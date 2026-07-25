import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { assertGeneratedId, createGeneratedId, createGeneratedSuffix } from '../src/lib/generatedId'
import {
  assertEvidenceSummary,
  assertEventKind,
  assertRunProvenance,
  sameEventIntent,
  sameRunProvenance,
  type EvidenceEvent,
  type EvidenceRunSummary,
  type RunProvenance,
} from './evidenceRecordValidation'
import {
  EvidenceSegmentStorage,
  retainedFirstEventSeq,
  shouldCheckpointEvidenceAt,
  shouldPruneEvidenceAt,
} from './evidenceSegmentStorage'
import {
  ensurePrivateDirectory,
  fsyncDirectory,
  initializeUserDataRoot,
  pathEntryExists,
  readPrivateFile,
  type PublishedFileMutationReceipt,
  writePrivateFileAtomic,
} from './userDataRoot'

export {
  retainedFirstEventSeq,
  RUN_EVENT_RETENTION_LIMIT,
  RUN_EVENT_SEGMENT_SIZE,
} from './evidenceSegmentStorage'
export type { EvidenceEvent, EvidenceRunSummary, RunProvenance } from './evidenceRecordValidation'
export type EvidenceEventWindow = { summary: EvidenceRunSummary; events: EvidenceEvent[] }

export type EvidenceStoreOptions = {
  eventIdFactory?: () => string
  afterEventPublish?: (event: EvidenceEvent) => void
  deleteSegment?: (path: string) => PublishedFileMutationReceipt
  writeSummary?: (path: string, bytes: string) => void
  onSegmentRead?: (runId: string, start: number) => void
  onSegmentList?: (runId: string) => void
}

export class EvidenceStore {
  readonly runsRoot: string
  private readonly eventIdFactory: () => string
  private readonly afterEventPublish: (event: EvidenceEvent) => void
  private readonly writeSummaryFile: (path: string, bytes: string) => void
  private readonly segmentStorage: EvidenceSegmentStorage
  private readonly appendCursors = new Map<string, { provenance: RunProvenance; nextEventSeq: number }>()
  private readonly maintenanceDebt = new Set<string>()
  private readonly traceSummaryFresh = new Set<string>()

