import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import {
  TerminalDeckClient,
  TerminalOutputFrameBatcher,
  type TerminalFrameScheduler,
} from '../../src/lib/terminalDeckClient'

class DeterministicFrameScheduler implements TerminalFrameScheduler {
  #nextHandle = 1
  readonly callbacks = new Map<number, (timestamp: number) => void>()

  request(callback: (timestamp: number) => void): number {
    const handle = this.#nextHandle++
    this.callbacks.set(handle, callback)
    return handle
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle)
  }

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

  addEventListener(type: string, callback: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(callback)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string, data?: unknown): void {
    for (const callback of this.listeners.get(type) ?? []) callback({ data })
  }
}

test('terminal output batching commits 20,000 same-terminal messages once per frame without changing bytes', () => {
  const scheduler = new DeterministicFrameScheduler()
  const emitted: ServerMessage[] = []
  const batcher = new TerminalOutputFrameBatcher((message) => emitted.push(message), scheduler)
  const chunks = Array.from({ length: 20_000 }, (_, index) => index % 3 === 0 ? '\u001b[38;5;' : index % 3 === 1 ? '196m😀' : '\u001b[0m')

  for (const data of chunks) batcher.accept(ptyOutput('term_a', data))
  expect(scheduler.callbacks.size).toBe(1)
  expect(emitted).toHaveLength(0)

  scheduler.run()
  expect(emitted).toHaveLength(1)
  expect(emitted[0]).toMatchObject({ type: 'pty_output', terminalId: 'term_a', data: chunks.join('') })
})

test('terminal output batching keeps terminals independent and flushes before a non-output barrier', () => {
  const scheduler = new DeterministicFrameScheduler()
  const emitted: ServerMessage[] = []
  const batcher = new TerminalOutputFrameBatcher((message) => emitted.push(message), scheduler)

  batcher.accept(ptyOutput('term_a', 'a1'))
  batcher.accept(ptyOutput('term_b', 'b1'))
  batcher.accept(ptyOutput('term_a', 'a2'))
  batcher.accept({
    type: 'terminal_state',
    configId: 'local',
    terminalId: 'term_a',
    status: 'closed',
    cols: 80,
    rows: 24,
    exitCode: 0,
    signal: null,
  })

  expect(emitted.map((message) => message.type)).toEqual(['pty_output', 'pty_output', 'terminal_state'])
  expect(emitted[0]).toMatchObject({ terminalId: 'term_a', data: 'a1a2' })
  expect(emitted[1]).toMatchObject({ terminalId: 'term_b', data: 'b1' })
  expect(scheduler.callbacks.size).toBe(0)
  scheduler.run()
  expect(emitted).toHaveLength(3)
})

test('client close cancels pending output and suppresses callbacks from the disposed websocket', () => {
  const scheduler = new DeterministicFrameScheduler()
  const websocket = new FakeWebSocket()
  const emitted: ServerMessage[] = []
  let closeCount = 0
  const client = new TerminalDeckClient({
    configId: 'local',
    url: 'ws://example.test/ws',
    onMessage: (message) => emitted.push(message),
    onClose: () => { closeCount += 1 },
    frameScheduler: scheduler,
    createWebSocket: () => websocket as unknown as WebSocket,
  })

  websocket.emit('message', JSON.stringify(ptyOutput('term_a', 'pending')))
  expect(scheduler.callbacks.size).toBe(1)
  client.close()
  expect(websocket.closed).toBe(true)
  expect(closeCount).toBe(1)
  expect(scheduler.callbacks.size).toBe(0)

  scheduler.run()
  websocket.emit('message', JSON.stringify(ptyOutput('term_a', 'late')))
  websocket.emit('close')
  expect(emitted).toHaveLength(0)
  expect(closeCount).toBe(1)
})

function ptyOutput(terminalId: string, data: string): Extract<ServerMessage, { type: 'pty_output' }> {
  return { type: 'pty_output', configId: 'local', terminalId, data, source: 'pty' }
}
