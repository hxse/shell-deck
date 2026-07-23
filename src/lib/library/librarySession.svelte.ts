import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
import type { ContentEditLeaseChangedMessage } from '../protocol'
import type { TerminalRoomClient } from '../terminalRoomClient'
import {
  formatLibraryRequestError,
  LibraryEditOrchestrator,
  type LibraryEditCommitOutcome,
  type LibraryLoadResult,
} from './libraryEditOrchestrator'
import {
  LibraryListCoordinator,
  type LibraryListRequestOutcome,
  type LibraryTab,
  libraryKindLabel,
  libraryKindTab,
  libraryTabKind,
} from './libraryListCoordinator'
import type { SequencedContentRecordChange } from './libraryInvalidationQueue'
import {
  LibraryMutationWorkflow,
  type LibraryPersistOutcome,
} from './libraryMutationWorkflow'
import {
  LibraryNavigationCoordinator,
  type CurrentLibraryOperationState,
  type LibraryOperationIdentity,
  type LibraryOperationSnapshot,
} from './libraryNavigationCoordinator'
import {
  LibraryRemoteSyncCoordinator,
  type LibraryListRefreshResult,
  type LibraryRefreshOutcome,
} from './libraryRemoteSyncCoordinator'
import {
  cloneLibraryFields,
  cloneLibraryItem,
  sameLibraryFields,
  type LibraryItem,
  type LibraryItemFields,
  type LibraryItemKind,
  type LibraryItemListResult,
  type LibraryItemSummary,
} from './libraryTypes'

export { formatLibraryMacroValidation, formatLibraryRequestError } from './libraryEditOrchestrator'
export type { LibraryLoadResult } from './libraryEditOrchestrator'
export { libraryKindLabel, libraryKindTab, libraryTabKind } from './libraryListCoordinator'
export type { LibraryTab } from './libraryListCoordinator'
export { cloneLibraryFields, cloneLibraryItem, sameLibraryFields } from './libraryTypes'

type ContentEditLeaseChange = ContentEditLeaseChangedMessage & { sequence: number }

type LibrarySessionOptions = {
  initialTab: LibraryTab
  initialFilter: string
  roomClient(): TerminalRoomClient | null
  canMutateShared(): boolean
  connectionGeneration(): number
  contentRecordChanges(): SequencedContentRecordChange[]
  contentLeaseChanges(): ContentEditLeaseChange[]
  onPreferenceChange(selectedTab: LibraryTab, filter: string): void
  onLoadIntoMacro(itemId: string, expectedRevision: number): Promise<LibraryLoadResult>
  onMutationDenied(reason: string): void
  onValidationText(value: string | null): void
}

