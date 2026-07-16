import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { PROFILE_CATALOG_SUMMARY } from '../src/lib/parser/profileCatalogSummary'
import { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import { assertGeneratedId, assertRoomRouteToken, createGeneratedSuffix } from '../src/lib/generatedId'
import { assertContentResourceKey } from '../src/lib/contentEditLease'
import type { FlowV2Node, MacroDefinitionV3 } from '../src/lib/macro/macroDefinitionTypes'
import { validateMacroDefinitionV3, validateMacroTerminalLayout } from '../src/lib/macro/macroDefinitionValidation'
import type { ClientMessage, ServerMessage } from '../src/lib/protocol'
import { parseClientMessage } from '../src/lib/protocol'
import {
  ROOM_CONTROL_CLIENT_HEADER,
  ROOM_CONTROL_EPOCH_HEADER,
  ROOM_CONTROL_LEASE_HEADER,
  type RoomControlBearer,
} from '../src/lib/roomControl'
import type { TerminalRef } from '../src/lib/terminalIdentity'
import { agentEventTokenFromRequest, ingestAgentEvent } from './agentEventIngest'
import { ContentEditLeaseService, type ContentEditLeaseServiceOptions } from './contentEditLeaseService'
import { relocateNotificationConfig } from './notificationConfigRelocation'
import { NotificationService } from './notificationService'
import { createServerPidRecord, parseServerPidRecord } from './serverProcessIdentity'
import { MacroRunStore } from './macroRunStore'
import { MacroRunnerService } from './macroRunnerService'
import { MacroRecordStore, type SharedContentStoreOptions } from './sharedContentStore'
import { ROOM_CONTROL_HEARTBEAT_MS, TerminalRoomManager, type RoomSummary } from './terminalRoomManager'
import { WebSocketSendQueue } from './webSocketSendQueue'
import { initializeUserDataRoot, resolveUserDataRoot, writePrivateFileAtomic } from './userDataRoot'

export type ShellDeckServer = {
  url: string
  port: number
  manager: TerminalRoomManager
  contentEditLeases: ContentEditLeaseService
  macroStore: MacroRecordStore<MacroDefinitionV3>
  macroRunner: MacroRunnerService
  userDataRoot: string
  stop(): Promise<void>
}

export type StartOptions = {
  host?: string
  port?: number
  manager?: TerminalRoomManager
  dataRoot?: string
  contentEditLeaseOptions?: ContentEditLeaseServiceOptions
  macroStoreOptions?: SharedContentStoreOptions
}

export type ServerCliOptions = {
  host: string
  port: number
  dataRoot?: string
  pidFile?: string
}

type SocketData = {
  clientId: string
  roomId: string
  roomGeneration: string
  sender: WebSocketSendQueue | null
  terminationTimer: ReturnType<typeof setTimeout> | null
}

export function startShellDeckServer(options: StartOptions = {}): ShellDeckServer {
  const host = options.host ?? '127.0.0.1'
  if (host !== '127.0.0.1' && process.env.SHELL_DECK_ALLOW_LAN !== '1') throw new Error('lan_bind_requires_explicit_enable')
  const userDataRoot = resolve(options.dataRoot ?? resolveUserDataRoot())
  initializeUserDataRoot(userDataRoot, (warning) => console.warn(warning.code + ':' + warning.path))
  const manager = options.manager ?? new TerminalRoomManager()
  const contentEditLeases = new ContentEditLeaseService(userDataRoot, manager, {
    ...options.contentEditLeaseOptions,
    onChanged: (resourceKey, view) => {
      manager.broadcastAllClients((roomId, roomGeneration) => ({
        type: 'content_edit_lease_changed',
        roomId,
        roomGeneration,
        resourceKey,
        view,
      }))
    },
  })
  manager.setControlLostHook(async (context) => await contentEditLeases.releaseForController(context))
  manager.setControlHeartbeatHook(async (context) => await contentEditLeases.renewForController(context))
  manager.addDestroyHook(async (roomId, roomGeneration) => await contentEditLeases.releaseForRoom(roomId, roomGeneration))
  const agentEventStore = new AgentEventStore(userDataRoot)
  const ingestToken = createGeneratedSuffix() + createGeneratedSuffix()

  let notificationError: string | null = null
  try {
    const relocationEnv = options.dataRoot === undefined
      ? process.env
      : { ...process.env, SHELL_DECK_DATA_ROOT: userDataRoot }
    relocateNotificationConfig({ root: userDataRoot, env: relocationEnv })
  }
  catch (error) {
    notificationError = error instanceof Error ? error.message : String(error)
    console.warn(notificationError)
  }
  const notificationService = new NotificationService(userDataRoot, fetch, 10_000, notificationError)
  const macroStore = new MacroRecordStore<MacroDefinitionV3>(userDataRoot, options.macroStoreOptions)
  const macroRunStore = new MacroRunStore(userDataRoot)
  const macroRunner = new MacroRunnerService(manager, macroStore, macroRunStore, notificationService, agentEventStore)
  manager.setActiveRunProvider((roomId, roomGeneration) => macroRunner.hasActiveRun(roomId, roomGeneration))
  manager.addDestroyHook((roomId, roomGeneration) => macroRunner.destroyRoom(roomId, roomGeneration))

  let stopPromise: Promise<void> | null = null
  let server: ReturnType<typeof Bun.serve<SocketData>>
  server = Bun.serve<SocketData>({
    hostname: host,
    port: options.port ?? 5177,
    async fetch(req, bunServer) {
      const url = new URL(req.url)
      const websocketRoomId = websocketRoomRoute(url.pathname)
      if (websocketRoomId) {
        try { assertNoQuery(url) } catch (error) { return errorResponse(error, true) }
        let summary: RoomSummary
        try { summary = manager.roomSummaryById(websocketRoomId) }
        catch (error) { return errorResponse(error, true) }
        const upgraded = bunServer.upgrade(req, {
          data: { clientId: '', roomId: summary.roomId, roomGeneration: summary.roomGeneration, sender: null, terminationTimer: null },
        })
        return upgraded ? undefined : json({ ok: false, error: 'websocket_upgrade_failed' }, 400)
      }
      if (url.pathname.startsWith('/ws')) return json({ ok: false, error: 'route_not_found' }, 404)

      try {
        return await handleHttp(req, url, manager, contentEditLeases, agentEventStore, ingestToken, notificationService, macroStore, macroRunner)
      } catch (error) {
        return errorResponse(error, url.pathname.startsWith('/api/'))
      }
    },
    websocket: {
      open(ws) {
        const sender = new WebSocketSendQueue({ target: ws, onFatal: (reason) => ws.close(1011, reason) })
        ws.data.sender = sender
        try {
          const client = manager.connectClient(
            ws.data.roomId,
            (message) => sender.send(JSON.stringify(message)),
            (code, reason) => {
              if (ws.data.terminationTimer) clearTimeout(ws.data.terminationTimer)
              ws.data.terminationTimer = setTimeout(() => {
                ws.data.terminationTimer = null
                try { ws.terminate() } catch {}
              }, 100)
              try { ws.close(code, reason) } catch {}
            },
            () => ws.ping(),
          )
          if (client.roomGeneration !== ws.data.roomGeneration) throw new Error('room_generation_conflict')
          ws.data.clientId = client.clientId
          sender.send(JSON.stringify({ type: 'runner_snapshot', snapshot: macroRunner.snapshot(ws.data.roomId) } satisfies ServerMessage))
        } catch (error) {
          sender.send(JSON.stringify({ type: 'terminal_error', roomId: ws.data.roomId, roomGeneration: ws.data.roomGeneration, reason: errorMessage(error) } satisfies ServerMessage))
          ws.close(4004, 'room_not_found')
        }
      },
      async message(ws, raw) {
        const send = (reply: ServerMessage) => ws.data.sender?.send(JSON.stringify(reply))
        try {
          const message = parseClientMessage(typeof raw === 'string' ? raw : raw.toString())
          await handleClientMessage(manager, ws.data.clientId, ws.data.roomId, message, send)
        } catch (error) {
          send({ type: 'terminal_error', roomId: ws.data.roomId, roomGeneration: ws.data.roomGeneration, reason: errorMessage(error) })
        }
      },
      drain(ws) { ws.data.sender?.notifyDrain() },
      pong(ws) {
        if (ws.data.clientId) manager.noteClientPong(ws.data.clientId)
      },
      close(ws) {
        if (ws.data.terminationTimer) clearTimeout(ws.data.terminationTimer)
        ws.data.terminationTimer = null
        ws.data.sender?.dispose()
        if (ws.data.clientId) manager.disconnectClient(ws.data.clientId)
      },
    },
  })

  const heartbeatTimer = setInterval(() => manager.heartbeatSweep(), ROOM_CONTROL_HEARTBEAT_MS)
  heartbeatTimer.unref?.()

  manager.setTerminalEnvProvider((context) => ({
    SHELL_DECK_SERVER_INSTANCE_ID: context.serverInstanceId,
    SHELL_DECK_ROOM_ID: context.roomId,
    SHELL_DECK_ROOM_GENERATION: context.roomGeneration,
    SHELL_DECK_TERMINAL_ID: context.terminalId,
    SHELL_DECK_LAUNCH_ID: context.launchId,
    SHELL_DECK_INGEST_URL: 'http://127.0.0.1:' + server.port + '/api/rooms/' + context.roomId + '/agent-events',
    SHELL_DECK_INGEST_TOKEN: ingestToken,
  }))

  return {
    url: 'http://' + server.hostname + ':' + server.port,
    port: server.port ?? 0,
    manager,
    contentEditLeases,
    macroStore,
    macroRunner,
    userDataRoot,
    stop() {
      stopPromise ??= (async () => {
        clearInterval(heartbeatTimer)
        const transportStop = Promise.resolve(server.stop(true))
        await manager.destroyAllRooms()
        await finishHttpTransportStop(server, transportStop)
      })()
      return stopPromise
    },
  }
}

async function handleHttp(
  req: Request,
  url: URL,
  manager: TerminalRoomManager,
  contentEditLeases: ContentEditLeaseService,
  agentEventStore: AgentEventStore,
  ingestToken: string,
  notificationService: NotificationService,
  macroStore: MacroRecordStore<MacroDefinitionV3>,
  macroRunner: MacroRunnerService,
): Promise<Response> {
  if (url.pathname === '/health') {
    assertNoQuery(url)
    return json({ ok: true, serverInstanceId: manager.serverInstanceId })
  }

  if (url.pathname === '/api/rooms') {
    assertNoQuery(url)
    if (req.method === 'GET') return json({ ok: true, rooms: manager.listRooms(), maxLiveRooms: manager.maxLiveRooms })
    if (req.method === 'POST') {
      if ((await req.text()).length !== 0) throw new Error('room_create_body_must_be_empty')
      const room = manager.createRoom()
      return json({ ok: true, room, url: '/' + room.roomId }, 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  const roomControlAcquire = /^\/api\/rooms\/([^/]+)\/control\/acquire$/.exec(url.pathname)
  if (roomControlAcquire) {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const roomId = assertRoomRouteToken(decodeURIComponent(roomControlAcquire[1]))
    const body = await exactObject(req, ['expectedControlEpoch'])
    const clientId = roomControlClientId(req)
    manager.roomControlView(roomId, clientId)
    const grant = manager.acquireRoomControl(clientId, body.expectedControlEpoch as number)
    return json({ ok: true, view: manager.roomControlView(roomId, clientId), grant })
  }

  const roomControlTakeOver = /^\/api\/rooms\/([^/]+)\/control\/take-over$/.exec(url.pathname)
  if (roomControlTakeOver) {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const roomId = assertRoomRouteToken(decodeURIComponent(roomControlTakeOver[1]))
    const body = await exactObject(req, ['expectedControlEpoch', 'confirmed'])
    const clientId = roomControlClientId(req)
    manager.roomControlView(roomId, clientId)
    const grant = await manager.takeOverRoomControl(clientId, body.expectedControlEpoch as number, body.confirmed === true)
    return json({ ok: true, view: manager.roomControlView(roomId, clientId), grant })
  }

  const roomControlRelease = /^\/api\/rooms\/([^/]+)\/control$/.exec(url.pathname)
  if (roomControlRelease) {
    assertNoQuery(url)
    if (req.method !== 'DELETE') return methodNotAllowed(['DELETE'])
    const roomId = assertRoomRouteToken(decodeURIComponent(roomControlRelease[1]))
    await exactObject(req, [])
    await manager.releaseRoomControl(roomControlBearer(req), roomId)
    return json({ ok: true })
  }

  if (url.pathname === '/api/content-edit-leases/acquire') {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const body = await exactObject(req, ['resourceKey', 'expectedLeaseEpoch'])
    const resourceKey = assertContentResourceKey(body.resourceKey)
    const result = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
      await contentEditLeases.acquire(ticket, resourceKey, body.expectedLeaseEpoch as number)
    ))
    return json({ ok: true, ...result })
  }

  if (url.pathname === '/api/content-edit-leases/view') {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const body = await exactObject(req, ['resourceKey'])
    const view = await contentEditLeases.view(assertContentResourceKey(body.resourceKey))
    return json({ ok: true, view })
  }

  if (url.pathname === '/api/content-edit-leases/take-over') {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const body = await exactObject(req, ['resourceKey', 'expectedLeaseEpoch', 'confirmed'])
    const resourceKey = assertContentResourceKey(body.resourceKey)
    const result = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
      await contentEditLeases.takeOver(ticket, resourceKey, body.expectedLeaseEpoch as number, body.confirmed === true)
    ))
    return json({ ok: true, ...result })
  }

  if (url.pathname === '/api/templates') {
    assertNoQuery(url)
    if (req.method === 'GET') {
      const templates = macroStore.list().map((record) => {
        const validated = validateMacroDefinitionV3(record.definition)
        if (!validated.ok) throw new Error('invalid_macro_record_definition')
        return {
          id: record.id,
          revision: record.revision,
          name: validated.value.name,
          description: validated.value.description,
          updatedAt: record.updatedAt,
          stepCount: countMacroNodes(validated.value.body),
        }
      })
      return json({ ok: true, templates })
    }
    if (req.method === 'POST') {
      const body = await exactObject(req, ['definition'])
      const validation = validateMacroDefinitionV3(body.definition)
      if (!validation.ok) return json({ ok: false, error: 'invalid_macro_definition', issues: validation.issues }, 400)
      const template = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => {
        ticket.assertAuthorized()
        return await macroStore.create(validation.value, ticket.signal, () => ticket.assertAuthorized())
      })
      manager.broadcastAllClients(() => ({
        type: 'content_record_changed',
        resourceKey: { kind: 'macro', itemId: template.id },
        operation: 'saved',
        revision: template.revision,
      }))
      return json({ ok: true, template }, 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  const templateRoute = /^\/api\/templates\/([^/]+)$/.exec(url.pathname)
  if (templateRoute) {
    assertNoQuery(url)
    const templateId = assertGeneratedId(decodeURIComponent(templateRoute[1]), 'macroTemplate')
    if (req.method === 'GET') {
      const template = macroStore.read(templateId)
      if (!validateMacroDefinitionV3(template.definition).ok) throw new Error('invalid_macro_record_definition')
      return json({ ok: true, template })
    }
    if (req.method === 'PUT') {
      const body = await exactObject(req, ['expectedRevision', 'editLeaseId', 'definition'])
      const validation = validateMacroDefinitionV3(body.definition)
      if (!validation.ok) return json({ ok: false, error: 'invalid_macro_definition', issues: validation.issues }, 400)
      const expectedRevision = assertPositiveRevision(body.expectedRevision)
      const editLeaseId = assertGeneratedId(body.editLeaseId, 'contentEditLease')
      const committed = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => (
        await contentEditLeases.commit(
          ticket,
          { kind: 'macro', itemId: templateId },
          editLeaseId,
          expectedRevision,
          (_path, currentRevision) => macroStore.commitUpdate(templateId, currentRevision, validation.value),
        )
      ))
      const template = committed.value
      manager.broadcastAllClients(() => ({
        type: 'content_record_changed',
        resourceKey: { kind: 'macro', itemId: template.id },
        operation: 'saved',
        revision: template.revision,
      }))
      return json({ ok: true, template, leaseOutcome: committed.leaseOutcome })
    }
    if (req.method === 'DELETE') {
      if ((await req.text()).length !== 0) throw new Error('request_body_must_be_empty')
      const expectedRevision = parseIfMatch(req)
      const editLeaseId = contentEditLeaseHeader(req)
      const committed = await manager.runControlledBearerPublishedOperation(roomControlBearer(req), async (ticket) => (
        await contentEditLeases.commit(
          ticket,
          { kind: 'macro', itemId: templateId },
          editLeaseId,
          expectedRevision,
          (_path, currentRevision) => macroStore.commitDelete(templateId, currentRevision),
          { deleteRecord: true },
        )
      ))
      manager.broadcastAllClients(() => ({
        type: 'content_record_changed',
        resourceKey: { kind: 'macro', itemId: templateId },
        operation: 'deleted',
        revision: null,
      }))
      return json({ ok: true, leaseOutcome: committed.leaseOutcome })
    }
    return methodNotAllowed(['GET', 'PUT', 'DELETE'])
  }

  const prepareRoute = /^\/api\/rooms\/([^/]+)\/terminals\/prepare$/.exec(url.pathname)
  if (prepareRoute) {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const roomId = assertRoomRouteToken(decodeURIComponent(prepareRoute[1]))
    const body = await exactObject(req, ['terminalLayout', 'expectedTerminalStructureRevision'])
    const layout = validateMacroTerminalLayout(body.terminalLayout)
    if (!layout.ok) return json({ ok: false, error: 'invalid_terminal_layout', issues: layout.issues }, 400)
    const expectedRevision = assertTerminalStructureRevision(body.expectedTerminalStructureRevision)
    const result = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
      await manager.runTerminalStructureOperation(ticket, expectedRevision, async () => {
        for (const required of layout.value) {
          ticket.assertAuthorized()
          const positions = manager.terminalPositions(roomId)
          const current = positions[required.index - 1]
          if (current?.type === required.type) continue
          const later = positions.slice(required.index).find((position) => position.type === required.type)
          try {
            if (later) manager.moveTerminal(roomId, later.terminalId, required.index)
            else manager.createTerminal(roomId, { backend: required.type === 'text' ? 'text' : 'real', insertAtIndex: required.index })
          } catch (error) {
            const code = errorMessage(error)
            if (code.startsWith('room_') || code.startsWith('terminal_structure_')) throw error
            const snapshot = manager.roomSnapshot(roomId)
            return { ok: false as const, error: 'terminal_prepare_backend_failed', failedIndex: required.index, operation: later ? 'move' : 'create', snapshot }
          }
          ticket.assertAuthorized()
        }
        return { ok: true as const, snapshot: manager.roomSnapshot(roomId) }
      })
    ), roomId)
    return json(result, result.ok ? 200 : 409)
  }

  const runnerRoute = /^\/api\/rooms\/([^/]+)\/runner(?:\/(start|pause|resume|stop|input-draft|input))?$/.exec(url.pathname)
  const runnerTracesRoute = /^\/api\/rooms\/([^/]+)\/runner\/traces$/.exec(url.pathname)
  if (runnerTracesRoute) {
    assertNoQuery(url)
    if (req.method !== 'GET') return methodNotAllowed(['GET'])
    const roomId = assertRoomRouteToken(decodeURIComponent(runnerTracesRoute[1]))
    manager.roomSummaryById(roomId)
    return json({ ok: true, traces: macroRunner.traces(roomId) })
  }
  if (runnerRoute) {
    assertNoQuery(url)
    const roomId = assertRoomRouteToken(decodeURIComponent(runnerRoute[1]))
    const action = runnerRoute[2]
    if (!action) {
      if (req.method !== 'GET') return methodNotAllowed(['GET'])
      return json({ ok: true, runner: macroRunner.snapshot(roomId) })
    }
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    if (action === 'start') {
      const body = await exactObject(req, ['templateId', 'expectedMacroRevision', 'expectedTerminalStructureRevision'])
      const templateId = assertGeneratedId(body.templateId, 'macroTemplate')
      const expectedMacroRevision = assertPositiveRevision(body.expectedMacroRevision)
      const expectedStructureRevision = assertTerminalStructureRevision(body.expectedTerminalStructureRevision)
      const runner = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
        await manager.runTerminalStructureOperation(ticket, expectedStructureRevision, async () => (
          await macroRunner.start(ticket, templateId, expectedMacroRevision, expectedStructureRevision)
        ))
      ), roomId)
      return json({ ok: true, runner }, 201)
    }
    const body = action === 'input' || action === 'input-draft'
      ? await exactObject(req, ['invocationId', 'value', 'expectedInputRevision'])
      : await exactObject(req, [])
    const runner = await manager.runControlledBearerOperation(roomControlBearer(req), (ticket) => {
      ticket.assertAuthorized()
      if (action === 'pause') return macroRunner.pause(roomId)
      if (action === 'resume') return macroRunner.resume(roomId)
      if (action === 'stop') return macroRunner.stop(roomId)
      if (typeof body.value !== 'string') throw new Error('runner_input_must_be_string')
      const invocationId = assertGeneratedId(body.invocationId, 'runnerInput')
      const expectedInputRevision = assertNonNegativeRevision(body.expectedInputRevision, 'invalid_runner_input_revision')
      return action === 'input-draft'
        ? macroRunner.updateInputDraft(roomId, invocationId, body.value, expectedInputRevision)
        : macroRunner.submitInput(roomId, invocationId, body.value, expectedInputRevision)
    }, roomId)
    return json({ ok: true, runner })
  }

  const contentLeaseRelease = /^\/api\/content-edit-leases\/([^/]+)$/.exec(url.pathname)
  if (contentLeaseRelease) {
    assertNoQuery(url)
    if (req.method !== 'DELETE') return methodNotAllowed(['DELETE'])
    await exactObject(req, [])
    const editLeaseId = assertGeneratedId(decodeURIComponent(contentLeaseRelease[1]), 'contentEditLease')
    const view = await manager.runControlledBearerOperation(roomControlBearer(req), async (ticket) => (
      await contentEditLeases.release(ticket, editLeaseId)
    ))
    return json({ ok: true, view })
  }

  const roomApi = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname)
  if (roomApi) {
    assertNoQuery(url)
    const roomId = assertRoomRouteToken(decodeURIComponent(roomApi[1]))
    if (req.method !== 'DELETE') return methodNotAllowed(['DELETE'])
    const body = await exactObject(req, ['expectedRoomGeneration'])
    if (typeof body.expectedRoomGeneration !== 'string') throw new Error('expected_room_generation_required')
    await manager.destroyRoom(roomId, body.expectedRoomGeneration)
    return json({ ok: true })
  }

  const ingest = /^\/api\/rooms\/([^/]+)\/agent-events$/.exec(url.pathname)
  if (ingest) {
    assertNoQuery(url)
    if (req.method !== 'POST') return methodNotAllowed(['POST'])
    const roomId = assertRoomRouteToken(decodeURIComponent(ingest[1]))
    const result = ingestAgentEvent(await requestJson(req), agentEventTokenFromRequest(req), {
      roomId,
      expectedToken: ingestToken,
      manager,
      store: agentEventStore,
    })
    return result.ok ? json({ ok: true, event: result.event }, 201) : json(result, result.status)
  }

  if (url.pathname === '/api/notification-profiles/telegram') {
    if (req.method !== 'GET') return methodNotAllowed(['GET'])
    assertNoQuery(url)
    return json({ ok: true, profiles: notificationService.listTelegramProfileIds() })
  }

  if (url.pathname === '/api/macro/profile-catalog') {
    if (req.method !== 'GET') return methodNotAllowed(['GET'])
    assertNoQuery(url)
    return json({ ok: true, profileCatalog: PROFILE_CATALOG_SUMMARY })
  }

  if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'route_not_found' }, 404)

  const asset = req.method === 'GET' ? serveStaticAsset(url.pathname) : null
  if (asset) return asset
  if (req.method !== 'GET') return methodNotAllowed(['GET'])

  if (url.pathname === '/') {
    assertNoQuery(url)
    const entry = manager.ensureRootRoom()
    if (entry.kind === 'created') {
      return new Response(null, {
        status: 302,
        headers: { location: '/' + entry.room.roomId, 'cache-control': 'no-store, private' },
      })
    }
    return serveIndex()
  }

  if (!/^\/[^/]+$/.test(url.pathname)) return notFoundPage('route_not_found')
  assertNoQuery(url)
  const roomId = assertRoomRouteToken(decodeURIComponent(url.pathname.slice(1)))
  manager.ensureRoomFromRoute(roomId)
  return serveIndex()
}

