import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { parseConfigId } from '../src/lib/identifier'
import { PROFILE_CATALOG_SUMMARY } from '../src/lib/macro/profileCatalogSummary'
import { MacroTemplateStore } from '../src/lib/macro/templateStore'
import { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import { RunEventStore } from '../src/lib/runLog/runEventStore'
import { isRunEventKind } from '../src/lib/runLog/runEventSchema'
import type { AppendRunEventInput } from '../src/lib/runLog/runEventTypes'
import type { ClientMessage, ServerMessage, TerminalBackendKind } from '../src/lib/protocol'
import { parseClientMessage } from '../src/lib/protocol'
import { TerminalDeckManager } from './terminalDeckManager'
import { MacroRunnerService } from './macroRunnerService'
import { ParserRuntime, type AiJsonParserMode } from '../src/lib/parser/parserRuntime'
import { agentEventTokenFromRequest, ingestAgentEvent } from './agentEventIngest'
import { UiLayoutStore } from '../src/lib/workspace/uiLayoutStore'
import { PromptStore } from '../src/lib/prompts/promptStore'
import { NotificationService } from './notificationService'
import type { PromptScope, PromptScopeFilter } from '../src/lib/prompts/promptTypes'
import { WebSocketSendQueue } from './webSocketSendQueue'

export type ShellDeckServer = {
  url: string
  port: number
  manager: TerminalDeckManager
  stop(): void
}

type StartOptions = {
  host?: string
  port?: number
  manager?: TerminalDeckManager
  seed?: boolean
  aiJsonParser?: AiJsonParserMode
  seedBackend?: TerminalBackendKind
}

type RunnerAction = 'start' | 'pause' | 'resume' | 'stop' | 'input'

type RunnerActionRequest =
  | { action: 'start'; templateId: string }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'stop' }
  | { action: 'input'; text: string }

