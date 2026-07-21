import type { ContentEditLeaseGrant } from '../contentEditLease'
import type { LibraryItem, LibraryItemFields, LibraryItemKind } from './libraryTypes'

export type LibraryOperationIdentity = {
  kind: LibraryItemKind
  selectedKey: string
  selectedRevision: number | null
  draft: LibraryItemFields | null
  draftRevision: number
  editLeaseId: string | null
}

export type LibraryOperationSnapshot = LibraryOperationIdentity & {
  token: number
  controlEpoch: number | null
}

export type CurrentLibraryOperationState = {
  kind: LibraryItemKind
  selectedKey: string
  selectedItem: LibraryItem | null
  draft: LibraryItemFields | null
  draftRevision: number
  editLease: ContentEditLeaseGrant | null
  controlEpoch: number | null
}

export class LibraryNavigationCoordinator {
  #generation = 0

  constructor(private readonly setPending: (pending: boolean) => void) {}

  begin(identity: LibraryOperationIdentity, controlEpoch: number | null): LibraryOperationSnapshot {
    const operation = { token: ++this.#generation, controlEpoch, ...identity }
    this.setPending(true)
    return operation
  }

  end(operation: LibraryOperationSnapshot): boolean {
    if (!this.isTokenCurrent(operation)) return false
    this.setPending(false)
    return true
  }

  isTokenCurrent(operation: LibraryOperationSnapshot, currentControlEpoch?: number | null): boolean {
    if (this.#generation !== operation.token) return false
    if (currentControlEpoch !== undefined
      && operation.controlEpoch !== null
      && currentControlEpoch !== operation.controlEpoch) return false
    return true
  }

  hasLocalIdentity(operation: LibraryOperationSnapshot, current: CurrentLibraryOperationState): boolean {
    return this.#generation === operation.token
      && current.kind === operation.kind
      && current.selectedKey === operation.selectedKey
      && (current.selectedItem?.revision ?? null) === operation.selectedRevision
      && current.draft === operation.draft
      && current.draftRevision === operation.draftRevision
  }

  canCommit(
    operation: LibraryOperationSnapshot,
    current: CurrentLibraryOperationState,
    allowReleasedLease = false,
  ): boolean {
    if (!this.hasLocalIdentity(operation, current)) return false
    if (operation.controlEpoch !== null && current.controlEpoch !== operation.controlEpoch) return false
    const currentLeaseId = current.editLease?.editLeaseId ?? null
    if (currentLeaseId === operation.editLeaseId) return true
    return allowReleasedLease && operation.editLeaseId !== null && currentLeaseId === null
  }

  get generation(): number {
    return this.#generation
  }
}
