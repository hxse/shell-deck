import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseConfigId } from '../src/lib/identifier'
import type { ClientMessage } from '../src/lib/protocol'
import { parseClientMessage } from '../src/lib/protocol'
import { TerminalDeckManager } from './terminalDeckManager'

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
    fetch(req, bunServer) {
      const url = new URL(req.url)
      if (url.pathname === '/ws') {
        const configId = parseConfigId(url.searchParams.get('configId'))
        const upgraded = bunServer.upgrade(req, { data: { clientId: '', configId } })
        return upgraded ? undefined : new Response('upgrade failed', { status: 400 })
      }

      try {
        return handleHttp(req, url, manager, bindHost)
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

function handleHttp(req: Request, url: URL, manager: TerminalDeckManager, bindHost: string): Response {
  if (url.pathname === '/health') {
    return json({ ok: true, bind: bindHost })
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
