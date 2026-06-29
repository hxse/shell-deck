import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import type { AgentEvent } from '../../src/lib/agentEvents/agentEventTypes'
import { TerminalDeckManager } from '../../server/terminalDeckManager'
import { MacroTemplateStore } from '../../src/lib/macro/templateStore'
import type { MacroTemplate, ParallelLane, ParserConfig } from '../../src/lib/macro/templateTypes'
import { ParserRuntime, type AiJsonAdapter } from '../../src/lib/parser/parserRuntime'
import { RunEventStore } from '../../src/lib/runLog/runEventStore'

type HarnessOptions = {
  aiJsonMode?: 'disabled' | 'mock'
  aiJsonAdapter?: AiJsonAdapter
}

function harness(options: HarnessOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-008-'))
  const manager = new TerminalDeckManager()
  manager.ensureConfig('local')
  manager.createTerminal('local', { backend: 'fake', terminalId: 'term_main_a', terminalAlias: 'main' })
  manager.createTerminal('local', { backend: 'fake', terminalId: 'term_review_b', terminalAlias: 'reviewer' })
  const templateStore = new MacroTemplateStore(root)
  const runStore = new RunEventStore(root)
  const agentStore = new AgentEventStore(root)
  const parserRuntime = new ParserRuntime(runStore, { aiJsonMode: options.aiJsonMode ?? 'disabled', ...(options.aiJsonAdapter ? { aiJsonAdapter: options.aiJsonAdapter } : {}) })
  const service = new MacroRunnerService(manager, templateStore, runStore, agentStore, parserRuntime)
  return { root, manager, templateStore, runStore, agentStore, service }
}

