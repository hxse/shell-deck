import { readFileSync, realpathSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import { createGeneratedSuffix } from '../src/lib/generatedId'
import type { MacroDefinitionV5 } from '../src/lib/macro/macroDefinitionTypes'
import { ServerAccessController, assertAccessMode, assertListenMode, listenHost, type AccessMode, type ListenMode } from './accessControl'
import { ContentEditLeaseService, type ContentEditLeaseServiceOptions } from './contentEditLeaseService'
import { handleContentRoutes } from './http/contentRoutes'
import type { HttpContext } from './http/httpContext'
import { errorResponse, json } from './http/httpPrimitives'
import { handlePageRoutes } from './http/pageRoutes'
import { handleRoomRoutes } from './http/roomRoutes'
import { handleRunnerRoutes } from './http/runnerRoutes'
import { LogStorageRetention } from './logStorageRetention'
import { formatLoginTokenForTerminal } from './loginTokenPresentation'
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

const SHELL_DECK_JUSTFILE = realpathSync(resolve(import.meta.dir, '../justfile'))

export type ShellDeckServer = {
  url: string
  port: number
  loginToken: string | null
  manager: TerminalRoomManager
  contentEditLeases: ContentEditLeaseService
  macroStore: MacroRecordStore<MacroDefinitionV5>
  macroRunner: MacroRunnerService
  userDataRoot: string
  stop(): Promise<void>
}

export type StartOptions = {
  accessMode: AccessMode
  listenMode: ListenMode
  port?: number
  devFrontendPort?: number
  manager?: TerminalRoomManager
  dataRoot?: string
  logStorageLimitBytes?: number
  contentEditLeaseOptions?: ContentEditLeaseServiceOptions
  macroStoreOptions?: SharedContentStoreOptions
}

export type ServerCliOptions = {
  accessMode: AccessMode
  listenMode: ListenMode
  port: number
  dataRoot?: string
  pidFile?: string
}

export function startShellDeckServer(options: StartOptions): ShellDeckServer {
  if (!options || options.accessMode === undefined) throw new Error('server_access_mode_required')
  if (options.listenMode === undefined) throw new Error('server_listen_mode_required')
  if (process.env.SHELL_DECK_ALLOW_LAN !== undefined) throw new Error('legacy_shell_deck_allow_lan_unsupported')
  const accessMode = assertAccessMode(options.accessMode)
  const listenMode = assertListenMode(options.listenMode)
  const host = listenHost(listenMode)
  const access = new ServerAccessController(accessMode, listenMode, options.devFrontendPort)
  const userDataRoot = resolve(options.dataRoot ?? resolveUserDataRoot())
  initializeUserDataRoot(userDataRoot, (warning) => console.warn(warning.code + ':' + warning.path))
  const manager = options.manager ?? new TerminalRoomManager()
  const logStorage = new LogStorageRetention(userDataRoot, {
    limitBytes: options.logStorageLimitBytes,
  })
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
  const macroStore = new MacroRecordStore<MacroDefinitionV5>(userDataRoot, options.macroStoreOptions)
  const macroRunStore = new MacroRunStore(
    userDataRoot,
    undefined,
    undefined,
    undefined,
    logStorage,
  )
  const agentEventStore = new AgentEventStore(userDataRoot, {
    admitAppend: (incomingBytes, publish) => logStorage.admitAndPublish(incomingBytes, publish),
    afterStreamClose: () => logStorage.afterAgentSegmentClose(),
  })
  logStorage.enforce()
  const ingestToken = createGeneratedSuffix() + createGeneratedSuffix()
  const macroRunner = new MacroRunnerService(manager, macroStore, macroRunStore, notificationService, agentEventStore)
  manager.setActiveRunProvider((roomId, roomGeneration) => macroRunner.hasActiveRun(roomId, roomGeneration))
  manager.addDestroyHook((roomId, roomGeneration) => macroRunner.destroyRoom(roomId, roomGeneration))
  manager.addDestroyHook((roomId, roomGeneration) => {
    agentEventStore.closeRoom(manager.serverInstanceId, roomId, roomGeneration)
  })

  const httpContext: HttpContext = {
    manager,
    contentEditLeases,
    agentEventStore,
    ingestToken,
    notificationService,
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
      try {
        const accessResponse = await access.admit(req, url)
        if (accessResponse) return accessResponse
        const websocketUpgrade = handleRoomWebSocketUpgrade(req, url, bunServer, httpContext)
        if (websocketUpgrade.handled) return websocketUpgrade.response

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
    SHELL_DECK_SUBMIT_JSON_URL: 'http://127.0.0.1:' + server.port + '/api/rooms/' + context.roomId + '/structured-results',
    SHELL_DECK_JUSTFILE,
    SHELL_DECK_INGEST_TOKEN: ingestToken,
  }))

  return {
    url: 'http://127.0.0.1:' + server.port,
    port: server.port ?? 0,
    loginToken: access.loginToken,
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
        agentEventStore.close()
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
  const devPortText = process.env.SHELL_DECK_DEV_FRONTEND_PORT
  const server = startShellDeckServer({ ...cli,
    devFrontendPort: devPortText === undefined ? undefined : Number(devPortText),
  })
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
  console.log('shell-deck listening on http://' + listenHost(cli.listenMode) + ':' + server.port)
  if (server.loginToken) console.log(formatLoginTokenForTerminal(server.loginToken))
  if (cli.accessMode === 'guest' && cli.listenMode === 'lan') {
    console.warn('WARNING: guest LAN grants every device that can reach this port full shell-deck capability.')
  }
  console.log('shell-deck pid file ' + pidFile)
}

export function parseServerCliArgs(args: string[]): ServerCliOptions {
  const values = parseExactValueFlags(args, ['--access-mode', '--listen-mode', '--port', '--data-root', '--pid-file'])
  if (!values.has('--access-mode')) throw new Error('server_access_mode_required')
  if (!values.has('--listen-mode')) throw new Error('server_listen_mode_required')
  const portText = values.get('--port') ?? '5177'
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('invalid_server_port')
  return {
    accessMode: assertAccessMode(values.get('--access-mode')),
    listenMode: assertListenMode(values.get('--listen-mode')),
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
