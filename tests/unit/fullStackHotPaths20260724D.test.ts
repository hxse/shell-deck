import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import type { AgentEvent, AgentEventMatch } from '../../src/lib/agentEvents/agentEventTypes'
import { canonicalJsonStringify } from '../../src/lib/canonicalJson'
import { createGeneratedId } from '../../src/lib/generatedId'
import { buildArtifactChoiceIndex } from '../../src/lib/macro/macroArtifactChoices'
import {
  diagnoseTrustedMacroDefinitionV6,
  type MacroDefinitionDiagnosticsMetrics,
} from '../../src/lib/macro/macroDefinitionValidation'
import type { MacroDefinitionV6 } from '../../src/lib/macro/macroDefinitionTypes'
import { MacroDiagnosticsScheduler } from '../../src/lib/macro/macroDiagnosticsScheduler'
import { createMacroDraftMutationTracker } from '../../src/lib/macro/macroDraftMutation'
import { moveNodeAtPosition } from '../../src/lib/macro/flowV2EditorCommands'
import { traceEventWindow, type MacroRunEventPage } from '../../src/lib/macro/runnerTypes'
import {
  applyTextTerminalMutation,
  createTextTerminalMutation,
} from '../../src/lib/textTerminalMutation'
import { visibleLineWindow } from '../../src/lib/visibleLineWindow'
import { createLiveRun } from '../../server/macroRunnerLiveState'
import { MacroRunnerPublication } from '../../server/macroRunnerPublication'

describe('20260724D Macro hot paths', () => {
  test('trusted diagnostics visits a 1000-node draft once, keeps identity, and coalesces revisions', async () => {
    const definition = largeDefinition(1_000)
    const metrics: MacroDefinitionDiagnosticsMetrics = { nodeVisits: 0 }
    const diagnostics = diagnoseTrustedMacroDefinitionV6(definition, metrics)
    expect(diagnostics.persistable).toMatchObject({ ok: true })
    expect(diagnostics.runnable).toMatchObject({ ok: true })
    if (!diagnostics.persistable.ok || !diagnostics.runnable.ok) throw new Error('expected valid diagnostics')
    expect(diagnostics.persistable.value).toBe(definition)
    expect(diagnostics.runnable.value).toBe(definition)
    expect(metrics.nodeVisits).toBe(1_000)

    let revision = 1
    const scheduledMetrics: MacroDefinitionDiagnosticsMetrics = { nodeVisits: 0 }
    const scheduler = new MacroDiagnosticsScheduler(
      () => ({ definition, revision }),
      () => {},
      5,
      (value) => diagnoseTrustedMacroDefinitionV6(value, scheduledMetrics),
    )
    scheduler.schedule()
    scheduler.schedule()
    await Bun.sleep(20)
    expect(scheduledMetrics.nodeVisits).toBe(1_000)
    scheduler.flush()
    expect(scheduledMetrics.nodeVisits).toBe(1_000)
    revision += 1
    scheduler.flush()
    expect(scheduledMetrics.nodeVisits).toBe(2_000)
    scheduler.dispose()
  })

  test('dirty journal compares only the changed path and exact reversion is immediately clean', () => {
    const base = largeDefinition(1_000)
    const draft = structuredClone(base)
    Object.defineProperty(base, 'body', {
      configurable: true,
      enumerable: true,
      get() { throw new Error('unrelated base body traversed') },
    })
    Object.defineProperty(draft, 'body', {
      configurable: true,
      enumerable: true,
      get() { throw new Error('unrelated draft body traversed') },
    })
    const tracker = createMacroDraftMutationTracker()
    tracker.replaceBase(base)
    expect(tracker.apply(draft, (value) => { value.name = 'changed' })).toBe(true)
    expect(tracker.apply(draft, (value) => { value.name = 'large' })).toBe(false)
  })

  test('repeated splice moves never install recording Proxies into the live draft', () => {
    const definition = largeDefinition(2)
    const original = [...definition.body]
    const tracker = createMacroDraftMutationTracker()
    tracker.replaceBase(structuredClone(definition))
    for (let index = 0; index < 50; index += 1) {
      const forward = index % 2 === 0
      const dirty = tracker.apply(definition, (draft) => {
        const result = moveNodeAtPosition(draft, {
          bodyPath: [],
          index: forward ? 0 : 1,
        }, forward ? 1 : -1)
        if (!result.ok) throw new Error(result.reason)
      })
      expect(definition.body[forward ? 1 : 0]).toBe(original[0])
      expect(definition.body[forward ? 0 : 1]).toBe(original[1])
      expect(dirty).toBe(forward)
    }
  })

  test('artifact choices build one persistent scope for 10000 non-producing nodes', () => {
    const definition = largeDefinition(10_000)
    const index = buildArtifactChoiceIndex(definition)
    const first = index.before('wait_0')
    expect(first).toEqual([])
    expect(index.before('wait_9999')).toBe(first)
  })
})

