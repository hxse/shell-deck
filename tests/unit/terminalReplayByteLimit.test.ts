import { expect, test } from 'bun:test'
import type { TerminalBackendKind } from '../../src/lib/protocol'
import type { TerminalBackend, TerminalBackendEvent } from '../../server/terminalBackend'
import { DEFAULT_REPLAY_BYTE_LIMIT, TerminalDeckManager } from '../../server/terminalDeckManager'

class ManualOutputBackend implements TerminalBackend {
  readonly inputChannel = 'helper-stdin-pipe' as const
  #events: TerminalBackendEvent | null = null

  constructor(readonly kind: TerminalBackendKind) {}

  start(events: TerminalBackendEvent): void {
    this.#events = events
  }

  emit(data: string): void {
    this.#events?.onData(data)
  }

  write(data: string): void {
    this.emit(data)
  }

  resize(_cols: number, _rows: number): void {}
  close(): void {}
}

test('TerminalDeckManager accepts only a positive integer replay byte limit', () => {
  expect(new TerminalDeckManager().replayByteLimit).toBe(DEFAULT_REPLAY_BYTE_LIMIT)
  expect(DEFAULT_REPLAY_BYTE_LIMIT).toBe(2 * 1024 * 1024)

  for (const replayByteLimit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => new TerminalDeckManager({ replayByteLimit })).toThrow('invalid_replay_byte_limit')
  }
})

test('shell replay evicts oldest whole chunks by UTF-8 byte size', () => {
  let backend: ManualOutputBackend | undefined
  const manager = new TerminalDeckManager({
    replayByteLimit: 8,
    backendFactory: (kind) => (backend = new ManualOutputBackend(kind)),
  })
  manager.createTerminal('local', { backend: 'fake', terminalId: 'term_byte_tail' })

  backend?.emit('old')
  backend?.emit('界')
  backend?.emit('END')

  const replay = manager.deckSnapshot('local').terminals[0].replay
  expect(replay).toEqual(['界', 'END'])
  expect(Buffer.byteLength(replay.join(''))).toBeLessThanOrEqual(8)
})

test('shell replay physically compacts discarded 37 MB batches by byte size', () => {
  let backend: ManualOutputBackend | undefined
  const manager = new TerminalDeckManager({
    backendFactory: (kind) => (backend = new ManualOutputBackend(kind)),
  })
  const terminal = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_physical_byte_tail' })
  let remaining = 37_174_834

  while (remaining > 0) {
    const size = Math.min(256 * 1024, remaining)
    backend?.emit('x'.repeat(size))
    remaining -= size
  }

  const storage = manager.configs.get('local')?.terminals.get(terminal.terminalId) as unknown as {
    replay: string[]
    replayStart: number
    replayBytes: number
    replayDiscardedBytes: number
  }
  const physicalBytes = storage.replay.reduce((total, chunk) => total + Buffer.byteLength(chunk), 0)

  expect(storage.replayBytes).toBeLessThanOrEqual(DEFAULT_REPLAY_BYTE_LIMIT)
  expect(storage.replayDiscardedBytes).toBeLessThan(DEFAULT_REPLAY_BYTE_LIMIT)
  expect(physicalBytes).toBeLessThanOrEqual(DEFAULT_REPLAY_BYTE_LIMIT * 2)
  expect(storage.replay.length).toBeLessThanOrEqual(16)
  expect(manager.deckSnapshot('local').terminals[0].replay.join('').length).toBe(storage.replayBytes)
})

test('oversized shell chunk keeps a valid UTF-8 tail without a replacement character', () => {
  let backend: ManualOutputBackend | undefined
  const manager = new TerminalDeckManager({
    replayByteLimit: 6,
    backendFactory: (kind) => (backend = new ManualOutputBackend(kind)),
  })
  manager.createTerminal('local', { backend: 'fake', terminalId: 'term_oversized_tail' })

  backend?.emit('old😀END')

  const replay = manager.deckSnapshot('local').terminals[0].replay
  expect(replay).toEqual(['END'])
  expect(replay.join('')).not.toContain('\ufffd')
  expect(Buffer.byteLength(replay.join(''))).toBeLessThanOrEqual(6)
})

test('text backend content is not truncated by the shell replay byte limit', () => {
  const manager = new TerminalDeckManager({
    replayByteLimit: 4,
    backendFactory: (kind) => new ManualOutputBackend(kind),
  })
  const terminal = manager.createTerminal('local', { backend: 'text', terminalId: 'term_unbounded_text' })
  const content = 'prefix😀multiline\nvalue'

  manager.setTextContent('local', terminal.terminalId, content)

  expect(manager.deckSnapshot('local').terminals[0].replay).toEqual([content])
  expect(Buffer.byteLength(content)).toBeGreaterThan(manager.replayByteLimit)
})
