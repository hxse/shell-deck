import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { assertGeneratedId, assertRoomRouteToken, createGeneratedId, createGeneratedSuffix } from '../src/lib/generatedId'
import {
  assertManagedRegularFile,
  ensurePrivateDirectory,
  fsyncDirectory,
  initializeUserDataRoot,
  pathEntryExists,
  PRIVATE_FILE_MODE,
  publishPrivateFileDelete,
  readPrivateFile,
  type PublishedFileMutationReceipt,
  writePrivateFileAtomic,
} from './userDataRoot'

export const RUN_EVENT_RETENTION_LIMIT = 1_000
export const RUN_EVENT_SEGMENT_SIZE = 100

export function retainedFirstEventSeq(lastEventSeq: number): number {
  if (lastEventSeq <= RUN_EVENT_RETENTION_LIMIT) return 1
  return segmentStart(lastEventSeq - RUN_EVENT_RETENTION_LIMIT) + RUN_EVENT_SEGMENT_SIZE
}

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

export type EvidenceEventWindow = {
  summary: EvidenceRunSummary
  events: EvidenceEvent[]
}

export type EvidenceStoreOptions = {
  eventIdFactory?: () => string
  afterEventPublish?: (event: EvidenceEvent) => void
  deleteSegment?: (path: string) => PublishedFileMutationReceipt
  writeSummary?: (path: string, bytes: string) => void
}

export class EvidenceStore {
  readonly runsRoot: string
  private readonly eventIdFactory: () => string
  private readonly afterEventPublish: (event: EvidenceEvent) => void
  private readonly deleteSegmentFile: (path: string) => PublishedFileMutationReceipt
  private readonly writeSummaryFile: (path: string, bytes: string) => void
  private readonly appendCursors = new Map<string, { provenance: RunProvenance; nextEventSeq: number }>()
  private readonly maintenanceDebt = new Set<string>()

  constructor(
    root?: string,
    private readonly now: () => string = () => new Date().toISOString(),
    options: EvidenceStoreOptions = {},
  ) {
    this.runsRoot = initializeUserDataRoot(root).runs
    this.eventIdFactory = options.eventIdFactory ?? (() => createGeneratedId('runEvent'))
    this.afterEventPublish = options.afterEventPublish ?? (() => {})
    this.deleteSegmentFile = options.deleteSegment ?? publishPrivateFileDelete
    this.writeSummaryFile = options.writeSummary ?? writePrivateFileAtomic
  }

