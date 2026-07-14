import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { assertGeneratedId, createGeneratedId } from '../src/lib/generatedId'
import type { MacroDefinitionV3 } from '../src/lib/macro/macroDefinitionTypes'
import type { MacroRunEvent, MacroRunEventWindow, MacroRunTrace, RunManifestV1 } from '../src/lib/macro/runnerTypes'
import { EvidenceStore, retainedFirstEventSeq, type EvidenceRunSummary, type RunProvenance } from './evidenceStore'
import { ensurePrivateDirectory, fsyncDirectory, initializeUserDataRoot, writePrivateFileAtomic } from './userDataRoot'

export class MacroRunStore {
  readonly root: string
  private readonly evidence: EvidenceStore
  private readonly idFactory: () => string
  private readonly eventCursors = new Map<string, { provenance: RunProvenance; nextEventSeq: number }>()
  private readonly liveEventWindows = new Map<string, MacroRunEventWindow>()

  constructor(
    dataRoot?: string,
    now: () => string = () => new Date().toISOString(),
    idFactory: () => string = () => createGeneratedId('run'),
    evidenceStore?: EvidenceStore,
  ) {
    this.root = initializeUserDataRoot(dataRoot).runs
    this.evidence = evidenceStore ?? new EvidenceStore(dataRoot, now)
    this.idFactory = idFactory
  }

  reserveRunId(): string {
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
    try {
      writePrivateFileAtomic(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
      fsyncDirectory(this.root)
      return `${runId}/manifest.json`
    } catch (error) {
      rmSync(runDir, { recursive: true, force: true })
      fsyncDirectory(this.root)
      throw error
    }
  }

  removeUnstarted(runId: string): void {
    const id = assertGeneratedId(runId, 'run')
    if (this.evidence.hasStarted(id)) return
    rmSync(this.runDir(id), { recursive: true, force: true })
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

  readManifest(runId: string): RunManifestV1 {
    return JSON.parse(readFileSync(join(this.runDir(assertGeneratedId(runId, 'run')), 'manifest.json'), 'utf8')) as RunManifestV1
  }

  writeArtifact(runId: string, prefix: string, content: string, extension = 'txt'): string {
    const id = assertGeneratedId(runId, 'run')
    if (!existsSync(join(this.runDir(id), 'manifest.json'))) throw new Error('run_manifest_not_found')
    return this.evidence.writeArtifactFile(id, prefix, content, extension)
  }

  listTracesForRoom(roomId: string): MacroRunTrace[] {
    const traces: MacroRunTrace[] = []
    for (const runId of this.listRunIds()) {
      try {
        const manifest = this.readManifest(runId)
        if (manifest.runtime.roomId !== roomId) continue
        const window = this.readEventWindow(runId)
        const summary = this.evidence.summary(runId)
        traces.push({
          runId,
          createdAt: manifest.createdAt,
          macroRecord: manifest.macroRecord,
          roomId: manifest.runtime.roomId,
          roomGeneration: manifest.runtime.roomGeneration,
          status: derivedTraceStatus(summary),
          ...window,
        })
      } catch {
        // Current-schema Trace ignores incomplete or foreign evidence directories.
      }
    }
    return traces.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  listRunIds(): string[] {
    return this.evidence.listRuns()
  }

  private runDir(runId: string): string { return join(this.root, assertGeneratedId(runId, 'run')) }

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

function derivedTraceStatus(summary: EvidenceRunSummary): MacroRunTrace['status'] {
  if (summary.lastEventKind === 'run_completed') return 'completed'
  if (summary.lastEventKind === 'run_stopped') return 'stopped'
  if (summary.lastEventKind === 'run_failed') return 'failed'
  return 'interrupted'
}

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJsonStringify).join(',') + ']'
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort(compareCodePoints)
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJsonStringify(record[key])).join(',') + '}'
}

export function macroDefinitionHash(definition: MacroDefinitionV3): string {
  return createHash('sha256').update(Buffer.from(canonicalJsonStringify(definition), 'utf8')).digest('hex')
}

function compareCodePoints(left: string, right: string): number {
  const a = [...left].map((value) => value.codePointAt(0)!)
  const b = [...right].map((value) => value.codePointAt(0)!)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return a[index] - b[index]
  return a.length - b.length
}
