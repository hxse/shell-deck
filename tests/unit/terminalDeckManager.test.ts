import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import { FakeTerminalBackend } from '../../server/fakeTerminalBackend'
import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from '../../server/terminalBackend'
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

test('text backend appends macro input, supports manual content replace and syncs snapshots', async () => {
  const manager = new TerminalDeckManager()
  const textBox = manager.createTerminal('local', { backend: 'text', terminalId: 'term_text_a', terminalAlias: 'collector' })
  const a = collect(manager, 'local')
  const b = collect(manager, 'local')

  expect(textBox.backend).toBe('text')
  expect(snapshotText(a.messages, textBox.terminalId)).toBe('')

  manager.input('local', { kind: 'alias', value: 'collector' }, 'result one\r')
  expect(outputText(a.messages, textBox.terminalId)).toContain('result one\n')
  expect(outputText(b.messages, textBox.terminalId)).toContain('result one\n')

  manager.setTextContent('local', textBox.terminalId, 'manual edit')
  expect(snapshotText(a.messages, textBox.terminalId)).toBe('manual edit')
  expect(snapshotText(collect(manager, 'local').messages, textBox.terminalId)).toBe('manual edit')
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


test('backend options inject shell-deck terminal env for wrapped Codex hooks', () => {
  const captured: TerminalBackendOptions[] = []
  const manager = new TerminalDeckManager({
    backendFactory: (_kind, options) => {
      captured.push(options)
      return new FakeTerminalBackend(options)
    },
  })
  manager.setTerminalEnvProvider((configId, terminalId, launchId) => ({
    SHELL_DECK_CONFIG_ID: configId,
    SHELL_DECK_TERMINAL_ID: terminalId,
    SHELL_DECK_LAUNCH_ID: launchId,
    SHELL_DECK_INGEST_URL: 'http://127.0.0.1:9999/api/agent-events',
    SHELL_DECK_INGEST_TOKEN: 'token-a',
  }))

  const terminal = manager.createTerminal('local', { backend: 'real', terminalId: 'term_env_a' })
  expect(captured[0]).toMatchObject({ configId: 'local', terminalId: 'term_env_a' })
  expect(captured[0].launchId).toMatch(/^launch_/)
  expect(captured[0].env).toMatchObject({
    SHELL_DECK_CONFIG_ID: 'local',
    SHELL_DECK_TERMINAL_ID: 'term_env_a',
    SHELL_DECK_LAUNCH_ID: captured[0].launchId,
    SHELL_DECK_INGEST_URL: 'http://127.0.0.1:9999/api/agent-events',
    SHELL_DECK_INGEST_TOKEN: 'token-a',
  })

  expect(manager.resetTerminal('local', terminal.terminalId, 'real')).toEqual({ ok: true })
  expect(captured[1].terminalId).toBe('term_env_a')
  expect(captured[1].launchId).toMatch(/^launch_/)
  expect(captured[1].launchId).not.toBe(captured[0].launchId)
  expect(captured[1].env?.SHELL_DECK_LAUNCH_ID).toBe(captured[1].launchId)
})

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
    .flatMap((message) => message.type === 'deck_snapshot' ? message.terminals : message.type === 'terminal_snapshot' ? [message] : [])
    .filter((terminal) => terminal.terminalId === terminalId)
    .map((terminal) => terminal.replay.join(''))
    .at(-1) ?? ''
}
