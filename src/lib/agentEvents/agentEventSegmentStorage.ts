import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  assertManagedRegularFile,
  ensurePrivateDirectory,
  fsyncDirectory,
  PRIVATE_FILE_MODE,
} from '../../../server/userDataRoot'
import { assertGeneratedId, assertRoomRouteToken } from '../generatedId'

export const AGENT_EVENT_SEGMENT_TARGET_BYTES = 8 * 1024 * 1024

type AgentEventSegmentStorageOptions = {
  targetBytes?: number
  admitAppend?: <T>(incomingBytes: number, publish: () => T) => T
  afterStreamClose?: () => void
}

type StreamIdentity = {
  serverInstanceId: string
  roomId: string
  roomGeneration: string
}

type SegmentEntry = {
  number: number
  path: string
  open: boolean
}

export class AgentEventSegmentStorage {
  readonly targetBytes: number
  readonly #admitAppend: <T>(incomingBytes: number, publish: () => T) => T
  readonly #afterStreamClose: () => void

  constructor(
    readonly root: string,
    options: AgentEventSegmentStorageOptions = {},
  ) {
    this.targetBytes = options.targetBytes ?? AGENT_EVENT_SEGMENT_TARGET_BYTES
    if (!Number.isSafeInteger(this.targetBytes) || this.targetBytes <= 0) {
      throw new Error('invalid_agent_event_segment_target_bytes')
    }
    this.#admitAppend = options.admitAppend ?? ((_incomingBytes, publish) => publish())
    this.#afterStreamClose = options.afterStreamClose ?? (() => {})
  }

  append(identity: StreamIdentity, value: unknown): string {
    const buffer = Buffer.from(JSON.stringify(value) + '\n')
    return this.#admitAppend(buffer.length, () => {
      const directory = this.streamDirectory(identity)
      let entries = this.segmentEntries(directory)
      let active = entries.find((entry) => entry.open)
      if (active && statSync(active.path).size > 0
        && statSync(active.path).size + buffer.length > this.targetBytes) {
        this.closeEntry(active)
        active = undefined
        entries = entries.map((entry) => entry.open ? { ...entry, open: false } : entry)
      }
      if (!active) {
        const next = (entries.at(-1)?.number ?? 0) + 1
        if (!Number.isSafeInteger(next) || next > 999_999_999_999) throw new Error('agent_event_segment_exhausted')
        active = { number: next, path: this.segmentPath(directory, next, true), open: true }
      }
      appendJsonLine(active.path, buffer)
      return active.path
    })
  }

  read<T>(identity: StreamIdentity, parse: (value: unknown) => T): T[] {
    const directory = this.streamDirectory(identity)
    const values: T[] = []
    for (const entry of this.segmentEntries(directory)) {
      for (const [index, line] of readFileSync(entry.path, 'utf8').split('\n').entries()) {
        if (!line.trim()) continue
        try { values.push(parse(JSON.parse(line))) }
        catch (error) {
          throw new Error(entry.path + ':' + (index + 1) + ':'
            + (error instanceof Error ? error.message : String(error)))
        }
      }
    }
    return values
  }

  activePath(identity: StreamIdentity): string {
    const directory = this.streamDirectory(identity)
    const entries = this.segmentEntries(directory)
    const active = entries.find((entry) => entry.open)
    const number = active?.number ?? (entries.at(-1)?.number ?? 0) + 1
    return active?.path ?? this.segmentPath(directory, number, true)
  }

  close(identity: StreamIdentity): boolean {
    const directory = this.streamDirectory(identity, false)
    if (!existsSync(directory)) return false
    const active = this.segmentEntries(directory).find((entry) => entry.open)
    if (!active) return false
    this.closeEntry(active)
    this.#afterStreamClose()
    return true
  }

  private streamDirectory(identity: StreamIdentity, create = true): string {
    const server = assertGeneratedId(identity.serverInstanceId, 'serverInstance')
    const room = assertRoomRouteToken(identity.roomId)
    const generation = assertGeneratedId(identity.roomGeneration, 'roomGeneration')
    const serverDirectory = join(this.root, server)
    const roomDirectory = join(serverDirectory, room)
    const legacyPath = join(roomDirectory, generation + '.jsonl')
    if (existsSync(legacyPath)) throw new Error('legacy_agent_event_log_unsupported:' + legacyPath)
    const directory = join(roomDirectory, generation)
    if (create) {
      ensurePrivateDirectory(serverDirectory)
      ensurePrivateDirectory(roomDirectory)
      ensurePrivateDirectory(directory)
    }
    return directory
  }

  private segmentEntries(directory: string): SegmentEntry[] {
    if (!existsSync(directory)) return []
    const entries: SegmentEntry[] = []
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const match = /^(\d{12})(\.open)?\.jsonl$/.exec(entry.name)
      if (!match || !entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('invalid_agent_event_segment:' + join(directory, entry.name))
      }
      entries.push({
        number: Number(match[1]),
        path: join(directory, entry.name),
        open: match[2] === '.open',
      })
    }
    entries.sort((left, right) => left.number - right.number)
    if (new Set(entries.map((entry) => entry.number)).size !== entries.length
      || entries.filter((entry) => entry.open).length > 1) {
      throw new Error('invalid_agent_event_segment_set:' + directory)
    }
    return entries
  }

  private closeEntry(entry: SegmentEntry): void {
    const target = this.segmentPath(dirname(entry.path), entry.number, false)
    if (existsSync(target)) throw new Error('agent_event_segment_close_conflict')
    const closedAt = new Date()
    utimesSync(entry.path, closedAt, closedAt)
    const fd = openSync(entry.path, 'r')
    try { fsyncSync(fd) }
    finally { closeSync(fd) }
    renameSync(entry.path, target)
    fsyncDirectory(dirname(target))
  }

  private segmentPath(directory: string, number: number, open: boolean): string {
    return join(directory, String(number).padStart(12, '0') + (open ? '.open' : '') + '.jsonl')
  }
}

function appendJsonLine(path: string, buffer: Buffer): void {
  assertManagedRegularFile(path)
  const createdDirectoryEntry = !existsSync(path)
  let fd = openSync(path, 'a+', PRIVATE_FILE_MODE)
  const originalSize = fstatSync(fd).size
  try {
    fchmodSync(fd, PRIVATE_FILE_MODE)
    let offset = 0
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
    fsyncSync(fd)
    closeSync(fd)
    fd = -1
    if (createdDirectoryEntry) fsyncDirectory(dirname(path))
  } catch (error) {
    rollbackAppend(path, fd, originalSize, createdDirectoryEntry)
    fd = -1
    throw error
  } finally {
    if (fd !== -1) {
      try { closeSync(fd) } catch {}
    }
  }
}

function rollbackAppend(path: string, fd: number, originalSize: number, created: boolean): void {
  try {
    const target = fd === -1 ? openSync(path, 'r+') : fd
    ftruncateSync(target, originalSize)
    fsyncSync(target)
    closeSync(target)
  } catch {
    if (fd !== -1) {
      try { closeSync(fd) } catch {}
    }
  }
  if (!created) return
  try {
    unlinkSync(path)
    fsyncDirectory(dirname(path))
  } catch {}
}
