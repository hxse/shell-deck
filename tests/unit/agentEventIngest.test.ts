import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingestAgentEvent } from '../../server/agentEventIngest'
import { TerminalDeckManager } from '../../server/terminalDeckManager'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import type { AgentEvent } from '../../src/lib/agentEvents/agentEventTypes'

test('AgentEvent ingest validates local bind, token and terminal scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-006-ingest-'))
  try {
    const manager = new TerminalDeckManager()
    manager.createTerminal('local', { backend: 'fake', terminalId: 'term_ingest_a' })
    const store = new AgentEventStore(root)
    const event = agentOutput({ terminalId: 'term_ingest_a' })

    expect(ingestAgentEvent(event, 'bad', { bindHost: '127.0.0.1', expectedToken: 'token-a', manager, store })).toMatchObject({ ok: false, status: 403 })
    expect(ingestAgentEvent(event, 'token-a', { bindHost: '0.0.0.0', expectedToken: 'token-a', manager, store })).toMatchObject({ ok: false, status: 403 })
    expect(ingestAgentEvent(event, 'token-a', { bindHost: '127.0.0.1', expectedToken: undefined, manager, store })).toMatchObject({ ok: false, status: 403 })
    expect(ingestAgentEvent(agentOutput({ terminalId: 'term_missing' }), 'token-a', { bindHost: '127.0.0.1', expectedToken: 'token-a', manager, store })).toMatchObject({ ok: false, status: 404 })

    const accepted = ingestAgentEvent(event, 'token-a', { bindHost: '127.0.0.1', expectedToken: 'token-a', manager, store })
    expect(accepted).toMatchObject({ ok: true })
    expect(store.latestMatching({ configId: 'local', terminalId: 'term_ingest_a', eventKind: 'agent.output', adapter: 'codex-stop-hook' })?.capturedText).toBe('agent result')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('AgentEvent JSONL spool imports into append-only store without becoming a second truth', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-006-spool-'))
  try {
    const store = new AgentEventStore(root)
    const event = agentOutput({ terminalId: 'term_spool_a' })
    const spoolPath = store.spool(event)
    expect(spoolPath).toContain('spool-')
    expect(store.list('local')).toEqual([])

    expect(store.importSpool('local')).toBe(1)
    expect(store.list('local').map((item) => item.terminalId)).toEqual(['term_spool_a'])
    expect(store.importSpool('local')).toBe(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


test('AgentEvent spool ignores writing files and imports only atomically published jsonl', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-006-spool-atomic-'))
  try {
    const store = new AgentEventStore(root)
    const dir = store.agentEventsDir('local')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'spool-half.jsonl.writing-test'), '{"half"')
    expect(store.importSpool('local')).toBe(0)
    expect(existsSync(join(dir, 'spool-half.jsonl.writing-test'))).toBe(true)

    const spoolPath = store.spool(agentOutput({ terminalId: 'term_atomic_a' }))
    expect(spoolPath.endsWith('.jsonl')).toBe(true)
    expect(existsSync(spoolPath)).toBe(true)
    expect(readdirSync(dir).filter((name) => name.includes('.writing-'))).toEqual(['spool-half.jsonl.writing-test'])
    expect(store.importSpool('local')).toBe(1)
    expect(store.list('local').map((event) => event.terminalId)).toEqual(['term_atomic_a'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('AgentEvent matching is config scoped even when terminal ids are equal', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-006-config-scope-'))
  try {
    const store = new AgentEventStore(root)
    store.append(agentOutput({ configId: 'config_a', terminalId: 'term_same', text: 'from-a' }))
    store.append(agentOutput({ configId: 'config_b', terminalId: 'term_same', text: 'from-b' }))

    expect(store.latestMatching({ configId: 'config_a', terminalId: 'term_same' })?.capturedText).toBe('from-a')
    expect(store.latestMatching({ configId: 'config_b', terminalId: 'term_same' })?.capturedText).toBe('from-b')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function agentOutput(options: { configId?: string; terminalId: string; text?: string }): AgentEvent {
  return {
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.output',
    configId: options.configId ?? 'local',
    terminalId: options.terminalId,
    launchId: 'launch_ingest_a',
    agentSessionId: 'codex-session-a',
    agentTurnId: 'turn-a',
    adapterMetadata: {
      adapter: 'codex-stop-hook',
      codexSessionId: 'codex-session-a',
    },
    capturedText: options.text ?? 'agent result',
    raw: {
      source: 'codex.Stop',
      payload: {},
    },
    receivedAt: '2026-06-30T00:00:00.000Z',
  }
}
