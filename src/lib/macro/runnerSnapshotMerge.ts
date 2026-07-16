import type { MacroRunEvent, MacroRunnerDelta, MacroRunnerSnapshot } from './runnerTypes'

export type MacroRunnerMergeResult =
  | { kind: 'applied'; snapshot: MacroRunnerSnapshot }
  | { kind: 'stale'; snapshot: MacroRunnerSnapshot }
  | { kind: 'resync_required'; snapshot: MacroRunnerSnapshot | null }

export function mergeMacroRunnerDelta(current: MacroRunnerSnapshot | null, delta: MacroRunnerDelta): MacroRunnerMergeResult {
  if (!validWindowMetadata(delta)) return { kind: 'resync_required', snapshot: current }
  if (!current || current.roomGeneration !== delta.roomGeneration) {
    return completeDeltaWindow(delta)
      ? { kind: 'applied', snapshot: { ...delta, events: [...delta.events] } }
      : { kind: 'resync_required', snapshot: current }
  }
  if (delta.runtimeRevision <= current.runtimeRevision) return { kind: 'stale', snapshot: current }
  if (current.runId !== delta.runId) {
    return completeDeltaWindow(delta)
      ? { kind: 'applied', snapshot: { ...delta, events: [...delta.events] } }
      : { kind: 'resync_required', snapshot: current }
  }
  if (delta.runId === null) {
    return delta.events.length === 0 && delta.lastEventSeq === 0
      ? { kind: 'applied', snapshot: { ...delta, events: [] } }
      : { kind: 'resync_required', snapshot: current }
  }
  if (delta.lastEventSeq < current.lastEventSeq) return { kind: 'resync_required', snapshot: current }
  const appended = delta.events.filter((event) => event.eventSeq > current.lastEventSeq)
  if (!eventsAreContiguous(appended, current.lastEventSeq + 1, delta.lastEventSeq, delta.runId, delta.roomGeneration)) {
    return { kind: 'resync_required', snapshot: current }
  }
  const retained = [...current.events, ...appended].filter((event) => event.eventSeq >= delta.firstAvailableEventSeq)
  if (delta.lastEventSeq > 0 && (retained[0]?.eventSeq !== delta.firstAvailableEventSeq || retained.at(-1)?.eventSeq !== delta.lastEventSeq)) {
    return { kind: 'resync_required', snapshot: current }
  }
  return { kind: 'applied', snapshot: { ...delta, events: retained } }
}

function completeDeltaWindow(delta: MacroRunnerDelta): boolean {
  if (delta.runId === null) return delta.events.length === 0 && delta.firstAvailableEventSeq === 0 && delta.lastEventSeq === 0
  return eventsAreContiguous(delta.events, delta.firstAvailableEventSeq, delta.lastEventSeq, delta.runId, delta.roomGeneration)
}

function validWindowMetadata(delta: MacroRunnerDelta): boolean {
  if (delta.runId === null) {
    return delta.firstAvailableEventSeq === 0
      && delta.lastEventSeq === 0
      && delta.totalEventCount === 0
      && delta.discardedEventCount === 0
  }
  return Number.isInteger(delta.firstAvailableEventSeq)
    && delta.firstAvailableEventSeq >= 1
    && delta.totalEventCount === delta.lastEventSeq
    && delta.discardedEventCount === delta.firstAvailableEventSeq - 1
    && delta.lastEventSeq >= delta.firstAvailableEventSeq
}

function eventsAreContiguous(
  events: MacroRunEvent[],
  expectedFirst: number,
  expectedLast: number,
  runId: string,
  roomGeneration: string,
): boolean {
  if (expectedLast < expectedFirst) return events.length === 0
  if (events.length !== expectedLast - expectedFirst + 1) return false
  return events.every((event, offset) => event.eventSeq === expectedFirst + offset && event.runId === runId && event.roomGeneration === roomGeneration)
}
