import { isDeepStrictEqual } from 'node:util'
import { assertGeneratedId, assertRoomRouteToken } from '../src/lib/generatedId'

export type RunProvenance = {
  serverInstanceId: string
  roomId: string
  roomGeneration: string
}

export type EvidenceEvent = RunProvenance & {
  schemaVersion: 1
  eventId: string
  eventSeq: number
  runId: string
  kind: string
  createdAt: string
  data: Record<string, unknown>
}

export type EvidenceRunSummary = RunProvenance & {
  schemaVersion: 1
  runId: string
  startedAt: string
  updatedAt: string
  firstAvailableEventSeq: number
  lastEventSeq: number
  totalEventCount: number
  discardedEventCount: number
  lastEventKind: string
}

export function assertRunProvenance(value: RunProvenance): RunProvenance {
  return {
    serverInstanceId: assertGeneratedId(value.serverInstanceId, 'serverInstance'),
    roomId: assertRoomRouteToken(value.roomId),
    roomGeneration: assertGeneratedId(value.roomGeneration, 'roomGeneration'),
  }
}

export function assertEventKind(kind: string): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(kind)) throw new Error('invalid_evidence_event_kind')
}

export function createEvidenceEvent(
  runId: string,
  kind: string,
  data: Record<string, unknown>,
  provenance: RunProvenance,
  eventSeq: number,
  eventId: string,
  createdAt: string,
): EvidenceEvent {
  assertEventKind(kind)
  return {
    schemaVersion: 1,
    eventId: assertGeneratedId(eventId, 'runEvent'),
    eventSeq,
    runId: assertGeneratedId(runId, 'run'),
    kind,
    createdAt,
    ...assertRunProvenance(provenance),
    data,
  }
}

export function sameEventIntent(
  event: EvidenceEvent,
  kind: string,
  data: Record<string, unknown>,
  provenance: RunProvenance,
): boolean {
  return event.kind === kind
    && sameRunProvenance(event, provenance)
    && isDeepStrictEqual(event.data, data)
}

export function sameRunProvenance(event: RunProvenance, provenance: RunProvenance): boolean {
  return event.serverInstanceId === provenance.serverInstanceId
    && event.roomId === provenance.roomId
    && event.roomGeneration === provenance.roomGeneration
}

export function assertEvidenceEvent(value: unknown): EvidenceEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_evidence_event')
  const event = value as Record<string, unknown>
  if (Object.keys(event).sort().join(',') !== 'createdAt,data,eventId,eventSeq,kind,roomGeneration,roomId,runId,schemaVersion,serverInstanceId') throw new Error('invalid_evidence_event')
  if (event.schemaVersion !== 1 || !Number.isInteger(event.eventSeq) || (event.eventSeq as number) < 1) throw new Error('invalid_evidence_event')
  assertGeneratedId(event.eventId, 'runEvent')
  assertGeneratedId(event.runId, 'run')
  assertGeneratedId(event.serverInstanceId, 'serverInstance')
  assertRoomRouteToken(event.roomId)
  assertGeneratedId(event.roomGeneration, 'roomGeneration')
  if (typeof event.kind !== 'string' || !isExactIsoTimestamp(event.createdAt)) throw new Error('invalid_evidence_event')
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) throw new Error('invalid_evidence_event')
  return value as EvidenceEvent
}

export function assertEvidenceSummary(value: unknown, expectedRunId: string): EvidenceRunSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_evidence_summary')
  const summary = value as Record<string, unknown>
  if (Object.keys(summary).sort().join(',') !== 'discardedEventCount,firstAvailableEventSeq,lastEventKind,lastEventSeq,roomGeneration,roomId,runId,schemaVersion,serverInstanceId,startedAt,totalEventCount,updatedAt') throw new Error('invalid_evidence_summary')
  if (summary.schemaVersion !== 1 || assertGeneratedId(summary.runId, 'run') !== expectedRunId) throw new Error('invalid_evidence_summary')
  assertGeneratedId(summary.serverInstanceId, 'serverInstance')
  assertRoomRouteToken(summary.roomId)
  assertGeneratedId(summary.roomGeneration, 'roomGeneration')
  if (!isExactIsoTimestamp(summary.startedAt) || !isExactIsoTimestamp(summary.updatedAt)) throw new Error('invalid_evidence_summary')
  for (const key of ['firstAvailableEventSeq', 'lastEventSeq', 'totalEventCount', 'discardedEventCount'] as const) {
    if (!Number.isInteger(summary[key]) || (summary[key] as number) < (key === 'discardedEventCount' ? 0 : 1)) throw new Error('invalid_evidence_summary')
  }
  if (summary.totalEventCount !== summary.lastEventSeq || summary.discardedEventCount !== (summary.firstAvailableEventSeq as number) - 1) throw new Error('invalid_evidence_summary')
  if (typeof summary.lastEventKind !== 'string') throw new Error('invalid_evidence_summary')
  return value as EvidenceRunSummary
}

function isExactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new Date(value).toISOString() === value }
  catch { return false }
}
