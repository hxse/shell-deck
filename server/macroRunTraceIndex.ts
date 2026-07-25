import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertGeneratedId, assertRoomRouteToken } from '../src/lib/generatedId'
import type { RunManifestV1 } from '../src/lib/macro/runnerTypes'
import { userDataPaths, withFileLockSync, writePrivateFileAtomic } from './userDataRoot'

export type TraceIndexEntry = {
  runId: string
  createdAt: string
  macroRecord: { id: string; revision: number }
  roomId: string
  roomGeneration: string
}

type TraceIndexFile = {
  schemaVersion: 1
  entries: TraceIndexEntry[]
}

type TraceIndexObserver = {
  manifestParse?(runId: string): void
  admitWrite?<T>(incomingBytes: () => number, publish: () => T): T
}

export class MacroRunTraceIndex {
  readonly #path: string
  readonly #lockPath: string
  #entries: TraceIndexEntry[] | null = null
  #byRoom = new Map<string, TraceIndexEntry[]>()
  #version: string | null = null

  constructor(
    private readonly runsRoot: string,
    private readonly observe: TraceIndexObserver = {},
  ) {
    this.#path = join(runsRoot, 'trace-index.json')
    this.#lockPath = join(userDataPaths(dirname(runsRoot)).locks, 'trace-index.lock')
  }

  recordManifest(manifest: RunManifestV1): void {
    const entry = manifestEntry(manifest)
    this.#publishEntries(() => this.#entriesForMutation((entries) => upsertEntry(entries, entry)))
  }

  removeRun(runId: string): void {
    const id = assertGeneratedId(runId, 'run')
    this.#publishEntries(() => this.#entriesForRemoval(id))
  }

  invalidate(): void {
    this.#entries = null
    this.#byRoom.clear()
    this.#version = null
  }

  page(roomId: string, limit: number, cursor: string | null): {
    entries: TraceIndexEntry[]
    nextCursor: string | null
  } {
    const position = cursor ? decodeRunCursor(cursor) : null
    this.#load()
    const matching = this.#byRoom.get(assertRoomRouteToken(roomId)) ?? []
    const start = position
      ? matching.findIndex((entry) => entry.createdAt === position.createdAt && entry.runId === position.runId) + 1
      : 0
    if (position && start === 0) throw new Error('invalid_trace_cursor')
    const entries = matching.slice(start, start + limit)
    const hasMore = start + entries.length < matching.length
    return {
      entries,
      nextCursor: hasMore && entries.length > 0 ? encodeRunCursor(entries.at(-1)!) : null,
    }
  }

  #load(): TraceIndexEntry[] {
    const version = indexVersion(this.#path)
    if (this.#entries && version === this.#version) return this.#entries
    const loaded = this.#readValidated(version)
    if (loaded) {
      this.#install(loaded.entries, loaded.version)
      return loaded.entries
    }
    const entries = this.#publishEntries(() => this.#freshEntries())
    if (!entries) throw new Error('trace_index_rebuild_failed')
    return entries
  }

  #freshEntries(): TraceIndexEntry[] {
    const loaded = this.#readValidated(indexVersion(this.#path))
    return loaded?.entries ?? rebuildEntries(
      this.runsRoot,
      currentManifestRunIds(this.runsRoot),
      this.observe.manifestParse,
    )
  }

  #entriesForMutation(mutate: (entries: TraceIndexEntry[]) => TraceIndexEntry[]): TraceIndexEntry[] {
    const runIds = currentManifestRunIds(this.runsRoot)
    const loaded = this.#readIndex(indexVersion(this.#path))
    if (loaded) {
      const candidate = sortEntries(mutate([...loaded.entries]))
      if (sameRunIds(candidate, runIds)) return candidate
    }
    return sortEntries(mutate(rebuildEntries(this.runsRoot, runIds, this.observe.manifestParse)))
  }

  #entriesForRemoval(runId: string): TraceIndexEntry[] | null {
    const runIds = currentManifestRunIds(this.runsRoot)
    const loaded = this.#readIndex(indexVersion(this.#path))
    if (!loaded) return null
    const candidate = sortEntries(loaded.entries.filter((entry) => entry.runId !== runId))
    return sameRunIds(candidate, runIds) ? candidate : null
  }

  #readValidated(version: string | null): { entries: TraceIndexEntry[]; version: string } | null {
    const loaded = this.#readIndex(version)
    if (!loaded || !sameRunIds(loaded.entries, currentManifestRunIds(this.runsRoot))) return null
    return loaded
  }

  #readIndex(version: string | null): { entries: TraceIndexEntry[]; version: string } | null {
    if (!version) return null
    let entries: TraceIndexEntry[]
    try {
      const parsed = JSON.parse(readFileSync(this.#path, 'utf8')) as TraceIndexFile
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) return null
      entries = parsed.entries.map(assertTraceEntry)
      if (new Set(entries.map((entry) => entry.runId)).size !== entries.length) return null
    } catch {
      return null
    }
    const afterRead = indexVersion(this.#path)
    if (!afterRead || afterRead !== version) return null
    return { entries: sortEntries(entries), version: afterRead }
  }

  #write(entries: TraceIndexEntry[]): void {
    writePrivateFileAtomic(this.#path, serializeIndex(entries))
    const version = indexVersion(this.#path)
    if (!version) throw new Error('trace_index_publish_missing')
    this.#install(entries, version)
  }

  #publishEntries(build: () => TraceIndexEntry[] | null): TraceIndexEntry[] | null {
    if (!this.observe.admitWrite) {
      return withFileLockSync(this.#lockPath, () => this.#buildAndWrite(build))
    }
    return this.observe.admitWrite(
      () => withFileLockSync(this.#lockPath, () => {
        const entries = build()
        return entries ? indexGrowthBytes(this.#path, entries) : 0
      }),
      () => withFileLockSync(this.#lockPath, () => this.#buildAndWrite(build)),
    )
  }

  #buildAndWrite(build: () => TraceIndexEntry[] | null): TraceIndexEntry[] | null {
    const entries = build()
    if (!entries) {
      this.invalidate()
      return null
    }
    this.#write(entries)
    return entries
  }

  #install(entries: TraceIndexEntry[], version: string): void {
    this.#entries = entries
    this.#byRoom = indexByRoom(entries)
    this.#version = version
  }
}

