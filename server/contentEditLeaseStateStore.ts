import { createHash } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  assertContentResourceKey,
  contentResourceKeyString,
  type ContentEditLeaseGrant,
  type ContentEditLeaseView,
  type ContentResourceKey,
} from '../src/lib/contentEditLease'
import { assertGeneratedId } from '../src/lib/generatedId'
import {
  canonicalResourceRelativePath,
  ensurePrivateDirectory,
  fsyncDirectory,
  readPrivateFile,
  writePrivateFileAtomic,
} from './userDataRoot'

export type AvailableLeaseState = {
  schemaVersion: 1
  resourceKey: ContentResourceKey
  mode: 'available'
  leaseEpoch: number
  updatedAt: string
}

export type HeldLeaseState = {
  schemaVersion: 1
  resourceKey: ContentResourceKey
  mode: 'held'
  leaseEpoch: number
  editLeaseId: string
  serverInstanceId: string
  roomId: string
  roomGeneration: string
  clientId: string
  controlEpoch: number
  baseRevision: number
  acquiredAt: string
  expiresAt: string
}

export type ContentEditLeaseState = AvailableLeaseState | HeldLeaseState

export type ContentEditLeaseStateStoreOptions = {
  now?: () => number
  writeLeaseState?: (path: string, content: string) => void
  deleteLeaseState?: (path: string) => void
}

export class ContentEditLeaseStateStore {
  private readonly now: () => number
  private readonly writeLeaseStateFile: (path: string, content: string) => void
  private readonly deleteLeaseStateFile: (path: string) => void
  private readonly leaseDirectory: string

  constructor(
    private readonly root: string,
    locksDirectory: string,
    options: ContentEditLeaseStateStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.writeLeaseStateFile = options.writeLeaseState ?? writePrivateFileAtomic
    this.deleteLeaseStateFile = options.deleteLeaseState ?? unlinkSync
    this.leaseDirectory = join(locksDirectory, 'content-edit')
    ensurePrivateDirectory(this.leaseDirectory)
  }

  currentState(
    recordPath: string,
    resourceKey: ContentResourceKey,
    now: number,
    beforePersistExpired: (editLeaseId: string) => void = () => {},
  ): ContentEditLeaseState {
    const state = this.readState(recordPath, resourceKey)
    if (state.mode === 'held' && Date.parse(state.expiresAt) <= now) {
      beforePersistExpired(state.editLeaseId)
      const available = availableState(resourceKey, state.leaseEpoch, now)
      this.writeState(recordPath, available)
      return available
    }
    return state
  }

  readState(recordPath: string, resourceKey: ContentResourceKey): ContentEditLeaseState {
    const path = this.statePath(recordPath)
    if (!existsSync(path)) return availableState(resourceKey, 0, this.now())
    const parsed = JSON.parse(readPrivateFile(path).toString('utf8')) as unknown
    return assertLeaseState(parsed, resourceKey)
  }

  writeState(recordPath: string, state: ContentEditLeaseState): void {
    this.writeLeaseStateFile(this.statePath(recordPath), JSON.stringify(state, null, 2) + '\n')
  }

  deleteState(recordPath: string): void {
    const path = this.statePath(recordPath)
    try { this.deleteLeaseStateFile(path) } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error
    }
    fsyncDirectory(this.leaseDirectory)
  }

  statePath(recordPath: string): string {
    const relative = canonicalResourceRelativePath(this.root, recordPath)
    const digest = createHash('sha256').update(relative).digest('hex')
    const path = join(this.leaseDirectory, digest + '.json')
    if (basename(path) !== digest + '.json') throw new Error('invalid_content_edit_lease_path')
    return path
  }

  readRecordRevision(recordPath: string): number {
    if (!existsSync(recordPath)) throw new Error('content_record_not_found')
    let parsed: unknown
    try { parsed = JSON.parse(readPrivateFile(recordPath).toString('utf8')) }
    catch { throw new Error('invalid_content_record') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_content_record')
    return assertRevision((parsed as Record<string, unknown>).revision)
  }
}

export function assertLeaseState(value: unknown, expectedKey: ContentResourceKey): ContentEditLeaseState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_content_edit_lease_state')
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) throw new Error('invalid_content_edit_lease_state')
  const resourceKey = assertContentResourceKey(record.resourceKey)
  if (contentResourceKeyString(resourceKey) !== contentResourceKeyString(expectedKey)) {
    throw new Error('content_edit_lease_resource_mismatch')
  }
  const leaseEpoch = assertLeaseEpoch(record.leaseEpoch)
  if (record.mode === 'available') {
    if (Object.keys(record).sort().join(',') !== 'leaseEpoch,mode,resourceKey,schemaVersion,updatedAt') {
      throw new Error('invalid_content_edit_lease_state')
    }
    assertTimestamp(record.updatedAt)
    return { schemaVersion: 1, resourceKey, mode: 'available', leaseEpoch, updatedAt: record.updatedAt as string }
  }
  if (record.mode !== 'held') throw new Error('invalid_content_edit_lease_state')
  if (Object.keys(record).sort().join(',') !== 'acquiredAt,baseRevision,clientId,controlEpoch,editLeaseId,expiresAt,leaseEpoch,mode,resourceKey,roomGeneration,roomId,schemaVersion,serverInstanceId') {
    throw new Error('invalid_content_edit_lease_state')
  }
  assertTimestamp(record.acquiredAt)
  assertTimestamp(record.expiresAt)
  return {
    schemaVersion: 1,
    resourceKey,
    mode: 'held',
    leaseEpoch,
    editLeaseId: assertGeneratedId(record.editLeaseId, 'contentEditLease'),
    serverInstanceId: assertGeneratedId(record.serverInstanceId, 'serverInstance'),
    roomId: assertGeneratedId(record.roomId, 'room'),
    roomGeneration: assertGeneratedId(record.roomGeneration, 'roomGeneration'),
    clientId: assertGeneratedId(record.clientId, 'client'),
    controlEpoch: assertLeaseEpoch(record.controlEpoch),
    baseRevision: assertRevision(record.baseRevision),
    acquiredAt: record.acquiredAt as string,
    expiresAt: record.expiresAt as string,
  }
}

export function availableState(resourceKey: ContentResourceKey, leaseEpoch: number, now: number): AvailableLeaseState {
  return { schemaVersion: 1, resourceKey, mode: 'available', leaseEpoch, updatedAt: iso(now) }
}

export function leaseView(state: ContentEditLeaseState): ContentEditLeaseView {
  return state.mode === 'available'
    ? { mode: 'available', leaseEpoch: state.leaseEpoch }
    : { mode: 'held', leaseEpoch: state.leaseEpoch, expiresAt: state.expiresAt }
}

export function leaseGrant(state: HeldLeaseState): ContentEditLeaseGrant {
  return {
    resourceKey: state.resourceKey,
    editLeaseId: state.editLeaseId,
    leaseEpoch: state.leaseEpoch,
    baseRevision: state.baseRevision,
    expiresAt: state.expiresAt,
  }
}

export function assertLeaseEpoch(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error('invalid_lease_epoch')
  return value as number
}

export function assertRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('invalid_content_revision')
  return value as number
}

export function iso(value: number): string {
  return new Date(value).toISOString()
}

function assertTimestamp(value: unknown): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('invalid_content_edit_lease_state')
  }
}