describe('20260724D Text and projection primitives', () => {
  test('one replacement patch preserves UTF-16 pairs and falls back to replace for broad edits', () => {
    const base = 'A'.repeat(100) + '😀' + 'B'.repeat(100)
    const candidate = 'A'.repeat(100) + '😎' + 'B'.repeat(100)
    const patch = createTextTerminalMutation(base, candidate)
    expect(patch).toEqual({ kind: 'patch', start: 100, deleteCount: 2, insert: '😎' })
    expect(applyTextTerminalMutation(base, patch)).toBe(candidate)
    expect(() => applyTextTerminalMutation(base, {
      kind: 'patch',
      start: 101,
      deleteCount: 1,
      insert: 'x',
    })).toThrow('invalid_text_patch')
    expect(createTextTerminalMutation('a'.repeat(100), 'b'.repeat(100)).kind).toBe('replace')
  })

  test('a 2MiB tail edit produces a bounded payload and visible gutters stay viewport-bounded', () => {
    const base = 'a'.repeat(2 * 1024 * 1024)
    const mutation = createTextTerminalMutation(base, base + 'b')
    expect(mutation).toEqual({ kind: 'patch', start: base.length, deleteCount: 0, insert: 'b' })
    expect(JSON.stringify(mutation).length).toBeLessThan(100)
    const window = visibleLineWindow(1_000_000, 480_000, 400, 20)
    expect(window.end - window.start).toBeLessThanOrEqual(28)
  })

  test('canonical runner projection sorts object keys by Unicode code point', () => {
    const astral = '\u{10000}'
    const bmp = '\ue000'
    expect(canonicalJsonStringify({ [astral]: 1, [bmp]: 2 }))
      .toBe(`{"${bmp}":2,"${astral}":1}`)
    expect(canonicalJsonStringify({
      array: [undefined, Number.NaN],
      omitted: undefined,
      when: new Date('2026-07-24T00:00:00.000Z'),
    })).toBe('{"array":[null,null],"when":"2026-07-24T00:00:00.000Z"}')
  })

  test('Runner snapshots reuse one frozen Start definition projection', () => {
    const roomId = createGeneratedId('room')
    const roomGeneration = createGeneratedId('roomGeneration')
    const definition = largeDefinition(10)
    const run = createLiveRun({
      runId: createGeneratedId('run'),
      roomId,
      roomGeneration,
      recordId: createGeneratedId('macroTemplate'),
      recordRevision: 1,
      runtimeRevision: 1,
      definitionHash: 'sha256:' + '1'.repeat(64),
      definition,
      bindings: [],
    })
    const eventWindow = {
      events: [],
      firstAvailableEventSeq: 0,
      lastEventSeq: 0,
      totalEventCount: 0,
      discardedEventCount: 0,
    }
    const publication = new MacroRunnerPublication(
      { roomSummaryById: () => ({ roomId, roomGeneration }) } as never,
      { readEventWindow: () => eventWindow } as never,
      () => run,
    )
    const first = publication.snapshot(roomId).runningMacro!.definition
    const second = publication.snapshot(roomId).runningMacro!.definition
    expect(first).toBe(definition)
    expect(second).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.body)).toBe(true)
  })

  test('Trace keeps the selected current run retained window after terminalization', () => {
    const persisted = tracePage('run-current', 1)
    const runner = {
      ...persisted,
      roomId: 'room',
      roomGeneration: 'generation',
      runtimeRevision: 4,
      runningMacro: null,
      status: 'completed' as const,
      currentNodeId: null,
      error: null,
      runtimeInput: null,
      stateHash: 'hash',
      events: [
        ...persisted.events,
        { ...persisted.events[0]!, eventId: 'event-final', eventSeq: 2, kind: 'run_completed' },
      ],
      lastEventSeq: 2,
      totalEventCount: 2,
    }
    expect(traceEventWindow(runner, 'run-current', persisted)).toBe(runner)
    expect(traceEventWindow({ ...runner, events: [] }, 'run-current', persisted)?.events).toEqual([])
    expect(traceEventWindow(runner, 'another-run', persisted)).toBe(persisted)
  })
})

