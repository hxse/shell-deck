import { createHash } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  assertContentResourceKey,
  contentResourceKeyString,
  type ContentCommitLeaseOutcome,
  type ContentEditLeaseGrant,
  type ContentEditLeaseView,
  type ContentResourceKey,
} from '../src/lib/contentEditLease'
import { assertGeneratedId, createGeneratedId } from '../src/lib/generatedId'
import type { RoomControlContext } from '../src/lib/roomControl'
import { ContentResourceTransactions } from './sharedContentStore'
import type { RoomControlledOperationTicket, TerminalRoomManager } from './terminalRoomManager'
import {
  canonicalResourceRelativePath,
  ensurePrivateDirectory,
  fsyncDirectory,
  readPrivateFile,
  writePrivateFileAtomic,
} from './userDataRoot'

export const CONTENT_EDIT_LEASE_TTL_MS = 30_000

type AvailableLeaseState = {
  schemaVersion: 1
  resourceKey: ContentResourceKey
  mode: 'available'
  leaseEpoch: number
  updatedAt: string
}

type HeldLeaseState = {
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

type ContentEditLeaseState = AvailableLeaseState | HeldLeaseState

type OwnedLease = {
  resourceKey: ContentResourceKey
  recordPath: string
  context: RoomControlContext
}

export type ContentEditLeaseServiceOptions = {
  now?: () => number
  editLeaseIdFactory?: () => string
  onChanged?: (resourceKey: ContentResourceKey, view: ContentEditLeaseView) => void
  writeLeaseState?: (path: string, content: string) => void
  deleteLeaseState?: (path: string) => void
}

export type PublishedContentCommitResult<T> = {
  value: T
  leaseOutcome: ContentCommitLeaseOutcome
}

export class ContentEditLeaseService {
  readonly transactions: ContentResourceTransactions
  private readonly manager: TerminalRoomManager
  private readonly now: () => number
  private readonly editLeaseIdFactory: () => string
  private readonly onChanged: (resourceKey: ContentResourceKey, view: ContentEditLeaseView) => void
  private readonly writeLeaseStateFile: (path: string, content: string) => void
  private readonly deleteLeaseStateFile: (path: string) => void
  private readonly owned = new Map<string, OwnedLease>()
  private readonly leaseDirectory: string

  constructor(root: string, manager: TerminalRoomManager, options: ContentEditLeaseServiceOptions = {}) {
    this.transactions = new ContentResourceTransactions(root)
    this.manager = manager
    this.now = options.now ?? Date.now
    this.editLeaseIdFactory = options.editLeaseIdFactory ?? (() => createGeneratedId('contentEditLease'))
    this.onChanged = options.onChanged ?? (() => {})
    this.writeLeaseStateFile = options.writeLeaseState ?? writePrivateFileAtomic
    this.deleteLeaseStateFile = options.deleteLeaseState ?? unlinkSync
    this.leaseDirectory = join(this.transactions.paths.locks, 'content-edit')
    ensurePrivateDirectory(this.leaseDirectory)
  }

  async view(resourceKey: ContentResourceKey, signal?: AbortSignal): Promise<ContentEditLeaseView> {
    const key = assertContentResourceKey(resourceKey)
    const recordPath = this.recordPath(key)
    return await this.transactions.run(recordPath, () => {
      const state = this.currentState(recordPath, key, this.now())
      return leaseView(state)
    }, signal)
  }

  async acquire(
    ticket: RoomControlledOperationTicket,
    resourceKey: ContentResourceKey,
    expectedLeaseEpoch: number,
  ): Promise<{ view: ContentEditLeaseView; grant: ContentEditLeaseGrant }> {
    const key = assertContentResourceKey(resourceKey)
    const expected = assertLeaseEpoch(expectedLeaseEpoch)
    const recordPath = this.recordPath(key)
    const result = await this.transactions.run(recordPath, () => {
      ticket.assertAuthorized()
      const now = this.now()
      const state = this.currentState(recordPath, key, now)
      if (state.leaseEpoch !== expected) throw new Error('content_edit_lease_epoch_conflict')
      if (state.mode === 'held') throw new Error('content_edit_lease_held')
      const next = this.createHeldState(key, ticket.context, state.leaseEpoch + 1, this.readRecordRevision(recordPath), now)
      this.writeState(recordPath, next)
      return next
    }, ticket.signal)
    ticket.assertAuthorized()
    this.trackOwned(result, recordPath, ticket.context)
    const view = leaseView(result)
    this.onChanged(result.resourceKey, view)
    return { view, grant: leaseGrant(result) }
  }

  async takeOver(
    ticket: RoomControlledOperationTicket,
    resourceKey: ContentResourceKey,
    expectedLeaseEpoch: number,
    confirmed: boolean,
  ): Promise<{ view: ContentEditLeaseView; grant: ContentEditLeaseGrant }> {
    if (confirmed !== true) throw new Error('content_edit_takeover_confirmation_required')
    const key = assertContentResourceKey(resourceKey)
    const expected = assertLeaseEpoch(expectedLeaseEpoch)
    const recordPath = this.recordPath(key)
    const result = await this.transactions.run(recordPath, () => {
      ticket.assertAuthorized()
      const now = this.now()
      const state = this.currentState(recordPath, key, now)
      if (state.leaseEpoch !== expected) throw new Error('content_edit_lease_epoch_conflict')
      if (state.mode !== 'held') throw new Error('content_edit_lease_lost')
      const next = this.createHeldState(key, ticket.context, state.leaseEpoch + 1, this.readRecordRevision(recordPath), now)
      this.writeState(recordPath, next)
      return next
    }, ticket.signal)
    ticket.assertAuthorized()
    this.removeTrackedResource(key)
    this.trackOwned(result, recordPath, ticket.context)
    const view = leaseView(result)
    this.onChanged(result.resourceKey, view)
    return { view, grant: leaseGrant(result) }
  }

  async release(ticket: RoomControlledOperationTicket, editLeaseId: string): Promise<ContentEditLeaseView> {
    const normalizedLeaseId = assertGeneratedId(editLeaseId, 'contentEditLease')
    const tracked = this.owned.get(normalizedLeaseId)
    if (!tracked || !sameControlContext(tracked.context, ticket.context)) throw new Error('content_edit_lease_lost')
    const view = await this.transactions.run(tracked.recordPath, () => {
      ticket.assertAuthorized()
      const state = this.currentState(tracked.recordPath, tracked.resourceKey, this.now())
      this.assertOwnedState(state, normalizedLeaseId, ticket.context)
      const available = availableState(state.resourceKey, state.leaseEpoch, this.now())
      this.writeState(tracked.recordPath, available)
      return leaseView(available)
    }, ticket.signal)
    this.owned.delete(normalizedLeaseId)
    this.onChanged(tracked.resourceKey, view)
    return view
  }

  async renewForController(context: RoomControlContext): Promise<void> {
    const leases = [...this.owned.entries()].filter(([, owned]) => sameControlContext(owned.context, context))
    for (const [editLeaseId, owned] of leases) {
      try {
        this.manager.assertRoomControlContext(context)
        const state = await this.transactions.run(owned.recordPath, () => {
          this.manager.assertRoomControlContext(context)
          const current = this.currentState(owned.recordPath, owned.resourceKey, this.now())
          this.assertOwnedState(current, editLeaseId, context)
          const renewed: HeldLeaseState = { ...current, expiresAt: iso(this.now() + CONTENT_EDIT_LEASE_TTL_MS) }
          this.writeState(owned.recordPath, renewed)
          return renewed
        })
        this.onChanged(owned.resourceKey, leaseView(state))
      } catch {
        this.owned.delete(editLeaseId)
      }
    }
  }

  async releaseForController(context: RoomControlContext): Promise<void> {
    const leases = [...this.owned.entries()].filter(([, owned]) => sameControlContext(owned.context, context))
    await Promise.allSettled(leases.map(async ([editLeaseId, owned]) => {
      await this.releaseOwnedInternal(editLeaseId, owned)
    }))
  }

  async releaseForRoom(roomId: string, roomGeneration: string): Promise<void> {
    const leases = [...this.owned.entries()].filter(([, owned]) => (
      owned.context.roomId === roomId && owned.context.roomGeneration === roomGeneration
    ))
    await Promise.allSettled(leases.map(async ([editLeaseId, owned]) => {
      await this.releaseOwnedInternal(editLeaseId, owned)
    }))
  }

  async commit<T>(
    ticket: RoomControlledOperationTicket,
    resourceKey: ContentResourceKey,
    editLeaseId: string,
    expectedRevision: number,
    operation: (recordPath: string, currentRevision: number) => T,
    options: { deleteRecord?: boolean } = {},
  ): Promise<PublishedContentCommitResult<T>> {
    const key = assertContentResourceKey(resourceKey)
    const normalizedLeaseId = assertGeneratedId(editLeaseId, 'contentEditLease')
    const expected = assertRevision(expectedRevision)
    const recordPath = this.recordPath(key)
    const result = await this.transactions.run(recordPath, () => {
      ticket.assertAuthorized()
      const tracked = this.owned.get(normalizedLeaseId)
      if (!tracked || tracked.recordPath !== recordPath || !sameControlContext(tracked.context, ticket.context)) {
        throw new Error('content_edit_lease_lost')
      }
      const state = this.currentState(recordPath, key, this.now())
      this.assertOwnedState(state, normalizedLeaseId, ticket.context)
      const currentRevision = this.readRecordRevision(recordPath)
      if (currentRevision !== expected) throw new Error('content_revision_conflict')
      ticket.assertAuthorized()
      const value = operation(recordPath, currentRevision)
      if (value && typeof (value as { then?: unknown }).then === 'function') throw new Error('content_commit_operation_must_be_sync')
      if (options.deleteRecord) {
        this.owned.delete(normalizedLeaseId)
        try {
          this.deleteState(recordPath)
          return {
            value,
            leaseOutcome: { status: 'released' } as const,
            changedView: { mode: 'available', leaseEpoch: state.leaseEpoch } as ContentEditLeaseView,
          }
        } catch {
          return {
            value,
            leaseOutcome: { status: 'lost', reason: 'content_edit_lease_state_refresh_failed' } as const,
            changedView: null,
          }
        }
      } else {
        const committedRevision = this.readRecordRevision(recordPath)
        if (committedRevision !== currentRevision + 1) throw new Error('content_commit_revision_not_advanced')
        const committedState: HeldLeaseState = { ...state, baseRevision: committedRevision }
        try {
          this.writeState(recordPath, committedState)
          return {
            value,
            leaseOutcome: { status: 'retained', grant: leaseGrant(committedState) } as const,
            changedView: null,
          }
        } catch {
          this.owned.delete(normalizedLeaseId)
          return {
            value,
            leaseOutcome: { status: 'lost', reason: 'content_edit_lease_state_refresh_failed' } as const,
            changedView: null,
          }
        }
      }
    }, ticket.signal)
    if (result.changedView) this.onChanged(key, result.changedView)
    return { value: result.value, leaseOutcome: result.leaseOutcome }
  }

  recordPath(resourceKey: ContentResourceKey): string {
    const key = assertContentResourceKey(resourceKey)
    if (key.kind === 'macro') return join(this.transactions.paths.macros, key.itemId + '.json')
    return join(this.transactions.paths.library, key.itemKind, key.itemId + '.json')
  }

  private async releaseOwnedInternal(editLeaseId: string, owned: OwnedLease): Promise<void> {
    try {
      const view = await this.transactions.run(owned.recordPath, () => {
        const state = this.currentState(owned.recordPath, owned.resourceKey, this.now())
        if (state.mode !== 'held' || state.editLeaseId !== editLeaseId || !sameControlContext(state, owned.context)) {
          throw new Error('content_edit_lease_lost')
        }
        const available = availableState(state.resourceKey, state.leaseEpoch, this.now())
        this.writeState(owned.recordPath, available)
        return leaseView(available)
      })
      this.onChanged(owned.resourceKey, view)
    } finally {
      this.owned.delete(editLeaseId)
    }
  }

  private createHeldState(
    resourceKey: ContentResourceKey,
    context: RoomControlContext,
    leaseEpoch: number,
    baseRevision: number,
    now: number,
  ): HeldLeaseState {
    return {
      schemaVersion: 1,
      resourceKey,
      mode: 'held',
      leaseEpoch,
      editLeaseId: assertGeneratedId(this.editLeaseIdFactory(), 'contentEditLease'),
      serverInstanceId: context.serverInstanceId,
      roomId: context.roomId,
      roomGeneration: context.roomGeneration,
      clientId: context.clientId,
      controlEpoch: context.controlEpoch,
      baseRevision,
      acquiredAt: iso(now),
      expiresAt: iso(now + CONTENT_EDIT_LEASE_TTL_MS),
    }
  }

  private currentState(recordPath: string, resourceKey: ContentResourceKey, now: number): ContentEditLeaseState {
    const state = this.readState(recordPath, resourceKey)
    if (state.mode === 'held' && Date.parse(state.expiresAt) <= now) {
      this.owned.delete(state.editLeaseId)
      const available = availableState(resourceKey, state.leaseEpoch, now)
      this.writeState(recordPath, available)
      return available
    }
    return state
  }

  private readState(recordPath: string, resourceKey: ContentResourceKey): ContentEditLeaseState {
    const path = this.statePath(recordPath)
    if (!existsSync(path)) return availableState(resourceKey, 0, this.now())
    const parsed = JSON.parse(readPrivateFile(path).toString('utf8')) as unknown
    return assertLeaseState(parsed, resourceKey)
  }

  private writeState(recordPath: string, state: ContentEditLeaseState): void {
    this.writeLeaseStateFile(this.statePath(recordPath), JSON.stringify(state, null, 2) + '\n')
  }

  private deleteState(recordPath: string): void {
    const path = this.statePath(recordPath)
    try { this.deleteLeaseStateFile(path) } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error
    }
    fsyncDirectory(this.leaseDirectory)
  }

  private statePath(recordPath: string): string {
    const relative = canonicalResourceRelativePath(this.transactions.paths.root, recordPath)
    const digest = createHash('sha256').update(relative).digest('hex')
    const path = join(this.leaseDirectory, digest + '.json')
    if (basename(path) !== digest + '.json') throw new Error('invalid_content_edit_lease_path')
    return path
  }

  private readRecordRevision(recordPath: string): number {
    if (!existsSync(recordPath)) throw new Error('content_record_not_found')
    let parsed: unknown
    try { parsed = JSON.parse(readPrivateFile(recordPath).toString('utf8')) }
    catch { throw new Error('invalid_content_record') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_content_record')
    return assertRevision((parsed as Record<string, unknown>).revision)
  }

  private assertOwnedState(state: ContentEditLeaseState, editLeaseId: string, context: RoomControlContext): asserts state is HeldLeaseState {
    if (state.mode !== 'held') throw new Error('content_edit_lease_expired')
    if (state.editLeaseId !== editLeaseId || !sameControlContext(state, context)) throw new Error('content_edit_lease_lost')
  }

  private trackOwned(state: HeldLeaseState, recordPath: string, context: RoomControlContext): void {
    this.owned.set(state.editLeaseId, { resourceKey: state.resourceKey, recordPath, context })
  }

  private removeTrackedResource(resourceKey: ContentResourceKey): void {
    const target = contentResourceKeyString(resourceKey)
    for (const [editLeaseId, owned] of this.owned) {
      if (contentResourceKeyString(owned.resourceKey) === target) this.owned.delete(editLeaseId)
    }
  }
}

function assertLeaseState(value: unknown, expectedKey: ContentResourceKey): ContentEditLeaseState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_content_edit_lease_state')
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) throw new Error('invalid_content_edit_lease_state')
  const resourceKey = assertContentResourceKey(record.resourceKey)
  if (contentResourceKeyString(resourceKey) !== contentResourceKeyString(expectedKey)) throw new Error('content_edit_lease_resource_mismatch')
  const leaseEpoch = assertLeaseEpoch(record.leaseEpoch)
  if (record.mode === 'available') {
    if (Object.keys(record).sort().join(',') !== 'leaseEpoch,mode,resourceKey,schemaVersion,updatedAt') throw new Error('invalid_content_edit_lease_state')
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

function availableState(resourceKey: ContentResourceKey, leaseEpoch: number, now: number): AvailableLeaseState {
  return { schemaVersion: 1, resourceKey, mode: 'available', leaseEpoch, updatedAt: iso(now) }
}

function leaseView(state: ContentEditLeaseState): ContentEditLeaseView {
  return state.mode === 'available'
    ? { mode: 'available', leaseEpoch: state.leaseEpoch }
    : { mode: 'held', leaseEpoch: state.leaseEpoch, expiresAt: state.expiresAt }
}

function leaseGrant(state: HeldLeaseState): ContentEditLeaseGrant {
  return {
    resourceKey: state.resourceKey,
    editLeaseId: state.editLeaseId,
    leaseEpoch: state.leaseEpoch,
    baseRevision: state.baseRevision,
    expiresAt: state.expiresAt,
  }
}

function sameControlContext(left: Pick<HeldLeaseState, 'serverInstanceId' | 'roomId' | 'roomGeneration' | 'clientId' | 'controlEpoch'> | RoomControlContext, right: RoomControlContext): boolean {
  return left.serverInstanceId === right.serverInstanceId
    && left.roomId === right.roomId
    && left.roomGeneration === right.roomGeneration
    && left.clientId === right.clientId
    && left.controlEpoch === right.controlEpoch
}

function assertLeaseEpoch(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error('invalid_lease_epoch')
  return value as number
}

function assertRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('invalid_content_revision')
  return value as number
}

function assertTimestamp(value: unknown): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('invalid_content_edit_lease_state')
  }
}

function iso(value: number): string {
  return new Date(value).toISOString()
}