export function encodeEventCursor(runId: string, eventSeq: number): string {
  return Buffer.from(JSON.stringify({
    runId: assertGeneratedId(runId, 'run'),
    eventSeq,
  })).toString('base64url')
}

export function decodeEventCursor(cursor: string, runId: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    if (parsed.runId !== runId || !Number.isInteger(parsed.eventSeq) || (parsed.eventSeq as number) < 0) {
      throw new Error('invalid_trace_event_cursor')
    }
    return parsed.eventSeq as number
  } catch {
    throw new Error('invalid_trace_event_cursor')
  }
}

function serializeIndex(entries: TraceIndexEntry[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    entries,
  } satisfies TraceIndexFile, null, 2) + '\n'
}

function indexGrowthBytes(path: string, entries: TraceIndexEntry[]): number {
  const nextBytes = Buffer.byteLength(serializeIndex(entries))
  try { return Math.max(0, nextBytes - statSync(path).size) }
  catch { return nextBytes }
}

function rebuildEntries(
  runsRoot: string,
  runIds: string[],
  onManifestParse?: (runId: string) => void,
): TraceIndexEntry[] {
  const entries: TraceIndexEntry[] = []
  for (const runId of runIds) {
    try {
      onManifestParse?.(runId)
      entries.push(manifestEntry(JSON.parse(
        readFileSync(join(runsRoot, runId, 'manifest.json'), 'utf8'),
      ) as RunManifestV1))
    } catch {
      // Incomplete current-schema run directories are not Trace entries.
    }
  }
  return sortEntries(entries)
}

function currentManifestRunIds(runsRoot: string): string[] {
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(runsRoot, entry.name, 'manifest.json')))
    .flatMap((entry) => {
      try { return [assertGeneratedId(entry.name, 'run')] }
      catch { return [] }
    })
    .sort()
}

function indexVersion(path: string): string | null {
  try {
    const stat = statSync(path)
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs].join(':')
  } catch {
    return null
  }
}

function manifestEntry(manifest: RunManifestV1): TraceIndexEntry {
  return assertTraceEntry({
    runId: manifest.runId,
    createdAt: manifest.createdAt,
    macroRecord: manifest.macroRecord,
    roomId: manifest.runtime.roomId,
    roomGeneration: manifest.runtime.roomGeneration,
  })
}

function assertTraceEntry(value: TraceIndexEntry): TraceIndexEntry {
  assertGeneratedId(value.runId, 'run')
  assertGeneratedId(value.macroRecord?.id, 'macroTemplate')
  assertRoomRouteToken(value.roomId)
  assertGeneratedId(value.roomGeneration, 'roomGeneration')
  if (!Number.isInteger(value.macroRecord.revision) || value.macroRecord.revision < 1
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('invalid_trace_index')
  }
  return value
}

function indexByRoom(entries: TraceIndexEntry[]): Map<string, TraceIndexEntry[]> {
  const rooms = new Map<string, TraceIndexEntry[]>()
  for (const entry of entries) {
    const current = rooms.get(entry.roomId)
    if (current) current.push(entry)
    else rooms.set(entry.roomId, [entry])
  }
  return rooms
}

function sortEntries(entries: TraceIndexEntry[]): TraceIndexEntry[] {
  return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt)
    || right.runId.localeCompare(left.runId))
}

function upsertEntry(entries: TraceIndexEntry[], entry: TraceIndexEntry): TraceIndexEntry[] {
  const existing = entries.findIndex((candidate) => candidate.runId === entry.runId)
  if (existing === -1) entries.push(entry)
  else entries[existing] = entry
  return entries
}

function sameRunIds(entries: TraceIndexEntry[], runIds: string[]): boolean {
  if (entries.length !== runIds.length) return false
  const indexed = new Set(entries.map((entry) => entry.runId))
  return runIds.every((runId) => indexed.has(runId))
}

function encodeRunCursor(entry: TraceIndexEntry): string {
  return Buffer.from(JSON.stringify({
    createdAt: entry.createdAt,
    runId: entry.runId,
  })).toString('base64url')
}

function decodeRunCursor(cursor: string): { createdAt: string; runId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.createdAt !== 'string' || typeof parsed.runId !== 'string') throw new Error()
    return { createdAt: parsed.createdAt, runId: assertGeneratedId(parsed.runId, 'run') }
  } catch {
    throw new Error('invalid_trace_cursor')
  }
}
