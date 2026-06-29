import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import { FakeTerminalBackend } from '../../server/fakeTerminalBackend'
import type { TerminalBackend, TerminalBackendEvent } from '../../server/terminalBackend'
import { TerminalDeckManager } from '../../server/terminalDeckManager'

function collect(manager: TerminalDeckManager, configId: string) {
  const messages: ServerMessage[] = []
  const client = manager.connectClient(configId, (message) => messages.push(message))
  return { client, messages }
}

test('fake backend fan-out, backend echo and replay', async () => {
  const manager = new TerminalDeckManager()
  const terminal = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_local_a' })
  const a = collect(manager, 'local')
  const b = collect(manager, 'local')
  await Bun.sleep(1)

  expect(a.messages.some((message) => message.type === 'deck_snapshot')).toBe(true)
  manager.input('local', terminal.terminalId, 'hello')
  expect(outputText(a.messages, terminal.terminalId)).toContain('hello')
  manager.input('local', terminal.terminalId, '\r')
  expect(outputText(a.messages, terminal.terminalId)).toContain('ECHO:hello')
  expect(outputText(b.messages, terminal.terminalId)).toContain('ECHO:hello')

  const late = collect(manager, 'local')
  expect(snapshotText(late.messages, terminal.terminalId)).toContain('ECHO:hello')
})

test('config isolation keeps same terminal index separate', async () => {
  const manager = new TerminalDeckManager()
  const local = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_local_a' })
  const other = manager.createTerminal('other', { backend: 'fake', terminalId: 'term_other_a' })
  const localClient = collect(manager, 'local')
  const otherClient = collect(manager, 'other')
  await Bun.sleep(1)

  manager.input('local', 1, 'local-only\r')
  expect(outputText(localClient.messages, local.terminalId)).toContain('ECHO:local-only')
  expect(outputText(otherClient.messages, other.terminalId)).not.toContain('ECHO:local-only')
})

test('reorder updates index map while terminal id remains stable', () => {
  const manager = new TerminalDeckManager()
  const a = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_a' })
  const b = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_b' })
  manager.moveTerminal('local', b.terminalId, 1)
  expect(manager.indexMap('local')).toEqual([
    { index: 1, terminalId: 'term_b', terminalAlias: 'terminal_2' },
    { index: 2, terminalId: 'term_a', terminalAlias: 'terminal_1' },
  ])
  expect(manager.resolveTerminal('local', { kind: 'id', value: a.terminalId }).terminalId).toBe('term_a')
})

test('terminal alias follows terminal id and can be used as a ref', async () => {
  const manager = new TerminalDeckManager()
  const terminal = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_alias_a', terminalAlias: 'reviewer' })
  const c = collect(manager, 'local')
  await Bun.sleep(1)

  expect(terminal.terminalAlias).toBe('reviewer')
  expect(manager.renameTerminal('local', terminal.terminalId, 'worker_1')).toEqual({ ok: true })
  expect(manager.terminalSnapshot(manager.resolveTerminal('local', terminal.terminalId)).terminalAlias).toBe('worker_1')

  manager.input('local', { kind: 'alias', value: 'worker_1' }, 'alias-input\r')
  expect(outputText(c.messages, terminal.terminalId)).toContain('ECHO:alias-input')
  expect(() => manager.createTerminal('local', { backend: 'fake', terminalId: 'term_alias_b', terminalAlias: 'worker_1' })).toThrow()
  expect(manager.indexMap('local')).toEqual([{ index: 1, terminalId: terminal.terminalId, terminalAlias: 'worker_1' }])
  expect(manager.deckSnapshot('local').terminals.map((item) => item.terminalId)).toEqual([terminal.terminalId])
})

test('resize, ctrl-c, exit and failed reset behavior', async () => {
  const manager = new TerminalDeckManager()
  const terminal = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_local_a' })
  const c = collect(manager, 'local')
  await Bun.sleep(1)

  manager.input('local', terminal.terminalId, 'partial')
  manager.input('local', terminal.terminalId, '\u0003')
  expect(outputText(c.messages, terminal.terminalId)).toContain('^C')

  manager.resize('local', terminal.terminalId, 120, 30)
  expect(c.messages.some((message) => message.type === 'terminal_state' && message.cols === 120 && message.rows === 30)).toBe(true)

  manager.input('local', terminal.terminalId, 'exit\r')
  await Bun.sleep(1)
  expect(manager.input('local', terminal.terminalId, 'after-close\r')).toEqual({ ok: false, reason: 'not_running' })

  const before = snapshotText(collect(manager, 'local').messages, terminal.terminalId)
  expect(manager.resetTerminal('local', terminal.terminalId, undefined, true)).toEqual({ ok: false, reason: 'backend_unavailable' })
  expect(snapshotText(collect(manager, 'local').messages, terminal.terminalId)).toBe(before)
})

