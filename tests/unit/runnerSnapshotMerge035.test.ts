import { expect, test } from 'bun:test'
import { canonicalJsonStringify } from '../../src/lib/canonicalJson'
import { createGeneratedId } from '../../src/lib/generatedId'
import { mergeMacroRunnerDelta, validateMacroRunnerSnapshot } from '../../src/lib/macro/runnerSnapshotMerge'
import { canonicalRunnerState } from '../../src/lib/macro/runnerStateProjection'
import type { MacroRunEvent, MacroRunnerDelta, MacroRunnerSnapshot } from '../../src/lib/macro/runnerTypes'
import { RoomNotificationDelivery } from '../../src/lib/roomNotificationDelivery'
import { RunnerRepairCoordinator } from '../../src/lib/runnerRepairCoordinator'
import type { MacroNotificationMessage } from '../../src/lib/protocol'
import { sha256Text } from '../../src/lib/textHash'

const ROOM_ID = createGeneratedId('room')
const ROOM_GENERATION = createGeneratedId('roomGeneration')
const RUN_ID = createGeneratedId('run')

test('runner delta appends each absolute event once and trims the discarded prefix', async () => {
  const current = await snapshot([event(1), event(2)], { runtimeRevision: 2, lastEventSeq: 2, totalEventCount: 2 })
  const delta = await runnerDelta(current, [event(3)], {
    runtimeRevision: 4,
    firstAvailableEventSeq: 2,
    lastEventSeq: 3,
    totalEventCount: 3,
    discardedEventCount: 1,
  })
  const merged = await mergeMacroRunnerDelta(current, delta)
  expect(merged.kind).toBe('applied')
  expect(merged.snapshot?.events.map((item) => item.eventSeq)).toEqual([2, 3])
  expect(merged.snapshot).toMatchObject({ runtimeRevision: 4, firstAvailableEventSeq: 2, discardedEventCount: 1 })
  expect((await mergeMacroRunnerDelta(merged.snapshot, delta)).kind).toBe('stale')
})

test('runner delta requests a full resync on an event gap', async () => {
  const current = await snapshot([event(1), event(2)], { runtimeRevision: 2, lastEventSeq: 2, totalEventCount: 2 })
  const gap = await runnerDelta(current, [event(4)], {
    runtimeRevision: 3,
    lastEventSeq: 4,
    totalEventCount: 4,
  })
  expect(await mergeMacroRunnerDelta(current, gap)).toMatchObject({ kind: 'resync_required', snapshot: current })
})

test('runner state and frozen definition hashes reject quietly divergent projections', async () => {
  const current = await snapshot([event(1)], {
    runtimeRevision: 2,
    lastEventSeq: 1,
    totalEventCount: 1,
  })
  const delta = await runnerDelta(current, [event(2)], {
    runtimeRevision: 3,
    lastEventSeq: 2,
    totalEventCount: 2,
  })
  expect(await mergeMacroRunnerDelta(current, {
    ...delta,
    stateHash: 'sha256:' + '0'.repeat(64),
  })).toMatchObject({ kind: 'resync_required', snapshot: current })
  expect(await validateMacroRunnerSnapshot({
    ...current,
    runningMacro: {
      ...current.runningMacro!,
      definitionHash: 'sha256:' + '1'.repeat(64),
    },
  })).toEqual({ kind: 'resync_required', snapshot: null })
})

test('runner state hash matches the JSON wire projection of event data', async () => {
  const current = await snapshot([{
    ...event(1),
    data: { kept: 'wire value', omitted: undefined },
  }], {
    runtimeRevision: 2,
    lastEventSeq: 1,
    totalEventCount: 1,
  })
  const wire = JSON.parse(JSON.stringify(current)) as MacroRunnerSnapshot
  expect((await validateMacroRunnerSnapshot(wire)).kind).toBe('applied')
})