test('parallel_all runs two fake terminal-buffer regex lanes and joins all_success', async () => {
  const h = harness()
  try {
    h.templateStore.save('local', template('parallel_regex', regexParser()), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'parallel_regex' })
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    const snapshot = h.service.snapshot('local')
    expect(snapshot.status).toBe('completed')
    const replay = h.manager.deckSnapshot('local').terminals.map((terminal) => terminal.replay.join('')).join(String.fromCharCode(10))
    expect(replay).toContain('ECHO:ready main')
    expect(replay).toContain('ECHO:ready review')
    expect(eventKinds(h).filter((kind) => kind === 'parallel_lane_succeeded')).toHaveLength(2)
    expect(eventKinds(h)).toContain('parallel_all_joined')
    const parentLog = snapshot.run?.nodeLogs.find((node) => node.nodeId === 'parallel_review')
    expect(parentLog?.events.some((event) => event.data.laneId === 'main_lane')).toBe(true)
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('parallel_all condition failure pauses the run with lane evidence', async () => {
  const h = harness()
  try {
    const candidate = template('parallel_fail', regexParser())
    const parallel = candidate.steps[0]
    if (parallel.type !== 'parallel_all') throw new Error('missing parallel_all')
    parallel.lanes[1].success.conditions[0].value = false
    h.templateStore.save('local', candidate, h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'parallel_fail' })
    await waitFor(async () => h.service.snapshot('local').status === 'paused')
    const snapshot = h.service.snapshot('local')
    expect(snapshot.pauseReason?.code).toBe('parallel_lane_condition_failed')
    expect(snapshot.pauseReason?.message).toContain('review_lane')
    const failed = snapshot.run?.replay.events.find((event) => event.kind === 'parallel_lane_failed')
    expect(failed?.data.laneId).toBe('review_lane')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('parallel_all resume does not repeat lane send steps already written to event log', async () => {
  const h = harness()
  try {
    const candidate = template('parallel_resume', regexParser(), 100)
    h.templateStore.save('local', candidate, h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'parallel_resume' })
    await waitFor(async () => sentCount(h) === 2)
    await h.service.pause('local')
    expect(h.service.snapshot('local').status).toBe('paused')
    await h.service.resume('local')
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    expect(sentCount(h)).toBe(2)
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('parallel_all can reuse mock ai-json parser lanes explicitly', async () => {
  const h = harness({ aiJsonMode: 'mock' })
  try {
    h.templateStore.save('local', template('parallel_mock_ai', { kind: 'ai-json', profileId: 'review-routing-v1' }), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'parallel_mock_ai' })
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    const parserEvents = h.service.snapshot('local').run?.replay.events.filter((event) => event.kind === 'parallel_lane_parser_normalized') ?? []
    expect(parserEvents).toHaveLength(2)
    expect(parserEvents.every((event) => event.data.artifactRef)).toBe(true)
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('parallel_all can capture two AgentEvent lanes and mock-parse without crossing lane state', async () => {
  const h = harness({ aiJsonMode: 'mock' })
  try {
    h.templateStore.save('local', agentEventTemplate('parallel_agent_events'), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'parallel_agent_events' })
    await waitFor(async () => (h.service.snapshot('local').run?.replay.events.filter((event) => event.kind === 'parallel_lane_waiting').length ?? 0) === 2)
    h.agentStore.append(agentOutput({ terminalId: 'term_main_a', text: 'clean no issues from main lane', turnId: 'turn-main', receivedAt: '2026-07-01T00:00:01.000Z' }))
    h.agentStore.append(agentOutput({ terminalId: 'term_review_b', text: 'clean no issues from review lane', turnId: 'turn-review', receivedAt: '2026-07-01T00:00:02.000Z' }))
    await waitFor(async () => h.service.snapshot('local').status === 'completed')

    const events = h.service.snapshot('local').run?.replay.events ?? []
    const captures = events.filter((event) => event.kind === 'capture_artifact_created' && event.data.captureKind === 'agent-event')
    expect(captures).toHaveLength(2)
    expect(captures.map((event) => [event.data.laneId, event.data.terminalId]).sort()).toEqual([['main_lane', 'term_main_a'], ['review_lane', 'term_review_b']])
    const parserEvents = events.filter((event) => event.kind === 'parallel_lane_parser_normalized')
    expect(parserEvents).toHaveLength(2)
    expect(parserEvents.map((event) => event.data.laneId).sort()).toEqual(['main_lane', 'review_lane'])
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('parallel_all aborts every active lane parser when paused', async () => {
  let started = 0
  let aborted = 0
  const delayedAdapter: AiJsonAdapter = async (_profile, _text, context) => {
    started += 1
    return await new Promise<never>((_resolve, reject) => {
      const abort = () => {
        aborted += 1
        reject(new Error('aborted'))
      }
      if (context.signal?.aborted) abort()
      else context.signal?.addEventListener('abort', abort, { once: true })
    })
  }
  const h = harness({ aiJsonAdapter: delayedAdapter })
  try {
    h.templateStore.save('local', template('parallel_abort_parser', { kind: 'ai-json', profileId: 'review-routing-v1' }), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'parallel_abort_parser' })
    await waitFor(async () => started === 2)
    await h.service.pause('local')
    await waitFor(async () => aborted === 2)
    await delayFor(50)
    const snapshot = h.service.snapshot('local')
    expect(snapshot.status).toBe('paused')
    const events = snapshot.run?.replay.events ?? []
    expect(events.some((event) => event.kind === 'parallel_lane_parser_normalized')).toBe(false)
    expect(events.some((event) => event.kind === 'parallel_all_joined')).toBe(false)
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

function template(id: string, parser: ParserConfig, sleepMs = 1): MacroTemplate {
  const now = new Date('2026-07-01T00:00:00.000Z').toISOString()
  return {
    schemaVersion: 1,
    id,
    name: id,
    description: '',
    configId: 'local',
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: 'parallel_review',
        type: 'parallel_all',
        lanes: [lane('main_lane', { kind: 'alias', value: 'main' }, 'main', parser, sleepMs), lane('review_lane', { kind: 'alias', value: 'reviewer' }, 'review', parser, sleepMs)],
        join: { mode: 'all_success', onLaneFail: 'pause', onTimeout: 'pause' },
        next: 'done',
      },
      { id: 'done', type: 'complete', reason: 'ok' },
    ],
  }
}

function lane(id: string, terminal: { kind: 'alias'; value: string }, prefix: string, parser: ParserConfig, sleepMs: number): ParallelLane {
  const signal = parser.kind === 'regex' ? parser.rules[0].signal : 'onlyP3OrClean'
  return {
    id,
    terminal,
    steps: [
      { id: 'send_' + prefix, type: 'send_line', text: 'ready ' + prefix + ' clean p3' },
      { id: 'sleep_' + prefix, type: 'sleep', durationMs: sleepMs },
      { id: 'wait_' + prefix, type: 'wait', mode: 'terminal-quiet', terminal, quietMs: 5, maxMs: 300, onTimeout: 'pause' },
      { id: 'capture_' + prefix, type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 12000 } },
      { id: 'parse_' + prefix, type: 'parse', captureStep: 'capture_' + prefix, parser },
    ],
    success: { fromParseStep: 'parse_' + prefix, mode: 'all', conditions: [{ signal, op: '==', value: true }] },
  }
}

function agentEventTemplate(id: string): MacroTemplate {
  const now = new Date('2026-07-01T00:00:00.000Z').toISOString()
  return {
    schemaVersion: 1,
    id,
    name: id,
    description: '',
    configId: 'local',
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: 'parallel_review',
        type: 'parallel_all',
        lanes: [agentLane('main_lane', { kind: 'alias', value: 'main' }, 'main'), agentLane('review_lane', { kind: 'alias', value: 'reviewer' }, 'review')],
        join: { mode: 'all_success', onLaneFail: 'pause', onTimeout: 'pause' },
        next: 'done',
      },
      { id: 'done', type: 'complete', reason: 'ok' },
    ],
  }
}

function agentLane(id: string, terminal: { kind: 'alias'; value: string }, prefix: string): ParallelLane {
  const captureStep = 'capture_agent_' + prefix
  const parseStep = 'parse_agent_' + prefix
  return {
    id,
    terminal,
    steps: [
      { id: 'send_agent_' + prefix, type: 'send_line', text: 'agent wait ' + prefix },
      { id: 'wait_agent_' + prefix, type: 'wait', mode: 'capture-ready-or-user', captureStep, timeoutMs: 500, onTimeout: 'pause' },
      { id: captureStep, type: 'capture-source', capture: { kind: 'agent-event', agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook', terminal } },
      { id: parseStep, type: 'parse', captureStep, parser: { kind: 'ai-json', profileId: 'review-routing-v1' } },
    ],
    success: { fromParseStep: parseStep, mode: 'all', conditions: [{ signal: 'onlyP3OrClean', op: '==', value: true }] },
  }
}

function agentOutput(options: { terminalId: string; text: string; turnId: string; receivedAt: string }): AgentEvent {
  return {
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.output',
    configId: 'local',
    terminalId: options.terminalId,
    launchId: 'launch_parallel_agent',
    agentSessionId: 'codex-session-' + options.terminalId,
    agentTurnId: options.turnId,
    adapterMetadata: { adapter: 'codex-stop-hook', codexSessionId: 'codex-session-' + options.terminalId },
    capturedText: options.text,
    raw: { source: 'codex.Stop', payload: { hook_event_name: 'Stop' } },
    receivedAt: options.receivedAt,
  }
}

function regexParser(): ParserConfig {
  return { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready', flags: 'i', onMatch: true, onNoMatch: false }] }
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 120; i += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timeout waiting for predicate')
}

function eventKinds(h: ReturnType<typeof harness>) {
  return h.service.snapshot('local').run?.replay.events.map((event) => event.kind) ?? []
}

function delayFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sentCount(h: ReturnType<typeof harness>): number {
  return h.service.snapshot('local').run?.replay.events.filter((event) => event.kind === 'terminal_line_sent').length ?? 0
}
