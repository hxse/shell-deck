import { expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { TerminalDeckManager } from '../../server/terminalDeckManager'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import type { AgentEvent } from '../../src/lib/agentEvents/agentEventTypes'
import { MacroTemplateStore } from '../../src/lib/macro/templateStore'
import type { MacroTemplate } from '../../src/lib/macro/templateTypes'
import { ParserRuntime, type AiJsonAdapter } from '../../src/lib/parser/parserRuntime'
import { ParserInvocationError, type ParserInvocationOutput } from '../../src/lib/parser/parserProfileTypes'
import { RunEventStore } from '../../src/lib/runLog/runEventStore'

test('terminal-buffer capture artifact plus mock ai-json parser drives branch', async () => {
  const h = harness()
  try {
    h.manager.input('local', { kind: 'alias', value: 'reviewer' }, 'AI can directly fix this P2 review item.\r')
    await waitFor(async () => h.manager.deckSnapshot('local').terminals[0].replay.join('').includes('AI can directly fix'))
    h.templateStore.save('local', template('mock_ai_json_terminal', [
      { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse' },
      { id: 'parse', type: 'parse', captureStep: 'capture', parser: { kind: 'ai-json', profileId: 'review-routing-v1' }, next: 'branch' },
      { id: 'branch', type: 'branch', fromParseStep: 'parse', conditions: [{ signal: 'hasAiFixable', op: '==', value: true, goto: 'done' }], else: 'fail' },
      { id: 'done', type: 'complete', reason: 'ok' },
      { id: 'fail', type: 'fail', reason: 'no fixable signal' },
    ]), h.manager.indexMap('local'))

    await h.service.start('local', { templateId: 'mock_ai_json_terminal' })
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    const parserEvent = h.service.snapshot('local').run?.replay.events.find((event) => event.kind === 'parser_normalized')
    expect(parserEvent?.data).toMatchObject({ parserKind: 'ai-json', profileId: 'review-routing-v1', signals: { hasAiFixable: true } })
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('agent-event capture artifact plus mock ai-json parser drives branch', async () => {
  const h = harness()
  try {
    h.agentStore.append(agentOutput('AI can directly fix the review finding.'))
    h.templateStore.save('local', template('mock_ai_json_agent', [
      { id: 'capture', type: 'capture-source', capture: { kind: 'agent-event', agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook', terminal: { kind: 'alias', value: 'reviewer' } }, next: 'parse' },
      { id: 'parse', type: 'parse', captureStep: 'capture', parser: { kind: 'ai-json', profileId: 'review-routing-v1' }, next: 'branch' },
      { id: 'branch', type: 'branch', fromParseStep: 'parse', conditions: [{ signal: 'hasAiFixable', op: '==', value: true, goto: 'done' }], else: 'fail' },
      { id: 'done', type: 'complete', reason: 'ok' },
      { id: 'fail', type: 'fail', reason: 'no fixable signal' },
    ]), h.manager.indexMap('local'))

    await h.service.start('local', { templateId: 'mock_ai_json_agent' })
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    expect(h.service.snapshot('local').run?.replay.events.map((event) => event.kind)).toContain('parser_normalized')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('ai-json replica disagreement pauses before branch', async () => {
  const h = harness({ disagreement: true })
  try {
    h.manager.input('local', { kind: 'alias', value: 'reviewer' }, 'AI can directly fix this.\r')
    await waitFor(async () => h.manager.deckSnapshot('local').terminals[0].replay.join('').includes('AI can directly fix'))
    h.templateStore.save('local', template('disagreement', [
      { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse' },
      { id: 'parse', type: 'parse', captureStep: 'capture', parser: { kind: 'ai-json', profileId: 'review-routing-v1' }, next: 'branch' },
      { id: 'branch', type: 'branch', fromParseStep: 'parse', conditions: [{ signal: 'hasAiFixable', op: '==', value: true, goto: 'done' }], else: 'fail' },
      { id: 'done', type: 'complete', reason: 'ok' },
      { id: 'fail', type: 'fail', reason: 'no fixable signal' },
    ]), h.manager.indexMap('local'))

    await h.service.start('local', { templateId: 'disagreement' })
    await waitFor(async () => h.service.snapshot('local').status === 'paused')
    const snapshot = h.service.snapshot('local')
    expect(snapshot.pauseReason?.code).toBe('parser_disagreement')
    expect(snapshot.run?.replay.events.map((event) => event.kind)).toContain('parser_disagreement')
    expect(snapshot.run?.replay.events.map((event) => event.kind)).not.toContain('branch_decision')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('default product parser mode pauses ai-json instead of silently using mock', async () => {
  const h = harness({ aiJsonMode: 'disabled' })
  try {
    h.manager.input('local', { kind: 'alias', value: 'reviewer' }, 'AI can directly fix this.\r')
    h.templateStore.save('local', template('disabled_ai_json', [
      { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse' },
      { id: 'parse', type: 'parse', captureStep: 'capture', parser: { kind: 'ai-json', profileId: 'review-routing-v1' }, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), h.manager.indexMap('local'))

    await h.service.start('local', { templateId: 'disabled_ai_json' })
    await waitFor(async () => h.service.snapshot('local').status === 'paused')
    const snapshot = h.service.snapshot('local')
    expect(snapshot.pauseReason?.code).toBe('ai_json_adapter_not_configured')
    expect(snapshot.run?.replay.events.map((event) => event.kind)).not.toContain('parser_normalized')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('pause during parser invocation prevents late parser completion events', async () => {
  let release!: () => void
  let signal: AbortSignal | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const adapter: AiJsonAdapter = async (profile, _text, context) => {
    signal = context.signal
    await gate
    const signals = { hasAiFixable: true, needsUserDecision: false, onlyP3OrClean: false }
    const rawArtifactRef = await context.writeArtifact('parser-ai-json-raw', JSON.stringify(signals), 'json')
    const normalizedArtifactRef = await context.writeArtifact('parser-normalized', JSON.stringify({ signals }), 'json')
    return { parserKind: 'ai-json', profileId: profile.profileId, signals, rawArtifactRef, normalizedArtifactRef, metadata: {} }
  }
  const h = harness({ aiJsonAdapter: adapter })
  try {
    h.manager.input('local', { kind: 'alias', value: 'reviewer' }, 'AI can directly fix this.\r')
    h.templateStore.save('local', template('pause_during_parse', [
      { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse' },
      { id: 'parse', type: 'parse', captureStep: 'capture', parser: { kind: 'ai-json', profileId: 'review-routing-v1' }, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), h.manager.indexMap('local'))

    await h.service.start('local', { templateId: 'pause_during_parse' })
    await waitFor(async () => Boolean(signal))
    await h.service.pause('local')
    expect(signal?.aborted).toBe(true)
    release()
    await delayFor(60)

    const snapshot = h.service.snapshot('local')
    const parseEvents = snapshot.run?.replay.events.filter((event) => event.stepId === 'parse').map((event) => event.kind) ?? []
    expect(snapshot.status).toBe('paused')
    expect(parseEvents).not.toContain('parser_normalized')
    expect(parseEvents).not.toContain('step_completed')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('parser invocation errors pause with raw artifact evidence on the node log', async () => {
  const adapter: AiJsonAdapter = async (_profile, _text, context) => {
    const inputArtifactRef = await context.writeArtifact('parser-input', 'input used for parser', 'txt')
    const rawArtifactRef = await context.writeArtifact('parser-ai-json-raw', '{not json', 'txt')
    throw new ParserInvocationError('invalid_ai_json_json', 'bad json', { rawArtifactRef, inputArtifactRef })
  }
  const h = harness({ aiJsonAdapter: adapter })
  try {
    h.templateStore.save('local', template('parser_error_raw_ref', [
      { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse' },
      { id: 'parse', type: 'parse', captureStep: 'capture', parser: { kind: 'ai-json', profileId: 'review-routing-v1' }, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), h.manager.indexMap('local'))

    await h.service.start('local', { templateId: 'parser_error_raw_ref' })
    await waitFor(async () => h.service.snapshot('local').status === 'paused')
    const snapshot = h.service.snapshot('local')
    const pause = snapshot.run?.replay.events.find((event) => event.kind === 'run_paused')
    const rawArtifactRef = String(pause?.data.rawArtifactRef)
    expect(pause?.data.code).toBe('invalid_ai_json_json')
    expect(rawArtifactRef.startsWith('artifacts/parser-ai-json-raw-')).toBe(true)
    expect(h.runStore.readArtifact('local', snapshot.run?.runId ?? '', rawArtifactRef)).toBe('{not json')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

function harness(options: { disagreement?: boolean; aiJsonAdapter?: AiJsonAdapter; aiJsonMode?: 'disabled' | 'mock' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-007-runner-'))
  const manager = new TerminalDeckManager()
  manager.createTerminal('local', { backend: 'fake', terminalId: 'term_review_a', terminalAlias: 'reviewer' })
  const templateStore = new MacroTemplateStore(root)
  const runStore = new RunEventStore(root)
  const agentStore = new AgentEventStore(root)
  let parserRuntime: ParserRuntime | undefined
  if (options.aiJsonMode) {
    parserRuntime = new ParserRuntime(runStore, { aiJsonMode: options.aiJsonMode })
  } else if (options.aiJsonAdapter) {
    parserRuntime = new ParserRuntime(runStore, { aiJsonAdapter: options.aiJsonAdapter })
  } else if (options.disagreement) {
    const profileRoot = join(root, 'profiles')
    mkdirSync(profileRoot, { recursive: true })
    cpSync(join(process.cwd(), 'parser-profiles', 'review-routing-v1'), join(profileRoot, 'review-routing-v1'), { recursive: true })
    const manifestPath = join(profileRoot, 'review-routing-v1', 'profile.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.replicas = 2
    manifest.replicaStrategy = 'agree_or_pause'
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    parserRuntime = new ParserRuntime(runStore, {
      profileRoot,
      aiJsonAdapter: async (profile, _text, context, replicaIndex) => {
        const signals = replicaIndex === 0
          ? { hasAiFixable: true, needsUserDecision: false, onlyP3OrClean: false }
          : { hasAiFixable: null, needsUserDecision: false, onlyP3OrClean: false }
        const rawArtifactRef = await context.writeArtifact('parser-ai-json-raw', JSON.stringify(signals), 'json')
        const normalizedArtifactRef = await context.writeArtifact('parser-normalized', JSON.stringify({ signals }), 'json')
        return { parserKind: 'ai-json', profileId: profile.profileId, signals, rawArtifactRef, normalizedArtifactRef, metadata: { replicaIndex } } satisfies ParserInvocationOutput
      },
    })
  } else {
    parserRuntime = new ParserRuntime(runStore, { aiJsonMode: 'mock' })
  }
  const service = new MacroRunnerService(manager, templateStore, runStore, agentStore, parserRuntime)
  return { root, manager, templateStore, runStore, agentStore, service }
}

function template(id: string, steps: MacroTemplate['steps']): MacroTemplate {
  const now = '2026-06-30T00:00:00.000Z'
  return { schemaVersion: 1, id, name: id, description: '', configId: 'local', steps, createdAt: now, updatedAt: now }
}

function agentOutput(text: string): AgentEvent {
  return {
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.output',
    configId: 'local',
    terminalId: 'term_review_a',
    launchId: 'launch_007',
    agentSessionId: 'codex-session-007',
    agentTurnId: 'turn-007',
    adapterMetadata: { adapter: 'codex-stop-hook', codexSessionId: 'codex-session-007' },
    capturedText: text,
    raw: { source: 'codex.Stop', payload: { hook_event_name: 'Stop' } },
    receivedAt: '2026-06-30T00:00:00.000Z',
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timeout waiting for predicate')
}

function delayFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
