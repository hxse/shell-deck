import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
import type { ContentEditLeaseChangedMessage } from '../protocol'
import type { TerminalRoomClient } from '../terminalRoomClient'
import { parseAndValidateMacroDefinitionJson } from '../macro/macroDefinitionValidation'
import type { SequencedContentRecordChange } from './libraryInvalidationQueue'
import {
  LibraryMutationWorkflow,
  type LibraryFreshLeaseOutcome,
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
import type { LibraryItem, LibraryItemFields, LibraryItemKind, LibraryItemListResult, LibraryItemSummary } from './libraryTypes'

export type LibraryTab = 'json-template' | 'prompt' | 'note'
export type LibraryLoadResult = { selected: boolean; recordId: string }
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
  let listGeneration = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let handledLeaseSequence = 0
  let statusText = $state('Library')
  let errorText = $state<string | null>(null)
  let listProblem = $state<string | null>(null)
  let remoteNotice = $state<string | null>(null)
  const navigation = new LibraryNavigationCoordinator((pending) => { operationPending = pending })
  const selectedKey = $derived(selectedItem ? selectedItem.kind + ':' + selectedItem.itemId : '')
  const mutations = new LibraryMutationWorkflow({ roomClient: options.roomClient })
  const remoteSync = new LibraryRemoteSyncCoordinator({
    connectionGeneration: options.connectionGeneration,
    snapshot: () => ({
      selectedItem,
      draft,
      draftRevision,
      operationPending,
      protectedBuffer: dirty
        || editing
        || editLease !== null
        || leaseLost
        || publishedCreateBufferPreserved,
      publishedCreateBufferPreserved,
    }),
    reloadList,
    readItem: (item) => mutations.read(item.kind, item.itemId),
    installItem: (item) => installItem(item),
    clearSelection,
    setRemoteNotice: (notice) => { remoteNotice = notice },
    setErrorText: (error) => { errorText = error },
    reportError,
  })

  $effect(() => {
    remoteSync.connectionChanged(options.connectionGeneration())
  })

  $effect(() => {
    if (options.canMutateShared() || !editLease) return
    markEditLeaseLost(null, 'Room control moved elsewhere. The local draft remains here; take control and reopen Edit before saving.')
  })

  $effect(() => {
    remoteSync.observe(options.contentRecordChanges())
  })

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
      if (searchTimer) clearTimeout(searchTimer)
      remoteSync.dispose()
      void releaseEditLease()
    }
  }

  async function changeKind(next: LibraryItemKind): Promise<void> {
    if (next === kind) return
    if (operationPending) { deny('operation_pending'); return }
    if (!confirmDiscardCurrent('Switch Library tab and discard the current draft?')) return
    const operation = beginOperation(false)
    try {
      if (!await releaseNavigationLease(operation)) return
      if (!canCommitNavigation(operation)) return
      if (searchTimer) { clearTimeout(searchTimer); searchTimer = null }
      kind = next
      selectedItem = null
      draft = null
      editing = false
      publishedCreateBufferPreserved = false
      dirty = false
      draftRevision += 1
      options.onValidationText(null)
      errorText = null
      remoteNotice = null
      options.onPreferenceChange(libraryKindTab(next), searchText)
      await reloadList(true, false)
      if (canCommitToken(operation) && kind === next && draft === null) {
        statusText = `${items.length} ${libraryKindLabel(kind)} items`
      }
    } catch (error) {
      if (canCommitToken(operation)) reportError(error)
    } finally {
      endOperation(operation)
    }
  }

  function updateSearch(value: string): void {
    searchText = value
    options.onPreferenceChange(libraryKindTab(kind), value)
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { searchTimer = null; void reloadList(false) }, 180)
  }

  async function reloadList(report: boolean, announce = true): Promise<LibraryListRefreshResult> {
    const generation = ++listGeneration
    const requestKind = kind
    const requestQuery = searchText
    try {
      const result = await mutations.list(requestKind, requestQuery)
      if (generation !== listGeneration || requestKind !== kind || requestQuery !== searchText) {
        return { outcome: 'stale' }
      }
      installList(result)
      if (announce && !dirty && !editing && !operationPending) {
        statusText = `${result.items.length} ${libraryKindLabel(kind)} items`
      }
      if (selectedItem && !result.items.some((item) => item.itemId === selectedItem?.itemId)) {
        if (dirty || editing || editLease || leaseLost || publishedCreateBufferPreserved || operationPending) {
          remoteNotice = 'The selected item is no longer in the current saved result. The local draft was kept.'
        } else {
          clearSelection('Item unavailable')
        }
      }
      return { outcome: 'applied', records: result.items }
    } catch (error) {
      if (generation !== listGeneration || requestKind !== kind || requestQuery !== searchText) {
        return { outcome: 'stale' }
      }
      if (report) reportError(error)
      return { outcome: 'retry' }
    }
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

  async function selectByKey(key: string): Promise<void> {
    if (operationPending) { deny('operation_pending'); return }
    const summary = items.find((item) => item.kind + ':' + item.itemId === key)
    if (!summary || summary.itemId === selectedItem?.itemId) return
    if (!confirmDiscardCurrent('Discard the current Library draft?')) return
    const operation = beginOperation(false)
    try {
      if (!await releaseNavigationLease(operation)) return
      if (!canCommitNavigation(operation)) return
      const item = await mutations.read(summary.kind, summary.itemId)
      if (!canCommitNavigation(operation) || item.kind !== kind) return
      installItem(item)
      statusText = 'Item loaded'
    } catch (error) {
      if (canCommitToken(operation)) reportError(error)
    } finally {
      endOperation(operation)
    }
  }

  async function newItem(): Promise<void> {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    if (!confirmDiscardCurrent('Discard the current Library draft?')) return
    const operation = beginOperation()
    try {
      if (!await releaseNavigationLease(operation)) return
      if (!canCommitNavigation(operation)) return
      selectedItem = null
      draft = {
        title: `New ${libraryKindLabel(kind)}`,
        content: kind === 'macro-template' ? emptyMacroJson() : '',
        description: '',
        tags: [],
      }
      editing = true
      leaseLost = false
      publishedCreateBufferPreserved = false
      dirty = true
      draftRevision += 1
      options.onValidationText(null)
      errorText = null
      remoteNotice = null
      statusText = 'Unsaved new item'
    } catch (error) {
      if (canCommitToken(operation)) reportError(error)
    } finally {
      endOperation(operation)
    }
  }

  async function beginEdit(): Promise<void> {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    const current = selectedItem
    if (!current) { deny('no_saved_library_item_selected'); return }
    if (dirty && !confirm('Reopen Edit and replace the local draft with the latest saved item?')) return
    const operation = beginOperation()
    try {
      const acquired = await acquireLease(current, operation, 'edit')
      if (!acquired) return
      editLease = acquired.grant
      leaseView = acquired.view
      installItem(acquired.item, true, true)
      statusText = 'Editing'
    } catch (error) {
      if (canCommitToken(operation)) reportError(error)
    } finally {
      endOperation(operation)
    }
  }

  async function saveItem(): Promise<void> {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    if (!draft) { deny('no_library_draft'); return }
    const fields = cloneLibraryFields(draft)
    if (!fields.title.trim()) { errorText = 'library_title_required'; return }
    if (kind === 'macro-template') {
      const validation = parseAndValidateMacroDefinitionJson(fields.content)
      if (!validation.ok) {
        options.onValidationText(formatLibraryMacroValidation(validation))
        errorText = validation.error.code
        return
      }
    }
    const current = selectedItem
    const lease = editLease
    if (current && !lease) {
      deny(leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required')
      return
    }
    const operation = beginOperation()
    try {
      const outcome = await mutations.persist(
        kind,
        fields,
        current,
        lease,
        () => canCommitLibraryOperation(operation),
        (committed) => {
          if (committed.kind === 'published_save') {
            reconcilePublishedSave(operation, committed.item)
            return
          }
          editLease = committed.value.editLease
          leaseView = committed.value.leaseView
        },
      )
      if (outcome.kind !== 'persisted') return
      const persisted = outcome.value
      installItem(
        persisted.item,
        persisted.editing,
        true,
        persisted.preservePublishedCreateBuffer,
      )
      if (persisted.leaseWarning) {
        remoteNotice = persisted.leaseWarning
      }
      await reloadList(false, false)
      if (navigation.generation === operation.token) statusText = 'Saved'
    } catch (error) {
      if (canCommitToken(operation)) reportError(error, true)
    } finally {
      endOperation(operation)
    }
  }

  async function cancelEdit(): Promise<void> {
    if (operationPending) return
    if (publishedCreateBufferPreserved && selectedItem) {
      const expectedKind = selectedItem.kind
      const expectedItemId = selectedItem.itemId
      const operation = beginOperation(false)
      try {
        const latest = await mutations.read(expectedKind, expectedItemId)
        if (!canCommitToken(operation)
          || !publishedCreateBufferPreserved
          || selectedItem?.kind !== expectedKind
          || selectedItem.itemId !== expectedItemId) return
        installItem(latest)
        statusText = 'Local copy discarded; latest saved item loaded'
      } catch (error) {
        if (!canCommitToken(operation)
          || !publishedCreateBufferPreserved
          || selectedItem?.kind !== expectedKind
          || selectedItem.itemId !== expectedItemId) return
        if (requestStatus(error) === 404) {
          clearSelection('Local copy discarded; item removed elsewhere')
        } else {
          reportError(error)
        }
      } finally {
        endOperation(operation)
      }
      return
    }
    const saved = selectedItem ? cloneLibraryItem(selectedItem) : null
    const lease = editLease
    const cancelledDirtyDraft = dirty
    const operation = beginOperation(false)
    editLease = null
    leaseView = null
    leaseLost = false
    if (saved) installItem(saved)
    else clearSelection('Draft cancelled')
    statusText = saved && !cancelledDirtyDraft ? 'Done' : 'Cancelled'
    try {
      await mutations.releaseEditLease(lease)
    } finally {
      endOperation(operation)
    }
  }

  async function removeItem(): Promise<void> {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    const current = selectedItem
    if (!current) { deny('no_saved_library_item_selected'); return }
    if (!confirm(`Remove ${current.title}?`)) return
    const operation = beginOperation()
    let temporaryLease: ContentEditLeaseGrant | null = null
    try {
      let lease = editLease
      let record = current
      if (!lease) {
        const acquired = await acquireLease(current, operation, 'remove')
        if (!acquired) return
        lease = acquired.grant
        record = acquired.item
        temporaryLease = lease
      }
      await mutations.delete(record, lease)
      temporaryLease = null
      if (!canCommitToken(operation)) return
      editLease = null
      leaseView = null
      leaseLost = false
      clearSelection('Removed')
      await reloadList(false, false)
    } catch (error) {
      if (temporaryLease) {
        await mutations.discardTemporaryLease(temporaryLease)
      }
      if (canCommitToken(operation)) reportError(error)
    } finally {
      endOperation(operation)
    }
  }

  async function acquireLease(
    item: LibraryItem,
    operation: LibraryOperationSnapshot,
    intent: 'edit' | 'remove',
  ): Promise<Extract<LibraryFreshLeaseOutcome, { kind: 'acquired' }> | null> {
    const outcome = await mutations.acquireFreshLease(
      item,
      intent,
      () => canCommitToken(operation) && selectedItem?.itemId === item.itemId,
    )
    if (outcome.kind === 'declined') statusText = 'Item remains read-only'
    return outcome.kind === 'acquired' ? outcome : null
  }

  async function loadIntoMacro(): Promise<void> {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    const current = selectedItem
    if (!current || current.kind !== 'macro-template') {
      deny('no_saved_library_macro_selected')
      return
    }
    const operation = beginOperation()
    try {
      const result = await options.onLoadIntoMacro(current.itemId, current.revision)
      if (!canCommitToken(operation)) return
      statusText = result.selected
        ? `Created and selected ${result.recordId}`
        : `Created ${result.recordId}; current Macro draft was not switched`
    } catch (error) {
      if (canCommitToken(operation)) reportError(error, true)
    } finally {
      endOperation(operation)
    }
  }

  function updateDraft(field: keyof LibraryItemFields, value: string | string[]): void {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    if (!draft || !editing) return
    if (selectedItem && !editLease) {
      deny(leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required')
      return
    }
    draft = {
      ...draft,
      [field]: value,
      tags: field === 'tags' ? [...value as string[]] : [...draft.tags],
    }
    dirty = !selectedItem || !sameLibraryFields(draft, selectedItem)
    draftRevision += 1
    options.onValidationText(null)
  }

  function setTags(value: string): void {
    updateDraft('tags', value.split(',').map((tag) => tag.trim()).filter(Boolean))
  }

  function confirmDiscardCurrent(message: string): boolean {
    return !dirty || confirm(message)
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
      kind,
      selectedKey,
      selectedRevision: selectedItem?.revision ?? null,
      draft,
      draftRevision,
      editLeaseId: editLease?.editLeaseId ?? null,
    }
  }

  function currentOperationState(): CurrentLibraryOperationState {
    return {
      kind,
      selectedKey,
      selectedItem,
      draft,
      draftRevision,
      editLease,
      controlEpoch: options.roomClient()?.controlGrant?.controlEpoch ?? null,
    }
  }

  function canCommitToken(operation: LibraryOperationSnapshot): boolean {
    return navigation.isTokenCurrent(operation, options.roomClient()?.controlGrant?.controlEpoch ?? null)
  }

  function hasLocalOperationIdentity(operation: LibraryOperationSnapshot): boolean {
    return navigation.hasLocalIdentity(operation, currentOperationState())
  }

  function canCommitLibraryOperation(
    operation: LibraryOperationSnapshot,
    allowReleasedLease = false,
  ): boolean {
    return navigation.canCommit(operation, currentOperationState(), allowReleasedLease)
  }

  function canCommitNavigation(operation: LibraryOperationSnapshot): boolean {
    return canCommitLibraryOperation(operation, true)
  }

  function endOperation(operation: LibraryOperationSnapshot): void {
    if (!navigation.end(operation)) return
    remoteSync.operationEnded()
  }

  async function releaseNavigationLease(operation: LibraryOperationSnapshot): Promise<boolean> {
    const lease = editLease
    await mutations.releaseEditLease(lease)
    if (!canCommitNavigation(operation)) return false
    editLease = null
    leaseView = null
    leaseLost = false
    return true
  }

  function reconcilePublishedSave(operation: LibraryOperationSnapshot, saved: LibraryItem): void {
    if (!hasLocalOperationIdentity(operation)) return
    const savedKey = saved.kind + ':' + saved.itemId
    if (operation.selectedKey) {
      if (savedKey !== operation.selectedKey
        || operation.selectedRevision === null
        || saved.revision !== operation.selectedRevision + 1) return
    } else if (saved.kind !== operation.kind || saved.revision !== 1) return
    const relevantLeaseView = operation.editLeaseId !== null && leaseLost ? leaseView : null
    installItem(saved, false, false, operation.selectedKey === '')
    editLease = null
    leaseView = relevantLeaseView
    leaseLost = operation.editLeaseId !== null
    remoteNotice = operation.editLeaseId === null
      ? 'The item was saved, but this device no longer controls the operation. It remains read-only.'
      : 'The item was saved, but its edit lease moved elsewhere. Reopen Edit before making more changes.'
    statusText = 'Saved read-only'
  }

  async function releaseEditLease(): Promise<void> {
    const lease = editLease
    editLease = null
    leaseView = null
    leaseLost = false
    await mutations.releaseEditLease(lease)
  }

  function installItem(
    item: LibraryItem,
    asEditing = false,
    preserveLeaseState = false,
    preservePublishedCreateBuffer = false,
  ): void {
    selectedItem = cloneLibraryItem(item)
    draft = cloneLibraryFields(item)
    editing = asEditing
    if (!preserveLeaseState) {
      editLease = null
      leaseView = null
    }
    leaseLost = false
    publishedCreateBufferPreserved = preservePublishedCreateBuffer
    dirty = false
    draftRevision += 1
    errorText = null
    remoteNotice = null
    options.onValidationText(null)
  }

  function clearSelection(status: string): void {
    selectedItem = null
    draft = null
    editing = false
    editLease = null
    leaseView = null
    leaseLost = false
    publishedCreateBufferPreserved = false
    dirty = false
    draftRevision += 1
    options.onValidationText(null)
    remoteNotice = null
    statusText = status
  }

  function markEditLeaseLost(view: ContentEditLeaseView | null, notice: string): void {
    editLease = null
    leaseView = view
    editing = false
    leaseLost = true
    remoteNotice = notice
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
    get kind() { return kind },
    get searchText() { return searchText },
    get items() { return items },
    get selectedItem() { return selectedItem },
    get selectedKey() { return selectedKey },
    get draft() { return draft },
    get editing() { return editing },
    get editLease() { return editLease },
    get leaseView() { return leaseView },
    get leaseLost() { return leaseLost },
    get publishedCreateBufferPreserved() { return publishedCreateBufferPreserved },
    get dirty() { return dirty },
    get operationPending() { return operationPending },
    get statusText() { return statusText },
    get errorText() { return errorText },
    get listProblem() { return listProblem },
    get remoteNotice() { return remoteNotice },
    mount,
    changeKind,
    updateSearch,
    selectByKey,
    newItem,
    beginEdit,
    saveItem,
    cancelEdit,
    removeItem,
    refreshLibrary,
    loadIntoMacro,
    updateDraft,
    setTags,
    deny,
    setErrorText: (value: string | null) => { errorText = value },
  }
}

export type LibrarySession = ReturnType<typeof createLibrarySession>

export function formatLibraryRequestError(error: unknown): string {
  const response = error instanceof Error && 'response' in error
    ? (error as Error & { response?: Record<string, unknown> }).response
    : undefined
  if (Array.isArray(response?.issues)) {
    return (response.issues as Array<{ path: string; code?: string; message: string }>)
      .map((issue) => `${issue.path || '<root>'}: ${issue.code ? issue.code + ': ' : ''}${issue.message}`)
      .join('\n')
  }
  if (response?.error === 'invalid_json') {
    return `invalid_json at ${response.line}:${response.column} (offset ${response.offset}): ${response.message}`
  }
  return messageOf(error)
}

export function formatLibraryMacroValidation(
  result: Exclude<ReturnType<typeof parseAndValidateMacroDefinitionJson>, { ok: true }>,
): string {
  return result.error.code === 'invalid_json'
    ? `invalid_json at ${result.error.line}:${result.error.column} (offset ${result.error.offset}): ${result.error.message}`
    : result.error.issues.map((issue) => `${issue.path || '<root>'}: ${issue.code}: ${issue.message}`).join('\n')
}

export function cloneLibraryFields(item: LibraryItemFields): LibraryItemFields {
  return {
    title: item.title,
    content: item.content,
    description: item.description,
    tags: [...item.tags],
  }
}

export function cloneLibraryItem(item: LibraryItem): LibraryItem {
  return {
    schemaVersion: item.schemaVersion,
    itemId: item.itemId,
    kind: item.kind,
    revision: item.revision,
    ...cloneLibraryFields(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

export function sameLibraryFields(left: LibraryItemFields, right: LibraryItemFields): boolean {
  return left.title === right.title
    && left.content === right.content
    && left.description === right.description
    && JSON.stringify(left.tags) === JSON.stringify(right.tags)
}

export function libraryTabKind(tab: LibraryTab): LibraryItemKind {
  return tab === 'json-template' ? 'macro-template' : tab
}

export function libraryKindTab(value: LibraryItemKind): LibraryTab {
  return value === 'macro-template' ? 'json-template' : value
}

export function libraryKindLabel(value: LibraryItemKind): string {
  return value === 'macro-template' ? 'Macro JSON' : value === 'prompt' ? 'Prompt' : 'Note'
}

function emptyMacroJson(): string {
  return JSON.stringify({
    schemaVersion: 5,
    name: 'Library Macro',
    description: '',
    terminalLayout: [],
    body: [],
  }, null, 2)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requestStatus(error: unknown): number | null {
  return error instanceof Error && 'status' in error
    && typeof (error as Error & { status?: unknown }).status === 'number'
    ? (error as Error & { status: number }).status
    : null
}
