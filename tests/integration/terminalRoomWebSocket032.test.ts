import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { ServerMessage } from '../../src/lib/protocol'
import { startShellDeckServer } from '../../server/httpServer'

test('two Room websocket clients share exact output, replay and dynamic index order', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'shell-deck-room-ws-'))
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot })
  const sockets: WebSocket[] = []
  try {
    const room = server.manager.createRoom()
    const terminal = server.manager.createTerminal(room.roomId, { backend: 'fake' })
    const first = await connect(server.url, room.roomId)
    const second = await connect(server.url, room.roomId)
    sockets.push(first.ws, second.ws)

    first.ws.send(JSON.stringify({ type: 'terminal_input', terminalId: terminal.terminalId, data: 'hello-ws\r' }))
    await waitFor(() => outputText(first.messages, terminal.terminalId).includes('ECHO:hello-ws'), 1000)
    expect(outputText(second.messages, terminal.terminalId)).toContain('ECHO:hello-ws')

    const late = await connect(server.url, room.roomId)
    sockets.push(late.ws)
    await waitFor(() => snapshotText(late.messages, terminal.terminalId).includes('ECHO:hello-ws'), 1000)

    first.ws.send(JSON.stringify({ type: 'create_terminal', backend: 'fake' }))
    await waitFor(() => latestIndexMap(first.messages).length === 2, 1000)
    const created = latestIndexMap(first.messages).find((item) => item.terminalId !== terminal.terminalId)!
    await waitFor(() => first.messages.some((message) => message.type === 'terminal_created' && message.terminalId === created.terminalId), 1000)
    expect(first.messages.filter((message) => message.type === 'terminal_created')).toEqual([
      { type: 'terminal_created', roomId: room.roomId, roomGeneration: room.roomGeneration, terminalId: created.terminalId },
    ])
    expect(second.messages.some((message) => message.type === 'terminal_created')).toBe(false)
    first.ws.send(JSON.stringify({ type: 'reorder_terminal', terminalId: created.terminalId, newIndex: 1 }))
    await waitFor(() => latestIndexMap(second.messages)[0]?.terminalId === created.terminalId, 1000)
    expect(latestIndexMap(second.messages)).toEqual([
      { index: 1, terminalId: created.terminalId },
      { index: 2, terminalId: terminal.terminalId },
    ])

    first.ws.send(JSON.stringify({ type: 'close_terminal', terminalId: created.terminalId }))
    await waitFor(() => latestIndexMap(second.messages).length === 1, 1000)
    expect(latestIndexMap(second.messages)).toEqual([{ index: 1, terminalId: terminal.terminalId }])

    server.manager.createTerminal(room.roomId, { backend: 'text' })
    await waitFor(() => latestIndexMap(second.messages).length === 2, 1000)
    const beforeObserverAttempt = second.messages.length
    second.ws.send(JSON.stringify({ type: 'close_all_terminals' }))
    await waitFor(() => second.messages.slice(beforeObserverAttempt).some((message) => (
      message.type === 'terminal_error' && message.reason === 'room_control_required'
    )), 1000)
    expect(server.manager.terminalPositions(room.roomId)).toHaveLength(2)

    const runId = createGeneratedId('run')
    server.manager.acquireRunStructureLock(room.roomId, runId)
    await waitFor(() => latestIndexProjection(second.messages)?.terminalStructureLocked === true, 1000)
    const beforeLockedAttempt = first.messages.length
    first.ws.send(JSON.stringify({ type: 'close_all_terminals' }))
    await waitFor(() => first.messages.slice(beforeLockedAttempt).some((message) => (
      message.type === 'terminal_error' && message.reason === 'room_structure_locked_by_run'
    )), 1000)
    expect(server.manager.terminalPositions(room.roomId)).toHaveLength(2)
    server.manager.releaseRunStructureLock(room.roomId, runId)
    await waitFor(() => latestIndexProjection(second.messages)?.terminalStructureLocked === false, 1000)

    const mapsBeforeCloseAll = second.messages.filter((message) => message.type === 'terminal_index_map').length
    first.ws.send(JSON.stringify({ type: 'close_all_terminals' }))
    await waitFor(() => latestIndexMap(second.messages).length === 0, 1000)
    expect(server.manager.terminalPositions(room.roomId)).toEqual([])
    expect(second.messages.filter((message) => message.type === 'terminal_index_map')).toHaveLength(mapsBeforeCloseAll + 1)
  } finally {
    await server.stop()
    await Promise.allSettled(sockets.map(closeWebSocket))
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

async function connect(baseUrl: string, roomId: string) {
  const messages: ServerMessage[] = []
  const ws = new WebSocket(baseUrl.replace('http://', 'ws://') + '/ws/rooms/' + roomId)
  ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))))
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error('ws_error')), { once: true })
  })
  await waitFor(() => messages.some((message) => message.type === 'room_snapshot'), 1000)
  return { ws, messages }
}

function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000)
    socket.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.close()
  })
}

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('timeout')
}

function outputText(messages: ServerMessage[], terminalId: string): string {
  return messages.filter((message): message is Extract<ServerMessage, { type: 'pty_output' }> => message.type === 'pty_output' && message.terminalId === terminalId).map((message) => message.data).join('')
}

function snapshotText(messages: ServerMessage[], terminalId: string): string {
  return messages.filter((message) => message.type === 'room_snapshot').flatMap((message) => message.terminals).filter((terminal) => terminal.terminalId === terminalId).map((terminal) => terminal.replay.join('')).at(-1) ?? ''
}

function latestIndexMap(messages: ServerMessage[]) {
  const map = latestIndexProjection(messages)
  if (map?.type === 'terminal_index_map') return map.items
  const snapshot = messages.filter((message) => message.type === 'room_snapshot').at(-1)
  return snapshot?.type === 'room_snapshot' ? snapshot.indexMap : []
}

function latestIndexProjection(messages: ServerMessage[]) {
  return messages.filter((message): message is Extract<ServerMessage, { type: 'terminal_index_map' }> => (
    message.type === 'terminal_index_map'
  )).at(-1)
}
