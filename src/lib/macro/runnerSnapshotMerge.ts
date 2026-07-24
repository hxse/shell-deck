import { canonicalJsonStringify } from '../canonicalJson'
import { sha256Text } from '../textHash'
import { canonicalRunnerState } from './runnerStateProjection'
import type { MacroRunEvent, MacroRunnerDelta, MacroRunnerSnapshot } from './runnerTypes'

export type MacroRunnerMergeResult =
  | { kind: 'applied'; snapshot: MacroRunnerSnapshot }
  | { kind: 'stale'; snapshot: MacroRunnerSnapshot }
  | { kind: 'resync_required'; snapshot: MacroRunnerSnapshot | null }

export async function validateMacroRunnerSnapshot(
  snapshot: MacroRunnerSnapshot,
): Promise<MacroRunnerMergeResult> {
  if (!validWindowMetadata(snapshot)) return { kind: 'resync_required', snapshot: null }
  if (snapshot.runId === null) {
    if (snapshot.runningMacro !== null || snapshot.events.length > 0 || snapshot.status !== 'idle') {
      return { kind: 'resync_required', snapshot: null }
    }
  } else {
    if (!snapshot.runningMacro
      || !eventsAreContiguous(
        snapshot.events,
        snapshot.firstAvailableEventSeq,
        snapshot.lastEventSeq,
        snapshot.runId,
        snapshot.roomGeneration,
      )) return { kind: 'resync_required', snapshot: null }
    const definitionHash = await sha256Text(canonicalJsonStringify(snapshot.runningMacro.definition))
    if (definitionHash !== snapshot.runningMacro.definitionHash) {
      return { kind: 'resync_required', snapshot: null }
    }
  }
  return await stateHashMatches(snapshot)
    ? { kind: 'applied', snapshot: { ...snapshot, events: [...snapshot.events] } }
    : { kind: 'resync_required', snapshot: null }
}

export async function mergeMacroRunnerDelta(
  current: MacroRunnerSnapshot | null,
  delta: MacroRunnerDelta,
): Promise<MacroRunnerMergeResult> {
  if (!current || !validWindowMetadata(delta)) return { kind: 'resync_required', snapshot: current }
  if (delta.roomGeneration !== current.roomGeneration
    || delta.runId !== current.runId
    || !current.runningMacro
    || delta.definitionHash !== current.runningMacro.definitionHash) {
    return { kind: 'resync_required', snapshot: current }
  }
  if (delta.runtimeRevision <= current.runtimeRevision) return { kind: 'stale', snapshot: current }
  if (delta.expectedRuntimeRevision !== current.runtimeRevision
    || delta.lastEventSeq < current.lastEventSeq
    || current.lastEventSeq < delta.firstAvailableEventSeq - 1) {
    return { kind: 'resync_required', snapshot: current }
  }
  if (!eventsAreContiguous(
    delta.events,
    current.lastEventSeq + 1,
    delta.lastEventSeq,
    delta.runId,
    delta.roomGeneration,
  )) return { kind: 'resync_required', snapshot: current }
  const retained = [...current.events, ...delta.events]
    .filter((event) => event.eventSeq >= delta.firstAvailableEventSeq)
  if (delta.lastEventSeq > 0
    && (retained[0]?.eventSeq !== delta.firstAvailableEventSeq
      || retained.at(-1)?.eventSeq !== delta.lastEventSeq)) {
    return { kind: 'resync_required', snapshot: current }
  }
  const snapshot: MacroRunnerSnapshot = {
    ...current,
    runtimeRevision: delta.runtimeRevision,
    status: delta.status,
    currentNodeId: delta.currentNodeId,
    error: delta.error,
    runtimeInput: delta.runtimeInput,
    events: retained,
    firstAvailableEventSeq: delta.firstAvailableEventSeq,
    lastEventSeq: delta.lastEventSeq,
    totalEventCount: delta.totalEventCount,
    discardedEventCount: delta.discardedEventCount,
    stateHash: delta.stateHash,
  }
  return await stateHashMatches(snapshot)
    ? { kind: 'applied', snapshot }
    : { kind: 'resync_required', snapshot: current }
}

async function stateHashMatches(snapshot: MacroRunnerSnapshot): Promise<boolean> {
  const hash = await sha256Text(canonicalRunnerState({
    runId: snapshot.runId,
    definitionHash: snapshot.runningMacro?.definitionHash ?? null,
    status: snapshot.status,
    currentNodeId: snapshot.currentNodeId,
    error: snapshot.error,
    runtimeInput: snapshot.runtimeInput,
    events: snapshot.events,
    firstAvailableEventSeq: snapshot.firstAvailableEventSeq,
    lastEventSeq: snapshot.lastEventSeq,
    totalEventCount: snapshot.totalEventCount,
    discardedEventCount: snapshot.discardedEventCount,
  }))
  return hash === snapshot.stateHash
}

function validWindowMetadata(window: Pick<MacroRunnerSnapshot, 'runId' | 'firstAvailableEventSeq' | 'lastEventSeq' | 'totalEventCount' | 'discardedEventCount'>): boolean {
  if (window.runId === null) {
    return window.firstAvailableEventSeq === 0
      && window.lastEventSeq === 0
      && window.totalEventCount === 0
      && window.discardedEventCount === 0
  }
  return Number.isInteger(window.firstAvailableEventSeq)
    && window.firstAvailableEventSeq >= 1
    && window.totalEventCount === window.lastEventSeq
    && window.discardedEventCount === window.firstAvailableEventSeq - 1
    && window.lastEventSeq >= window.firstAvailableEventSeq
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
  return events.every((event, offset) => event.eventSeq === expectedFirst + offset
    && event.runId === runId
    && event.roomGeneration === roomGeneration)
}