export function startShellDeckServer(options: StartOptions = {}): ShellDeckServer {
  const host = options.host ?? '127.0.0.1'
  const bindHost = host
  const manager = options.manager ?? new TerminalDeckManager()
  const templateStore = new MacroTemplateStore()
  const runEventStore = new RunEventStore()
  const agentEventStore = new AgentEventStore(runEventStore.rootDir)
  const uiLayoutStore = new UiLayoutStore()
  const promptStore = new PromptStore()
  const notificationService = new NotificationService(runEventStore.rootDir)
  const aiJsonParser = options.aiJsonParser ?? 'disabled'
  const macroRunner = new MacroRunnerService(manager, templateStore, runEventStore, agentEventStore, new ParserRuntime(runEventStore, { aiJsonMode: aiJsonParser }), notificationService)
  runEventStore.subscribe((update) => {
    manager.broadcastConfigMessage(update.configId, {
      type: 'run_log_updated',
      configId: update.configId,
      runId: update.runId,
      eventSeq: update.event.eventSeq,
      kind: update.event.kind,
    })
  })
  if (options.seed ?? true) {
    manager.ensureConfig('local')
    if (manager.indexMap('local').length === 0) {
      if (options.seedBackend) {
        manager.createTerminal('local', { backend: options.seedBackend })
        manager.createTerminal('local', { backend: options.seedBackend })
      } else {
        manager.createTerminal('local', { backend: 'real' })
        manager.createTerminal('local', { backend: 'real' })
        manager.createTerminal('local', { backend: 'text' })
      }
    }
  }

  const server = Bun.serve<{
    clientId: string
    configId: string
    sender: WebSocketSendQueue | null
  }>({
    hostname: host,
    port: options.port ?? 5177,
    async fetch(req, bunServer) {
      const url = new URL(req.url)
      if (url.pathname === '/ws') {
        const configId = parseConfigId(url.searchParams.get('configId'))
        const upgraded = bunServer.upgrade(req, { data: { clientId: '', configId, sender: null } })
        return upgraded ? undefined : new Response('upgrade failed', { status: 400 })
      }

      try {
        return await handleHttp(req, url, manager, bindHost, templateStore, runEventStore, macroRunner, agentEventStore, uiLayoutStore, promptStore, notificationService)
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    },
    websocket: {
      open(ws) {
        const sender = new WebSocketSendQueue({
          target: ws,
          onFatal: (reason) => ws.close(1011, reason),
        })
        ws.data.sender = sender
        const client = manager.connectClient(ws.data.configId, (message) => sender.send(JSON.stringify(message)))
        ws.data.clientId = client.clientId
      },
      message(ws, raw) {
        const send = (reply: ServerMessage) => ws.data.sender?.send(JSON.stringify(reply))
        try {
          const payload = typeof raw === 'string' ? raw : raw.toString()
          const message = parseClientMessage(payload)
          handleClientMessage(manager, ws.data.configId, message, send)
        } catch (error) {
          send({ type: 'terminal_error', configId: ws.data.configId, reason: error instanceof Error ? error.message : String(error) })
        }
      },
      drain(ws) {
        ws.data.sender?.notifyDrain()
      },
      close(ws) {
        ws.data.sender?.dispose()
        if (ws.data.clientId) {
          manager.disconnectClient(ws.data.clientId)
        }
      },
    },
  })


  manager.setTerminalEnvProvider((configId, terminalId, launchId) => ({
    SHELL_DECK_CONFIG_ID: configId,
    SHELL_DECK_TERMINAL_ID: terminalId,
    SHELL_DECK_LAUNCH_ID: launchId,
    SHELL_DECK_DATA_ROOT: runEventStore.rootDir,
    SHELL_DECK_INGEST_URL: bindHost === '127.0.0.1' ? 'http://' + server.hostname + ':' + server.port + '/api/agent-events' : undefined,
    SHELL_DECK_INGEST_TOKEN: process.env.SHELL_DECK_INGEST_TOKEN,
  }))

  return {
    url: 'http://' + server.hostname + ':' + server.port,
    port: server.port ?? 0,
    manager,
    stop: () => server.stop(true),
  }
}

async function handleHttp(req: Request, url: URL, manager: TerminalDeckManager, bindHost: string, templateStore: MacroTemplateStore, runEventStore: RunEventStore, macroRunner: MacroRunnerService, agentEventStore: AgentEventStore, uiLayoutStore: UiLayoutStore, promptStore: PromptStore, notificationService: NotificationService): Promise<Response> {
  if (url.pathname === '/health') {
    return json({ ok: true, bind: bindHost, aiJsonParser: macroRunner.parserRuntime.optionsLabel() })
  }

  const layoutMatch = new RegExp('^/api/configs/([^/]+)/ui-layout$').exec(url.pathname)
  if (layoutMatch && req.method === 'GET') {
    const configId = parseConfigId(layoutMatch[1])
    manager.ensureConfig(configId)
    return json({ ok: true, layout: uiLayoutStore.read(configId) })
  }
  if (layoutMatch && req.method === 'PUT') {
    const configId = parseConfigId(layoutMatch[1])
    manager.ensureConfig(configId)
    const layout = uiLayoutStore.save(configId, await requestJson(req))
    manager.broadcastConfigMessage(configId, { type: 'ui_layout_updated', configId, layout })
    return json({ ok: true, layout })
  }

  const configPromptsMatch = new RegExp('^/api/configs/([^/]+)/prompts$').exec(url.pathname)
  if (configPromptsMatch && req.method === 'GET') {
    const configId = parseConfigId(configPromptsMatch[1])
    manager.ensureConfig(configId)
    return json({ ok: true, prompts: promptStore.list(configId, { scope: parsePromptScopeFilter(url.searchParams.get('scope')), q: url.searchParams.get('q') ?? '' }) })
  }
  if (configPromptsMatch && req.method === 'POST') {
    const configId = parseConfigId(configPromptsMatch[1])
    manager.ensureConfig(configId)
    const prompt = promptStore.create('project', configId, await requestJson(req))
    broadcastPromptChange(manager, configId, 'created', prompt.promptId, 'project', 'project')
    return json({ ok: true, prompt }, 201)
  }

  const configPromptMatch = new RegExp('^/api/configs/([^/]+)/prompts/([^/]+)$').exec(url.pathname)
  if (configPromptMatch && req.method === 'GET') {
    const configId = parseConfigId(configPromptMatch[1])
    manager.ensureConfig(configId)
    return json({ ok: true, prompt: promptStore.read('project', configId, configPromptMatch[2]) })
  }
  if (configPromptMatch && req.method === 'PUT') {
    const configId = parseConfigId(configPromptMatch[1])
    manager.ensureConfig(configId)
    const prompt = promptStore.update('project', configId, configPromptMatch[2], await requestJson(req))
    broadcastPromptChange(manager, configId, prompt.scope === 'project' ? 'updated' : 'moved', prompt.promptId, 'project', prompt.scope)
    return json({ ok: true, prompt })
  }
  if (configPromptMatch && req.method === 'DELETE') {
    const configId = parseConfigId(configPromptMatch[1])
    manager.ensureConfig(configId)
    const promptId = configPromptMatch[2]
    promptStore.delete('project', configId, promptId)
    broadcastPromptChange(manager, configId, 'deleted', promptId, 'project', 'project')
    return json({ ok: true })
  }

  if (url.pathname === '/api/prompts/global' && req.method === 'GET') {
    const configId = parseConfigId(url.searchParams.get('configId') ?? 'local')
    return json({ ok: true, prompts: promptStore.list(configId, { scope: 'global', q: url.searchParams.get('q') ?? '' }) })
  }
  if (url.pathname === '/api/prompts/global' && req.method === 'POST') {
    const configId = parseConfigId(url.searchParams.get('configId') ?? 'local')
    const prompt = promptStore.create('global', configId, await requestJson(req))
    broadcastPromptChange(manager, configId, 'created', prompt.promptId, 'global', 'global')
    return json({ ok: true, prompt }, 201)
  }

  const globalPromptMatch = new RegExp('^/api/prompts/global/([^/]+)$').exec(url.pathname)
  if (globalPromptMatch && req.method === 'GET') {
    const configId = parseConfigId(url.searchParams.get('configId') ?? 'local')
    return json({ ok: true, prompt: promptStore.read('global', configId, globalPromptMatch[1]) })
  }
  if (globalPromptMatch && req.method === 'PUT') {
    const configId = parseConfigId(url.searchParams.get('configId') ?? 'local')
    const prompt = promptStore.update('global', configId, globalPromptMatch[1], await requestJson(req))
    broadcastPromptChange(manager, configId, prompt.scope === 'global' ? 'updated' : 'moved', prompt.promptId, 'global', prompt.scope)
    return json({ ok: true, prompt })
  }
  if (globalPromptMatch && req.method === 'DELETE') {
    const configId = parseConfigId(url.searchParams.get('configId') ?? 'local')
    const promptId = globalPromptMatch[1]
    promptStore.delete('global', configId, promptId)
    broadcastPromptChange(manager, configId, 'deleted', promptId, 'global', 'global')
    return json({ ok: true })
  }
  if (url.pathname === '/api/agent-events' && req.method === 'POST') {
    const result = ingestAgentEvent(await requestJson(req), agentEventTokenFromRequest(req), {
      bindHost,
      expectedToken: process.env.SHELL_DECK_INGEST_TOKEN,
      manager,
      store: agentEventStore,
    })
    if (!result.ok) return json({ ok: false, error: result.error }, result.status)
    return json({ ok: true, event: result.event }, 201)
  }
  if (url.pathname === '/api/macro/profile-catalog' && req.method === 'GET') {
    return json(PROFILE_CATALOG_SUMMARY)
  }
  if (url.pathname === '/api/notification-profiles/telegram' && req.method === 'GET') {
    try {
      return json({ ok: true, profiles: notificationService.listTelegramProfileIds().map((profileId) => ({ profileId })) })
    } catch (error) {
      return json({ ok: false, profiles: [], error: error instanceof Error ? error.message : 'notification_profiles_unavailable' })
    }
  }
  const snapshotMatch = /^\/api\/configs\/([^/]+)\/snapshot$/.exec(url.pathname)
  if (snapshotMatch && req.method === 'GET') {
    const configId = parseConfigId(snapshotMatch[1])
    manager.ensureConfig(configId)
    return json(manager.deckSnapshot(configId))
  }
  const terminalMatch = /^\/api\/configs\/([^/]+)\/terminals$/.exec(url.pathname)
  if (terminalMatch && req.method === 'POST') {
    const configId = parseConfigId(terminalMatch[1])
    const backendParam = url.searchParams.get('backend')
    const backend = backendParam === 'real' ? 'real' : backendParam === 'text' ? 'text' : 'fake'
    return json(manager.createTerminal(configId, { backend }))
  }
  const templatesMatch = /^\/api\/configs\/([^/]+)\/templates$/.exec(url.pathname)
  if (templatesMatch && req.method === 'GET') {
    const configId = parseConfigId(templatesMatch[1])
    manager.ensureConfig(configId)
    return json({ ok: true, templates: templateStore.list(configId) })
  }
  if (templatesMatch && req.method === 'POST') {
    const configId = parseConfigId(templatesMatch[1])
    manager.ensureConfig(configId)
    return json({ ok: true, template: templateStore.create(configId, manager.indexMap(configId)) }, 201)
  }
  const importMatch = /^\/api\/configs\/([^/]+)\/templates\/import$/.exec(url.pathname)
  if (importMatch && req.method === 'POST') {
    const configId = parseConfigId(importMatch[1])
    manager.ensureConfig(configId)
    const body = await requestJson(req)
    try {
      return json({ ok: true, template: templateStore.import(configId, body, manager.indexMap(configId)) }, 201)
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 422)
    }
  }
  const duplicateMatch = /^\/api\/configs\/([^/]+)\/templates\/([^/]+)\/duplicate$/.exec(url.pathname)
  if (duplicateMatch && req.method === 'POST') {
    const configId = parseConfigId(duplicateMatch[1])
    const templateId = duplicateMatch[2]
    manager.ensureConfig(configId)
    return json({ ok: true, template: templateStore.duplicate(configId, templateId, manager.indexMap(configId)) }, 201)
  }
  const exportMatch = /^\/api\/configs\/([^/]+)\/templates\/([^/]+)\/export$/.exec(url.pathname)
  if (exportMatch && req.method === 'GET') {
    const configId = parseConfigId(exportMatch[1])
    const templateId = exportMatch[2]
    manager.ensureConfig(configId)
    return json(templateStore.read(configId, templateId))
  }
  const templateMatch = /^\/api\/configs\/([^/]+)\/templates\/([^/]+)$/.exec(url.pathname)
  if (templateMatch && req.method === 'GET') {
    const configId = parseConfigId(templateMatch[1])
    const templateId = templateMatch[2]
    manager.ensureConfig(configId)
    return json({ ok: true, template: templateStore.read(configId, templateId) })
  }
  if (templateMatch && req.method === 'PUT') {
    const configId = parseConfigId(templateMatch[1])
    const templateId = templateMatch[2]
    manager.ensureConfig(configId)
    const body = await requestJson(req)
    if (!body || typeof body !== 'object' || (body as { id?: unknown }).id !== templateId) {
      return json({ ok: false, error: 'template_id_mismatch' }, 422)
    }
    const validation = templateStore.validate(body, manager.indexMap(configId))
    if (!validation.ok) {
      return json({ ok: false, issues: validation.issues }, 422)
    }
    return json({ ok: true, template: templateStore.save(configId, body as never, manager.indexMap(configId)) })
  }
  if (templateMatch && req.method === 'DELETE') {
    const configId = parseConfigId(templateMatch[1])
    const templateId = templateMatch[2]
    manager.ensureConfig(configId)
    templateStore.delete(configId, templateId)
    return json({ ok: true })
  }


  const runnerMatch = /^\/api\/configs\/([^/]+)\/runner$/.exec(url.pathname)
  if (runnerMatch && req.method === 'GET') {
    const configId = parseConfigId(runnerMatch[1])
    manager.ensureConfig(configId)
    return json({ ok: true, runner: macroRunner.snapshot(configId) })
  }
  const runnerActionMatch = /^\/api\/configs\/([^/]+)\/runner\/(start|pause|resume|stop|input)$/.exec(url.pathname)
  if (runnerActionMatch && req.method === 'POST') {
    const configId = parseConfigId(runnerActionMatch[1])
    const action = runnerActionMatch[2] as RunnerAction
    let actionRequest: RunnerActionRequest
    try {
      actionRequest = await parseRunnerActionRequest(req, action)
    } catch (error) {
      const message = error instanceof Error ? error.message : runnerRequestError(action, 'invalid', 'body')
      return json({ ok: false, error: message }, 422)
    }
    manager.ensureConfig(configId)
    try {
      let runner
      switch (actionRequest.action) {
        case 'start':
          runner = await macroRunner.start(configId, { templateId: actionRequest.templateId })
          break
        case 'pause':
          runner = await macroRunner.pause(configId)
          break
        case 'resume':
          runner = await macroRunner.resume(configId)
          break
        case 'stop':
          runner = await macroRunner.stop(configId)
          break
        case 'input':
          runner = await macroRunner.submitInput(configId, actionRequest.text)
          break
        default:
          return assertNeverRunnerActionRequest(actionRequest)
      }
      return json({ ok: true, runner })
    } catch (error) {
      const existingRunId = error instanceof Error && 'existingRunId' in error ? String((error as { existingRunId?: string }).existingRunId) : undefined
      return json({ ok: false, error: error instanceof Error ? error.message : String(error), ...(existingRunId ? { existingRunId } : {}) }, 409)
    }
  }

  const spoolImportMatch = /^\/api\/configs\/([^/]+)\/agent-events\/import-spool$/.exec(url.pathname)
  if (spoolImportMatch && req.method === 'POST') {
    const configId = parseConfigId(spoolImportMatch[1])
    manager.ensureConfig(configId)
    return json({ ok: true, imported: agentEventStore.importSpool(configId) })
  }

  const runsMatch = /^\/api\/configs\/([^/]+)\/runs$/.exec(url.pathname)
  if (runsMatch && req.method === 'GET') {
    const configId = parseConfigId(runsMatch[1])
    manager.ensureConfig(configId)
    return json({ ok: true, runs: runEventStore.listRuns(configId) })
  }
  if (runsMatch && req.method === 'POST') {
    const configId = parseConfigId(runsMatch[1])
    manager.ensureConfig(configId)
    const body = asRecord(await requestJson(req))
    const data = asOptionalRecord(body.data) ?? {}
    return json({ ok: true, run: await runEventStore.createRun(configId, data) }, 201)
  }
  const artifactReadMatch = /^\/api\/configs\/([^/]+)\/runs\/([^/]+)\/artifacts\/(.+)$/.exec(url.pathname)
  if (artifactReadMatch && req.method === 'GET') {
    const configId = parseConfigId(artifactReadMatch[1])
    manager.ensureConfig(configId)
    const runId = artifactReadMatch[2]
    const artifactRef = 'artifacts/' + decodeURIComponent(artifactReadMatch[3])
    return new Response(runEventStore.readArtifact(configId, runId, artifactRef), { headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  const artifactWriteMatch = /^\/api\/configs\/([^/]+)\/runs\/([^/]+)\/artifacts$/.exec(url.pathname)
  if (artifactWriteMatch && req.method === 'POST') {
    const configId = parseConfigId(artifactWriteMatch[1])
    manager.ensureConfig(configId)
    const body = asRecord(await requestJson(req))
    const content = typeof body.content === 'string' ? body.content : ''
    const prefix = typeof body.prefix === 'string' ? body.prefix : 'artifact'
    const extension = typeof body.extension === 'string' ? body.extension : 'txt'
    const stepId = typeof body.stepId === 'string' ? body.stepId : undefined
    const result = await runEventStore.writeArtifact(configId, artifactWriteMatch[2], prefix, content, extension, stepId)
    return json({ ok: true, ...result }, 201)
  }
  const runMatch = /^\/api\/configs\/([^/]+)\/runs\/([^/]+)$/.exec(url.pathname)
  if (runMatch && req.method === 'GET') {
    const configId = parseConfigId(runMatch[1])
    manager.ensureConfig(configId)
    return json({ ok: true, run: runEventStore.snapshot(configId, runMatch[2]) })
  }
  const runEventMatch = /^\/api\/configs\/([^/]+)\/runs\/([^/]+)\/events$/.exec(url.pathname)
  if (runEventMatch && req.method === 'POST') {
    const configId = parseConfigId(runEventMatch[1])
    manager.ensureConfig(configId)
    const event = await runEventStore.appendEvent(configId, runEventMatch[2], runEventInput(await requestJson(req)))
    return json({ ok: true, event, run: runEventStore.snapshot(configId, runEventMatch[2]) }, 201)
  }
  return serveStatic(url)
}

function handleClientMessage(manager: TerminalDeckManager, configId: string, message: ClientMessage, send: (message: ServerMessage) => void) {
  if (message.type === 'request_snapshot') {
    send(manager.deckSnapshot(configId))
    return
  }
  if (message.type === 'create_terminal') {
    manager.createTerminal(configId, { backend: message.backend ?? 'fake', cols: message.cols, rows: message.rows })
    return
  }
  if (message.type === 'set_terminal_text') {
    manager.setTextContent(configId, refFromMessage(message), message.content)
    return
  }
  if (message.type === 'terminal_input') {
    manager.input(configId, refFromMessage(message), message.data)
    return
  }
  if (message.type === 'terminal_resize') {
    manager.resize(configId, refFromMessage(message), message.cols, message.rows)
    return
  }
  if (message.type === 'rename_terminal') {
    manager.renameTerminal(configId, message.terminalId, message.terminalAlias)
    return
  }
  if (message.type === 'reorder_terminal') {
    manager.moveTerminal(configId, message.terminalId, message.newIndex)
    return
  }
  if (message.type === 'close_terminal') {
    manager.closeTerminal(configId, refFromMessage(message))
    return
  }
  if (message.type === 'reset_terminal') {
    manager.resetTerminal(configId, refFromMessage(message), message.backend)
    return
  }
  if (message.type === 'request_replay') {
    send(manager.requestReplay(configId, refFromMessage(message)))
  }
}

function refFromMessage(message: { terminalId?: string; terminalIndex?: number; terminalAlias?: string }) {
  if (message.terminalId) {
    return { kind: 'id' as const, value: message.terminalId }
  }
  if (message.terminalIndex) {
    return { kind: 'index' as const, value: message.terminalIndex }
  }
  if (message.terminalAlias) {
    return { kind: 'alias' as const, value: message.terminalAlias }
  }
  throw new Error('missing_terminal_ref')
}

function serveStatic(url: URL): Response {
  const publicRoot = join(process.cwd(), 'dist')
  const path = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = join(publicRoot, path)
  if (existsSync(filePath)) {
    return new Response(readFileSync(filePath), { headers: { 'content-type': contentType(filePath) } })
  }
  const fallback = join(process.cwd(), 'index.html')
  if (existsSync(fallback)) {
    return new Response(readFileSync(fallback), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  return new Response('shell-deck', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

function broadcastPromptChange(manager: TerminalDeckManager, configId: string, action: 'created' | 'updated' | 'deleted' | 'moved', promptId: string, oldScope: PromptScope, newScope: PromptScope): void {
  if (oldScope === 'project' || newScope === 'project') {
    manager.broadcastConfigMessage(configId, { type: 'prompts_updated', configId, scope: 'project', action, promptId, oldScope, newScope })
  }
  if (oldScope === 'global' || newScope === 'global') {
    manager.broadcastAllConfigMessages((clientConfigId) => ({ type: 'prompts_updated', configId: clientConfigId, scope: 'global', action, promptId, oldScope, newScope }))
  }
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}


async function requestJson(req: Request): Promise<unknown> {
  const text = await req.text()
  if (!text.trim()) return {}
  return JSON.parse(text)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request_body_must_be_object')
  return value as Record<string, unknown>
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request_field_must_be_object')
  return value as Record<string, unknown>
}

async function parseRunnerActionRequest(req: Request, action: RunnerAction): Promise<RunnerActionRequest> {
  let text: string
  try {
    text = await req.text()
  } catch {
    throw new Error(runnerRequestError(action, 'invalid', 'body'))
  }
  let value: unknown = {}
  if (text.length > 0) {
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error(runnerRequestError(action, 'invalid', 'body'))
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(runnerRequestError(action, 'invalid', 'body'))
  }
  const body = value as Record<string, unknown>
  const allowedFields = action === 'start'
    ? ['templateId']
    : action === 'input'
      ? ['text']
      : []
  const unknownField = Object.keys(body).find((key) => !allowedFields.includes(key))
  if (unknownField) throw new Error(runnerRequestError(action, 'unknown', unknownField))

  switch (action) {
    case 'start':
      if (!Object.prototype.hasOwnProperty.call(body, 'templateId')) throw new Error(runnerRequestError(action, 'missing', 'templateId'))
      if (typeof body.templateId !== 'string' || body.templateId.length === 0) throw new Error(runnerRequestError(action, 'invalid', 'templateId'))
      return { action, templateId: body.templateId }
    case 'pause':
      return { action }
    case 'resume':
      return { action }
    case 'stop':
      return { action }
    case 'input':
      if (!Object.prototype.hasOwnProperty.call(body, 'text')) throw new Error(runnerRequestError(action, 'missing', 'text'))
      if (typeof body.text !== 'string') throw new Error(runnerRequestError(action, 'invalid', 'text'))
      return { action, text: body.text }
    default:
      return assertNeverRunnerAction(action)
  }
}

type RunnerRequestFailure = 'missing' | 'invalid' | 'unknown'

function runnerRequestError(action: RunnerAction, failure: RunnerRequestFailure, field: string): string {
  return `runner_request_${failure}_field:${action}:${field}`
}

function assertNeverRunnerAction(action: never): never {
  throw new Error('unreachable_runner_action:' + action)
}

function assertNeverRunnerActionRequest(value: never): never {
  throw new Error('unreachable_runner_action_request:' + JSON.stringify(value))
}

function parsePromptScopeFilter(value: string | null): PromptScopeFilter {
  if (value === 'project' || value === 'global' || value === 'all') return value
  return 'all'
}

function runEventInput(value: unknown): AppendRunEventInput {
  const body = asRecord(value)
  if (!isRunEventKind(body.kind)) throw new Error('invalid_run_event_kind')
  if (typeof body.summary !== 'string' || body.summary.trim().length === 0) throw new Error('event_summary_required')
  return {
    kind: body.kind,
    summary: body.summary,
    data: asOptionalRecord(body.data) ?? {},
    stepId: typeof body.stepId === 'string' ? body.stepId : undefined,
  }
}

if (import.meta.main) {
  const host = argValue('--host') ?? '127.0.0.1'
  if (host !== '127.0.0.1' && process.env.SHELL_DECK_ALLOW_LAN !== '1') {
    console.error('Refusing to bind non-local host without SHELL_DECK_ALLOW_LAN=1')
    process.exit(1)
  }
  const port = Number(argValue('--port') ?? '5177')
  const aiJsonParser = parseAiJsonParserMode(argValue('--ai-json-parser') ?? 'disabled')
  const seedBackendArg = argValue('--seed-backend')
  const seedBackend = seedBackendArg ? parseSeedBackend(seedBackendArg) : undefined
  const server = startShellDeckServer({ host, port, aiJsonParser, seedBackend })
  const pidFile = argValue('--pid-file') ?? defaultPidFile(port)
  writePidFile(pidFile)
  const cleanup = () => removePidFile(pidFile)
  process.on('exit', cleanup)
  process.once('SIGINT', () => { server.stop(); cleanup(); process.exit(0) })
  process.once('SIGTERM', () => { server.stop(); cleanup(); process.exit(0) })
  console.log('shell-deck listening on ' + server.url)
  console.log('shell-deck pid file ' + pidFile)
}

function defaultPidFile(port: number): string {
  return join(process.env.SHELL_DECK_DATA_ROOT ?? join(process.cwd(), '.shell-deck'), 'server-' + port + '.pid')
}

function writePidFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, String(process.pid) + '\n', 'utf8')
}

function removePidFile(path: string): void {
  try {
    if (readFileSync(path, 'utf8').trim() === String(process.pid)) unlinkSync(path)
  } catch {
    // Best-effort cleanup only.
  }
}

function parseSeedBackend(value: string): TerminalBackendKind {
  if (value === 'fake' || value === 'real') return value
  throw new Error('invalid_seed_backend:' + value)
}

function parseAiJsonParserMode(value: string): AiJsonParserMode {
  if (value === 'disabled' || value === 'mock' || value === 'codex-exec') return value
  throw new Error('invalid_ai_json_parser_mode:' + value)
}

function argValue(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(name + '='))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}