export function createLibrarySession(options: LibrarySessionOptions) {
  let kind = $state<LibraryItemKind>(libraryTabKind(options.initialTab))
  let searchText = $state(options.initialFilter)
  let items = $state<LibraryItemSummary[]>([])
  let selectedItem = $state<LibraryItem | null>(null)
  let draft = $state<LibraryItemFields | null>(null)
  let editing = $state(false)
  let editLease = $state<ContentEditLeaseGrant | null>(null)
  let leaseView = $state<ContentEditLeaseView | null>(null)
  let leaseLost = $state(false)
  let publishedCreateBufferPreserved = $state(false)
  let dirty = $state(false)
  let draftRevision = $state(0)
  let operationPending = $state(false)
  let handledLeaseSequence = 0
  let statusText = $state('Library')
  let errorText = $state<string | null>(null)
  let listProblem = $state<string | null>(null)
  let remoteNotice = $state<string | null>(null)
  const navigation = new LibraryNavigationCoordinator((pending) => { operationPending = pending })
  const selectedKey = $derived(selectedItem ? selectedItem.kind + ':' + selectedItem.itemId : '')
  const mutations = new LibraryMutationWorkflow({ roomClient: options.roomClient })
  const list = new LibraryListCoordinator({
    mutations, kind: () => kind, searchText: () => searchText,
    commitSearch: (value) => {
      searchText = value
      options.onPreferenceChange(libraryKindTab(kind), value)
    },
    commitList,
  })
  const edit = new LibraryEditOrchestrator({
    mutations, list, roomClientPresent: () => options.roomClient() !== null,
    canMutateShared: options.canMutateShared, operationPending: () => operationPending,
    kind: () => kind, items: () => items, selectedItem: () => selectedItem,
    draft: () => draft, editLease: () => editLease, leaseLost: () => leaseLost,
    dirty: () => dirty, publishedCreateBufferPreserved: () => publishedCreateBufferPreserved,
    beginOperation, canCommitToken, canCommitLibraryOperation, endOperation,
    commitReleasedLease, commitOutcome, commitPersistOutcome, completeKindChange, completeSave,
    takeEditLease, onLoadIntoMacro: options.onLoadIntoMacro,
    setStatusText: (value) => { statusText = value },
    setErrorText: (value) => { errorText = value },
    setValidationText: options.onValidationText, deny, reportError,
  })
  const remoteSync = new LibraryRemoteSyncCoordinator({
    connectionGeneration: options.connectionGeneration,
    snapshot: () => ({
      selectedItem, draft, draftRevision, operationPending,
      protectedBuffer: dirty || editing || editLease !== null || leaseLost || publishedCreateBufferPreserved,
      publishedCreateBufferPreserved,
    }),
    reloadList: (report, announce) => list.reload(report, announce),
    readItem: (item) => mutations.read(item.kind, item.itemId),
    installItem: (item) => installItem(item), clearSelection,
    setRemoteNotice: (notice) => { remoteNotice = notice },
    setErrorText: (error) => { errorText = error }, reportError,
  })

  $effect(() => { remoteSync.connectionChanged(options.connectionGeneration()) })
  $effect(() => {
    if (options.canMutateShared() || !editLease) return
    markEditLeaseLost(null, 'Room control moved elsewhere. The local draft remains here; take control and reopen Edit before saving.')
  })
  $effect(() => { remoteSync.observe(options.contentRecordChanges()) })
  $effect(() => {
    const changes = options.contentLeaseChanges().filter((change) => change.sequence > handledLeaseSequence)
    if (changes.length === 0) return
    handledLeaseSequence = changes.at(-1)!.sequence
    const current = selectedItem
    const lease = editLease
    if (!current || !lease) return
    const relevant = changes.filter((change) => change.resourceKey.kind === 'library'
      && change.resourceKey.itemKind === current.kind
      && change.resourceKey.itemId === current.itemId).at(-1)
    if (!relevant) return
    if (relevant.view.mode === 'held' && relevant.view.leaseEpoch === lease.leaseEpoch) {
      leaseView = relevant.view
      return
    }
    markEditLeaseLost(relevant.view, 'This edit lease moved elsewhere. The local draft was kept, but it cannot be saved until Edit is reopened.')
  })
  function mount(): () => void {
    remoteSync.mount()
    const focus = () => remoteSync.focus()
    window.addEventListener('focus', focus)
    return () => {
      window.removeEventListener('focus', focus)
      list.dispose()
      remoteSync.dispose()
      void edit.releaseEditLease()
    }
  }
  function commitList(
    outcome: LibraryListRequestOutcome,
    report: boolean,
    announce: boolean,
  ): LibraryListRefreshResult {
    if (outcome.kind === 'stale') return { outcome: 'stale' }
    if (outcome.kind === 'retry') {
      if (report) reportError(outcome.error)
      return { outcome: 'retry' }
    }
    const result = outcome.result
    installList(result)
    if (announce && !dirty && !editing && !operationPending) {
      statusText = `${result.items.length} ${libraryKindLabel(kind)} items`
    }
    if (selectedItem && !result.items.some((item) => item.itemId === selectedItem?.itemId)) {
      if (dirty || editing || editLease || leaseLost || publishedCreateBufferPreserved || operationPending) {
        remoteNotice = 'The selected item is no longer in the current saved result. The local draft was kept.'
      } else clearSelection('Item unavailable')
    }
    return { outcome: 'applied', records: result.items }
  }
  function installList(result: LibraryItemListResult): void {
    items = result.items
    listProblem = result.invalidItems.length === 0
      ? null
      : `Invalid Library items ignored: ${result.invalidItems.map((item) => `${item.itemId} (${item.error})`).join(', ')}`
  }
  async function refreshLibrary(
    report = true,
    expectedConnectionGeneration = options.connectionGeneration(),
  ): Promise<LibraryRefreshOutcome> {
    return await remoteSync.refresh(report, expectedConnectionGeneration)
  }
  function commitReleasedLease(operation: LibraryOperationSnapshot): boolean {
    if (!canCommitNavigation(operation)) return false
    editLease = null; leaseView = null; leaseLost = false
    return true
  }
  function commitOutcome(outcome: LibraryEditCommitOutcome, operation: LibraryOperationSnapshot): boolean {
    if (outcome.kind === 'change_kind') {
      if (!canCommitNavigation(operation)) return false
      kind = outcome.next; selectedItem = null; draft = null; editing = false
      publishedCreateBufferPreserved = false; dirty = false; draftRevision += 1
      options.onValidationText(null); errorText = null; remoteNotice = null
      options.onPreferenceChange(libraryKindTab(outcome.next), searchText)
    } else if (outcome.kind === 'select_item') {
      if (!canCommitNavigation(operation) || outcome.item.kind !== kind) return false
      installItem(outcome.item); statusText = 'Item loaded'
    } else if (outcome.kind === 'new_item') {
      if (!canCommitNavigation(operation) || outcome.itemKind !== kind) return false
      selectedItem = null; draft = cloneLibraryFields(outcome.draft); editing = true
      leaseLost = false; publishedCreateBufferPreserved = false; dirty = true; draftRevision += 1
      options.onValidationText(null); errorText = null; remoteNotice = null; statusText = 'Unsaved new item'
    } else if (outcome.kind === 'begin_edit') {
      if (!canCommitLibraryOperation(operation)) return false
      editLease = outcome.acquired.grant; leaseView = outcome.acquired.view
      installItem(outcome.acquired.item, true, true); statusText = 'Editing'
    } else if (outcome.kind === 'discard_preserved') {
      if (!canCommitPreserved(operation, outcome.item)) return false
      installItem(outcome.item); statusText = 'Local copy discarded; latest saved item loaded'
    } else if (outcome.kind === 'discard_preserved_missing') {
      if (!canCommitPreserved(operation)) return false
      clearSelection('Local copy discarded; item removed elsewhere')
    } else if (outcome.kind === 'cancel_edit') {
      if (!canCommitToken(operation)) return false
      if (outcome.saved) installItem(outcome.saved)
      else clearSelection('Draft cancelled')
      statusText = outcome.saved && !outcome.cancelledDirtyDraft ? 'Done' : 'Cancelled'
    } else if (outcome.kind === 'remove_item') {
      if (!canCommitToken(operation)) return false
      clearSelection('Removed')
    } else {
      if (!canCommitToken(operation)) return false
      statusText = outcome.result.selected
        ? `Created and selected ${outcome.result.recordId}`
        : `Created ${outcome.result.recordId}; current Macro draft was not switched`
    }
    return true
  }
  function commitPersistOutcome(
    outcome: Exclude<LibraryPersistOutcome, { kind: 'discarded' }>,
    operation: LibraryOperationSnapshot,
  ): void {
    if (outcome.kind === 'published_save') {
      reconcilePublishedSave(operation, outcome.item)
      return
    }
    if (!canCommitLibraryOperation(operation)) return
    const persisted = outcome.value
    editLease = persisted.editLease; leaseView = persisted.leaseView
    installItem(persisted.item, persisted.editing, true, persisted.preservePublishedCreateBuffer)
    if (persisted.leaseWarning) remoteNotice = persisted.leaseWarning
  }
  function completeKindChange(operation: LibraryOperationSnapshot, next: LibraryItemKind): void {
    if (canCommitToken(operation) && kind === next && draft === null) {
      statusText = `${items.length} ${libraryKindLabel(kind)} items`
    }
  }
  function completeSave(operation: LibraryOperationSnapshot): void {
    if (navigation.generation === operation.token) statusText = 'Saved'
  }
  function canCommitPreserved(operation: LibraryOperationSnapshot, item?: LibraryItem): boolean {
    return canCommitToken(operation)
      && publishedCreateBufferPreserved
      && selectedKey === operation.selectedKey
      && (!item || item.kind + ':' + item.itemId === operation.selectedKey)
  }
  function updateDraft(field: keyof LibraryItemFields, value: string | string[]): void {
    if (!requireNoPendingOperation() || !requireSharedMutation() || !draft || !editing) return
    if (selectedItem && !editLease) {
      deny(leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required')
      return
    }
    draft = { ...draft, [field]: value, tags: field === 'tags' ? [...value as string[]] : [...draft.tags] }
    dirty = !selectedItem || !sameLibraryFields(draft, selectedItem)
    draftRevision += 1
    options.onValidationText(null)
  }
  function setTags(value: string): void {
    updateDraft('tags', value.split(',').map((tag) => tag.trim()).filter(Boolean))
  }
  function beginOperation(requireController = true): LibraryOperationSnapshot {
    errorText = null
    return navigation.begin(
      captureOperationIdentity(),
      requireController ? options.roomClient()?.controlGrant?.controlEpoch ?? null : null,
    )
  }
  function captureOperationIdentity(): LibraryOperationIdentity {
    return {
      kind, selectedKey, selectedRevision: selectedItem?.revision ?? null,
      draft, draftRevision, editLeaseId: editLease?.editLeaseId ?? null,
    }
  }
  function currentOperationState(): CurrentLibraryOperationState {
    return {
      kind, selectedKey, selectedItem, draft, draftRevision, editLease,
      controlEpoch: options.roomClient()?.controlGrant?.controlEpoch ?? null,
    }
  }
  function canCommitToken(operation: LibraryOperationSnapshot): boolean {
    return navigation.isTokenCurrent(operation, options.roomClient()?.controlGrant?.controlEpoch ?? null)
  }
  function canCommitLibraryOperation(operation: LibraryOperationSnapshot, allowReleasedLease = false): boolean {
    return navigation.canCommit(operation, currentOperationState(), allowReleasedLease)
  }
  function canCommitNavigation(operation: LibraryOperationSnapshot): boolean {
    return canCommitLibraryOperation(operation, true)
  }
  function endOperation(operation: LibraryOperationSnapshot): void {
    if (navigation.end(operation)) remoteSync.operationEnded()
  }
  function reconcilePublishedSave(operation: LibraryOperationSnapshot, saved: LibraryItem): void {
    if (!navigation.hasLocalIdentity(operation, currentOperationState())) return
    const savedKey = saved.kind + ':' + saved.itemId
    if (operation.selectedKey) {
      if (savedKey !== operation.selectedKey
        || operation.selectedRevision === null
        || saved.revision !== operation.selectedRevision + 1) return
    } else if (saved.kind !== operation.kind || saved.revision !== 1) return
    const relevantLeaseView = operation.editLeaseId !== null && leaseLost ? leaseView : null
    installItem(saved, false, false, operation.selectedKey === '')
    editLease = null; leaseView = relevantLeaseView; leaseLost = operation.editLeaseId !== null
    remoteNotice = operation.editLeaseId === null
      ? 'The item was saved, but this device no longer controls the operation. It remains read-only.'
      : 'The item was saved, but its edit lease moved elsewhere. Reopen Edit before making more changes.'
    statusText = 'Saved read-only'
  }
  function takeEditLease(): ContentEditLeaseGrant | null {
    const lease = editLease
    editLease = null; leaseView = null; leaseLost = false
    return lease
  }
  function installItem(
    item: LibraryItem,
    asEditing = false,
    preserveLeaseState = false,
    preservePublishedCreateBuffer = false,
  ): void {
    selectedItem = cloneLibraryItem(item); draft = cloneLibraryFields(item); editing = asEditing
    if (!preserveLeaseState) { editLease = null; leaseView = null }
    leaseLost = false; publishedCreateBufferPreserved = preservePublishedCreateBuffer
    dirty = false; draftRevision += 1; errorText = null; remoteNotice = null
    options.onValidationText(null)
  }
  function clearSelection(status: string): void {
    selectedItem = null; draft = null; editing = false; editLease = null; leaseView = null; leaseLost = false
    publishedCreateBufferPreserved = false; dirty = false; draftRevision += 1
    options.onValidationText(null); remoteNotice = null; statusText = status
  }
  function markEditLeaseLost(view: ContentEditLeaseView | null, notice: string): void {
    editLease = null; leaseView = view; editing = false; leaseLost = true; remoteNotice = notice
  }
  function requireSharedMutation(): boolean {
    if (!options.roomClient()) { deny('room_disconnected'); return false }
    if (!options.canMutateShared()) { deny('room_control_required'); return false }
    return true
  }
  function requireNoPendingOperation(): boolean {
    if (!operationPending) return true
    deny('operation_pending')
    return false
  }
  function deny(reason: string): void {
    errorText = reason
    options.onMutationDenied(reason)
  }
  function reportError(error: unknown, formatted = false): void {
    const reason = messageOf(error)
    errorText = formatted ? formatLibraryRequestError(error) : reason
    options.onMutationDenied(reason)
  }
  return {
    get kind() { return kind }, get searchText() { return searchText }, get items() { return items },
    get selectedItem() { return selectedItem }, get selectedKey() { return selectedKey }, get draft() { return draft },
    get editing() { return editing }, get editLease() { return editLease }, get leaseView() { return leaseView },
    get leaseLost() { return leaseLost }, get publishedCreateBufferPreserved() { return publishedCreateBufferPreserved },
    get dirty() { return dirty }, get operationPending() { return operationPending },
    get statusText() { return statusText }, get errorText() { return errorText },
    get listProblem() { return listProblem }, get remoteNotice() { return remoteNotice },
    mount,
    changeKind: (next: LibraryItemKind) => edit.changeKind(next),
    updateSearch: (value: string) => list.updateSearch(value),
    selectByKey: (key: string) => edit.selectByKey(key),
    newItem: () => edit.newItem(), beginEdit: () => edit.beginEdit(), saveItem: () => edit.saveItem(),
    cancelEdit: () => edit.cancelEdit(), removeItem: () => edit.removeItem(), refreshLibrary,
    loadIntoMacro: () => edit.loadIntoMacro(), updateDraft, setTags, deny,
    setErrorText: (value: string | null) => { errorText = value },
  }
}
export type LibrarySession = ReturnType<typeof createLibrarySession>
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