  createRun(provenance: RunProvenance, data: Record<string, unknown> = {}): string {
    const normalized = assertRunProvenance(provenance)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const runId = createGeneratedId('run')
      const runDir = join(this.runsRoot, runId)
      let created = false
      try {
        mkdirSync(runDir, { mode: 0o700 })
        created = true
        ensurePrivateDirectory(join(runDir, 'artifacts'))
        ensurePrivateDirectory(this.eventsDirectory(runId))
        this.initializeRun(runId, normalized, data)
        fsyncDirectory(this.runsRoot)
        return runId
      } catch (error) {
        if (created) {
          rmSync(runDir, { recursive: true, force: true })
          fsyncDirectory(this.runsRoot)
        }
        if (isNodeError(error, 'EEXIST')) continue
        throw error
      }
    }
    throw new Error('run_id_collision')
  }

  initializeRun(runId: string, provenance: RunProvenance, data: Record<string, unknown> = {}): EvidenceEvent {
    const id = assertGeneratedId(runId, 'run')
    const normalized = assertRunProvenance(provenance)
    const runDir = this.runDir(id)
    if (!existsSync(runDir)) throw new Error('run_evidence_directory_not_found:' + id)
    ensurePrivateDirectory(this.eventsDirectory(id))
    const existing = this.eventAtSequence(id, 1)
    if (existing) {
      if (!sameEventIntent(existing, 'run_started', data, normalized)) throw new Error('run_evidence_already_started:' + id)
      this.reconcileMaintenance(id, existing)
      const summary = this.readSummaryOrRecover(id)
      if (!summary) throw new Error('run_evidence_not_found:' + id)
      this.appendCursors.set(id, { provenance: normalized, nextEventSeq: summary.lastEventSeq + 1 })
      return existing
    }
    const event = this.createEvent(id, 'run_started', data, normalized, 1)
    try {
      const published = this.publishEvent(id, event)
      this.appendCursors.set(id, { provenance: normalized, nextEventSeq: 2 })
      return published
    } catch (error) {
      const persisted = this.eventAtSequence(id, 1)
      if (persisted && sameEventIntent(persisted, event.kind, event.data, normalized)) {
        this.appendCursors.set(id, { provenance: normalized, nextEventSeq: 2 })
      }
      throw error
    }
  }

  append(runId: string, kind: string, data: Record<string, unknown> = {}): EvidenceEvent {
    const id = assertGeneratedId(runId, 'run')
    const cursor = this.cursorForRun(id)
    return this.appendAtSequence(id, kind, data, cursor.provenance, cursor.nextEventSeq)
  }

  appendAtSequence(runId: string, kind: string, data: Record<string, unknown>, provenance: RunProvenance, eventSeq: number): EvidenceEvent {
    const id = assertGeneratedId(runId, 'run')
    assertEventKind(kind)
    if (!Number.isInteger(eventSeq) || eventSeq < 2) throw new Error('invalid_evidence_event_sequence')
    const normalized = assertRunProvenance(provenance)
    const cursor = this.cursorForRun(id)
    if (!sameRunProvenance(cursor.provenance, normalized)) throw new Error('invalid_evidence_event_provenance')
    if (eventSeq < cursor.nextEventSeq) {
      const existing = this.eventAtSequence(id, eventSeq)
      if (!existing) throw new Error('invalid_evidence_event_sequence')
      if (!sameEventIntent(existing, kind, data, normalized)) throw new Error('evidence_event_sequence_conflict')
      this.reconcileMaintenance(id, existing)
      return existing
    }
    if (eventSeq !== cursor.nextEventSeq) throw new Error('invalid_evidence_event_sequence')
    const event = this.createEvent(id, kind, data, normalized, eventSeq)
    try {
      const published = this.publishEvent(id, event)
      cursor.nextEventSeq += 1
      return published
    } catch (error) {
      const persisted = this.eventAtSequence(id, eventSeq)
      if (persisted && sameEventIntent(persisted, kind, data, normalized)) cursor.nextEventSeq = eventSeq + 1
      throw error
    }
  }

  hasStarted(runId: string): boolean {
    const id = assertGeneratedId(runId, 'run')
    return existsSync(this.summaryPath(id)) || Boolean(this.eventAtSequence(id, 1))
  }

  read(runId: string): EvidenceEvent[] {
    const id = assertGeneratedId(runId, 'run')
    this.repairMaintenanceDebt(id)
    if (!existsSync(this.eventsDirectory(id))) return []
    const events = this.segmentStarts(id).flatMap((start) => this.readSegment(id, start))
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].eventSeq !== events[index - 1].eventSeq + 1) throw new Error('invalid_evidence_event_sequence')
    }
    return events
  }

  window(runId: string): EvidenceEventWindow {
    const id = assertGeneratedId(runId, 'run')
    this.repairMaintenanceDebt(id)
    const summary = this.readSummaryOrRecover(id)
    if (!summary) throw new Error('run_evidence_not_found:' + id)
    const events = this.read(id)
    if (events.length === 0 || events[0].eventSeq !== summary.firstAvailableEventSeq || events.at(-1)?.eventSeq !== summary.lastEventSeq) {
      throw new Error('invalid_evidence_summary_window')
    }
    return { summary, events }
  }

  summary(runId: string): EvidenceRunSummary {
    const id = assertGeneratedId(runId, 'run')
    this.repairMaintenanceDebt(id)
    const summary = this.readSummaryOrRecover(id)
    if (!summary) throw new Error('run_evidence_not_found:' + id)
    return summary
  }

  listRuns(): string[] {
    return readdirSync(this.runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => assertGeneratedId(entry.name, 'run'))
      .sort()
  }

  writeArtifact(runId: string, prefix: string, content: string, extension = 'txt'): string {
    const artifactRef = this.writeArtifactFile(runId, prefix, content, extension)
    this.append(runId, 'artifact_created', { artifactRef, sizeBytes: Buffer.byteLength(content) })
    return artifactRef
  }

  writeArtifactFile(runId: string, prefix: string, content: string, extension = 'txt'): string {
    const id = assertGeneratedId(runId, 'run')
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(prefix)) throw new Error('invalid_artifact_prefix')
    if (!/^[A-Za-z0-9]{1,8}$/.test(extension)) throw new Error('invalid_artifact_extension')
    if (!this.hasStarted(id)) throw new Error('run_evidence_not_found:' + id)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const file = prefix + '-' + createGeneratedSuffix() + '.' + extension
      const target = join(this.runDir(id), 'artifacts', file)
      if (pathEntryExists(target)) continue
      writePrivateFileAtomic(target, content)
      return 'artifacts/' + file
    }
    throw new Error('artifact_id_collision')
  }

  private publishEvent(runId: string, event: EvidenceEvent): EvidenceEvent {
    const segment = this.segmentPath(runId, segmentStart(event.eventSeq))
    const receipt = appendPrivateJsonLine(segment, event, () => this.afterEventPublish(event))
    const persisted = receipt.durability === 'confirmed' ? event : this.eventAtSequence(runId, event.eventSeq)
    if (!persisted || !sameEventIntent(persisted, event.kind, event.data, event)) throw new Error('evidence_event_publish_state_unknown')
    if (this.maintenanceDebt.has(runId) || shouldPruneAt(event.eventSeq) || shouldCheckpointSummary(event, false)) {
      this.attemptMaintenance(runId, persisted)
    }
    return persisted
  }

  private reconcileMaintenance(runId: string, event: EvidenceEvent): void {
    const current = this.readSummaryOrRecover(runId)
    if (current && current.lastEventSeq > event.eventSeq) {
      this.repairMaintenanceDebt(runId)
      return
    }
    this.attemptMaintenance(runId, event)
  }

  private attemptMaintenance(runId: string, event: EvidenceEvent): void {
    try {
      this.pruneSegments(runId, event.eventSeq)
      const summary = this.readSummaryOrRecover(runId)
      this.persistSummary(this.nextSummary(event, summary ?? undefined))
      this.maintenanceDebt.delete(runId)
    } catch {
      this.maintenanceDebt.add(runId)
    }
  }

  private repairMaintenanceDebt(runId: string): void {
    if (!this.maintenanceDebt.has(runId)) return
    const lastStart = this.segmentStarts(runId).at(-1)
    if (lastStart === undefined) return
    const last = this.readSegment(runId, lastStart).at(-1)
    if (last) this.attemptMaintenance(runId, last)
  }

  private nextSummary(event: EvidenceEvent, previous?: EvidenceRunSummary): EvidenceRunSummary {
    const firstAvailableEventSeq = retainedFirstEventSeq(event.eventSeq)
    return {
      schemaVersion: 1,
      runId: event.runId,
      serverInstanceId: event.serverInstanceId,
      roomId: event.roomId,
      roomGeneration: event.roomGeneration,
      startedAt: previous?.startedAt ?? event.createdAt,
      updatedAt: event.createdAt,
      firstAvailableEventSeq,
      lastEventSeq: event.eventSeq,
      totalEventCount: event.eventSeq,
      discardedEventCount: firstAvailableEventSeq - 1,
      lastEventKind: event.kind,
    }
  }

  private persistSummary(summary: EvidenceRunSummary): void {
    const path = this.summaryPath(summary.runId)
    const bytes = JSON.stringify(summary, null, 2) + '\n'
    try { this.writeSummaryFile(path, bytes) }
    catch (error) {
      try {
        const current = assertEvidenceSummary(JSON.parse(readPrivateFile(path).toString('utf8')), summary.runId)
        if (isDeepStrictEqual(current, summary)) return
      } catch {}
      throw error
    }
  }

  private readSummaryOrRecover(runId: string): EvidenceRunSummary | null {
    const path = this.summaryPath(runId)
    let stored: EvidenceRunSummary | null = null
    if (existsSync(path)) {
      try { stored = assertEvidenceSummary(JSON.parse(readPrivateFile(path).toString('utf8')), runId) }
      catch { stored = null }
    }
    const starts = this.segmentStarts(runId)
    const firstStart = starts[0]
    const lastStart = starts.at(-1)
    if (firstStart === undefined || lastStart === undefined) return null
    const first = this.readSegment(runId, firstStart)[0]
    const last = this.readSegment(runId, lastStart).at(-1)
    if (!first || !last) return null
    if (stored?.firstAvailableEventSeq === first.eventSeq && stored.lastEventSeq === last.eventSeq) return stored
    return {
      schemaVersion: 1,
      runId,
      serverInstanceId: first.serverInstanceId,
      roomId: first.roomId,
      roomGeneration: first.roomGeneration,
      startedAt: stored?.startedAt ?? first.createdAt,
      updatedAt: last.createdAt,
      firstAvailableEventSeq: first.eventSeq,
      lastEventSeq: last.eventSeq,
      totalEventCount: last.eventSeq,
      discardedEventCount: first.eventSeq - 1,
      lastEventKind: last.kind,
    }
  }

  private createEvent(runId: string, kind: string, data: Record<string, unknown>, provenance: RunProvenance, eventSeq: number): EvidenceEvent {
    assertEventKind(kind)
    return {
      schemaVersion: 1,
      eventId: assertGeneratedId(this.eventIdFactory(), 'runEvent'),
      eventSeq,
      runId,
      kind,
      createdAt: this.now(),
      ...provenance,
      data,
    }
  }

  private eventAtSequence(runId: string, eventSeq: number): EvidenceEvent | undefined {
    const start = segmentStart(eventSeq)
    const path = this.segmentPath(runId, start)
    if (!existsSync(path)) return undefined
    return this.readSegment(runId, start).find((event) => event.eventSeq === eventSeq)
  }

  private readSegment(runId: string, start: number): EvidenceEvent[] {
    const path = this.segmentPath(runId, start)
    recoverPartialFinalLine(path)
    if (!existsSync(path)) return []
    const events: EvidenceEvent[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const event = assertEvidenceEvent(JSON.parse(line))
      if (event.runId !== runId || segmentStart(event.eventSeq) !== start) throw new Error('invalid_evidence_event_sequence')
      if (events.length && event.eventSeq !== events.at(-1)!.eventSeq + 1) throw new Error('invalid_evidence_event_sequence')
      events.push(event)
    }
    return events
  }

  private pruneSegments(runId: string, lastEventSeq: number): void {
    for (const start of this.segmentStarts(runId)) {
      if (lastEventSeq - start + 1 <= RUN_EVENT_RETENTION_LIMIT) break
      const path = this.segmentPath(runId, start)
      const receipt = this.deleteSegmentFile(path)
      if (receipt.durability === 'uncertain' && existsSync(path)) throw new Error('evidence_segment_prune_state_unknown')
    }
  }

  private segmentStarts(runId: string): number[] {
    const directory = this.eventsDirectory(runId)
    if (!existsSync(directory)) return []
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{12}\.jsonl$/.test(entry.name))
      .map((entry) => Number(entry.name.slice(0, 12)))
      .sort((left, right) => left - right)
  }

  private runDir(runId: string): string { return join(this.runsRoot, assertGeneratedId(runId, 'run')) }
  private eventsDirectory(runId: string): string { return join(this.runDir(runId), 'events') }
  private summaryPath(runId: string): string { return join(this.runDir(runId), 'summary.json') }
  private segmentPath(runId: string, start: number): string { return join(this.eventsDirectory(runId), String(start).padStart(12, '0') + '.jsonl') }

  private cursorForRun(runId: string): { provenance: RunProvenance; nextEventSeq: number } {
    const cached = this.appendCursors.get(runId)
    if (cached) return cached
    const summary = this.readSummaryOrRecover(runId)
    if (!summary) throw new Error('run_evidence_not_found:' + runId)
    const cursor = {
      provenance: {
        serverInstanceId: summary.serverInstanceId,
        roomId: summary.roomId,
        roomGeneration: summary.roomGeneration,
      },
      nextEventSeq: summary.lastEventSeq + 1,
    }
    this.appendCursors.set(runId, cursor)
    return cursor
  }
}

