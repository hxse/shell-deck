import {
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import type { Stats } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { assertGeneratedId } from '../src/lib/generatedId'
import { readLinuxProcessStartTime } from './serverProcessIdentity'
import {
  ensurePrivateDirectory,
  fsyncDirectory,
  initializeUserDataRoot,
  readPrivateFile,
  withFileLockSync,
  writePrivateFileAtomic,
  type UserDataPaths,
} from './userDataRoot'

export const DEFAULT_LOG_STORAGE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024
export const LOG_STORAGE_TARGET_NUMERATOR = 9
export const LOG_STORAGE_TARGET_DENOMINATOR = 10

export type RetentionRunCandidate = {
  runId: string
  completedAt: string
}

export type LogStorageRunAdapter = {
  candidates(): RetentionRunCandidate[]
  remove(runId: string): void
}

export type LogStorageSweepResult = {
  beforeBytes: number
  afterBytes: number
  removedRunIds: string[]
  removedAgentSegments: string[]
}

type LogStorageRetentionOptions = {
  limitBytes?: number
  env?: NodeJS.ProcessEnv
  onSweepError?: (error: Error) => void
}

type ClosedSegment = {
  path: string
  relativePath: string
  bytes: number
  closedAtMs: number
}

type RunPinRecord = {
  schemaVersion: 1
  pid: number
  processStartTime: string
}

export class LogStorageRetention {
  readonly paths: UserDataPaths
  readonly limitBytes: number
  readonly targetBytes: number
  readonly #lockPath: string
  readonly #runPinsRoot: string
  readonly #processStartTime: string
  readonly #onSweepError: (error: Error) => void
  #runAdapter: LogStorageRunAdapter | null = null
  #lockDepth = 0

  constructor(root?: string, options: LogStorageRetentionOptions = {}) {
    this.paths = initializeUserDataRoot(root)
    this.limitBytes = resolveLogStorageLimitBytes(options.limitBytes, options.env)
    this.targetBytes = scaleIntegerFloor(
      this.limitBytes,
      LOG_STORAGE_TARGET_NUMERATOR,
      LOG_STORAGE_TARGET_DENOMINATOR,
    )
    this.#lockPath = join(this.paths.locks, 'log-storage-gc.lock')
    this.#runPinsRoot = join(this.paths.locks, 'log-storage-current-runs')
    this.#processStartTime = readLinuxProcessStartTime(process.pid)
    ensurePrivateDirectory(this.#runPinsRoot)
    this.#onSweepError = options.onSweepError
      ?? ((error) => console.error(error.message))
  }

  setRunAdapter(adapter: LogStorageRunAdapter): void {
    if (this.#runAdapter) throw new Error('log_storage_run_adapter_already_set')
    this.#runAdapter = adapter
  }

  enforce(incomingBytes = 0): LogStorageSweepResult {
    const incoming = assertIncomingBytes(incomingBytes)
    return this.#withLock(() => this.#sweep(incoming))
  }

  admitAndPublish<T>(incomingBytes: number, publish: () => T): T {
    const incoming = assertIncomingBytes(incomingBytes)
    if (this.#lockDepth > 0) return publish()
    return this.#withLock(() => {
      this.#sweep(incoming)
      return publish()
    })
  }

  admitAndPublishComputed<T>(incomingBytes: () => number, publish: () => T): T {
    const admittedPublish = () => this.#admitComputedLocked(incomingBytes, publish)
    return this.#lockDepth > 0 ? admittedPublish() : this.#withLock(admittedPublish)
  }

  protectRun(runId: string): void {
    const id = assertGeneratedId(runId, 'run')
    withFileLockSync(this.#lockPath, () => {
      const path = this.#runPinPath(id)
      if (existsSync(path)) {
        const current = readRunPin(path)
        if (runPinIsLive(current)) {
          if (current.pid === process.pid && current.processStartTime === this.#processStartTime) return
          throw new Error('log_storage_run_already_protected:' + id)
        }
        unlinkSync(path)
        fsyncDirectory(this.#runPinsRoot)
      }
      writePrivateFileAtomic(path, JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        processStartTime: this.#processStartTime,
      } satisfies RunPinRecord) + '\n')
    })
  }

  unprotectRun(runId: string): void {
    const id = assertGeneratedId(runId, 'run')
    withFileLockSync(this.#lockPath, () => {
      const path = this.#runPinPath(id)
      if (!existsSync(path)) return
      const current = readRunPin(path)
      if (runPinIsLive(current)
        && (current.pid !== process.pid || current.processStartTime !== this.#processStartTime)) {
        throw new Error('log_storage_run_protected_by_other_process:' + id)
      }
      unlinkSync(path)
      fsyncDirectory(this.#runPinsRoot)
    })
  }

  afterRunTerminal(): void {
    this.#enforceAfterCommit()
  }

  afterAgentSegmentClose(): void {
    this.#enforceAfterCommit()
  }

  #enforceAfterCommit(): void {
    try { this.enforce() }
    catch (error) { this.#onSweepError(asError(error)) }
  }

  usageBytes(): number {
    return measureTreeBytes(this.paths.runs) + measureTreeBytes(this.paths.agentEvents)
  }

  #sweep(incomingBytes: number): LogStorageSweepResult {
    cleanupRunTombstones(this.paths.runs)
    const protectedRuns = this.#liveProtectedRunIds()
    const beforeBytes = this.usageBytes()
    let projectedBytes = beforeBytes + incomingBytes
    const removedRunIds: string[] = []
    const removedAgentSegments: string[] = []
    if (projectedBytes < this.limitBytes) {
      return { beforeBytes, afterBytes: beforeBytes, removedRunIds, removedAgentSegments }
    }

    const runs = (this.#runAdapter?.candidates() ?? [])
      .filter((candidate) => !protectedRuns.has(candidate.runId))
      .sort((left, right) => compareText(left.completedAt, right.completedAt)
        || compareText(left.runId, right.runId))
    const indexPath = join(this.paths.runs, 'trace-index.json')
    for (const candidate of runs) {
      if (projectedBytes <= this.targetBytes) break
      const runPath = join(this.paths.runs, candidate.runId)
      const runBytes = existsSync(runPath) ? measureTreeBytes(runPath) : 0
      const indexBefore = regularFileBytes(indexPath)
      this.#runAdapter!.remove(candidate.runId)
      const indexAfter = regularFileBytes(indexPath)
      projectedBytes += indexAfter - indexBefore - runBytes
      removedRunIds.push(candidate.runId)
    }

    const segments = closedAgentSegments(this.paths.agentEvents)
    for (const segment of segments) {
      if (projectedBytes <= this.targetBytes) break
      unlinkSync(segment.path)
      fsyncDirectory(dirname(segment.path))
      projectedBytes -= segment.bytes
      removedAgentSegments.push(segment.relativePath)
    }

    let afterBytes = this.usageBytes()
    for (const candidate of runs.slice(removedRunIds.length)) {
      if (afterBytes + incomingBytes <= this.targetBytes) break
      this.#runAdapter!.remove(candidate.runId)
      removedRunIds.push(candidate.runId)
      afterBytes = this.usageBytes()
    }
    for (const segment of segments.slice(removedAgentSegments.length)) {
      if (afterBytes + incomingBytes <= this.targetBytes) break
      unlinkSync(segment.path)
      fsyncDirectory(dirname(segment.path))
      removedAgentSegments.push(segment.relativePath)
      afterBytes = this.usageBytes()
    }
    if (afterBytes + incomingBytes >= this.limitBytes) throw new Error('log_storage_limit_reached')
    return { beforeBytes, afterBytes, removedRunIds, removedAgentSegments }
  }

  #liveProtectedRunIds(): Set<string> {
    const protectedRuns = new Set<string>()
    let removed = false
    for (const entry of readdirSync(this.#runPinsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new Error('invalid_log_storage_run_pin:' + join(this.#runPinsRoot, entry.name))
      }
      const runId = assertGeneratedId(entry.name.slice(0, -'.json'.length), 'run')
      const path = join(this.#runPinsRoot, entry.name)
      if (runPinIsLive(readRunPin(path))) protectedRuns.add(runId)
      else {
        unlinkSync(path)
        removed = true
      }
    }
    if (removed) fsyncDirectory(this.#runPinsRoot)
    return protectedRuns
  }

  #runPinPath(runId: string): string {
    return join(this.#runPinsRoot, assertGeneratedId(runId, 'run') + '.json')
  }

  #admitComputedLocked<T>(incomingBytes: () => number, publish: () => T): T {
    for (;;) {
      const incoming = assertIncomingBytes(incomingBytes())
      if (incoming === 0) return publish()
      const sweep = this.#sweep(incoming)
      if (sweep.removedRunIds.length === 0) return publish()
    }
  }

  #withLock<T>(operation: () => T): T {
    return withFileLockSync(this.#lockPath, () => {
      this.#lockDepth += 1
      try { return operation() }
      finally { this.#lockDepth -= 1 }
    })
  }
}

export function resolveLogStorageLimitBytes(
  explicit: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (explicit !== undefined) return assertLogStorageLimitBytes(explicit)
  const raw = env.SHELL_DECK_LOG_STORAGE_LIMIT_BYTES
  if (raw === undefined) return DEFAULT_LOG_STORAGE_LIMIT_BYTES
  const configured = raw.trim()
  if (!/^[1-9]\d*$/.test(configured)) throw new Error('invalid_log_storage_limit_bytes')
  return assertLogStorageLimitBytes(Number(configured))
}

function assertLogStorageLimitBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('invalid_log_storage_limit_bytes')
  return value
}

function assertIncomingBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_log_storage_incoming_bytes')
  return value
}

function scaleIntegerFloor(value: number, numerator: number, denominator: number): number {
  const quotient = Math.floor(value / denominator)
  const remainder = value % denominator
  return quotient * numerator + Math.floor(remainder * numerator / denominator)
}

function cleanupRunTombstones(runsRoot: string): void {
  for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith('.gc-run_')) continue
    const path = join(runsRoot, entry.name)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('log_storage_path_invalid:' + path)
    rmSync(path, { recursive: true, force: true })
    fsyncDirectory(runsRoot)
  }
}

function closedAgentSegments(root: string): ClosedSegment[] {
  const segments: ClosedSegment[] = []
  walkRegularFiles(root, (path, stats) => {
    const name = basename(path)
    if (!/^\d{12}\.jsonl$/.test(name)) return
    segments.push({
      path,
      relativePath: relative(root, path),
      bytes: stats.size,
      closedAtMs: stats.mtimeMs,
    })
  })
  return segments.sort((left, right) => left.closedAtMs - right.closedAtMs
    || compareText(left.relativePath, right.relativePath))
}

function measureTreeBytes(root: string): number {
  let total = 0
  walkRegularFiles(root, (_path, stats) => { total += stats.size })
  return total
}