test('AgentEvent current log cold-loads once, indexes 1000 IDs, and wakes waiters', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-agent-index-20260724D-'))
  try {
    const identity = {
      serverInstanceId: createGeneratedId('serverInstance'),
      roomId: createGeneratedId('room'),
      roomGeneration: createGeneratedId('roomGeneration'),
      terminalId: createGeneratedId('terminal'),
      launchId: createGeneratedId('terminalLaunch'),
    }
    const store = new AgentEventStore(root)
    const first = agentEvent(identity, 0)
    store.append(first)
    for (let index = 1; index < 1_000; index += 1) store.append(agentEvent(identity, index))
    const match: AgentEventMatch = {
      ...identity,
      agentKind: 'codex',
      eventKind: 'agent.output',
      adapter: 'codex-stop-hook',
    }
    expect(store.countMatching(match)).toBe(1_000)
    expect(() => store.append(first)).toThrow('duplicate_agent_event_id')
    expect(store.list(identity.serverInstanceId, identity.roomId, identity.roomGeneration)).toHaveLength(1_000)

    const version = store.version(match)
    const abort = new AbortController()
    const changed = store.waitForChange(match, version, 1_000, abort.signal)
    store.append(agentEvent(identity, 1_000))
    expect(await changed).toBe(true)

    const cold = new AgentEventStore(root)
    expect(cold.countMatching(match)).toBe(1_001)
    const path = cold.eventsPath(identity.serverInstanceId, identity.roomId, identity.roomGeneration)
    appendFileSync(path, '{invalid-json}\n')
    expect(cold.countMatching(match)).toBe(1_001)
    expect(() => new AgentEventStore(root).countMatching(match)).toThrow(path)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function largeDefinition(size: number): MacroDefinitionV6 {
  return {
    schemaVersion: 6,
    name: 'large',
    description: '',
    terminalLayout: [],
    body: Array.from({ length: size }, (_, index) => ({
      id: `wait_${index}`,
      type: 'wait' as const,
      mode: 'duration' as const,
      durationMs: 1,
    })),
  }
}

function agentEvent(
  identity: {
    serverInstanceId: string
    roomId: string
    roomGeneration: string
    terminalId: string
    launchId: string
  },
  index: number,
): AgentEvent {
  return {
    protocolVersion: 1,
    eventId: createGeneratedId('runEvent'),
    agentKind: 'codex',
    eventKind: 'agent.output',
    ...identity,
    agentSessionId: 'session',
    agentTurnId: `turn-${index}`,
    adapterMetadata: { adapter: 'codex-stop-hook', codexSessionId: 'session' },
    capturedText: String(index),
    raw: { source: 'codex.Stop', payload: {} },
    receivedAt: '2026-07-24T00:00:00.000Z',
  }
}

function tracePage(runId: string, eventSeq: number): MacroRunEventPage {
  return {
    runId,
    events: [{
      schemaVersion: 1,
      eventId: `event-${eventSeq}`,
      eventSeq,
      runId,
      serverInstanceId: 'server',
      roomId: 'room',
      roomGeneration: 'generation',
      kind: 'step_completed',
      createdAt: '2026-07-24T00:00:00.000Z',
      data: {},
    }],
    firstAvailableEventSeq: 1,
    lastEventSeq: eventSeq,
    totalEventCount: eventSeq,
    discardedEventCount: 0,
    nextCursor: null,
  }
}
