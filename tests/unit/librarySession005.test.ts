import { describe, expect, test } from 'bun:test'
import type { ContentEditLeaseGrant } from '../../src/lib/contentEditLease'
import { LibraryInvalidationQueue, type SequencedContentRecordChange } from '../../src/lib/library/libraryInvalidationQueue'
import { LibraryNavigationCoordinator, type CurrentLibraryOperationState, type LibraryOperationIdentity } from '../../src/lib/library/libraryNavigationCoordinator'
import type { LibraryItem, LibraryItemFields } from '../../src/lib/library/libraryTypes'

describe('Library session coordinators', () => {
  test('navigation shares one generation and checks draft, selection, controller, and released lease identity', () => {
    const pending: boolean[] = []
    const coordinator = new LibraryNavigationCoordinator((value) => pending.push(value))
    const draft = fields('draft')
    const lease = editLease('lease-a')
    const identity: LibraryOperationIdentity = {
      kind: 'prompt',
      selectedKey: 'prompt:item-a',
      selectedRevision: 2,
      draft,
      draftRevision: 7,
      editLeaseId: lease.editLeaseId,
    }
    const operation = coordinator.begin(identity, 12)
    const current = operationState(draft, lease)

    expect(pending).toEqual([true])
    expect(coordinator.canCommit(operation, current)).toBe(true)
    expect(coordinator.canCommit(operation, { ...current, controlEpoch: 13 })).toBe(false)
    expect(coordinator.canCommit(operation, { ...current, draft: fields('newer') })).toBe(false)
    expect(coordinator.canCommit(operation, { ...current, editLease: null })).toBe(false)
    expect(coordinator.canCommit(operation, { ...current, editLease: null }, true)).toBe(true)

    const newer = coordinator.begin(identity, 12)
    expect(coordinator.isTokenCurrent(operation, 12)).toBe(false)
    expect(coordinator.end(operation)).toBe(false)
    expect(coordinator.end(newer)).toBe(true)
    expect(pending).toEqual([true, true, false])
  })

  test('invalidation retains unconsumed events and classifies ack, higher revision, delete, and retry', () => {
    const queue = new LibraryInvalidationQueue()
    const item = libraryItem(2)
    const changes = [
      change(1, 'saved', 2),
      change(2, 'saved', 3),
    ]

    expect(queue.observe(changes)).toBe(true)
    expect(queue.observe(changes)).toBe(false)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([1, 2])
    expect(queue.classify([changes[0]], item)).toEqual({ kind: 'own_ack', revision: 2 })
    expect(queue.classify([changes[1]], item)).toEqual({ kind: 'higher_revision', revision: 3 })
    expect(queue.classify([change(3, 'deleted', null)], item)).toEqual({ kind: 'deleted' })
    expect(queue.classify([change(4, 'saved', 8, 'note', 'other')], item)).toEqual({ kind: 'unrelated' })

    expect([queue.nextRetryDelay(), queue.nextRetryDelay(), queue.nextRetryDelay(), queue.nextRetryDelay()])
      .toEqual([100, 300, 800, null])
    expect(queue.batch()).toHaveLength(2)
    queue.consumeThrough(1)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([2])
    queue.resetRetry()
    expect(queue.nextRetryDelay()).toBe(100)
  })

})

function fields(content: string): LibraryItemFields {
  return { title: 'Title', content, description: '', tags: [] }
}

function editLease(editLeaseId: string): ContentEditLeaseGrant {
  return {
    resourceKey: { kind: 'library', itemKind: 'prompt', itemId: 'item-a' },
    editLeaseId,
    leaseEpoch: 4,
    baseRevision: 2,
    expiresAt: '2026-07-21T00:00:00.000Z',
  }
}

function operationState(draft: LibraryItemFields, editLeaseValue: ContentEditLeaseGrant | null): CurrentLibraryOperationState {
  return {
    kind: 'prompt',
    selectedKey: 'prompt:item-a',
    selectedItem: libraryItem(2),
    draft,
    draftRevision: 7,
    editLease: editLeaseValue,
    controlEpoch: 12,
  }
}

function libraryItem(revision: number): LibraryItem {
  return {
    schemaVersion: 1,
    itemId: 'item-a',
    kind: 'prompt',
    revision,
    ...fields('saved'),
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  }
}

function change(
  sequence: number,
  operation: 'saved' | 'deleted',
  revision: number | null,
  itemKind: 'macro-template' | 'prompt' | 'note' = 'prompt',
  itemId = 'item-a',
): SequencedContentRecordChange {
  return {
    type: 'content_record_changed',
    resourceKey: { kind: 'library', itemKind, itemId },
    operation,
    revision,
    sequence,
  }
}
