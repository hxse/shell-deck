import { expect, test } from 'bun:test'
import type { ServerMessage, TerminalBackendKind } from '../../src/lib/protocol'
import { FakeTerminalBackend } from '../../server/fakeTerminalBackend'
import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from '../../server/terminalBackend'
import { DEFAULT_REPLAY_BYTE_LIMIT, TerminalRoomManager } from '../../server/terminalRoomManager'
import { setTextTerminalContent } from '../helpers/textTerminal'

class ManualOutputBackend implements TerminalBackend {
  readonly inputChannel = 'helper-stdin-pipe' as const
  #events: TerminalBackendEvent | null = null
  constructor(readonly kind: TerminalBackendKind) {}
  start(events: TerminalBackendEvent): void { this.#events = events }
  emit(data: string): void { this.#events?.onData(data) }
  write(data: string): void { this.emit(data) }
  resize(): void {}
  close(): void {}
}

test('Room replay limit is byte-bounded, UTF-8 safe and Text remains unbounded', async () => {
  expect(new TerminalRoomManager().replayByteLimit).toBe(DEFAULT_REPLAY_BYTE_LIMIT)
  for (const replayByteLimit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => new TerminalRoomManager({ replayByteLimit })).toThrow('invalid_replay_byte_limit')
  }

  let backend: ManualOutputBackend | undefined
  const manager = new TerminalRoomManager({ replayByteLimit: 8, backendFactory: (kind) => (backend = new ManualOutputBackend(kind)) })
  const room = manager.createRoom()
  manager.createTerminal(room.roomId, { backend: 'fake' })
  backend?.emit('old')
  backend?.emit('界')
  backend?.emit('END')
  expect(manager.roomSnapshot(room.roomId).terminals[0].replay).toEqual(['界', 'END'])

  const text = manager.createTerminal(room.roomId, { backend: 'text' })
  const content = 'prefix😀multiline\nvalue'
  setTextTerminalContent(manager, room.roomId, text.terminalId, content)
  expect(manager.roomSnapshot(room.roomId).terminals[1].replay).toEqual([content])
  await manager.destroyAllRooms()
})

test('Room replay physically compacts a 37 MB burst', async () => {
  let backend: ManualOutputBackend | undefined
  const manager = new TerminalRoomManager({ backendFactory: (kind) => (backend = new ManualOutputBackend(kind)) })
  const room = manager.createRoom()
  const terminal = manager.createTerminal(room.roomId, { backend: 'fake' })
  let remaining = 37_174_834
  while (remaining > 0) {
    const size = Math.min(256 * 1024, remaining)
    backend?.emit('x'.repeat(size))
    remaining -= size
  }
  const runtime = manager.rooms.get(room.roomId) as unknown as { terminals: Map<string, { replay: string[]; replayStart: number; replayBytes: number; replayDiscardedBytes: number }> }
  const storage = runtime.terminals.get(terminal.terminalId)!
  const physicalBytes = storage.replay.reduce((total, chunk) => total + Buffer.byteLength(chunk), 0)
  expect(storage.replayBytes).toBeLessThanOrEqual(DEFAULT_REPLAY_BYTE_LIMIT)
  expect(storage.replayDiscardedBytes).toBeLessThan(DEFAULT_REPLAY_BYTE_LIMIT)
  expect(physicalBytes).toBeLessThanOrEqual(DEFAULT_REPLAY_BYTE_LIMIT * 2)
  expect(storage.replay.length).toBeLessThanOrEqual(16)
  await manager.destroyAllRooms()
})

test('Room clients synchronize Fake/Text output while different Rooms remain isolated', async () => {
  const manager = new TerminalRoomManager()
  const left = manager.createRoom()
  const right = manager.createRoom()
  const shell = manager.createTerminal(left.roomId, { backend: 'fake' })
  const other = manager.createTerminal(right.roomId, { backend: 'fake' })
  const leftA = collect(manager, left.roomId)
  const leftB = collect(manager, left.roomId)
  const rightClient = collect(manager, right.roomId)
  manager.input(left.roomId, shell.terminalId, '\u001b[200~first\nsecond')
  manager.input(left.roomId, shell.terminalId, '\u001b[201~\r')
  expect(outputText(leftA, shell.terminalId)).toContain('ECHO:first\nsecond')
  expect(outputText(leftB, shell.terminalId)).toContain('ECHO:first\nsecond')
  expect(outputText(rightClient, other.terminalId)).not.toContain('first')

  const text = manager.createTerminal(left.roomId, { backend: 'text' })
  setTextTerminalContent(manager, left.roomId, text.terminalId, 'manual edit')
  expect(manager.roomSnapshot(left.roomId).terminals.find((item) => item.terminalId === text.terminalId)?.replay).toEqual(['manual edit'])
  await manager.destroyAllRooms()
})

test('close and reset preserve generation ordering and launch identity', async () => {
  let generation = 0
  class GenerationBackend implements TerminalBackend {
    readonly kind = 'real' as const
    readonly inputChannel = 'helper-stdin-pipe' as const
    #events: TerminalBackendEvent | null = null
    constructor(readonly number: number) {}
    start(events: TerminalBackendEvent): void { this.#events = events; if (this.number === 2) events.onData('__NEW_START__') }
    write(): void {}
    resize(): void {}
    close(): void { if (this.number === 1) { this.#events?.onData('__OLD_FLUSH__'); this.#events?.onExit(0, null) } }
  }
  const manager = new TerminalRoomManager({ backendFactory: () => new GenerationBackend(++generation) })
  const room = manager.createRoom()
  const terminal = manager.createTerminal(room.roomId, { backend: 'real' })
  const firstLaunch = terminal.launchId
  const messages = collect(manager, room.roomId)
  const resetStart = messages.length
  expect(manager.resetTerminal(room.roomId, terminal.terminalId, 'real')).toEqual({ ok: true })
  const reset = messages.slice(resetStart)
  const oldOutput = reset.findIndex((message) => message.type === 'pty_output' && message.data === '__OLD_FLUSH__')
  const newSnapshot = reset.findIndex((message) => message.type === 'terminal_snapshot' && message.launchId !== firstLaunch)
  const newOutput = reset.findIndex((message) => message.type === 'pty_output' && message.data === '__NEW_START__')
  expect(oldOutput).toBeGreaterThanOrEqual(0)
  expect(newSnapshot).toBeGreaterThan(oldOutput)
  expect(newOutput).toBeGreaterThan(newSnapshot)
  const current = manager.roomSnapshot(room.roomId).terminals[0]
  expect(current.launchId).not.toBe(firstLaunch)
  expect(current.replay.join('')).toBe('__NEW_START__')
  await manager.destroyAllRooms()
})

test('failed candidate start leaves Room unchanged and injected env is Room-scoped', async () => {
  const captured: TerminalBackendOptions[] = []
  let failNext = false
  class ThrowingBackend implements TerminalBackend {
    readonly kind = 'real' as const
    readonly inputChannel = 'helper-stdin-pipe' as const
    start(): void { throw new Error('boom') }
    write(): void {}
    resize(): void {}
    close(): void {}
  }
  const manager = new TerminalRoomManager({
    backendFactory: (kind, options) => {
      captured.push(options)
      if (failNext) return new ThrowingBackend()
      return new FakeTerminalBackend(options)
    },
  })
  manager.setTerminalEnvProvider((context) => ({
    SHELL_DECK_ROOM_ID: context.roomId,
    SHELL_DECK_ROOM_GENERATION: context.roomGeneration,
    SHELL_DECK_TERMINAL_ID: context.terminalId,
    SHELL_DECK_LAUNCH_ID: context.launchId,
  }))
  const room = manager.createRoom()
  const terminal = manager.createTerminal(room.roomId, { backend: 'real' })
  expect(captured[0]).toMatchObject({ roomId: room.roomId, roomGeneration: room.roomGeneration, terminalId: terminal.terminalId, launchId: terminal.launchId })
  expect(captured[0].env).toMatchObject({ SHELL_DECK_ROOM_ID: room.roomId, SHELL_DECK_TERMINAL_ID: terminal.terminalId })
  const before = manager.roomSnapshot(room.roomId)
  failNext = true
  expect(manager.resetTerminal(room.roomId, terminal.terminalId, 'real')).toEqual({ ok: false, reason: 'backend_unavailable' })
  expect(manager.roomSnapshot(room.roomId)).toEqual(before)
  expect(() => manager.createTerminal(room.roomId, { backend: 'real' })).toThrow('boom')
  expect(manager.roomSnapshot(room.roomId).terminals).toHaveLength(1)
  await manager.destroyAllRooms()
})

function collect(manager: TerminalRoomManager, roomId: string): ServerMessage[] {
  const messages: ServerMessage[] = []
  manager.connectClient(roomId, (message) => messages.push(message))
  return messages
}

function outputText(messages: ServerMessage[], terminalId: string): string {
  return messages.filter((message): message is Extract<ServerMessage, { type: 'pty_output' }> => message.type === 'pty_output' && message.terminalId === terminalId).map((message) => message.data).join('')
}
