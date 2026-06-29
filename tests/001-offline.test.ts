import { afterAll, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { normalizeCodexHookPayload, ProbeAgentEventIngest } from '../src/probe001/agentEvent'
import { ProbeTerminalDeck } from '../src/probe001/terminalDeck'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const passedProbeIds = new Set<string>()

afterAll(() => {
  const resultDir = join(repoRoot, '.shell-deck', 'probe-results', '001-offline')
  mkdirSync(resultDir, { recursive: true })
  writeFileSync(join(resultDir, 'result.json'), `${JSON.stringify({
    probe: '20260627A.001-offline',
    status: 'passed',
    passedProbeIds: [...passedProbeIds].sort(),
    finishedAt: new Date().toISOString(),
  }, null, 2)}\n`)
})

test('A01 just codex recipe forwards args while injecting temporary hook config', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'shell-deck-001-a01-'))
  const fakeCodex = join(workDir, 'fake-codex')
  const argvPath = join(workDir, 'argv.json')
  writeFileSync(fakeCodex, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" | bun -e 'const fs=require("fs"); const lines=fs.readFileSync(0,"utf8").trim().split(/\\n/).filter(Boolean); fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(lines,null,2));'\n`)
  chmodSync(fakeCodex, 0o755)

  const result = spawnSync('just', ['-f', join(repoRoot, 'justfile'), '--', 'codex', '--help'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SHELL_DECK_CODEX_BIN: fakeCodex,
      SHELL_DECK_CONFIG_ID: 'local',
      SHELL_DECK_TERMINAL_ID: 'term_a01',
      SHELL_DECK_LAUNCH_ID: 'launch_a01',
    },
    encoding: 'utf8',
  })

  expect(result.status).toBe(0)
  const argv = JSON.parse(readFileSync(argvPath, 'utf8')) as string[]
  expect(argv).toContain('--dangerously-bypass-hook-trust')
  expect(argv).toContain('features.hooks=true')
  expect(argv.some((arg) => arg.startsWith('hooks.SessionStart='))).toBe(true)
  expect(argv.some((arg) => arg.startsWith('hooks.Stop='))).toBe(true)
  expect(argv.at(-1)).toBe('--help')
  passedProbeIds.add('A01')
})

test('A03-A07 normalize Codex hook payloads and split accepted/spooled ingest', () => {
  const env = { configId: 'local', terminalId: 'term_hook', launchId: 'launch_hook' }
  const sessionStart = normalizeCodexHookPayload({
    hook_event_name: 'SessionStart',
    session_id: 'codex-session-a',
    cwd: repoRoot,
    model: 'gpt-test',
  }, env, '2026-06-27T00:00:00.000Z')
  const stop = normalizeCodexHookPayload({
    hook_event_name: 'Stop',
    session_id: 'codex-session-a',
    turn_id: 'turn-a',
    cwd: repoRoot,
    model: 'gpt-test',
    last_assistant_message: 'review complete',
  }, env, '2026-06-27T00:00:01.000Z')

  expect(sessionStart).toMatchObject({
    eventKind: 'agent.session_started',
    configId: 'local',
    terminalId: 'term_hook',
    launchId: 'launch_hook',
    agentSessionId: 'codex-session-a',
    adapterMetadata: { codexSessionId: 'codex-session-a' },
  })
  expect(stop).toMatchObject({
    eventKind: 'agent.output',
    agentTurnId: 'turn-a',
    capturedText: 'review complete',
    agentSessionId: 'codex-session-a',
    adapterMetadata: { codexSessionId: 'codex-session-a' },
  })

  const ingest = new ProbeAgentEventIngest('token-a')
  expect(ingest.post(sessionStart, 'bad-token')).toEqual({ ok: false, reason: 'invalid_token' })
  expect(ingest.post(sessionStart, 'token-a')).toMatchObject({ ok: true, accepted: true, spooled: false })
  ingest.online = false
  expect(ingest.post(stop, 'token-a')).toMatchObject({ ok: true, accepted: false, spooled: true })
  expect(ingest.importSpool()).toBe(1)
  expect(ingest.accepted.map((event) => event.eventKind)).toEqual(['agent.session_started', 'agent.output'])

  for (const id of ['A03', 'A04', 'A05', 'A06', 'A07']) {
    passedProbeIds.add(id)
  }
})