type AppendReceipt =
  | { published: true; durability: 'confirmed' }
  | { published: true; durability: 'uncertain'; postPublishError: unknown }

function appendPrivateJsonLine(path: string, value: unknown, afterPublish: () => void): AppendReceipt {
  ensurePrivateDirectory(dirname(path))
  recoverPartialFinalLine(path)
  assertManagedRegularFile(path)
  const createdDirectoryEntry = !existsSync(path)
  const fd = openSync(path, 'a+', PRIVATE_FILE_MODE)
  const originalSize = fstatSync(fd).size
  const buffer = Buffer.from(JSON.stringify(value) + '\n')
  let completeLine = false
  let postPublishError: unknown
  try {
    fchmodSync(fd, PRIVATE_FILE_MODE)
    let offset = 0
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
    completeLine = true
    try { fsyncSync(fd) } catch (error) { postPublishError = error }
  } catch (error) {
    if (!completeLine) {
      try { ftruncateSync(fd, originalSize); fsyncSync(fd) } catch {}
      throw error
    }
    postPublishError = error
  } finally {
    try { closeSync(fd) } catch (error) { if (completeLine && postPublishError === undefined) postPublishError = error }
  }
  if (postPublishError === undefined) {
    try {
      afterPublish()
      // Appending bytes only requires the file fsync above. The directory fsync is
      // required when this append created a new segment entry.
      if (createdDirectoryEntry) fsyncDirectory(dirname(path))
    } catch (error) { postPublishError = error }
  }
  return postPublishError === undefined
    ? { published: true, durability: 'confirmed' }
    : { published: true, durability: 'uncertain', postPublishError }
}