class SyncDataBackend implements TerminalBackend {
  readonly kind = 'fake' as const
  readonly inputChannel = 'helper-stdin-pipe' as const
  #events: TerminalBackendEvent | null = null

  start(events: TerminalBackendEvent): void {
    this.#events = events
    events.onData('SYNC_START_OUTPUT\n')
  }

  write(data: string): void {
    if (data.includes('ping')) {
      this.#events?.onData('SYNC_PING\n')
    }
  }

  resize(_cols: number, _rows: number): void {}
  close(): void {}
}

class ThrowingBackend implements TerminalBackend {
  readonly kind = 'real' as const
  readonly inputChannel = 'helper-stdin-pipe' as const

  start(_events: TerminalBackendEvent): void {
    throw new Error('boom')
  }

  write(_data: string): void {}
  resize(_cols: number, _rows: number): void {}
  close(): void {}
}

test('createTerminal keeps config clean when backend start throws', () => {
  const manager = new TerminalDeckManager({
    backendFactory: (kind, options) => kind === 'real' ? new ThrowingBackend() : new FakeTerminalBackend(options),
  })
  manager.ensureConfig('local')

  expect(() => manager.createTerminal('local', { backend: 'real', terminalId: 'term_fail_a', terminalAlias: 'broken' })).toThrow()
  expect(manager.indexMap('local')).toEqual([])
  expect(manager.deckSnapshot('local').terminals).toEqual([])
})

test('reset preserves synchronous candidate backend output after swap', async () => {
  const manager = new TerminalDeckManager({
    backendFactory: (kind, options) => kind === 'real' ? new SyncDataBackend() : new FakeTerminalBackend(options),
  })
  const terminal = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_sync_a' })
  const c = collect(manager, 'local')
  await Bun.sleep(1)

  expect(manager.resetTerminal('local', terminal.terminalId, 'real')).toEqual({ ok: true })
  expect(outputText(c.messages, terminal.terminalId)).toContain('SYNC_START_OUTPUT')
})

test('reset keeps old terminal when candidate backend start throws', async () => {
  const manager = new TerminalDeckManager({
    backendFactory: (kind, options) => kind === 'real' ? new ThrowingBackend() : new FakeTerminalBackend(options),
  })
  const terminal = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_local_a' })
  const c = collect(manager, 'local')
  await Bun.sleep(1)

  manager.input('local', terminal.terminalId, 'keep\r')
  const before = manager.terminalSnapshot(manager.resolveTerminal('local', terminal.terminalId))
  expect(before.replay.join('')).toContain('ECHO:keep')

  expect(manager.resetTerminal('local', terminal.terminalId, 'real')).toEqual({ ok: false, reason: 'backend_unavailable' })
  const after = manager.terminalSnapshot(manager.resolveTerminal('local', terminal.terminalId))
  expect(after.backend).toBe('fake')
  expect(after.status).toBe('running')
  expect(after.replay.join('')).toBe(before.replay.join(''))

  manager.input('local', terminal.terminalId, 'after\r')
  expect(outputText(c.messages, terminal.terminalId)).toContain('ECHO:after')
})

function outputText(messages: ServerMessage[], terminalId: string) {
  return messages
    .filter((message): message is Extract<ServerMessage, { type: 'pty_output' }> => message.type === 'pty_output' && message.terminalId === terminalId)
    .map((message) => message.data)
    .join('')
}

function snapshotText(messages: ServerMessage[], terminalId: string) {
  return messages
    .filter((message) => message.type === 'deck_snapshot')
    .flatMap((message) => message.terminals)
    .filter((terminal) => terminal.terminalId === terminalId)
    .map((terminal) => terminal.replay.join(''))
    .at(-1) ?? ''
}