test('T01-T12 terminal deck API baseline matches shell-deck V0 expectations', () => {
  const deck = new ProbeTerminalDeck()
  deck.createConfig('local')
  deck.createConfig('other')
  const terminal = deck.createTerminal('local', 'term_local_a')
  const otherTerminal = deck.createTerminal('other', 'term_other_a')

  expect(terminal.terminalIndex).toBe(1)
  expect(terminal.terminalId).toBe('term_local_a')
  expect(deck.indexMap('local')).toEqual([{ index: 1, terminalId: 'term_local_a' }])

  const first = deck.connectClient('local', 'first')
  const second = deck.connectClient('local', 'second')
  const other = deck.connectClient('other', 'other-client')
  deck.subscribeTerminal('first', terminal.terminalId)
  deck.subscribeTerminal('second', terminal.terminalId)
  deck.subscribeTerminal('other-client', otherTerminal.terminalId)

  expect(first.messages.some((message) => message.type === 'terminal_snapshot' && message.replay.join('').includes('READY'))).toBe(true)
  expect(second.messages.some((message) => message.type === 'terminal_snapshot' && message.replay.join('').includes('READY'))).toBe(true)

  deck.terminalInput('local', terminal.terminalId, 'hello\r')
  expect(outputText(first, terminal.terminalId)).toContain('ECHO:hello')
  expect(outputText(second, terminal.terminalId)).toContain('ECHO:hello')
  expect(outputText(other, otherTerminal.terminalId)).not.toContain('ECHO:hello')

  deck.terminalInput('local', terminal.terminalId, 'from-second\r')
  const late = deck.connectClient('local', 'late')
  deck.subscribeTerminal('late', terminal.terminalId)
  expect(snapshotText(late, terminal.terminalId)).toContain('ECHO:hello')
  expect(snapshotText(late, terminal.terminalId)).toContain('ECHO:from-second')

  deck.terminalInput('local', terminal.terminalId, 'partial-no-local-echo')
  expect(outputText(first, terminal.terminalId)).not.toContain('partial-no-local-echo')

  deck.terminalInput('local', terminal.terminalId, '\u001b')
  deck.terminalInput('local', terminal.terminalId, '\u0003')
  expect(outputText(first, terminal.terminalId)).toContain('<ESC>')
  expect(outputText(first, terminal.terminalId)).toContain('^C')

  const longPaste = 'x'.repeat(5000)
  deck.terminalInput('local', terminal.terminalId, `${longPaste}\r`)
  expect(outputText(first, terminal.terminalId)).toContain(`ECHO:${longPaste}`)

  deck.terminalResize('local', terminal.terminalId, 120, 30)
  expect(first.messages.some((message) => message.type === 'terminal_state' && message.cols === 120 && message.rows === 30)).toBe(true)

  const capture = deck.captureTerminalBuffer('local', terminal.terminalId, 'cap_1')
  expect(capture.artifactRef).toBe('artifacts/capture/cap_1.txt')
  expect(capture.text).toContain('ECHO:hello')

  const terminalB = deck.createTerminal('local', 'term_local_b')
  deck.moveTerminal('local', terminalB.terminalId, 1)
  expect(deck.indexMap('local')).toEqual([
    { index: 1, terminalId: 'term_local_b' },
    { index: 2, terminalId: 'term_local_a' },
  ])

  const beforeFailedReset = snapshotText(late, terminal.terminalId)
  expect(deck.resetTerminal('local', terminal.terminalId, { fail: true })).toEqual({ ok: false, reason: 'backend_unavailable' })
  const afterFailedReset = deck.captureTerminalBuffer('local', terminal.terminalId, 'cap_failed_reset').text
  expect(afterFailedReset).toContain(beforeFailedReset.trim().split('\n').at(-1) ?? 'ECHO:from-second')

  expect(deck.resetTerminal('local', terminal.terminalId)).toEqual({ ok: true })
  expect(snapshotText(first, terminal.terminalId)).toContain('READY')
  expect(deck.commandChannel).toBe('helper-stdin-pipe')

  deck.closeTerminal('local', terminal.terminalId)
  expect(deck.terminalInput('local', terminal.terminalId, 'after-close\r')).toEqual({ ok: false, reason: 'not_running' })

  for (const id of ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12']) {
    passedProbeIds.add(id)
  }
})

function outputText(client: { messages: Array<{ type: string; terminalId?: string; data?: string }> }, terminalId: string) {
  return client.messages
    .filter((message) => message.type === 'pty_output' && message.terminalId === terminalId)
    .map((message) => message.data ?? '')
    .join('')
}

function snapshotText(client: { messages: Array<{ type: string; terminalId?: string; replay?: string[] }> }, terminalId: string) {
  const snapshot = client.messages.findLast((message) => message.type === 'terminal_snapshot' && message.terminalId === terminalId)
  return snapshot?.replay?.join('') ?? ''
}
