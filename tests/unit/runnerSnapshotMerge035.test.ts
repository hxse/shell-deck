import { expect, test } from 'bun:test'
import { createGeneratedId } from '../../src/lib/generatedId'
import { mergeMacroRunnerDelta } from '../../src/lib/macro/runnerSnapshotMerge'
import type { MacroRunEvent, MacroRunnerDelta, MacroRunnerSnapshot } from '../../src/lib/macro/runnerTypes'
import { RoomNotificationDelivery } from '../../src/lib/roomNotificationDelivery'
import { RunnerRepairCoordinator } from '../../src/lib/runnerRepairCoordinator'
import type { MacroNotificationMessage } from '../../src/lib/protocol'

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

test('runner repair retries one transient failure and ignores a suspended connection generation', async () => {
  const identity = { active: true, connected: true, roomId: ROOM_ID, roomGeneration: ROOM_GENERATION, connectionGeneration: 1 }
  let current: MacroRunnerSnapshot | null = snapshot([], { runtimeRevision: 1 })
  let fetchCount = 0
  const repaired = snapshot([event(1)], { runtimeRevision: 3 })
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
  resolveFetch(Response.json({ ok: true, runner: snapshot([], { runtimeRevision: 4 }) }))
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
    channels: [{ kind: 'app', toast: true, sound: 'none' }],
  }

  await delivery.deliver(message)
  await delivery.deliver(message)
  expect(notices).toEqual(['One browser toast'])
  delivery.clear()
  await delivery.deliver(message)
  expect(notices).toEqual(['One browser toast', 'One browser toast'])
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
      definition: { schemaVersion: 5, name: 'merge', description: '', terminalLayout: [], body: [] },
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

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('wait_until_timeout')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