async function handleClientMessage(manager: TerminalRoomManager, clientId: string, roomId: string, message: ClientMessage, send: (message: ServerMessage) => void): Promise<void> {
  if (message.type !== 'request_replay' && message.type !== 'request_snapshot') {
    if (isTerminalStructureMessage(message)) {
      await manager.runControlledClientOperation(clientId, async (ticket) => (
        await manager.runTerminalStructureMutation(ticket, () => handleMutatingClientMessage(manager, roomId, message, send))
      ))
    } else manager.runControlledClientMutation(clientId, () => handleMutatingClientMessage(manager, roomId, message, send))
    return
  }
  if (message.type === 'request_replay') send(manager.requestReplay(roomId, terminalRefFromMessage(message)))
  else send(manager.roomSnapshot(roomId))
}

function isTerminalStructureMessage(message: ClientMessage): boolean {
  return message.type === 'create_terminal' || message.type === 'reorder_terminal' || message.type === 'close_terminal' || message.type === 'reset_terminal'
}

function handleMutatingClientMessage(manager: TerminalRoomManager, roomId: string, message: Exclude<ClientMessage, { type: 'request_replay' | 'request_snapshot' }>, send: (message: ServerMessage) => void): void {
  switch (message.type) {
    case 'create_terminal': {
      const terminal = manager.createTerminal(roomId, { backend: message.backend, cols: message.cols, rows: message.rows, cwd: message.cwd, cwdSource: message.cwdSource })
      send({ type: 'terminal_created', roomId: terminal.roomId, roomGeneration: terminal.roomGeneration, terminalId: terminal.terminalId })
      return
    }
    case 'terminal_input':
      manager.input(roomId, terminalRefFromMessage(message), message.data)
      return
    case 'set_terminal_text':
      manager.setTextContent(roomId, terminalRefFromMessage(message), message.content)
      return
    case 'terminal_resize':
      manager.resize(roomId, terminalRefFromMessage(message), message.cols, message.rows)
      return
    case 'reorder_terminal':
      manager.moveTerminal(roomId, message.terminalId, message.newIndex)
      return
    case 'close_terminal':
      manager.closeTerminal(roomId, terminalRefFromMessage(message))
      return
    case 'reset_terminal': {
      const result = manager.resetTerminal(roomId, terminalRefFromMessage(message), message.backend)
      if (!result.ok) send({ type: 'terminal_error', ...roomContext(manager, roomId), reason: result.reason })
      return
    }
  }
}

