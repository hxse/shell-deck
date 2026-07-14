import { closeSync, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertGeneratedId, assertRoomRouteToken, createGeneratedId, createGeneratedSuffix } from '../src/lib/generatedId'
import { assertManagedRegularFile, ensurePrivateDirectory, fsyncDirectory, initializeUserDataRoot, pathEntryExists, PRIVATE_FILE_MODE, writePrivateFileAtomic } from './userDataRoot'

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

export class EvidenceStore {
  readonly runsRoot: string

  constructor(root?: string) {
    this.runsRoot = initializeUserDataRoot(root).runs
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
        appendPrivateJsonLine(join(runDir, 'events.jsonl'), {
          schemaVersion: 1,
          eventId: createGeneratedId('runEvent'),
          eventSeq: 1,
          runId,
          kind: 'run_started',
          createdAt: new Date().toISOString(),
          ...normalized,
          data,
        } satisfies EvidenceEvent)
        fsyncDirectory(this.runsRoot)
        return runId
      } catch (error) {
        if (created) {
          rmSync(runDir, { recursive: true, force: true })
          fsyncDirectory(this.runsRoot)
        }
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
    }
    throw new Error('run_id_collision')
  }

  append(runId: string, kind: string, data: Record<string, unknown> = {}): EvidenceEvent {
    const id = assertGeneratedId(runId, 'run')
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(kind)) throw new Error('invalid_evidence_event_kind')
    const existing = this.read(id)
    const started = existing[0]
    if (!started) throw new Error('run_evidence_not_found:' + id)
    const event: EvidenceEvent = {
      schemaVersion: 1,
      eventId: createGeneratedId('runEvent'),
      eventSeq: existing.length + 1,
      runId: id,
      kind,
      createdAt: new Date().toISOString(),
      serverInstanceId: started.serverInstanceId,
      roomId: started.roomId,
      roomGeneration: started.roomGeneration,
      data,
    }
    appendPrivateJsonLine(this.eventsPath(id), event)
    return event
  }

  read(runId: string): EvidenceEvent[] {
    const path = this.eventsPath(runId)
    if (!existsSync(path)) return []
    const events: EvidenceEvent[] = []
    for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
      if (!line.trim()) continue
      const event = assertEvidenceEvent(JSON.parse(line))
      if (event.eventSeq !== index + 1) throw new Error('invalid_evidence_event_sequence')
      events.push(event)
    }
    return events
  }

  listRuns(): string[] {
    return readdirSync(this.runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => assertGeneratedId(entry.name, 'run'))
      .sort()
  }

  writeArtifact(runId: string, prefix: string, content: string, extension = 'txt'): string {
    const id = assertGeneratedId(runId, 'run')
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(prefix)) throw new Error('invalid_artifact_prefix')
    if (!/^[A-Za-z0-9]{1,8}$/.test(extension)) throw new Error('invalid_artifact_extension')
    if (this.read(id).length === 0) throw new Error('run_evidence_not_found:' + id)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const file = prefix + '-' + createGeneratedSuffix() + '.' + extension
      const target = join(this.runDir(id), 'artifacts', file)
      if (pathEntryExists(target)) continue
      writePrivateFileAtomic(target, content)
      const artifactRef = 'artifacts/' + file
      this.append(id, 'artifact_created', { artifactRef, sizeBytes: Buffer.byteLength(content) })
      return artifactRef
    }
    throw new Error('artifact_id_collision')
  }

  private runDir(runId: string): string {
    return join(this.runsRoot, assertGeneratedId(runId, 'run'))
  }

  private eventsPath(runId: string): string {
    return join(this.runDir(runId), 'events.jsonl')
  }
}

function appendPrivateJsonLine(path: string, value: unknown): void {
  assertManagedRegularFile(path)
  const fd = openSync(path, 'a', PRIVATE_FILE_MODE)
  try {
    fchmodSync(fd, PRIVATE_FILE_MODE)
    const buffer = Buffer.from(JSON.stringify(value) + '\n')
    let offset = 0
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  fsyncDirectory(dirname(path))
}

function assertRunProvenance(value: RunProvenance): RunProvenance {
  return {
    serverInstanceId: assertGeneratedId(value.serverInstanceId, 'serverInstance'),
    roomId: assertRoomRouteToken(value.roomId),
    roomGeneration: assertGeneratedId(value.roomGeneration, 'roomGeneration'),
  }
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

function isExactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new Date(value).toISOString() === value }
  catch { return false }
}
