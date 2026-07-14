import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import { createGeneratedId } from '../../src/lib/generatedId'
import { TerminalOutputFrameBatcher, TerminalRoomClient, type TerminalFrameScheduler } from '../../src/lib/terminalRoomClient'

const ROOM_ID = createGeneratedId('room')
const ROOM_GENERATION = createGeneratedId('roomGeneration')
const TERMINAL_A = createGeneratedId('terminal')
const TERMINAL_B = createGeneratedId('terminal')
const LAUNCH_A = createGeneratedId('terminalLaunch')
const LAUNCH_B = createGeneratedId('terminalLaunch')

class DeterministicFrameScheduler implements TerminalFrameScheduler {
  #nextHandle = 1
  readonly callbacks = new Map<number, (timestamp: number) => void>()

  request(callback: (timestamp: number) => void): number {
    const handle = this.#nextHandle++
    this.callbacks.set(handle, callback)
    return handle
  }

  cancel(handle: number): void { this.callbacks.delete(handle) }

  run(): void {
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    for (const callback of callbacks) callback(0)
  }
}

class FakeWebSocket {
  readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()
  readonly sent: string[] = []
  closed = false
  readyState = WebSocket.OPEN

  addEventListener(type: string, callback: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(callback)
    this.listeners.set(type, listeners)
  }

  send(data: string): void { this.sent.push(data) }
  close(): void { this.closed = true }

  emit(type: string, data?: unknown): void {
    for (const callback of this.listeners.get(type) ?? []) callback({ data })
  }
}

test('Room output batching commits one exact update per terminal and frame', () => {
  const scheduler = new DeterministicFrameScheduler()
  const emitted: ServerMessage[] = []
  const batcher = new TerminalOutputFrameBatcher((message) => emitted.push(message), scheduler)
  const chunks = Array.from({ length: 20_000 }, (_, index) => index % 3 === 0 ? '\u001b[38;5;' : index % 3 === 1 ? '196m😀' : '\u001b[0m')

  for (const [index, data] of chunks.entries()) batcher.accept(ptyOutput(TERMINAL_A, data, index + 1))
  expect(scheduler.callbacks.size).toBe(1)
  scheduler.run()
  expect(emitted).toHaveLength(1)
  expect(emitted[0]).toMatchObject({ type: 'pty_output', terminalId: TERMINAL_A, data: chunks.join('') })
  expect(emitted[0]).toMatchObject({ roomRevision: chunks.length, terminalRevision: chunks.length })
})

test('Room output batching keeps terminals independent and flushes before state barriers', () => {
  const scheduler = new DeterministicFrameScheduler()
  const emitted: ServerMessage[] = []
  const batcher = new TerminalOutputFrameBatcher((message) => emitted.push(message), scheduler)
  batcher.accept(ptyOutput(TERMINAL_A, 'a1', 1))
  batcher.accept(ptyOutput(TERMINAL_B, 'b1', 2))
  batcher.accept(ptyOutput(TERMINAL_A, 'a2', 3))
  batcher.accept({
    type: 'terminal_state', roomId: ROOM_ID, roomGeneration: ROOM_GENERATION, terminalId: TERMINAL_A,
    launchId: LAUNCH_A, roomRevision: 4, terminalRevision: 3, textRevision: 0, outputActivityRevision: 2,
    status: 'closed', cols: 80, rows: 24, exitCode: 0, signal: null,
  })
  expect(emitted.map((message) => message.type)).toEqual(['pty_output', 'pty_output', 'terminal_state'])
  expect(emitted[0]).toMatchObject({ terminalId: TERMINAL_A, data: 'a1a2' })
  expect(emitted[0]).toMatchObject({ roomRevision: 3, terminalRevision: 3, outputActivityRevision: 3 })
  expect(emitted[1]).toMatchObject({ terminalId: TERMINAL_B, data: 'b1' })
  expect(scheduler.callbacks.size).toBe(0)
})

test('Room client close cancels pending output and suppresses disposed socket callbacks', () => {
  const scheduler = new DeterministicFrameScheduler()
  const websocket = new FakeWebSocket()
  const emitted: ServerMessage[] = []
  let closeCount = 0
  const client = new TerminalRoomClient({
    roomId: ROOM_ID,
    url: 'ws://example.test/ws/rooms/' + ROOM_ID,
    onMessage: (message) => emitted.push(message),
    onClose: () => { closeCount += 1 },
    frameScheduler: scheduler,
    createWebSocket: () => websocket as unknown as WebSocket,
  })

  websocket.emit('message', JSON.stringify(ptyOutput(TERMINAL_A, 'pending')))
  expect(scheduler.callbacks.size).toBe(1)
  client.close()
  expect(websocket.closed).toBe(true)
  expect(closeCount).toBe(1)
  expect(scheduler.callbacks.size).toBe(0)
  scheduler.run()
  websocket.emit('message', JSON.stringify(ptyOutput(TERMINAL_A, 'late')))
  websocket.emit('close')
  expect(emitted).toHaveLength(0)
  expect(closeCount).toBe(1)
})

function ptyOutput(terminalId: string, data: string, revision = 1): Extract<ServerMessage, { type: 'pty_output' }> {
  return {
    type: 'pty_output',
    roomId: ROOM_ID,
    roomGeneration: ROOM_GENERATION,
    terminalId,
    launchId: terminalId === TERMINAL_A ? LAUNCH_A : LAUNCH_B,
    roomRevision: revision,
    terminalRevision: revision,
    textRevision: 0,
    outputActivityRevision: revision,
    data,
    source: 'pty',
  }
}