test('runner repair retries one transient failure and ignores a suspended connection generation', async () => {
  const identity = { active: true, connected: true, roomId: ROOM_ID, roomGeneration: ROOM_GENERATION, connectionGeneration: 1 }
  let current: MacroRunnerSnapshot | null = await snapshot([], { runtimeRevision: 1 })
  let fetchCount = 0
  const repaired = await snapshot([event(1)], { runtimeRevision: 3 })
  const coordinator = new RunnerRepairCoordinator({
    identity: () => identity,
    snapshot: () => current,
    install: (next) => { current = next },
    notice: (message) => { throw new Error(message) },
    fetcher: async () => {
      fetchCount += 1
      if (fetchCount === 1) throw new Error('transient')
      return Response.json({ ok: true, runner: repaired })
    },
  })

  coordinator.request(ROOM_GENERATION)
  await waitUntil(() => current?.runtimeRevision === 3)
  expect(fetchCount).toBe(2)

  let resolveFetch!: (response: Response) => void
  const suspended = new RunnerRepairCoordinator({
    identity: () => identity,
    snapshot: () => current,
    install: (next) => { current = next },
    notice: (message) => { throw new Error(message) },
    fetcher: () => new Promise((resolve) => { resolveFetch = resolve }),
  })
  suspended.request(ROOM_GENERATION)
  await waitUntil(() => typeof resolveFetch === 'function')
  identity.connectionGeneration += 1
  suspended.suspend()
  resolveFetch(Response.json({ ok: true, runner: await snapshot([], { runtimeRevision: 4 }) }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(current?.runtimeRevision).toBe(3)
  coordinator.dispose()
  suspended.dispose()
})

test('browser notification delivery deduplicates one connection projection and resets explicitly', async () => {
  const notices: string[] = []
  const delivery = new RoomNotificationDelivery({
    volume: () => 1,
    notice: (text) => { notices.push(text) },
  })
  const message: MacroNotificationMessage = {
    type: 'macro_notification',
    roomId: ROOM_ID,
    roomGeneration: ROOM_GENERATION,
    notificationId: createGeneratedId('notification'),
    runId: RUN_ID,
    stepId: 'notify',
    level: 'success',
    title: 'Done',
    message: 'One browser toast',
    createdAt: '2026-07-21T00:00:00.000Z',
    channels: [{ kind: 'app', toast: true, sound: 'none', repeatCount: 1, repeatIntervalMs: 1000 }],
  }

  await delivery.deliver(message)
  await delivery.deliver(message)
  expect(notices).toEqual(['One browser toast'])
  delivery.clear()
  await delivery.deliver(message)
  expect(notices).toEqual(['One browser toast', 'One browser toast'])
})

test('browser notification delivery repeats App presentation on interval and clear cancels pending attempts', async () => {
  const notices: string[] = []
  const delivery = new RoomNotificationDelivery({
    volume: () => 1,
    notice: (text) => { notices.push(text) },
  })
  const message: MacroNotificationMessage = {
    type: 'macro_notification',
    roomId: ROOM_ID,
    roomGeneration: ROOM_GENERATION,
    notificationId: createGeneratedId('notification'),
    runId: RUN_ID,
    stepId: 'notify_repeat',
    level: 'warning',
    title: 'Repeat',
    message: 'Repeated browser toast',
    createdAt: '2026-07-22T00:00:00.000Z',
    channels: [{ kind: 'app', toast: true, sound: 'none', repeatCount: 3, repeatIntervalMs: 250 }],
  }

  await delivery.deliver(message)
  await delivery.deliver(message)
  expect(notices).toEqual(['Repeated browser toast'])
  await new Promise((resolve) => setTimeout(resolve, 275))
  expect(notices).toEqual(['Repeated browser toast', 'Repeated browser toast'])
  delivery.clear()
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(notices).toEqual(['Repeated browser toast', 'Repeated browser toast'])
})

async function snapshot(
  events: MacroRunEvent[],
  overrides: Partial<MacroRunnerSnapshot> = {},
): Promise<MacroRunnerSnapshot> {
  const definition = { schemaVersion: 6 as const, name: 'merge', description: '', terminalLayout: [], body: [] }
  const definitionHash = await sha256Text(canonicalJsonStringify(definition))
  const value: MacroRunnerSnapshot = {
    roomId: ROOM_ID,
    roomGeneration: ROOM_GENERATION,
    runtimeRevision: 1,
    runId: RUN_ID,
    runningMacro: {
      recordId: createGeneratedId('macroTemplate'),
      recordRevision: 1,
      definition,
      definitionHash,
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
    stateHash: '',
    ...overrides,
  }
  value.stateHash = await stateHash(value)
  return value
}

async function runnerDelta(
  current: MacroRunnerSnapshot,
  events: MacroRunEvent[],
  overrides: Partial<MacroRunnerDelta>,
): Promise<MacroRunnerDelta> {
  if (!current.runId || !current.runningMacro) throw new Error('active snapshot required')
  const delta: MacroRunnerDelta = {
    roomId: current.roomId,
    roomGeneration: current.roomGeneration,
    runId: current.runId,
    definitionHash: current.runningMacro.definitionHash,
    expectedRuntimeRevision: current.runtimeRevision,
    runtimeRevision: current.runtimeRevision + 1,
    status: current.status,
    currentNodeId: current.currentNodeId,
    error: current.error,
    runtimeInput: current.runtimeInput,
    events,
    firstAvailableEventSeq: current.firstAvailableEventSeq,
    lastEventSeq: events.at(-1)?.eventSeq ?? current.lastEventSeq,
    totalEventCount: events.at(-1)?.eventSeq ?? current.totalEventCount,
    discardedEventCount: current.discardedEventCount,
    stateHash: '',
    ...overrides,
  }
  const retained = [...current.events, ...events]
    .filter((item) => item.eventSeq >= delta.firstAvailableEventSeq)
  delta.stateHash = await sha256Text(canonicalRunnerState({
    ...delta,
    events: retained,
  }))
  return delta
}

function stateHash(snapshot: MacroRunnerSnapshot): Promise<string> {
  return sha256Text(canonicalRunnerState({
    ...snapshot,
    definitionHash: snapshot.runningMacro?.definitionHash ?? null,
  }))
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

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('wait_until_timeout')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