  constructor(
    root?: string,
    private readonly now: () => string = () => new Date().toISOString(),
    options: EvidenceStoreOptions = {},
  ) {
    this.runsRoot = initializeUserDataRoot(root).runs
    this.eventIdFactory = options.eventIdFactory ?? (() => createGeneratedId('runEvent'))
    this.afterEventPublish = options.afterEventPublish ?? (() => {})
    this.writeSummaryFile = options.writeSummary ?? writePrivateFileAtomic
    this.segmentStorage = new EvidenceSegmentStorage(this.runsRoot, options.deleteSegment, {
      segmentRead: options.onSegmentRead,
      segmentList: options.onSegmentList,
    })
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
        this.segmentStorage.ensureEventsDirectory(runId)
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
    this.segmentStorage.ensureEventsDirectory(id)
    const existing = this.segmentStorage.eventAtSequence(id, 1)
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
      const persisted = this.segmentStorage.eventAtSequence(id, 1)
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
  appendAtSequence(
    runId: string,
    kind: string,
    data: Record<string, unknown>,
    provenance: RunProvenance,
    eventSeq: number,
  ): EvidenceEvent {
    const id = assertGeneratedId(runId, 'run')
    assertEventKind(kind)
    if (!Number.isInteger(eventSeq) || eventSeq < 2) throw new Error('invalid_evidence_event_sequence')
    const normalized = assertRunProvenance(provenance)
    const cursor = this.cursorForRun(id)
    if (!sameRunProvenance(cursor.provenance, normalized)) throw new Error('invalid_evidence_event_provenance')
    if (eventSeq < cursor.nextEventSeq) {
      const existing = this.segmentStorage.eventAtSequence(id, eventSeq)
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
      const persisted = this.segmentStorage.eventAtSequence(id, eventSeq)
      if (persisted && sameEventIntent(persisted, kind, data, normalized)) cursor.nextEventSeq = eventSeq + 1
      throw error
    }
  }
  hasStarted(runId: string): boolean {
    const id = assertGeneratedId(runId, 'run')
    return existsSync(this.summaryPath(id)) || Boolean(this.segmentStorage.eventAtSequence(id, 1))
  }
  read(runId: string): EvidenceEvent[] {
    const id = assertGeneratedId(runId, 'run')
    this.repairMaintenanceDebt(id)
    return this.segmentStorage.read(id)
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
  page(runId: string, afterEventSeq: number, limit: number): EvidenceEventWindow {
    const id = assertGeneratedId(runId, 'run')
    const summary = this.traceSummary(id)
    if (afterEventSeq > summary.lastEventSeq) throw new Error('invalid_trace_event_cursor')
    const first = Math.max(summary.firstAvailableEventSeq, afterEventSeq + 1)
    const last = Math.min(summary.lastEventSeq, first + limit - 1)
    const events = this.segmentStorage.readRange(id, first, last)
    if (last >= first && (events[0]?.eventSeq !== first || events.at(-1)?.eventSeq !== last)) throw new Error('invalid_evidence_event_sequence')
    return { events, summary }
  }
  summary(runId: string): EvidenceRunSummary { return this.loadSummary(runId, true) }
  traceSummary(runId: string): EvidenceRunSummary {
    const id = assertGeneratedId(runId, 'run')
    const verify = !this.traceSummaryFresh.has(id)
    let repairPublished = true
    const summary = this.loadSummary(id, verify, (recovered) => {
      try { this.persistSummary(recovered) }
      catch { repairPublished = false; this.maintenanceDebt.add(id) }
    })
    if (verify && repairPublished) this.traceSummaryFresh.add(id)
    return summary
  }
  private loadSummary(runId: string, verifySegments: boolean, repair?: (summary: EvidenceRunSummary) => void): EvidenceRunSummary {
    const id = assertGeneratedId(runId, 'run')
    this.repairMaintenanceDebt(id)
    const summary = this.readSummaryOrRecover(id, verifySegments, repair)
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
    const receipt = this.segmentStorage.append(runId, event, () => this.afterEventPublish(event))
    const persisted = receipt.durability === 'confirmed'
      ? event
      : this.segmentStorage.eventAtSequence(runId, event.eventSeq)
    if (!persisted || !sameEventIntent(persisted, event.kind, event.data, event)) {
      throw new Error('evidence_event_publish_state_unknown')
    }
    this.traceSummaryFresh.delete(runId)
    if (this.maintenanceDebt.has(runId) || shouldPruneEvidenceAt(event.eventSeq) || shouldCheckpointEvidenceAt(event)) {
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
      this.segmentStorage.pruneSegments(runId, event.eventSeq)
      const summary = this.readSummaryOrRecover(runId)
      this.persistSummary(this.nextSummary(event, summary ?? undefined))
      this.maintenanceDebt.delete(runId)
      this.traceSummaryFresh.add(runId)
    } catch {
      this.maintenanceDebt.add(runId)
    }
  }

  private repairMaintenanceDebt(runId: string): void {
    if (!this.maintenanceDebt.has(runId)) return
    const lastStart = this.segmentStorage.segmentStarts(runId).at(-1)
    if (lastStart === undefined) return
    const last = this.segmentStorage.readSegment(runId, lastStart).at(-1)
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

  private readSummaryOrRecover(runId: string, verifySegments = true, repair?: (summary: EvidenceRunSummary) => void): EvidenceRunSummary | null {
    const path = this.summaryPath(runId)
    let stored: EvidenceRunSummary | null = null
    if (existsSync(path)) {
      try { stored = assertEvidenceSummary(JSON.parse(readPrivateFile(path).toString('utf8')), runId) }
      catch { stored = null }
    }
    if (stored && !verifySegments) return stored
    const starts = this.segmentStorage.segmentStarts(runId)
    const firstStart = starts[0]
    const lastStart = starts.at(-1)
    if (firstStart === undefined || lastStart === undefined) return null
    const firstEvents = this.segmentStorage.readSegment(runId, firstStart)
    const first = firstEvents[0]
    const last = firstStart === lastStart ? firstEvents.at(-1) : this.segmentStorage.readSegment(runId, lastStart).at(-1)
    if (!first || !last) return null
    if (stored?.firstAvailableEventSeq === first.eventSeq && stored.lastEventSeq === last.eventSeq) return stored
    const recovered: EvidenceRunSummary = {
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
    repair?.(recovered)
    return recovered
  }

  private createEvent(
    runId: string,
    kind: string,
    data: Record<string, unknown>,
    provenance: RunProvenance,
    eventSeq: number,
  ): EvidenceEvent {
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

  private runDir(runId: string): string {
    return join(this.runsRoot, assertGeneratedId(runId, 'run'))
  }

  private summaryPath(runId: string): string {
    return join(this.runDir(runId), 'summary.json')
  }

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

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}
