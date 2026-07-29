import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { assertGeneratedId, assertRoomRouteToken, createGeneratedId } from '../src/lib/generatedId'
import { canonicalJsonStringify } from '../src/lib/canonicalJson'
import type { MacroDefinitionV6 } from '../src/lib/macro/macroDefinitionTypes'
import type {
  MacroRunEvent,
  MacroRunEventPage,
  MacroRunEventWindow,
  MacroRunSummary,
  MacroRunSummaryPage,
  RunManifestV1,
} from '../src/lib/macro/runnerTypes'
import { EvidenceStore, retainedFirstEventSeq, type EvidenceRunSummary, type RunProvenance } from './evidenceStore'
import {
  type LogStorageRetention,
  type RetentionRunCandidate,
} from './logStorageRetention'
import { ensurePrivateDirectory, fsyncDirectory, initializeUserDataRoot, writePrivateFileAtomic } from './userDataRoot'
import {
  decodeEventCursor,
  encodeEventCursor,
  MacroRunTraceIndex,
} from './macroRunTraceIndex'

export { canonicalJsonStringify } from '../src/lib/canonicalJson'

export class MacroRunStore {
  readonly root: string
  private readonly evidence: EvidenceStore
  private readonly idFactory: () => string
  private readonly traceIndex: MacroRunTraceIndex
  private readonly retention?: LogStorageRetention
  private readonly eventCursors = new Map<string, { provenance: RunProvenance; nextEventSeq: number }>()
  private readonly liveEventWindows = new Map<string, MacroRunEventWindow>()
  private readonly currentRoomRuns = new Map<string, string>()

  constructor(
    dataRoot?: string,
    now: () => string = () => new Date().toISOString(),
    idFactory: () => string = () => createGeneratedId('run'),
    evidenceStore?: EvidenceStore,
    retention?: LogStorageRetention,
  ) {
    this.root = initializeUserDataRoot(dataRoot).runs
    this.retention = retention
    this.evidence = evidenceStore ?? new EvidenceStore(dataRoot, now, {
      admitWrite: (incomingBytes, publish) => this.admitAndPublish(incomingBytes, publish),
    })
    this.idFactory = idFactory
    this.traceIndex = new MacroRunTraceIndex(this.root, retention ? {
      admitWrite: (incomingBytes, publish) => retention.admitAndPublishComputed(incomingBytes, publish),
    } : {})
    retention?.setRunAdapter({
      candidates: () => this.retentionCandidates(),
      remove: (runId) => this.removeRetainedRun(runId),
    })
  }