function walkRegularFiles(root: string, visit: (path: string, stats: Stats) => void): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error('log_storage_path_invalid:' + path)
    if (entry.isDirectory()) {
      walkRegularFiles(path, visit)
      continue
    }
    if (!entry.isFile()) throw new Error('log_storage_path_invalid:' + path)
    visit(path, lstatSync(path))
  }
}

function regularFileBytes(path: string): number {
  if (!existsSync(path)) return 0
  const stats = statSync(path)
  if (!stats.isFile()) throw new Error('log_storage_path_invalid:' + path)
  return stats.size
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function readRunPin(path: string): RunPinRecord {
  let value: unknown
  try { value = JSON.parse(readPrivateFile(path).toString('utf8')) }
  catch { throw new Error('invalid_log_storage_run_pin:' + path) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_log_storage_run_pin:' + path)
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'pid,processStartTime,schemaVersion'
    || record.schemaVersion !== 1 || !Number.isSafeInteger(record.pid) || (record.pid as number) <= 0
    || typeof record.processStartTime !== 'string' || !/^\d+$/.test(record.processStartTime)) {
    throw new Error('invalid_log_storage_run_pin:' + path)
  }
  return value as RunPinRecord
}

function runPinIsLive(record: RunPinRecord): boolean {
  try { return readLinuxProcessStartTime(record.pid) === record.processStartTime }
  catch { return false }
}
