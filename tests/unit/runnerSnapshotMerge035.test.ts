import { expect, test } from 'bun:test'
import { createGeneratedId } from '../../src/lib/generatedId'
import { mergeMacroRunnerDelta } from '../../src/lib/macro/runnerSnapshotMerge'
import type { MacroRunEvent, MacroRunnerDelta, MacroRunnerSnapshot } from '../../src/lib/macro/runnerTypes'

const ROOM_ID = createGeneratedId('room')
const ROOM_GENERATION = createGeneratedId('roomGeneration')
const RUN_ID = createGeneratedId('run')

test('runner delta appends each absolute event once and trims the discarded prefix', () => {
  const current = snapshot([event(1), event(2)], { runtimeRevision: 2, lastEventSeq: 2, totalEventCount: 2 })
  const delta = runnerDelta([event(3)], {
    runtimeRevision: 4,
    firstAvailableEventSeq: 2,
    lastEventSeq: 3,
    totalEventCount: 3,
    discardedEventCount: 1,
  })
  const merged = mergeMacroRunnerDelta(current, delta)
  expect(merged.kind).toBe('applied')
  expect(merged.snapshot?.events.map((item) => item.eventSeq)).toEqual([2, 3])
  expect(merged.snapshot).toMatchObject({ runtimeRevision: 4, firstAvailableEventSeq: 2, discardedEventCount: 1 })
  expect(mergeMacroRunnerDelta(merged.snapshot, delta).kind).toBe('stale')
})

test('runner delta requests a full resync on an event gap', () => {
  const current = snapshot([event(1), event(2)], { runtimeRevision: 2, lastEventSeq: 2, totalEventCount: 2 })
  const gap = runnerDelta([event(4)], { runtimeRevision: 3, lastEventSeq: 4, totalEventCount: 4 })
  expect(mergeMacroRunnerDelta(current, gap)).toMatchObject({ kind: 'resync_required', snapshot: current })
})

function snapshot(events: MacroRunEvent[], overrides: Partial<MacroRunnerSnapshot> = {}): MacroRunnerSnapshot {
  return {
    roomId: ROOM_ID,
    roomGeneration: ROOM_GENERATION,
    runtimeRevision: 1,
    runId: RUN_ID,
    runningMacro: {
      recordId: createGeneratedId('macroTemplate'),
      recordRevision: 1,
      definition: { schemaVersion: 3, name: 'merge', description: '', terminalLayout: [], body: [] },
    },
    status: 'running',
    currentNodeId: null,
    error: null,
    runtimeInput: null,
    events,
    firstAvailableEventSeq: 1,
    lastEventSeq: events.at(-1)?.eventSeq ?? 0,
    totalEventCount: events.at(-1)?.eventSeq ?? 0,
    discardedEventCount: 0,
    ...overrides,
  }
}

function runnerDelta(events: MacroRunEvent[], overrides: Partial<MacroRunnerDelta>): MacroRunnerDelta {
  return { ...snapshot(events), ...overrides }
}

function event(eventSeq: number): MacroRunEvent {
  return {
    schemaVersion: 1,
    eventId: createGeneratedId('runEvent'),
    eventSeq,
    runId: RUN_ID,
    serverInstanceId: createGeneratedId('serverInstance'),
    roomId: ROOM_ID,
    roomGeneration: ROOM_GENERATION,
    kind: 'step_completed',
    createdAt: '2026-07-20T00:00:00.000Z',
    data: {},
  }
}
