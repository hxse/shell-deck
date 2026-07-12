import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import type { TerminalBackend, TerminalBackendEvent } from '../../server/terminalBackend'
import { TerminalDeckManager } from '../../server/terminalDeckManager'

class ResetGenerationBackend implements TerminalBackend {
  readonly kind = 'real' as const
  readonly inputChannel = 'helper-stdin-pipe' as const
  #events: TerminalBackendEvent | null = null

  constructor(readonly generation: number) {}

  start(events: TerminalBackendEvent): void {
    this.#events = events
    if (this.generation === 2) events.onData('__NEW_START__')
  }

  write(_data: string): void {}
  resize(_cols: number, _rows: number): void {}

  close(): void {
    if (this.generation !== 1) return
    this.#events?.onData('__OLD_PENDING__')
    this.#events?.onExit(0, null)
  }
}

test('reset flushes old generation output before new snapshot without mixing replay', () => {
  let generation = 0
  const manager = new TerminalDeckManager({ backendFactory: () => new ResetGenerationBackend(++generation) })
  const terminal = manager.createTerminal('local', { backend: 'real', terminalId: 'term_reset_flush' })
  const messages: ServerMessage[] = []
  manager.connectClient('local', (message) => messages.push(message))
  const resetStart = messages.length

  expect(manager.resetTerminal('local', terminal.terminalId, 'real')).toEqual({ ok: true })

  const resetMessages = messages.slice(resetStart)
  const oldOutput = resetMessages.findIndex((message) => message.type === 'pty_output' && message.data === '__OLD_PENDING__')
  const newSnapshot = resetMessages.findIndex((message) => message.type === 'terminal_snapshot' && message.replay.length === 0)
  const newOutput = resetMessages.findIndex((message) => message.type === 'pty_output' && message.data === '__NEW_START__')
  expect(oldOutput).toBeGreaterThanOrEqual(0)
  expect(newSnapshot).toBeGreaterThan(oldOutput)
  expect(newOutput).toBeGreaterThan(newSnapshot)

  const replay = manager.deckSnapshot('local').terminals[0].replay.join('')
  expect(replay).toBe('__NEW_START__')
  expect(replay).not.toContain('__OLD_PENDING__')
})