function terminalRefFromMessage(message: { terminalId?: string; terminalIndex?: number }): TerminalRef {
  if (message.terminalId !== undefined) return { kind: 'id', value: message.terminalId }
  if (message.terminalIndex !== undefined) return { kind: 'index', value: message.terminalIndex }
  throw new Error('terminal_ref_must_have_exactly_one_selector')
}

function roomContext(manager: TerminalRoomManager, roomId: string) {
  const room = manager.roomSummaryById(roomId)
  return { roomId: room.roomId, roomGeneration: room.roomGeneration }
}

function websocketRoomRoute(pathname: string): string | null {
  const match = /^\/ws\/rooms\/([^/]+)$/.exec(pathname)
  if (!match) return null
  try { return assertRoomRouteToken(decodeURIComponent(match[1])) }
  catch { return null }
}

function serveStaticAsset(pathname: string): Response | null {
  if (!pathname.startsWith('/assets/') && pathname !== '/favicon.ico') return null
  const dist = resolve(import.meta.dir, '..', 'dist')
  const target = resolve(dist, '.' + pathname)
  if (!target.startsWith(dist + '/') || !existsSync(target)) return null
  return new Response(Bun.file(target), { headers: { 'content-type': contentType(target) } })
}

function serveIndex(): Response {
  const built = resolve(import.meta.dir, '..', 'dist', 'index.html')
  const fallback = resolve(import.meta.dir, '..', 'index.html')
  const path = existsSync(built) ? built : fallback
  if (!existsSync(path)) return new Response('shell-deck', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return new Response(readFileSync(path), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

function notFoundPage(error: string): Response {
  return new Response('<!doctype html><meta charset="utf-8"><title>shell-deck</title><p>' + escapeHtml(error) + '</p><a href="/">Home</a>', {
    status: error === 'room_capacity_reached' ? 409 : 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function errorResponse(error: unknown, api: boolean): Response {
  const message = errorMessage(error)
  const status = errorStatus(message)
  return api ? json({ ok: false, error: message }, status) : notFoundPage(message)
}

function errorStatus(message: string): number {
  if (message === 'room_not_found' || message === 'route_not_found') return 404
  if (
    message === 'room_capacity_reached'
    || message === 'room_destroying'
    || message === 'room_generation_conflict'
    || message.startsWith('room_control_')
    || message.startsWith('content_edit_')
    || message === 'content_revision_conflict'
    || message === 'terminal_structure_revision_conflict'
    || message === 'room_structure_locked_by_run'
    || message === 'macro_revision_conflict'
    || message === 'run_already_active'
    || message.startsWith('runner_input_')
    || message === 'runner_not_waiting_input'
  ) return 409
  if (message.startsWith('macro_record_not_found:')) return 404
  if (message.includes('permissions_too_open')) return 503
  return 400
}

function assertPositiveRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('invalid_macro_revision')
  return value as number
}

function assertTerminalStructureRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error('invalid_terminal_structure_revision')
  return value as number
}

function assertNonNegativeRevision(value: unknown, error: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(error)
  return value as number
}

function parseIfMatch(req: Request): number {
  const value = req.headers.get('if-match')
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new Error('invalid_macro_revision')
  return Number(value)
}

function contentEditLeaseHeader(req: Request): string {
  const value = req.headers.get('x-shell-deck-content-edit-lease')
  if (!value) throw new Error('content_edit_lease_required')
  return assertGeneratedId(value, 'contentEditLease')
}

function countMacroNodes(nodes: FlowV2Node[]): number {
  let count = 0
  const visit = (items: FlowV2Node[]) => {
    for (const node of items) {
      count += 1
      if (node.type === 'if') {
        for (const branch of node.branches) visit(branch.body)
        if (node.else) visit(node.else)
      }
      if (node.type === 'for') visit(node.body)
      if (node.type === 'parallel') for (const lane of node.lanes) count += lane.body.length
      if ((node.type === 'break' || node.type === 'continue' || node.type === 'finish') && node.body) visit(node.body)
    }
  }
  visit(nodes)
  return count
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

function methodNotAllowed(allow: string[]): Response {
  return new Response('method_not_allowed', { status: 405, headers: { allow: allow.join(', ') } })
}

async function requestJson(req: Request): Promise<unknown> {
  const text = await req.text()
  if (!text) throw new Error('request_body_required')
  try { return JSON.parse(text) }
  catch { throw new Error('invalid_request_json') }
}

async function exactObject(req: Request, keys: string[]): Promise<Record<string, unknown>> {
  const value = await requestJson(req)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request_body_must_be_object')
  const record = value as Record<string, unknown>
  const unknown = Object.keys(record).find((key) => !keys.includes(key))
  if (unknown) throw new Error('request_unknown_field:' + unknown)
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(record, key))
  if (missing) throw new Error('request_missing_field:' + missing)
  return record
}

function roomControlClientId(req: Request): string {
  const value = req.headers.get(ROOM_CONTROL_CLIENT_HEADER)
  if (!value) throw new Error('room_control_required')
  try { return assertGeneratedId(value, 'client') }
  catch { throw new Error('room_control_required') }
}

function roomControlBearer(req: Request): RoomControlBearer {
  const clientId = req.headers.get(ROOM_CONTROL_CLIENT_HEADER)
  const controlLeaseId = req.headers.get(ROOM_CONTROL_LEASE_HEADER)
  const epochText = req.headers.get(ROOM_CONTROL_EPOCH_HEADER)
  if (!clientId || !controlLeaseId || !epochText) throw new Error('room_control_required')
  if (!/^(0|[1-9][0-9]*)$/.test(epochText)) throw new Error('room_control_lost')
  try {
    return {
      clientId: assertGeneratedId(clientId, 'client'),
      controlLeaseId: assertGeneratedId(controlLeaseId, 'roomControlLease'),
      controlEpoch: Number(epochText),
    }
  } catch {
    throw new Error('room_control_lost')
  }
}

function assertNoQuery(url: URL): void {
  if ([...url.searchParams].length > 0) throw new Error('query_not_supported')
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.ico': return 'image/x-icon'
    default: return 'application/octet-stream'
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

async function finishHttpTransportStop(server: { unref(): void }, stopping: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const drained = await Promise.race([
    stopping.then(() => true),
    new Promise<boolean>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), 250)
    }),
  ])
  if (timer) clearTimeout(timer)
  if (!drained) {
    server.unref()
    void stopping.catch(() => {})
  }
}

if (import.meta.main) {
  const cli = parseServerCliArgs(process.argv.slice(2))
  const server = startShellDeckServer({ host: cli.host, port: cli.port, dataRoot: cli.dataRoot })
  const pidFile = cli.pidFile ?? join(initializeUserDataRoot(server.userDataRoot).locks, 'server-' + cli.port + '.pid')
  const pidRecord = createServerPidRecord(process.pid, server.manager.serverInstanceId)
  writePrivateFileAtomic(pidFile, JSON.stringify(pidRecord) + '\n')
  let stopping = false
  const stop = async (exitCode: number) => {
    if (stopping) return
    stopping = true
    await server.stop()
    try {
      const current = parseServerPidRecord(readFileSync(pidFile, 'utf8'))
      if (current.pid === pidRecord.pid && current.processStartTime === pidRecord.processStartTime && current.serverInstanceId === pidRecord.serverInstanceId) unlinkSync(pidFile)
    } catch {}
    process.exit(exitCode)
  }
  process.once('SIGINT', () => { void stop(130) })
  process.once('SIGTERM', () => { void stop(143) })
  console.log('shell-deck listening on ' + server.url)
  console.log('shell-deck pid file ' + pidFile)
}

export function parseServerCliArgs(args: string[]): ServerCliOptions {
  const values = parseExactValueFlags(args, ['--host', '--port', '--data-root', '--pid-file'])
  const portText = values.get('--port') ?? '5177'
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('invalid_server_port')
  return {
    host: values.get('--host') ?? '127.0.0.1',
    port,
    ...(values.has('--data-root') ? { dataRoot: values.get('--data-root')! } : {}),
    ...(values.has('--pid-file') ? { pidFile: values.get('--pid-file')! } : {}),
  }
}

function parseExactValueFlags(args: string[], allowed: string[]): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) throw new Error('unexpected_server_argument:' + argument)
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument : argument.slice(0, separator)
    if (!allowed.includes(name)) throw new Error('unknown_server_option:' + name)
    if (values.has(name)) throw new Error('duplicate_server_option:' + name)
    const value = separator === -1 ? args[++index] : argument.slice(separator + 1)
    if (value === undefined || value.length === 0 || value.startsWith('--')) throw new Error('server_option_value_required:' + name)
    values.set(name, value)
  }
  return values
}