  reserveRunId(): string {
    this.retention?.enforce()
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const runId = assertGeneratedId(this.idFactory(), 'run')
      const runDir = this.runDir(runId)
      try {
        mkdirSync(runDir, { mode: 0o700 })
        ensurePrivateDirectory(join(runDir, 'artifacts'))
        fsyncDirectory(this.root)
        return runId
      } catch (error) {
        if (isNodeError(error, 'EEXIST')) continue
        rmSync(runDir, { recursive: true, force: true })
        fsyncDirectory(this.root)
        throw error
      }
    }
    throw new Error('run_id_collision')
  }

  publishManifest(manifest: RunManifestV1): string {
    const runId = assertGeneratedId(manifest.runId, 'run')
    const runDir = this.runDir(runId)
    if (!existsSync(runDir)) throw new Error('run_id_not_reserved')
    if (existsSync(join(runDir, 'manifest.json'))) throw new Error('run_id_conflict')
    const content = JSON.stringify(manifest, null, 2) + '\n'
    try {
      return this.admitAndPublish(Buffer.byteLength(content), () => {
        writePrivateFileAtomic(join(runDir, 'manifest.json'), content)
        this.traceIndex.recordManifest(manifest)
        fsyncDirectory(this.root)
        return `${runId}/manifest.json`
      })
    } catch (error) {
      rmSync(runDir, { recursive: true, force: true })
      try { this.traceIndex.removeRun(runId) }
      catch { this.traceIndex.invalidate() }
      fsyncDirectory(this.root)
      throw error
    }
  }

  removeUnstarted(runId: string): void {
    const id = assertGeneratedId(runId, 'run')
    if (this.evidence.hasStarted(id)) return
    rmSync(this.runDir(id), { recursive: true, force: true })
    this.traceIndex.removeRun(id)
    this.eventCursors.delete(id)
    this.liveEventWindows.delete(id)
    fsyncDirectory(this.root)
  }

  append(runId: string, kind: string, data: Record<string, unknown> = {}): MacroRunEvent {
    const id = assertGeneratedId(runId, 'run')
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(kind)) throw new Error('invalid_run_event_kind')
    if (!existsSync(join(this.runDir(id), 'manifest.json'))) throw new Error('run_manifest_not_found')
    let cursor = this.eventCursors.get(id)
    if (!cursor && !this.evidence.hasStarted(id)) {
      if (kind !== 'run_started') throw new Error('run_evidence_not_started')
      const runtime = this.readManifest(id).runtime
      const provenance = {
        serverInstanceId: runtime.serverInstanceId,
        roomId: runtime.roomId,
        roomGeneration: runtime.roomGeneration,
      }
      const event = this.evidence.initializeRun(id, provenance, data) as MacroRunEvent
      this.eventCursors.set(id, { provenance, nextEventSeq: 2 })
      this.liveEventWindows.set(id, singletonEventWindow(event))
      return event
    }
    if (!cursor) {
      const summary = this.evidence.summary(id)
      cursor = {
        provenance: {
          serverInstanceId: summary.serverInstanceId,
          roomId: summary.roomId,
          roomGeneration: summary.roomGeneration,
        },
        nextEventSeq: summary.lastEventSeq + 1,
      }
      this.eventCursors.set(id, cursor)
    }
    const event = this.evidence.appendAtSequence(id, kind, data, cursor.provenance, cursor.nextEventSeq) as MacroRunEvent
    cursor.nextEventSeq += 1
    this.advanceLiveEventWindow(id, event)
    return event
  }

  readEvents(runId: string): MacroRunEvent[] {
    return this.evidence.read(assertGeneratedId(runId, 'run')) as MacroRunEvent[]
  }

  readEventWindow(runId: string): MacroRunEventWindow {
    const id = assertGeneratedId(runId, 'run')
    const cached = this.liveEventWindows.get(id)
    if (cached) return { ...cached, events: [...cached.events] }
    const window = this.evidence.window(id)
    return {
      events: window.events as MacroRunEvent[],
      firstAvailableEventSeq: window.summary.firstAvailableEventSeq,
      lastEventSeq: window.summary.lastEventSeq,
      totalEventCount: window.summary.totalEventCount,
      discardedEventCount: window.summary.discardedEventCount,
    }
  }

  readEventWindowView(runId: string): Readonly<MacroRunEventWindow> {
    const id = assertGeneratedId(runId, 'run')
    const cached = this.liveEventWindows.get(id)
    if (cached) return cached
    const window = this.readEventWindow(id)
    this.liveEventWindows.set(id, window)
    return window
  }

  retainCurrentRoomRun(roomId: string, runId: string): void {
    const room = assertRoomRouteToken(roomId)
    const id = assertGeneratedId(runId, 'run')
    const previous = this.currentRoomRuns.get(room)
    if (previous === id) return
    this.retention?.protectRun(id)
    try {
      if (previous) this.retention?.unprotectRun(previous)
    } catch (error) {
      try { this.retention?.unprotectRun(id) } catch {}
      throw error
    }
    this.currentRoomRuns.set(room, id)
  }

  releaseLiveRun(runId: string, currentRoomId?: string): void {
    const id = assertGeneratedId(runId, 'run')
    const cursorReleased = this.eventCursors.delete(id)
    const windowReleased = this.liveEventWindows.delete(id)
    let currentReleased = false
    if (currentRoomId !== undefined) {
      const roomId = assertRoomRouteToken(currentRoomId)
      if (this.currentRoomRuns.get(roomId) === id) {
        this.retention?.unprotectRun(id)
        this.currentRoomRuns.delete(roomId)
        currentReleased = true
      }
    }
    if (cursorReleased || windowReleased || currentReleased) this.retention?.afterRunTerminal()
  }

  readManifest(runId: string): RunManifestV1 {
    return JSON.parse(readFileSync(join(this.runDir(assertGeneratedId(runId, 'run')), 'manifest.json'), 'utf8')) as RunManifestV1
  }

  writeArtifact(runId: string, prefix: string, content: string, extension = 'txt'): string {
    const id = assertGeneratedId(runId, 'run')
    if (!existsSync(join(this.runDir(id), 'manifest.json'))) throw new Error('run_manifest_not_found')
    return this.admitAndPublish(
      Buffer.byteLength(content),
      () => this.evidence.writeArtifactFile(id, prefix, content, extension),
    )
  }

  traceSummariesForRoom(roomId: string, limit: number, cursor: string | null): MacroRunSummaryPage {
    const page = this.traceIndex.page(roomId, limit, cursor)
    const items: MacroRunSummary[] = page.entries.map((entry) => {
      const summary = this.evidence.traceSummary(entry.runId)
      return {
        ...entry,
        status: derivedTraceStatus(summary),
        firstAvailableEventSeq: summary.firstAvailableEventSeq,
        lastEventSeq: summary.lastEventSeq,
        totalEventCount: summary.totalEventCount,
        discardedEventCount: summary.discardedEventCount,
      }
    })
    return { items, nextCursor: page.nextCursor }
  }

  traceEventsForRoom(
    roomId: string,
    runId: string,
    limit: number,
    cursor: string | null,
  ): MacroRunEventPage {
    const id = assertGeneratedId(runId, 'run')
    const manifest = this.readManifest(id)
    if (manifest.runtime.roomId !== roomId) throw new Error('run_not_found_for_room')
    const after = cursor ? decodeEventCursor(cursor, id) : 0
    const page = this.evidence.page(id, after, limit)
    const events = page.events as MacroRunEvent[]
    const lastReturned = events.at(-1)?.eventSeq ?? after
    return {
      runId: id,
      events,
      firstAvailableEventSeq: page.summary.firstAvailableEventSeq,
      lastEventSeq: page.summary.lastEventSeq,
      totalEventCount: page.summary.totalEventCount,
      discardedEventCount: page.summary.discardedEventCount,
      nextCursor: lastReturned < page.summary.lastEventSeq
        ? encodeEventCursor(id, lastReturned)
        : null,
    }
  }

  listRunIds(): string[] {
    return this.evidence.listRuns()
  }

  private runDir(runId: string): string { return join(this.root, assertGeneratedId(runId, 'run')) }

  private admitAndPublish<T>(incomingBytes: number, publish: () => T): T {
    return this.retention?.admitAndPublish(incomingBytes, publish) ?? publish()
  }

  private retentionCandidates(): RetentionRunCandidate[] {
    const candidates: RetentionRunCandidate[] = []
    for (const runId of this.evidence.listRuns()) {
      if (this.eventCursors.has(runId) || !this.evidence.hasStarted(runId)) continue
      const summary = this.evidence.traceSummary(runId)
      if (!isTerminalRunKind(summary.lastEventKind)) continue
      candidates.push({ runId, completedAt: summary.updatedAt })
    }
    return candidates
  }

  private removeRetainedRun(runId: string): void {
    const id = assertGeneratedId(runId, 'run')
    if (this.eventCursors.has(id)) throw new Error('log_storage_run_not_collectable')
    const summary = this.evidence.traceSummary(id)
    if (!isTerminalRunKind(summary.lastEventKind)) throw new Error('log_storage_run_not_collectable')
    const tombstone = join(this.root, '.gc-' + id)
    if (existsSync(tombstone)) rmSync(tombstone, { recursive: true, force: true })
    renameSync(this.runDir(id), tombstone)
    fsyncDirectory(this.root)
    try { this.traceIndex.removeRun(id) }
    catch (error) {
      this.traceIndex.invalidate()
      throw error
    } finally {
      this.eventCursors.delete(id)
      this.liveEventWindows.delete(id)
      rmSync(tombstone, { recursive: true, force: true })
      fsyncDirectory(this.root)
    }
  }

  private advanceLiveEventWindow(runId: string, event: MacroRunEvent): void {
    const current = this.liveEventWindows.get(runId)
    if (!current) {
      const persisted = this.evidence.window(runId)
      this.liveEventWindows.set(runId, {
        events: persisted.events as MacroRunEvent[],
        firstAvailableEventSeq: persisted.summary.firstAvailableEventSeq,
        lastEventSeq: persisted.summary.lastEventSeq,
        totalEventCount: persisted.summary.totalEventCount,
        discardedEventCount: persisted.summary.discardedEventCount,
      })
      return
    }
    const firstAvailableEventSeq = retainedFirstEventSeq(event.eventSeq)
    current.events = [...current.events, event].filter((item) => item.eventSeq >= firstAvailableEventSeq)
    current.firstAvailableEventSeq = firstAvailableEventSeq
    current.lastEventSeq = event.eventSeq
    current.totalEventCount = event.eventSeq
    current.discardedEventCount = firstAvailableEventSeq - 1
  }
}

function singletonEventWindow(event: MacroRunEvent): MacroRunEventWindow {
  return {
    events: [event],
    firstAvailableEventSeq: event.eventSeq,
    lastEventSeq: event.eventSeq,
    totalEventCount: event.eventSeq,
    discardedEventCount: event.eventSeq - 1,
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function derivedTraceStatus(summary: EvidenceRunSummary): MacroRunSummary['status'] {
  if (summary.lastEventKind === 'run_completed') return 'completed'
  if (summary.lastEventKind === 'run_stopped') return 'stopped'
  if (summary.lastEventKind === 'run_failed') return 'failed'
  return 'interrupted'
}

function isTerminalRunKind(kind: string): boolean {
  return kind === 'run_completed' || kind === 'run_failed' || kind === 'run_stopped'
}

export function macroDefinitionHash(definition: MacroDefinitionV6): string {
  return createHash('sha256').update(Buffer.from(canonicalJsonStringify(definition), 'utf8')).digest('hex')
}
