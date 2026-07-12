import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import type { TerminalBackend, TerminalBackendEvent } from '../../server/terminalBackend'
import { TerminalDeckManager } from '../../server/terminalDeckManager'

class CloseFlushBackend implements TerminalBackend {
  readonly kind = 'real' as const
  readonly inputChannel = 'helper-stdin-pipe' as const
  #events: TerminalBackendEvent | null = null

  start(events: TerminalBackendEvent): void {
    this.#events = events
  }

  write(_data: string): void {}
  resize(_cols: number, _rows: number): void {}

  close(): void {
    this.#events?.onData('__CLOSE_FLUSH__')
    this.#events?.onExit(0, null)
  }
}

test('manager delivers backend close flush before removing the terminal generation', () => {
  const manager = new TerminalDeckManager({ backendFactory: () => new CloseFlushBackend() })
  const terminal = manager.createTerminal('local', { backend: 'real', terminalId: 'term_close_flush' })
  const messages: ServerMessage[] = []
  manager.connectClient('local', (message) => messages.push(message))

  manager.closeTerminal('local', terminal.terminalId)

  const outputIndex = messages.findIndex((message) => message.type === 'pty_output' && message.data === '__CLOSE_FLUSH__')
  const removalIndex = messages.findLastIndex((message) => message.type === 'deck_snapshot' && message.terminals.length === 0)
  expect(outputIndex).toBeGreaterThanOrEqual(0)
  expect(removalIndex).toBeGreaterThan(outputIndex)
})
