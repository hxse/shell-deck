import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { startShellDeckServer } from '../../server/httpServer'
import { TerminalDeckManager } from '../../server/terminalDeckManager'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import type { AgentEvent } from '../../src/lib/agentEvents/agentEventTypes'
import { MacroTemplateStore } from '../../src/lib/macro/templateStore'
import type { MacroTemplate } from '../../src/lib/macro/templateTypes'
import { RunEventStore } from '../../src/lib/runLog/runEventStore'

test('agent-event capture source writes raw event and captured text artifacts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-006-agent-capture-'))
  try {
    const manager = new TerminalDeckManager()
    manager.createTerminal('local', { backend: 'fake', terminalId: 'term_review_a', terminalAlias: 'reviewer' })
    const templateStore = new MacroTemplateStore(root)
    const runStore = new RunEventStore(root)
    const agentStore = new AgentEventStore(root)
    const service = new MacroRunnerService(manager, templateStore, runStore, agentStore)

    agentStore.append(agentOutput({ terminalId: 'term_review_a', text: 'stale ready' }))
    templateStore.save('local', template('agent_capture', [
      { id: 'wait_capture', type: 'wait', mode: 'capture-ready-or-user', captureStep: 'capture_agent', timeoutMs: 200, onTimeout: 'fail', next: 'capture_agent' },
      { id: 'capture_agent', type: 'capture-source', capture: { kind: 'agent-event', agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook', terminal: { kind: 'alias', value: 'reviewer' } }, next: 'parse_agent' },
      { id: 'parse_agent', type: 'parse', captureStep: 'capture_agent', parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready', flags: 'i', onMatch: true, onNoMatch: false }] }, next: 'branch_agent' },
      { id: 'branch_agent', type: 'branch', fromParseStep: 'parse_agent', conditions: [{ signal: 'hasReadyText', op: '==', value: true, goto: 'done' }], else: 'fail_agent' },
      { id: 'done', type: 'complete', reason: 'ok' },
      { id: 'fail_agent', type: 'fail', reason: 'missing ready' },
    ]), manager.indexMap('local'))

    await service.start('local', { templateId: 'agent_capture' })
    await waitFor(async () => service.snapshot('local').status === 'waiting')
    agentStore.append(agentOutput({ terminalId: 'term_review_a', text: 'ai-fixable ready', turnId: 'turn-b', receivedAt: '2026-06-30T00:00:01.000Z' }))
    await waitFor(async () => service.snapshot('local').status === 'completed')
    const run = service.snapshot('local').run
    const captureEvent = run?.replay.events.find((event) => event.kind === 'capture_artifact_created')
    expect(captureEvent?.data).toMatchObject({
      captureKind: 'agent-event',
      terminalId: 'term_review_a',
      agentSessionId: 'codex-session-a',
      codexSessionId: 'codex-session-a',
    })
    const artifactRef = String(captureEvent?.data.artifactRef)
    const rawArtifactRef = String(captureEvent?.data.rawArtifactRef)
    if (!run) throw new Error('missing run')
    expect(runStore.readArtifact('local', run.runId, artifactRef)).toBe('ai-fixable ready')
    expect(runStore.readArtifact('local', run.runId, rawArtifactRef)).toContain('"codexSessionId": "codex-session-a"')
    expect(run.replay.events.find((event) => event.kind === 'wait_completed')?.data.manualContinue).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})



test('runner imports AgentEvent spool before agent-event capture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-006-spool-capture-'))
  try {
    const manager = new TerminalDeckManager()
    manager.createTerminal('local', { backend: 'fake', terminalId: 'term_spool_capture', terminalAlias: 'reviewer' })
    const templateStore = new MacroTemplateStore(root)
    const runStore = new RunEventStore(root)
    const agentStore = new AgentEventStore(root)
    const service = new MacroRunnerService(manager, templateStore, runStore, agentStore)
    agentStore.spool(agentOutput({ terminalId: 'term_spool_capture', text: 'spooled capture ready', turnId: 'turn-spool' }))
    templateStore.save('local', template('spool_capture', [
      { id: 'capture_agent', type: 'capture-source', capture: { kind: 'agent-event', agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook', terminal: { kind: 'alias', value: 'reviewer' } }, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), manager.indexMap('local'))

    await service.start('local', { templateId: 'spool_capture' })
    await waitFor(async () => service.snapshot('local').status === 'completed')
    const run = service.snapshot('local').run
    const captureEvent = run?.replay.events.find((event) => event.kind === 'capture_artifact_created')
    if (!run) throw new Error('missing run')
    expect(runStore.readArtifact('local', run.runId, String(captureEvent?.data.artifactRef))).toBe('spooled capture ready')
    expect(agentStore.list('local').map((event) => event.agentTurnId)).toContain('turn-spool')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


test('HTTP spool import endpoint imports offline AgentEvent JSONL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-006-http-spool-import-'))
  const oldRoot = process.env.SHELL_DECK_DATA_ROOT
  process.env.SHELL_DECK_DATA_ROOT = root
  const server = startShellDeckServer({ port: 0, seed: false })
  try {
    const store = new AgentEventStore(root)
    store.spool(agentOutput({ terminalId: 'term_endpoint_spool', text: 'endpoint spool', turnId: 'turn-endpoint' }))
    const response = await fetch(server.url + '/api/configs/local/agent-events/import-spool', { method: 'POST' })
    expect(response.status).toBe(200)
    const body = await response.json() as { imported: number }
    expect(body.imported).toBe(1)
    expect(store.list('local').map((event) => event.agentTurnId)).toContain('turn-endpoint')
  } finally {
    server.stop()
    if (oldRoot === undefined) delete process.env.SHELL_DECK_DATA_ROOT
    else process.env.SHELL_DECK_DATA_ROOT = oldRoot
    rmSync(root, { recursive: true, force: true })
  }
})

test('HTTP AgentEvent ingest feeds server-owned runner capture source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-006-http-agent-capture-'))
  const oldRoot = process.env.SHELL_DECK_DATA_ROOT
  const oldToken = process.env.SHELL_DECK_INGEST_TOKEN
  process.env.SHELL_DECK_DATA_ROOT = root
  process.env.SHELL_DECK_INGEST_TOKEN = 'token-http'
  const server = startShellDeckServer({ port: 0, seed: false })
  try {
    const configId = 'http_capture'
    const terminalResponse = await fetch(server.url + '/api/configs/' + configId + '/terminals?backend=fake', { method: 'POST' })
    const terminal = await terminalResponse.json() as { terminalId: string }
    const httpTemplate = { ...template('http_agent_capture', [
      { id: 'capture_agent', type: 'capture-source', capture: { kind: 'agent-event', agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook', terminal: { kind: 'id', value: terminal.terminalId } }, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), configId }
    const importResponse = await fetch(server.url + '/api/configs/' + configId + '/templates/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(httpTemplate),
    })
    expect(importResponse.status).toBe(201)

    const event = { ...agentOutput({ terminalId: terminal.terminalId, text: 'http captured text' }), configId }
    const ingestResponse = await fetch(server.url + '/api/agent-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shell-deck-ingest-token': 'token-http' },
      body: JSON.stringify(event),
    })
    expect(ingestResponse.status).toBe(201)

    const startResponse = await fetch(server.url + '/api/configs/' + configId + '/runner/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'http_agent_capture' }),
    })
    expect(startResponse.status).toBe(200)
    await waitFor(async () => {
      const response = await fetch(server.url + '/api/configs/' + configId + '/runner')
      const body = await response.json() as { runner: { status: string } }
      return body.runner.status === 'completed'
    })

    const runsResponse = await fetch(server.url + '/api/configs/' + configId + '/runs')
    const runsBody = await runsResponse.json() as { runs: Array<{ runId: string }> }
    const runResponse = await fetch(server.url + '/api/configs/' + configId + '/runs/' + runsBody.runs[0].runId)
    const runBody = await runResponse.json() as { run: { replay: { events: Array<{ kind: string; data: Record<string, unknown> }> } } }
    const captureEvent = runBody.run.replay.events.find((candidate) => candidate.kind === 'capture_artifact_created')
    expect(captureEvent?.data.codexSessionId).toBe('codex-session-a')
    expect(captureEvent?.data.captureKind).toBe('agent-event')
  } finally {
    server.stop()
    if (oldRoot === undefined) delete process.env.SHELL_DECK_DATA_ROOT
    else process.env.SHELL_DECK_DATA_ROOT = oldRoot
    if (oldToken === undefined) delete process.env.SHELL_DECK_INGEST_TOKEN
    else process.env.SHELL_DECK_INGEST_TOKEN = oldToken
    rmSync(root, { recursive: true, force: true })
  }
})

function template(id: string, steps: MacroTemplate['steps']): MacroTemplate {
  const now = '2026-06-30T00:00:00.000Z'
  return { schemaVersion: 1, id, name: id, description: '', configId: 'local', steps, createdAt: now, updatedAt: now }
}

function agentOutput(options: { terminalId: string; text: string; turnId?: string; receivedAt?: string }): AgentEvent {
  return {
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.output',
    configId: 'local',
    terminalId: options.terminalId,
    launchId: 'launch_agent_capture',
    agentSessionId: 'codex-session-a',
    agentTurnId: options.turnId ?? 'turn-a',
    adapterMetadata: {
      adapter: 'codex-stop-hook',
      codexSessionId: 'codex-session-a',
    },
    capturedText: options.text,
    raw: {
      source: 'codex.Stop',
      payload: { hook_event_name: 'Stop' },
    },
    receivedAt: options.receivedAt ?? '2026-06-30T00:00:00.000Z',
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 80; i += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timeout waiting for predicate')
}
