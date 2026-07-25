import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
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
import {
  assertLeaseEpoch,
  assertRevision,
  availableState,
  ContentEditLeaseStateStore,
  iso,
  leaseGrant,
  leaseView,
  type ContentEditLeaseState,
  type HeldLeaseState,
} from './contentEditLeaseStateStore'
import { ContentResourceTransactions } from './sharedContentStore'
import type { RoomControlledOperationTicket, TerminalRoomManager } from './terminalRoomManager'

export const CONTENT_EDIT_LEASE_TTL_MS = 30_000

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
  private readonly stateStore: ContentEditLeaseStateStore
  private readonly owned = new Map<string, OwnedLease>()

  constructor(root: string, manager: TerminalRoomManager, options: ContentEditLeaseServiceOptions = {}) {
    this.transactions = new ContentResourceTransactions(root)
    this.manager = manager
    this.now = options.now ?? Date.now
    this.editLeaseIdFactory = options.editLeaseIdFactory ?? (() => createGeneratedId('contentEditLease'))
    this.onChanged = options.onChanged ?? (() => {})
    this.stateStore = new ContentEditLeaseStateStore(this.transactions.paths.root, this.transactions.paths.locks, {
      now: this.now,
      writeLeaseState: options.writeLeaseState,
      deleteLeaseState: options.deleteLeaseState,
    })
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
      const next = this.createHeldState(key, ticket.context, state.leaseEpoch + 1, this.stateStore.readRecordRevision(recordPath), now)
      this.stateStore.writeState(recordPath, next)
      return next
    }, ticket.signal)
    await this.authorizeAndTrackPublishedLease(result, recordPath, ticket)
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
      const next = this.createHeldState(key, ticket.context, state.leaseEpoch + 1, this.stateStore.readRecordRevision(recordPath), now)
      this.stateStore.writeState(recordPath, next)
      return next
    }, ticket.signal)
    await this.authorizeAndTrackPublishedLease(result, recordPath, ticket, true)
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
      this.stateStore.writeState(tracked.recordPath, available)
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
          this.stateStore.writeState(owned.recordPath, renewed)
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
      const currentRevision = this.stateStore.readRecordRevision(recordPath)
      if (currentRevision !== expected) throw new Error('content_revision_conflict')
      ticket.assertAuthorized()
      const value = operation(recordPath, currentRevision)
      if (value && typeof (value as { then?: unknown }).then === 'function') throw new Error('content_commit_operation_must_be_sync')
      if (options.deleteRecord) {
        this.owned.delete(normalizedLeaseId)
        try {
          this.stateStore.deleteState(recordPath)
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
        const committedRevision = this.stateStore.readRecordRevision(recordPath)
        if (committedRevision !== currentRevision + 1) throw new Error('content_commit_revision_not_advanced')
        const committedState: HeldLeaseState = { ...state, baseRevision: committedRevision }
        try {
          this.stateStore.writeState(recordPath, committedState)
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
    return join(this.transactions.paths.macros, key.itemId + '.json')
  }

  private async releaseOwnedInternal(editLeaseId: string, owned: OwnedLease): Promise<void> {
    try {
      const view = await this.transactions.run(owned.recordPath, () => {
        const state = this.currentState(owned.recordPath, owned.resourceKey, this.now())
        if (state.mode !== 'held' || state.editLeaseId !== editLeaseId || !sameControlContext(state, owned.context)) {
          throw new Error('content_edit_lease_lost')
        }
        const available = availableState(state.resourceKey, state.leaseEpoch, this.now())
        this.stateStore.writeState(owned.recordPath, available)
        return leaseView(available)
      })
      this.onChanged(owned.resourceKey, view)
    } finally {
      this.owned.delete(editLeaseId)
    }
  }

  private async authorizeAndTrackPublishedLease(
    state: HeldLeaseState,
    recordPath: string,
    ticket: RoomControlledOperationTicket,
    replaceTrackedResource = false,
  ): Promise<void> {
    try { ticket.assertAuthorized() }
    catch (error) {
      if (await this.rollbackPublishedLease(state, recordPath)) this.removeTrackedResource(state.resourceKey)
      throw error
    }
    if (replaceTrackedResource) this.removeTrackedResource(state.resourceKey)
    this.trackOwned(state, recordPath, ticket.context)
  }

  private async rollbackPublishedLease(published: HeldLeaseState, recordPath: string): Promise<boolean> {
    const view = await this.transactions.run(recordPath, () => {
      const current = this.stateStore.readState(recordPath, published.resourceKey)
      if (current.mode !== 'held' || !isDeepStrictEqual(current, published)) return null
      const available = availableState(current.resourceKey, current.leaseEpoch, this.now())
      this.stateStore.writeState(recordPath, available)
      return leaseView(available)
    })
    if (view) this.onChanged(published.resourceKey, view)
    return view !== null
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
    return this.stateStore.currentState(
      recordPath,
      resourceKey,
      now,
      (editLeaseId) => this.owned.delete(editLeaseId),
    )
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

function sameControlContext(left: Pick<HeldLeaseState, 'serverInstanceId' | 'roomId' | 'roomGeneration' | 'clientId' | 'controlEpoch'> | RoomControlContext, right: RoomControlContext): boolean {
  return left.serverInstanceId === right.serverInstanceId
    && left.roomId === right.roomId
    && left.roomGeneration === right.roomGeneration
    && left.clientId === right.clientId
    && left.controlEpoch === right.controlEpoch
}
