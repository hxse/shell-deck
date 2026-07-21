import { assertRoomRouteToken } from '../src/lib/generatedId'
import type { ClientMessage, ServerMessage } from '../src/lib/protocol'
import { parseClientMessage } from '../src/lib/protocol'
import type { TerminalRef } from '../src/lib/terminalIdentity'
import type { HttpContext } from './http/httpContext'
import { assertNoQuery, errorMessage, errorResponse, json } from './http/httpPrimitives'
import type { RoomSummary, TerminalRoomManager } from './terminalRoomManager'
import { WebSocketSendQueue } from './webSocketSendQueue'

export type RoomSocketData = {
  clientId: string
  roomId: string
  roomGeneration: string
  sender: WebSocketSendQueue | null
  terminationTimer: ReturnType<typeof setTimeout> | null
}

export type RoomWebSocketUpgradeResult =
  | { handled: false }
  | { handled: true; response: Response | undefined }

type RoomWebSocketContext = Pick<HttpContext, 'manager' | 'macroRunner'>

export function handleRoomWebSocketUpgrade(
  req: Request,
  url: URL,
  server: Bun.Server<RoomSocketData>,
  context: RoomWebSocketContext,
): RoomWebSocketUpgradeResult {
  const websocketRoomId = websocketRoomRoute(url.pathname)
  if (websocketRoomId) {
    try { assertNoQuery(url) } catch (error) { return { handled: true, response: errorResponse(error, true) } }
    let summary: RoomSummary
    try { summary = context.manager.roomSummaryById(websocketRoomId) }
    catch (error) { return { handled: true, response: errorResponse(error, true) } }
    const upgraded = server.upgrade(req, {
      data: { clientId: '', roomId: summary.roomId, roomGeneration: summary.roomGeneration, sender: null, terminationTimer: null },
    })
    return { handled: true, response: upgraded ? undefined : json({ ok: false, error: 'websocket_upgrade_failed' }, 400) }
  }
  if (url.pathname.startsWith('/ws')) return { handled: true, response: json({ ok: false, error: 'route_not_found' }, 404) }
  return { handled: false }
}

export function createRoomWebSocketHandler(context: RoomWebSocketContext): Bun.WebSocketHandler<RoomSocketData> {
  const { macroRunner, manager } = context
  return {
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
  }
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
