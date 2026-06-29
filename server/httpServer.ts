import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseConfigId } from '../src/lib/identifier'
import { PROFILE_CATALOG_SUMMARY } from '../src/lib/macro/profileCatalogSummary'
import { MacroTemplateStore } from '../src/lib/macro/templateStore'
import { RunEventStore } from '../src/lib/runLog/runEventStore'
import { isRunEventKind } from '../src/lib/runLog/runEventSchema'
import type { AppendRunEventInput } from '../src/lib/runLog/runEventTypes'
import type { ClientMessage } from '../src/lib/protocol'
import { parseClientMessage } from '../src/lib/protocol'
import { TerminalDeckManager } from './terminalDeckManager'
import { MacroRunnerService } from './macroRunnerService'

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
}

export function startShellDeckServer(options: StartOptions = {}): ShellDeckServer {
  const host = options.host ?? '127.0.0.1'
  const bindHost = host
  const manager = options.manager ?? new TerminalDeckManager()
  const templateStore = new MacroTemplateStore()
  const runEventStore = new RunEventStore()
  const macroRunner = new MacroRunnerService(manager, templateStore, runEventStore)
  if (options.seed ?? true) {
    manager.ensureConfig('local')
    if (manager.indexMap('local').length === 0) {
      manager.createTerminal('local', { backend: 'fake' })
      manager.createTerminal('local', { backend: 'fake' })
    }
  }

  const server = Bun.serve<{ clientId: string; configId: string }>({
    hostname: host,
    port: options.port ?? 5177,
    async fetch(req, bunServer) {
      const url = new URL(req.url)
      if (url.pathname === '/ws') {
        const configId = parseConfigId(url.searchParams.get('configId'))
        const upgraded = bunServer.upgrade(req, { data: { clientId: '', configId } })
        return upgraded ? undefined : new Response('upgrade failed', { status: 400 })
      }

      try {
        return await handleHttp(req, url, manager, bindHost, templateStore, runEventStore, macroRunner)
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
      }
    },
    websocket: {
      open(ws) {
        const client = manager.connectClient(ws.data.configId, (message) => ws.send(JSON.stringify(message)))
        ws.data.clientId = client.clientId
      },
      message(ws, raw) {
        try {
          const payload = typeof raw === 'string' ? raw : raw.toString()
          const message = parseClientMessage(payload)
          handleClientMessage(manager, ws.data.configId, message, (reply) => ws.send(JSON.stringify(reply)))
        } catch (error) {
          ws.send(JSON.stringify({ type: 'terminal_error', configId: ws.data.configId, reason: error instanceof Error ? error.message : String(error) }))
        }
      },
      close(ws) {
        if (ws.data.clientId) {
          manager.disconnectClient(ws.data.clientId)
        }
      },
    },
  })

  return {
    url: 'http://' + server.hostname + ':' + server.port,
    port: server.port ?? 0,
    manager,
    stop: () => server.stop(true),
  }
}

async function handleHttp(req: Request, url: URL, manager: TerminalDeckManager, bindHost: string, templateStore: MacroTemplateStore, runEventStore: RunEventStore, macroRunner: MacroRunnerService): Promise<Response> {
  if (url.pathname === '/health') {
    return json({ ok: true, bind: bindHost })
  }
  if (url.pathname === '/api/macro/profile-catalog' && req.method === 'GET') {
    return json(PROFILE_CATALOG_SUMMARY)
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
    const backend = url.searchParams.get('backend') === 'real' ? 'real' : 'fake'
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
    manager.ensureConfig(configId)
    const body = asRecord(await requestJson(req))
    try {
      const action = runnerActionMatch[2]
      const runner = action === 'start'
        ? await macroRunner.start(configId, { templateId: stringField(body, 'templateId'), mockCaptureText: optionalStringField(body, 'mockCaptureText'), mockCaptureReady: optionalBooleanField(body, 'mockCaptureReady') })
        : action === 'pause'
          ? await macroRunner.pause(configId)
          : action === 'resume'
            ? await macroRunner.resume(configId, optionalStringField(body, 'nextStepId'))
            : action === 'stop'
              ? await macroRunner.stop(configId)
              : await macroRunner.submitInput(configId, stringField(body, 'text'))
      return json({ ok: true, runner })
    } catch (error) {
      const existingRunId = error instanceof Error && 'existingRunId' in error ? String((error as { existingRunId?: string }).existingRunId) : undefined
      return json({ ok: false, error: error instanceof Error ? error.message : String(error), ...(existingRunId ? { existingRunId } : {}) }, 409)
    }
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

function handleClientMessage(manager: TerminalDeckManager, configId: string, message: ClientMessage, send: (message: unknown) => void) {
  if (message.type === 'request_snapshot') {
    send(manager.deckSnapshot(configId))
    return
  }
  if (message.type === 'create_terminal') {
    manager.createTerminal(configId, { backend: message.backend ?? 'fake', cols: message.cols, rows: message.rows })
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

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0) throw new Error('missing_string_field:' + key)
  return field
}

function optionalStringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  if (field === undefined) return undefined
  if (typeof field !== 'string') throw new Error('invalid_string_field:' + key)
  return field
}

function optionalBooleanField(value: Record<string, unknown>, key: string): boolean | undefined {
  const field = value[key]
  if (field === undefined) return undefined
  if (typeof field !== 'boolean') throw new Error('invalid_boolean_field:' + key)
  return field
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
  const server = startShellDeckServer({ host, port })
  console.log('shell-deck listening on ' + server.url)
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}
