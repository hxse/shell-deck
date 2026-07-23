import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
import type { TerminalRoomClient } from '../terminalRoomClient'
import { LibraryClient } from './libraryClient'
import type { LibraryItem, LibraryItemFields, LibraryItemKind, LibraryItemListResult } from './libraryTypes'

type LibraryItemUpdateResult = Awaited<ReturnType<LibraryClient['update']>>

export type LibraryPersistedItem = {
  item: LibraryItem
  editing: boolean
  leaseWarning: string | null
  preservePublishedCreateBuffer: boolean
  editLease: ContentEditLeaseGrant | null
  leaseView: ContentEditLeaseView | null
}

export type LibraryPersistOutcome =
  | { kind: 'persisted'; value: LibraryPersistedItem }
  | { kind: 'published_save'; item: LibraryItem }
  | { kind: 'discarded' }

export type LibraryFreshLeaseOutcome =
  | { kind: 'acquired'; item: LibraryItem; grant: ContentEditLeaseGrant; view: ContentEditLeaseView }
  | { kind: 'declined' }
  | { kind: 'discarded' }

type LibraryMutationWorkflowOptions = {
  roomClient(): TerminalRoomClient | null
}

export class LibraryMutationWorkflow {
  private readonly api: LibraryClient

  constructor(private readonly options: LibraryMutationWorkflowOptions) {
    this.api = new LibraryClient(() => options.roomClient()?.controlGrant ?? null)
  }

  async list(kind: LibraryItemKind, query: string): Promise<LibraryItemListResult> {
    return await this.api.list(kind, query)
  }

  async read(kind: LibraryItemKind, itemId: string): Promise<LibraryItem> {
    return await this.api.read(kind, itemId)
  }

  async delete(item: LibraryItem, lease: ContentEditLeaseGrant): Promise<void> {
    await this.api.delete(item, lease)
  }

  async releaseEditLease(lease: ContentEditLeaseGrant | null): Promise<void> {
    const roomClient = this.options.roomClient()
    if (lease && roomClient?.canMutateShared) {
      await roomClient.releaseContentEditLease(lease.editLeaseId).catch(() => {})
    }
  }

  async discardTemporaryLease(lease: ContentEditLeaseGrant): Promise<void> {
    await this.options.roomClient()?.releaseContentEditLease(lease.editLeaseId).catch(() => {})
  }

  async acquireFreshLease(
    item: LibraryItem,
    intent: 'edit' | 'remove',
    operationIsCurrent: () => boolean,
  ): Promise<LibraryFreshLeaseOutcome> {
    const roomClient = this.options.roomClient()
    if (!roomClient || !operationIsCurrent()) return { kind: 'discarded' }
    const key = { kind: 'library' as const, itemKind: item.kind, itemId: item.itemId }
    const view = await roomClient.contentEditLeaseView(key)
    if (!operationIsCurrent()) return { kind: 'discarded' }
    let result: { view: ContentEditLeaseView; grant: ContentEditLeaseGrant }
    if (view.mode === 'held') {
      if (!confirm(`This Library item is being edited elsewhere. Take over its edit lease${intent === 'remove' ? ' to remove it' : ''}?`)) {
        return { kind: 'declined' }
      }
      result = await roomClient.takeOverContentEditLease(key, view.leaseEpoch)
    } else {
      result = await roomClient.acquireContentEditLease(key, view.leaseEpoch)
    }
    try {
      if (!operationIsCurrent()) {
        await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
        return { kind: 'discarded' }
      }
      const latest = await this.api.read(item.kind, item.itemId)
      if (!operationIsCurrent()) {
        await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
        return { kind: 'discarded' }
      }
      return { kind: 'acquired', item: latest, grant: result.grant, view: result.view }
    } catch (error) {
      await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
      throw error
    }
  }

  async persist(
    kind: LibraryItemKind,
    fields: LibraryItemFields,
    current: LibraryItem | null,
    lease: ContentEditLeaseGrant | null,
    operationIsCurrent: () => boolean,
    commit: (outcome: Exclude<LibraryPersistOutcome, { kind: 'discarded' }>) => void,
  ): Promise<LibraryPersistOutcome> {
    const updateResult: LibraryItemUpdateResult | null = current
      ? lease
        ? await this.api.update(current, fields, lease)
        : (() => { throw new Error('content_edit_lease_required') })()
      : null
    const saved = updateResult?.item ?? await this.api.create(kind, fields)
    if (!operationIsCurrent()) {
      const outcome = { kind: 'published_save' as const, item: saved }
      commit(outcome)
      return outcome
    }
    if (current) {
      if (!lease) throw new Error('content_edit_lease_required')
      const persisted: LibraryPersistedItem = updateResult?.leaseOutcome.status === 'retained'
        ? {
            item: saved,
            editing: true,
            leaseWarning: null,
            preservePublishedCreateBuffer: false,
            editLease: updateResult.leaseOutcome.grant,
            leaseView: {
              mode: 'held',
              leaseEpoch: updateResult.leaseOutcome.grant.leaseEpoch,
              expiresAt: updateResult.leaseOutcome.grant.expiresAt,
            },
          }
        : {
            item: saved,
            editing: false,
            leaseWarning: updateResult?.leaseOutcome.status === 'lost'
              ? updateResult.leaseOutcome.reason
              : 'content_edit_lease_lost',
            preservePublishedCreateBuffer: false,
            editLease: null,
            leaseView: null,
          }
      const outcome = { kind: 'persisted' as const, value: persisted }
      commit(outcome)
      return outcome
    }
    const acquired = await this.acquireCreatedItemLease(saved, operationIsCurrent)
    if (acquired === null || !operationIsCurrent()) {
      const outcome = { kind: 'published_save' as const, item: saved }
      commit(outcome)
      return outcome
    }
    const persisted: LibraryPersistedItem = acquired.ok
      ? {
          item: saved,
          editing: true,
          leaseWarning: null,
          preservePublishedCreateBuffer: false,
          editLease: acquired.grant,
          leaseView: acquired.view,
        }
      : {
          item: saved,
          editing: false,
          leaseWarning: `library_saved_but_edit_lease_not_retained:${acquired.reason}`,
          preservePublishedCreateBuffer: true,
          editLease: null,
          leaseView: acquired.view,
        }
    const outcome = { kind: 'persisted' as const, value: persisted }
    commit(outcome)
    return outcome
  }

  private async acquireCreatedItemLease(
    item: LibraryItem,
    operationIsCurrent: () => boolean,
  ): Promise<
    | { ok: true; grant: ContentEditLeaseGrant; view: ContentEditLeaseView }
    | { ok: false; reason: string; view: ContentEditLeaseView | null }
    | null
  > {
    const roomClient = this.options.roomClient()
    if (!roomClient || !operationIsCurrent()) return null
    const key = { kind: 'library' as const, itemKind: item.kind, itemId: item.itemId }
    try {
      const view = await roomClient.contentEditLeaseView(key)
      if (!operationIsCurrent()) return null
      if (view.mode !== 'available') return { ok: false, reason: 'content_edit_lease_held', view }
      const acquired = await roomClient.acquireContentEditLease(key, view.leaseEpoch)
      if (!operationIsCurrent()) {
        await roomClient.releaseContentEditLease(acquired.grant.editLeaseId).catch(() => {})
        return null
      }
      return { ok: true, grant: acquired.grant, view: acquired.view }
    } catch (error) {
      return { ok: false, reason: messageOf(error), view: null }
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
