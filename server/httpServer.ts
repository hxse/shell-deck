import { readFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import { createGeneratedSuffix } from '../src/lib/generatedId'
import type { MacroDefinitionV5 } from '../src/lib/macro/macroDefinitionTypes'
import { ContentEditLeaseService, type ContentEditLeaseServiceOptions } from './contentEditLeaseService'
import { handleContentRoutes } from './http/contentRoutes'
import type { HttpContext } from './http/httpContext'
import { errorResponse, json } from './http/httpPrimitives'
import { handlePageRoutes } from './http/pageRoutes'
import { handleRoomRoutes } from './http/roomRoutes'
import { handleRunnerRoutes } from './http/runnerRoutes'
import { LibraryStore } from './libraryStore'
import { MacroRunStore } from './macroRunStore'
import { MacroRunnerService } from './macroRunnerService'
import { relocateNotificationConfig } from './notificationConfigRelocation'
import { NotificationService } from './notificationService'
import {
  createRoomWebSocketHandler,
  handleRoomWebSocketUpgrade,
  type RoomSocketData,
} from './roomWebSocketTransport'
import { createServerPidRecord, parseServerPidRecord } from './serverProcessIdentity'
import { MacroRecordStore, type SharedContentStoreOptions } from './sharedContentStore'
import { ROOM_CONTROL_HEARTBEAT_MS, TerminalRoomManager } from './terminalRoomManager'
import { initializeUserDataRoot, resolveUserDataRoot, writePrivateFileAtomic } from './userDataRoot'

export type ShellDeckServer = {
  url: string
  port: number
  manager: TerminalRoomManager
  contentEditLeases: ContentEditLeaseService
  libraryStore: LibraryStore
  macroStore: MacroRecordStore<MacroDefinitionV5>
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
  libraryStoreOptions?: SharedContentStoreOptions
  macroStoreOptions?: SharedContentStoreOptions
}

export type ServerCliOptions = {
  host: string
  port: number
  dataRoot?: string
  pidFile?: string
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
  const libraryStore = new LibraryStore(userDataRoot, options.libraryStoreOptions)
  const macroStore = new MacroRecordStore<MacroDefinitionV5>(userDataRoot, options.macroStoreOptions)
  const macroRunStore = new MacroRunStore(userDataRoot)
  const macroRunner = new MacroRunnerService(manager, macroStore, macroRunStore, notificationService, agentEventStore)
  manager.setActiveRunProvider((roomId, roomGeneration) => macroRunner.hasActiveRun(roomId, roomGeneration))
  manager.addDestroyHook((roomId, roomGeneration) => macroRunner.destroyRoom(roomId, roomGeneration))

  const httpContext: HttpContext = {
    manager,
    contentEditLeases,
    agentEventStore,
    ingestToken,
    notificationService,
    libraryStore,
    macroStore,
    macroRunner,
  }
  const websocket = createRoomWebSocketHandler(httpContext)

  let stopPromise: Promise<void> | null = null
  let server: ReturnType<typeof Bun.serve<RoomSocketData>>
  server = Bun.serve<RoomSocketData>({
    hostname: host,
    port: options.port ?? 5177,
    async fetch(req, bunServer) {
      const url = new URL(req.url)
      const websocketUpgrade = handleRoomWebSocketUpgrade(req, url, bunServer, httpContext)
      if (websocketUpgrade.handled) return websocketUpgrade.response

      try {
        const roomResponse = await handleRoomRoutes(req, url, httpContext)
        if (roomResponse) return roomResponse

        const contentResponse = await handleContentRoutes(req, url, httpContext)
        if (contentResponse) return contentResponse

        const runnerResponse = await handleRunnerRoutes(req, url, httpContext)
        if (runnerResponse) return runnerResponse

        if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'route_not_found' }, 404)

        const pageResponse = handlePageRoutes(req, url, httpContext)
        if (pageResponse) return pageResponse
        throw new Error('route_not_found')
      } catch (error) {
        return errorResponse(error, url.pathname.startsWith('/api/'))
      }
    },
    websocket,
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
    libraryStore,
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