function recoverPartialFinalLine(path: string): void {
  if (!existsSync(path)) return
  const bytes = readFileSync(path)
  if (bytes.length === 0 || bytes.at(-1) === 0x0a) return
  const lastNewline = bytes.lastIndexOf(0x0a)
  const fd = openSync(path, 'r+')
  try {
    ftruncateSync(fd, lastNewline + 1)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

function segmentStart(eventSeq: number): number {
  return Math.floor((eventSeq - 1) / RUN_EVENT_SEGMENT_SIZE) * RUN_EVENT_SEGMENT_SIZE + 1
}

function shouldPruneAt(eventSeq: number): boolean {
  return eventSeq > RUN_EVENT_RETENTION_LIMIT && (eventSeq - 1) % RUN_EVENT_SEGMENT_SIZE === 0
}

function shouldCheckpointSummary(event: EvidenceEvent, pruned: boolean): boolean {
  return event.eventSeq === 1
    || event.eventSeq % RUN_EVENT_SEGMENT_SIZE === 0
    || pruned
    || event.kind === 'run_completed'
    || event.kind === 'run_failed'
    || event.kind === 'run_stopped'
}

function assertRunProvenance(value: RunProvenance): RunProvenance {
  return {
    serverInstanceId: assertGeneratedId(value.serverInstanceId, 'serverInstance'),
    roomId: assertRoomRouteToken(value.roomId),
    roomGeneration: assertGeneratedId(value.roomGeneration, 'roomGeneration'),
  }
}

function assertEventKind(kind: string): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(kind)) throw new Error('invalid_evidence_event_kind')
}

function sameEventIntent(event: EvidenceEvent, kind: string, data: Record<string, unknown>, provenance: RunProvenance): boolean {
  return event.kind === kind
    && sameRunProvenance(event, provenance)
    && isDeepStrictEqual(event.data, data)
}

function sameRunProvenance(event: RunProvenance, provenance: RunProvenance): boolean {
  return event.serverInstanceId === provenance.serverInstanceId
    && event.roomId === provenance.roomId
    && event.roomGeneration === provenance.roomGeneration
}

function assertEvidenceEvent(value: unknown): EvidenceEvent {
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

function assertEvidenceSummary(value: unknown, expectedRunId: string): EvidenceRunSummary {
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

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}
