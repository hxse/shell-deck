<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
  import type { ContentEditLeaseChangedMessage, ContentRecordChangedMessage } from '../protocol'
  import type { TerminalRoomClient } from '../terminalRoomClient'
  import { LibraryClient } from '../library/libraryClient'
  import type { LibraryItem, LibraryItemFields, LibraryItemKind, LibraryItemSummary } from '../library/libraryTypes'
  import { parseAndValidateMacroDefinitionJson, validateRunnableMacroDefinitionV4 } from '../macro/macroDefinitionValidation'
  import LineNumberedTextarea from './macro/LineNumberedTextarea.svelte'

  type LibraryTab = 'json-template' | 'prompt' | 'note'
  type LoadResult = { selected: boolean; recordId: string }
  type RefreshOutcome = 'applied' | 'stale' | 'retry'
  type LibraryListRefreshResult = { outcome: RefreshOutcome; records?: LibraryItemSummary[] }
  type SequencedContentRecordChange = ContentRecordChangedMessage & { sequence: number }
  type LibraryOperationSnapshot = {
    token: number
    kind: LibraryItemKind
    selectedKey: string
    selectedRevision: number | null
    draft: LibraryItemFields | null
    draftRevision: number
    editLeaseId: string | null
  }

  let {
    roomClient,
    canMutateShared,
    selectedTab,
    filter,
    contentRecordChanges,
    contentLeaseChanges,
    connectionGeneration,
    onPreferenceChange,
    onDirtyChange,
    onLoadIntoMacro,
    onMutationDenied,
    onResetWidth,
  } = $props<{
    roomClient: TerminalRoomClient | null
    canMutateShared: boolean
    selectedTab: LibraryTab
    filter: string
    contentRecordChanges: Array<ContentRecordChangedMessage & { sequence: number }>
    contentLeaseChanges: Array<ContentEditLeaseChangedMessage & { sequence: number }>
    connectionGeneration: number
    onPreferenceChange: (selectedTab: LibraryTab, filter: string) => void
    onDirtyChange: (dirty: boolean) => void
    onLoadIntoMacro: (itemId: string, expectedRevision: number) => Promise<LoadResult>
    onMutationDenied: (reason: string) => void
    onResetWidth?: () => void
  }>()

  const api = new LibraryClient(() => roomClient?.controlGrant ?? null)
  let kind = $state<LibraryItemKind>(untrack(() => tabKind(selectedTab)))
  let searchText = $state(untrack(() => filter))
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
  let operationGeneration = $state(0)
  let operationControlEpoch = $state<number | null>(null)
  let operationPending = $state(false)
  let listGeneration = 0
  let selectedReadGeneration = 0
  let reconciledConnectionGeneration = 0
  let contentRetryAttempt = 0
  let contentRetryTimer: ReturnType<typeof setTimeout> | null = null
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let observedContentSequence = 0
  let handledLeaseSequence = 0
  let contentChangeProcessing = Promise.resolve()
  let pendingLibraryRecordChanges: SequencedContentRecordChange[] = []
  let statusText = $state('Library')
  let errorText = $state<string | null>(null)
  let remoteNotice = $state<string | null>(null)
  let validationText = $state<string | null>(null)
  let copyLabel = $state('Copy')

  const selectedKey = $derived(selectedItem ? selectedItem.kind + ':' + selectedItem.itemId : '')
  const editorReadOnly = $derived(!editing || operationPending || !canMutateShared || (selectedItem !== null && editLease === null))

  onMount(() => {
    void refreshLibrary(true, connectionGeneration)
    const focus = () => {
      resetContentRetry()
      void refreshLibrary(false, connectionGeneration)
      scheduleLibraryRecordChangeDrain()
    }
    window.addEventListener('focus', focus)
    return () => {
      window.removeEventListener('focus', focus)
      if (searchTimer) clearTimeout(searchTimer)
      if (contentRetryTimer) clearTimeout(contentRetryTimer)
      void releaseEditLease()
    }
  })

  $effect(() => {
    const generation = connectionGeneration
    if (generation <= 0 || generation === reconciledConnectionGeneration) return
    reconciledConnectionGeneration = generation
    resetContentRetry()
    void refreshLibrary(false, generation)
    scheduleLibraryRecordChangeDrain()
  })

  $effect(() => { onDirtyChange(dirty || publishedCreateBufferPreserved) })

  $effect(() => {
    if (canMutateShared || !editLease) return
    markEditLeaseLost(null, 'Room control moved elsewhere. The local draft remains here; take control and reopen Edit before saving.')
  })

  $effect(() => {
    const changes = contentRecordChanges.filter((change: SequencedContentRecordChange) => change.sequence > observedContentSequence)
    if (changes.length === 0) return
    observedContentSequence = changes.at(-1)!.sequence
    const relevant = changes.filter((change: SequencedContentRecordChange) => change.resourceKey.kind === 'library')
    if (relevant.length > 0) {
      resetContentRetry()
      pendingLibraryRecordChanges.push(...relevant)
      scheduleLibraryRecordChangeDrain()
    }
  })

  $effect(() => {
    const changes = contentLeaseChanges.filter((change: ContentEditLeaseChangedMessage & { sequence: number }) => change.sequence > handledLeaseSequence)
    if (changes.length === 0) return
    handledLeaseSequence = changes.at(-1)!.sequence
    const current = selectedItem
    const lease = editLease
    if (!current || !lease) return
    const relevant = changes.filter((change: ContentEditLeaseChangedMessage & { sequence: number }) => change.resourceKey.kind === 'library'
      && change.resourceKey.itemKind === current.kind && change.resourceKey.itemId === current.itemId).at(-1)
    if (!relevant) return
    if (relevant.view.mode === 'held' && relevant.view.leaseEpoch === lease.leaseEpoch) {
      leaseView = relevant.view
      return
    }
    markEditLeaseLost(relevant.view, 'This edit lease moved elsewhere. The local draft was kept, but it cannot be saved until Edit is reopened.')
  })

  async function changeKind(next: LibraryItemKind) {
    if (next === kind) return
    if (operationPending) { deny('operation_pending'); return }
    if (!confirmDiscardCurrent('Switch Library tab and discard the current draft?')) return
    const operation = beginNavigationOperation(false)
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
      validationText = null
      errorText = null
      remoteNotice = null
      onPreferenceChange(kindTab(next), searchText)
      await reloadList(true, false)
      if (canCommit(operation.token) && kind === next && draft === null) statusText = `${items.length} ${kindLabel(kind)} items`
    } catch (error) {
      if (canCommit(operation.token)) reportError(error)
    } finally { endOperation(operation.token) }
  }

  function updateSearch(value: string) {
    searchText = value
    onPreferenceChange(kindTab(kind), value)
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { searchTimer = null; void reloadList(false) }, 180)
  }

  async function reloadList(report: boolean, announce = true): Promise<LibraryListRefreshResult> {
    const generation = ++listGeneration
    const requestedKind = kind
    const requestedSearch = searchText
    try {
      const next = await api.list(requestedKind, requestedSearch)
      if (generation !== listGeneration || kind !== requestedKind || searchText !== requestedSearch) return { outcome: 'stale' }
      items = next
      if (announce && !dirty && !editing && !operationPending) statusText = `${next.length} ${kindLabel(kind)} items`
      if (selectedItem && !next.some((item) => item.itemId === selectedItem?.itemId)) {
        if (dirty || editing || editLease || leaseLost || publishedCreateBufferPreserved || operationPending) remoteNotice = 'The selected item is no longer in the current saved result. The local draft was kept.'
        else clearSelection('Item unavailable')
      }
      return { outcome: 'applied', records: next }
    } catch (error) {
      if (generation !== listGeneration || kind !== requestedKind || searchText !== requestedSearch) return { outcome: 'stale' }
      if (report) reportError(error)
      return { outcome: 'retry' }
    }
  }

  async function refreshLibrary(report = true, expectedConnectionGeneration = connectionGeneration) {
    const resolvesPublishedCreateBuffer = report && publishedCreateBufferPreserved
    const refreshed = await reloadList(report)
    if (refreshed.outcome !== 'applied') {
      if (refreshed.outcome === 'retry' && !report) scheduleContentRetry()
      return refreshed.outcome
    }
    if (expectedConnectionGeneration > 0 && expectedConnectionGeneration !== connectionGeneration) return 'stale'
    const current = selectedItem
    if (!current) return 'applied'
    const summary = refreshed.records?.find((item) => item.kind === current.kind && item.itemId === current.itemId)
    const protectedBuffer = dirty || editing || editLease !== null || leaseLost || publishedCreateBufferPreserved
    if (protectedBuffer && !resolvesPublishedCreateBuffer) {
      if (!summary) remoteNotice = 'The selected item is no longer in the current saved result. The local draft was kept.'
      else if (summary.revision > current.revision) remoteNotice = 'This saved item changed elsewhere. The local draft was kept.'
      return 'applied'
    }
    if (operationPending) return 'stale'
    const readGeneration = ++selectedReadGeneration
    const capturedDraft = draft
    const capturedDraftRevision = draftRevision
    const capturedRevision = current.revision
    try {
      const next = await api.read(current.kind, current.itemId)
      if (readGeneration !== selectedReadGeneration) return 'stale'
      if (expectedConnectionGeneration > 0 && expectedConnectionGeneration !== connectionGeneration) return 'stale'
      if (!resolvesPublishedCreateBuffer && !cleanReadonlyLibrarySelectionMatches(current, capturedRevision, capturedDraft, capturedDraftRevision)) return 'stale'
      if (resolvesPublishedCreateBuffer && (!publishedCreateBufferPreserved || selectedItem?.kind !== current.kind || selectedItem.itemId !== current.itemId)) return 'stale'
      if (next.revision < Math.max(capturedRevision, summary?.revision ?? capturedRevision)) return 'stale'
      installItem(next)
      return 'applied'
    } catch (error) {
      if (readGeneration !== selectedReadGeneration) return 'stale'
      if ((resolvesPublishedCreateBuffer || !protectedBuffer) && selectedItem?.kind === current.kind && selectedItem.itemId === current.itemId && requestStatus(error) === 404) {
        clearSelection('Item removed elsewhere')
        return 'applied'
      }
      if (report) reportError(error)
      else scheduleContentRetry()
      return 'retry'
    }
  }

  async function selectByKey(key: string) {
    if (operationPending) { deny('operation_pending'); return }
    const summary = items.find((item) => item.kind + ':' + item.itemId === key)
    if (!summary || summary.itemId === selectedItem?.itemId) return
    if (!confirmDiscardCurrent('Discard the current Library draft?')) return
    const operation = beginNavigationOperation(false)
    try {
      if (!await releaseNavigationLease(operation)) return
      if (!canCommitNavigation(operation)) return
      const item = await api.read(summary.kind, summary.itemId)
      if (!canCommitNavigation(operation) || item.kind !== kind) return
      installItem(item)
      statusText = 'Item loaded'
    } catch (error) { if (canCommit(operation.token)) reportError(error) }
    finally { endOperation(operation.token) }
  }

  async function newItem() {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    if (!confirmDiscardCurrent('Discard the current Library draft?')) return
    const operation = beginNavigationOperation()
    try {
      if (!await releaseNavigationLease(operation)) return
      if (!canCommitNavigation(operation)) return
      selectedItem = null
      draft = { title: `New ${kindLabel(kind)}`, content: kind === 'macro-template' ? emptyMacroJson() : '', description: '', tags: [] }
      editing = true
      leaseLost = false
      publishedCreateBufferPreserved = false
      dirty = true
      draftRevision += 1
      validationText = null
      errorText = null
      remoteNotice = null
      statusText = 'Unsaved new item'
    } catch (error) {
      if (canCommit(operation.token)) reportError(error)
    } finally { endOperation(operation.token) }
  }

  async function beginEdit() {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    const current = selectedItem
    if (!current) { deny('no_saved_library_item_selected'); return }
    if (dirty && !confirm('Reopen Edit and replace the local draft with the latest saved item?')) return
    const token = beginOperation()
    try {
      const acquired = await acquireLease(current, token, 'edit')
      if (!acquired) return
      editLease = acquired.grant
      leaseView = acquired.view
      installItem(acquired.item, true, true)
      statusText = 'Editing'
    } catch (error) { if (canCommit(token)) reportError(error) }
    finally { endOperation(token) }
  }

  async function saveItem() {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    if (!draft) { deny('no_library_draft'); return }
    const fields = cloneFields(draft)
    if (!fields.title.trim()) { errorText = 'library_title_required'; return }
    if (kind === 'macro-template') {
      const validation = parseAndValidateMacroDefinitionJson(fields.content)
      if (!validation.ok) { validationText = formatMacroValidation(validation); errorText = validation.error.code; return }
    }
    const current = selectedItem
    const lease = editLease
    if (current && !lease) { deny(leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required'); return }
    const operation = beginLibraryOperation()
    try {
      const updateResult = current
        ? lease ? await api.update(current, fields, lease) : (() => { throw new Error('content_edit_lease_required') })()
        : null
      const saved = updateResult?.item ?? await api.create(kind, fields)
      if (!canCommitLibraryOperation(operation)) {
        reconcilePublishedSave(operation, saved)
        return
      }
      let continueEditing = false
      let leaseWarning: string | null = null
      if (current) {
        if (!lease) throw new Error('content_edit_lease_required')
        if (updateResult?.leaseOutcome.status === 'retained') {
          editLease = updateResult.leaseOutcome.grant
          leaseView = {
            mode: 'held',
            leaseEpoch: updateResult.leaseOutcome.grant.leaseEpoch,
            expiresAt: updateResult.leaseOutcome.grant.expiresAt,
          }
          continueEditing = true
        } else {
          editLease = null
          leaseView = null
          leaseWarning = updateResult?.leaseOutcome.status === 'lost'
            ? updateResult.leaseOutcome.reason
            : 'content_edit_lease_lost'
        }
      } else {
        const acquired = await acquireCreatedItemLease(saved, operation)
        if (acquired === null) {
          reconcilePublishedSave(operation, saved)
          return
        }
        continueEditing = acquired.ok
        if (!acquired.ok) leaseWarning = `library_saved_but_edit_lease_not_retained:${acquired.reason}`
      }
      installItem(saved, continueEditing, true, !current && !continueEditing)
      if (leaseWarning) remoteNotice = leaseWarning
      await reloadList(false, false)
      if (operationGeneration === operation.token) statusText = 'Saved'
    } catch (error) { if (canCommit(operation.token)) reportError(error, true) }
    finally { endOperation(operation.token) }
  }

  async function cancelEdit() {
    if (operationPending) return
    if (publishedCreateBufferPreserved && selectedItem) {
      const expectedKind = selectedItem.kind
      const expectedItemId = selectedItem.itemId
      const token = beginOperation(false)
      try {
        const latest = await api.read(expectedKind, expectedItemId)
        if (!canCommit(token) || !publishedCreateBufferPreserved
          || selectedItem?.kind !== expectedKind || selectedItem.itemId !== expectedItemId) return
        installItem(latest)
        statusText = 'Local copy discarded; latest saved item loaded'
      } catch (error) {
        if (!canCommit(token) || !publishedCreateBufferPreserved
          || selectedItem?.kind !== expectedKind || selectedItem.itemId !== expectedItemId) return
        if (requestStatus(error) === 404) clearSelection('Local copy discarded; item removed elsewhere')
        else reportError(error)
      } finally { endOperation(token) }
      return
    }
    const saved = selectedItem ? cloneItem(selectedItem) : null
    const lease = editLease
    const cancelledDirtyDraft = dirty
    const token = beginOperation(false)
    editLease = null
    leaseView = null
    leaseLost = false
    if (saved) installItem(saved)
    else clearSelection('Draft cancelled')
    statusText = saved && !cancelledDirtyDraft ? 'Done' : 'Cancelled'
    try {
      if (lease && roomClient?.canMutateShared) await roomClient.releaseContentEditLease(lease.editLeaseId).catch(() => {})
    } finally { endOperation(token) }
  }

  async function removeItem() {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    const current = selectedItem
    if (!current) { deny('no_saved_library_item_selected'); return }
    if (!confirm(`Remove ${current.title}?`)) return
    const token = beginOperation()
    let temporaryLease: ContentEditLeaseGrant | null = null
    try {
      let lease = editLease
      let record = current
      if (!lease) {
        const acquired = await acquireLease(current, token, 'remove')
        if (!acquired) return
        lease = acquired.grant
        record = acquired.item
        temporaryLease = lease
      }
      await api.delete(record, lease)
      temporaryLease = null
      if (!canCommit(token)) return
      editLease = null
      leaseView = null
      leaseLost = false
      clearSelection('Removed')
      await reloadList(false, false)
    } catch (error) {
      if (temporaryLease) await roomClient?.releaseContentEditLease(temporaryLease.editLeaseId).catch(() => {})
      if (canCommit(token)) reportError(error)
    } finally { endOperation(token) }
  }

  async function acquireLease(item: LibraryItem, token: number, intent: 'edit' | 'remove'): Promise<{ item: LibraryItem; grant: ContentEditLeaseGrant; view: ContentEditLeaseView } | null> {
    if (!roomClient || selectedItem?.itemId !== item.itemId) return null
    const key = { kind: 'library' as const, itemKind: item.kind, itemId: item.itemId }
    const view = await roomClient.contentEditLeaseView(key)
    if (!canCommit(token) || selectedItem?.itemId !== item.itemId) return null
    let result: { view: ContentEditLeaseView; grant: ContentEditLeaseGrant }
    if (view.mode === 'held') {
      if (!confirm(`This Library item is being edited elsewhere. Take over its edit lease${intent === 'remove' ? ' to remove it' : ''}?`)) {
        statusText = 'Item remains read-only'
        return null
      }
      result = await roomClient.takeOverContentEditLease(key, view.leaseEpoch)
    } else result = await roomClient.acquireContentEditLease(key, view.leaseEpoch)
    try {
      if (!canCommit(token) || selectedItem?.itemId !== item.itemId) {
        await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
        return null
      }
      const latest = await api.read(item.kind, item.itemId)
      if (!canCommit(token) || selectedItem?.itemId !== item.itemId) {
        await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
        return null
      }
      return { item: latest, grant: result.grant, view: result.view }
    } catch (error) {
      await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
      throw error
    }
  }

  async function acquireCreatedItemLease(item: LibraryItem, operation: LibraryOperationSnapshot): Promise<{ ok: true } | { ok: false; reason: string } | null> {
    if (!roomClient || !canCommitLibraryOperation(operation)) return null
    const key = { kind: 'library' as const, itemKind: item.kind, itemId: item.itemId }
    try {
      const view = await roomClient.contentEditLeaseView(key)
      if (!canCommitLibraryOperation(operation)) return null
      if (view.mode !== 'available') {
        leaseView = view
        return { ok: false, reason: 'content_edit_lease_held' }
      }
      const acquired = await roomClient.acquireContentEditLease(key, view.leaseEpoch)
      if (!canCommitLibraryOperation(operation)) {
        await roomClient.releaseContentEditLease(acquired.grant.editLeaseId).catch(() => {})
        return null
      }
      editLease = acquired.grant
      leaseView = acquired.view
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }

  async function copyContent() {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(draft.content)
      copyLabel = 'Copied'
      errorText = null
      window.setTimeout(() => { copyLabel = 'Copy' }, 900)
    } catch {
      copyLabel = 'Copy'
      errorText = 'clipboard_write_failed'
      onMutationDenied('clipboard_write_failed')
    }
  }

  function validateMacro() {
    if (!draft || kind !== 'macro-template') return
    const result = parseAndValidateMacroDefinitionJson(draft.content)
    if (result.ok) {
      const runnable = validateRunnableMacroDefinitionV4(result.value)
      const unassigned = runnable.ok ? [] : runnable.issues.filter((issue) => issue.code === 'unassigned_terminal_reference' || issue.code === 'unassigned_artifact_reference')
      validationText = unassigned.length > 0
        ? `Valid MacroDefinitionV4 · ${unassigned.length} unassigned reference${unassigned.length === 1 ? '' : 's'} (not runnable)\n${unassigned.map((issue) => issue.path).join('\n')}`
        : 'Valid MacroDefinitionV4 · runnable'
    } else validationText = formatMacroValidation(result)
    errorText = result.ok ? null : result.error.code
  }

  async function loadIntoMacro() {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    const current = selectedItem
    if (!current || current.kind !== 'macro-template') { deny('no_saved_library_macro_selected'); return }
    const token = beginOperation()
    try {
      const result = await onLoadIntoMacro(current.itemId, current.revision)
      if (!canCommit(token)) return
      statusText = result.selected ? `Created and selected ${result.recordId}` : `Created ${result.recordId}; current Macro draft was not switched`
    } catch (error) { if (canCommit(token)) reportError(error, true) }
    finally { endOperation(token) }
  }

  function updateDraft(field: keyof LibraryItemFields, value: string | string[]) {
    if (!requireNoPendingOperation()) return
    if (!requireSharedMutation()) return
    if (!draft || !editing) return
    if (selectedItem && !editLease) { deny(leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required'); return }
    draft = { ...draft, [field]: value, tags: field === 'tags' ? [...value as string[]] : [...draft.tags] }
    dirty = !selectedItem || !sameFields(draft, selectedItem)
    draftRevision += 1
    validationText = null
  }

  function setTags(value: string) {
    updateDraft('tags', value.split(',').map((tag) => tag.trim()).filter(Boolean))
  }

  function confirmDiscardCurrent(message: string): boolean {
    return !dirty || confirm(message)
  }

  function beginLibraryOperation(requireController = true): LibraryOperationSnapshot {
    return {
      token: beginOperation(requireController),
      kind,
      selectedKey,
      selectedRevision: selectedItem?.revision ?? null,
      draft,
      draftRevision,
      editLeaseId: editLease?.editLeaseId ?? null,
    }
  }

  function beginNavigationOperation(requireController = true): LibraryOperationSnapshot {
    return beginLibraryOperation(requireController)
  }

  function hasLocalOperationIdentity(operation: LibraryOperationSnapshot): boolean {
    return operationGeneration === operation.token
      && kind === operation.kind
      && selectedKey === operation.selectedKey
      && (selectedItem?.revision ?? null) === operation.selectedRevision
      && draft === operation.draft
      && draftRevision === operation.draftRevision
  }

  function canCommitLibraryOperation(operation: LibraryOperationSnapshot, allowReleasedLease = false): boolean {
    if (!hasLocalOperationIdentity(operation)) return false
    if (operationControlEpoch !== null && roomClient?.controlGrant?.controlEpoch !== operationControlEpoch) return false
    const currentLeaseId = editLease?.editLeaseId ?? null
    if (currentLeaseId === operation.editLeaseId) return true
    return allowReleasedLease && operation.editLeaseId !== null && currentLeaseId === null
  }

  function canCommitNavigation(operation: LibraryOperationSnapshot): boolean {
    return canCommitLibraryOperation(operation, true)
  }

  async function releaseNavigationLease(operation: LibraryOperationSnapshot): Promise<boolean> {
    const lease = editLease
    if (lease && roomClient?.canMutateShared) await roomClient.releaseContentEditLease(lease.editLeaseId).catch(() => {})
    if (!canCommitNavigation(operation)) return false
    editLease = null
    leaseView = null
    leaseLost = false
    return true
  }

  function reconcilePublishedSave(operation: LibraryOperationSnapshot, saved: LibraryItem) {
    if (!hasLocalOperationIdentity(operation)) return
    const savedKey = saved.kind + ':' + saved.itemId
    if (operation.selectedKey) {
      if (savedKey !== operation.selectedKey || operation.selectedRevision === null || saved.revision !== operation.selectedRevision + 1) return
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

  async function releaseEditLease() {
    const lease = editLease
    editLease = null
    leaseView = null
    leaseLost = false
    if (lease && roomClient?.canMutateShared) await roomClient.releaseContentEditLease(lease.editLeaseId).catch(() => {})
  }

  function scheduleLibraryRecordChangeDrain() {
    contentChangeProcessing = contentChangeProcessing
      .then(async () => { await drainLibraryRecordChanges() })
      .catch((error) => { errorText = messageOf(error) })
  }

  function resetContentRetry() {
    contentRetryAttempt = 0
    if (contentRetryTimer) clearTimeout(contentRetryTimer)
    contentRetryTimer = null
  }

  function scheduleContentRetry() {
    if (contentRetryTimer || contentRetryAttempt >= 3) return
    const delays = [100, 300, 800]
    const delay = delays[contentRetryAttempt++] ?? 800
    contentRetryTimer = setTimeout(() => {
      contentRetryTimer = null
      void refreshLibrary(false, connectionGeneration)
      scheduleLibraryRecordChangeDrain()
    }, delay)
  }

  function hasProtectedLibraryBuffer(): boolean {
    return dirty || editing || editLease !== null || leaseLost || publishedCreateBufferPreserved
  }

  function cleanReadonlyLibrarySelectionMatches(
    item: LibraryItem,
    revision: number,
    capturedDraft: LibraryItemFields | null,
    capturedDraftRevision: number,
  ): boolean {
    return selectedItem?.kind === item.kind
      && selectedItem.itemId === item.itemId
      && selectedItem.revision === revision
      && draft === capturedDraft
      && draftRevision === capturedDraftRevision
      && !operationPending
      && !hasProtectedLibraryBuffer()
  }

  async function drainLibraryRecordChanges() {
    while (!operationPending && pendingLibraryRecordChanges.length > 0) {
      const batch = pendingLibraryRecordChanges.slice()
      const consumed = await handleRemoteContent(batch)
      if (!consumed) { scheduleContentRetry(); return }
      const lastSequence = batch.at(-1)!.sequence
      pendingLibraryRecordChanges = pendingLibraryRecordChanges.filter((change) => change.sequence > lastSequence)
      resetContentRetry()
    }
  }

  async function handleRemoteContent(changes: SequencedContentRecordChange[]): Promise<boolean> {
    if (operationPending) return false
    const refreshed = await reloadList(false, false)
    if (refreshed.outcome !== 'applied' || operationPending) return false
    const current = selectedItem
    if (!current) return true
    const relevant = changes.filter((change) => change.resourceKey.kind === 'library'
      && change.resourceKey.itemKind === current.kind && change.resourceKey.itemId === current.itemId).at(-1)
    if (!relevant) return true
    if (relevant.operation === 'saved' && relevant.revision !== null && relevant.revision <= current.revision) return true
    if (hasProtectedLibraryBuffer()) {
      remoteNotice = relevant.operation === 'deleted' ? 'This saved item was removed elsewhere. The local draft was kept.' : 'This saved item changed elsewhere. The local draft was kept.'
      return true
    }
    if (relevant.operation === 'deleted') clearSelection('Item removed elsewhere')
    else {
      const expectedRevision = current.revision
      const capturedDraft = draft
      const capturedDraftRevision = draftRevision
      const requiredRevision = relevant.revision ?? expectedRevision
      const readGeneration = ++selectedReadGeneration
      try {
        const item = await api.read(current.kind, current.itemId)
        if (readGeneration !== selectedReadGeneration) return false
        if (!cleanReadonlyLibrarySelectionMatches(current, expectedRevision, capturedDraft, capturedDraftRevision)) return false
        if (item.revision < Math.max(expectedRevision, requiredRevision)) return false
        installItem(item)
      } catch (error) {
        if (readGeneration !== selectedReadGeneration) return false
        if (requestStatus(error) === 404 && selectedItem?.kind === current.kind && selectedItem.itemId === current.itemId) {
          clearSelection('Item removed elsewhere')
          return true
        }
        errorText = messageOf(error)
        return false
      }
    }
    return true
  }

  function installItem(item: LibraryItem, asEditing = false, preserveLeaseState = false, preservePublishedCreateBuffer = false) {
    selectedItem = cloneItem(item)
    draft = cloneFields(item)
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
    validationText = null
  }

  function clearSelection(status: string) {
    selectedItem = null
    draft = null
    editing = false
    editLease = null
    leaseView = null
    leaseLost = false
    publishedCreateBufferPreserved = false
    dirty = false
    draftRevision += 1
    validationText = null
    remoteNotice = null
    statusText = status
  }

  function markEditLeaseLost(view: ContentEditLeaseView | null, notice: string) {
    editLease = null
    leaseView = view
    editing = false
    leaseLost = true
    remoteNotice = notice
  }

  function beginOperation(requireController = true): number {
    operationGeneration += 1
    operationControlEpoch = requireController ? roomClient?.controlGrant?.controlEpoch ?? null : null
    operationPending = true
    errorText = null
    return operationGeneration
  }

  function endOperation(token: number) {
    if (operationGeneration !== token) return
    operationPending = false
    scheduleLibraryRecordChangeDrain()
  }

  function canCommit(token: number, expectedDraftRevision?: number): boolean {
    if (operationGeneration !== token) return false
    if (expectedDraftRevision !== undefined && draftRevision !== expectedDraftRevision) return false
    if (operationControlEpoch !== null && roomClient?.controlGrant?.controlEpoch !== operationControlEpoch) return false
    return true
  }

  function requireSharedMutation(): boolean {
    if (!roomClient) { deny('room_disconnected'); return false }
    if (!canMutateShared) { deny('room_control_required'); return false }
    return true
  }

  function requireNoPendingOperation(): boolean {
    if (!operationPending) return true
    deny('operation_pending')
    return false
  }

  function deny(reason: string) { errorText = reason; onMutationDenied(reason) }

  function reportError(error: unknown, formatted = false) {
    const reason = messageOf(error)
    errorText = formatted ? formatRequestError(error) : reason
    onMutationDenied(reason)
  }

  function formatRequestError(error: unknown): string {
    const response = error instanceof Error && 'response' in error ? (error as Error & { response?: Record<string, unknown> }).response : undefined
    if (Array.isArray(response?.issues)) return (response.issues as Array<{ path: string; code?: string; message: string }>).map((issue) => `${issue.path || '<root>'}: ${issue.code ? issue.code + ': ' : ''}${issue.message}`).join('\n')
    if (response?.error === 'invalid_json') return `invalid_json at ${response.line}:${response.column} (offset ${response.offset}): ${response.message}`
    return messageOf(error)
  }

  function formatMacroValidation(result: Exclude<ReturnType<typeof parseAndValidateMacroDefinitionJson>, { ok: true }>): string {
    return result.error.code === 'invalid_json'
      ? `invalid_json at ${result.error.line}:${result.error.column} (offset ${result.error.offset}): ${result.error.message}`
      : result.error.issues.map((issue) => `${issue.path || '<root>'}: ${issue.code}: ${issue.message}`).join('\n')
  }

  function cloneFields(item: LibraryItemFields): LibraryItemFields {
    return { title: item.title, content: item.content, description: item.description, tags: [...item.tags] }
  }

  function cloneItem(item: LibraryItem): LibraryItem {
    return {
      schemaVersion: item.schemaVersion,
      itemId: item.itemId,
      kind: item.kind,
      revision: item.revision,
      ...cloneFields(item),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }
  }

  function sameFields(left: LibraryItemFields, right: LibraryItemFields): boolean {
    return left.title === right.title && left.content === right.content && left.description === right.description && JSON.stringify(left.tags) === JSON.stringify(right.tags)
  }

  function emptyMacroJson(): string {
    return JSON.stringify({ schemaVersion: 4, name: 'Library Macro', description: '', terminalLayout: [], body: [] }, null, 2)
  }

  function tabKind(tab: LibraryTab): LibraryItemKind { return tab === 'json-template' ? 'macro-template' : tab }
  function kindTab(value: LibraryItemKind): LibraryTab { return value === 'macro-template' ? 'json-template' : value }
  function kindLabel(value: LibraryItemKind): string { return value === 'macro-template' ? 'Macro JSON' : value === 'prompt' ? 'Prompt' : 'Note' }
  function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
  function requestStatus(error: unknown): number | null {
    return error instanceof Error && 'status' in error && typeof (error as Error & { status?: unknown }).status === 'number'
      ? (error as Error & { status: number }).status
      : null
  }
</script>

<aside class="prompt-panel library-panel" data-testid="library-panel" data-kind={kind} data-dirty={dirty} data-editing={editing}>
  <div class="prompt-header library-header">
    <div><h2>Library</h2><p data-testid="library-status">{statusText}</p></div>
    <button type="button" data-testid="library-reset-width" onclick={() => onResetWidth?.()}>Reset width</button>
  </div>

  {#if errorText}<div class="prompt-error" role="alert" data-testid="library-error">{errorText}</div>{/if}
  {#if remoteNotice}<div class="prompt-notice" role="status" data-testid="library-remote-notice">{remoteNotice}</div>{/if}

  <nav class="library-kind-tabs" data-testid="library-kind-tabs" aria-label="Library content kind">
    <button type="button" class:active={kind === 'macro-template'} data-testid="library-tab-macro-template" aria-disabled={operationPending} onclick={() => void changeKind('macro-template')}>Macro JSON</button>
    <button type="button" class:active={kind === 'prompt'} data-testid="library-tab-prompt" aria-disabled={operationPending} onclick={() => void changeKind('prompt')}>Prompt</button>
    <button type="button" class:active={kind === 'note'} data-testid="library-tab-note" aria-disabled={operationPending} onclick={() => void changeKind('note')}>Note</button>
  </nav>

  <section class="prompt-section prompt-toolbar library-toolbar" data-testid="library-toolbar" aria-busy={operationPending}>
    <label>Search
      <input data-testid="library-search" value={searchText} oninput={(event) => updateSearch(event.currentTarget.value)} placeholder="title, description, tags, content" />
    </label>
    <label>{kindLabel(kind)}
      <select data-testid="library-selector" value={selectedKey} aria-disabled={operationPending} onchange={(event) => void selectByKey(event.currentTarget.value)}>
        <option value="">{items.length === 0 ? 'No items found' : 'Select item'}</option>
        {#each items as item (item.kind + ':' + item.itemId)}
          <option data-testid="library-list-item" value={item.kind + ':' + item.itemId}>{item.title}{item.tags.length ? ' · ' + item.tags.join(', ') : ''}</option>
        {/each}
      </select>
    </label>
    <div class="prompt-editor-actions library-actions" data-testid="library-actions">
      <button type="button" data-testid="library-new" onclick={() => void newItem()} aria-disabled={!canMutateShared || operationPending}>New</button>
      <button type="button" data-testid="library-edit" onclick={() => void beginEdit()} aria-disabled={!canMutateShared || !selectedItem || operationPending}>Edit</button>
      <button type="button" data-testid="library-save" onclick={() => void saveItem()} aria-disabled={!canMutateShared || !draft || operationPending}>{operationPending ? 'Working…' : 'Save'}</button>
      <button type="button" data-testid="library-cancel" onclick={() => void cancelEdit()} disabled={!draft || operationPending}>{publishedCreateBufferPreserved ? 'Discard local copy' : editing ? selectedItem ? dirty ? 'Cancel' : 'Done' : 'Discard' : 'Cancel'}</button>
      <button type="button" data-testid="library-copy" onclick={() => void copyContent()} disabled={!draft}>{copyLabel}</button>
      {#if kind === 'macro-template'}<button type="button" data-testid="library-load-into-macro" onclick={() => void loadIntoMacro()} aria-disabled={!canMutateShared || !selectedItem || operationPending}>Load into Macro</button>{/if}
      <button type="button" data-testid="library-remove" onclick={() => void removeItem()} aria-disabled={!canMutateShared || !selectedItem || operationPending}>Remove</button>
      <button type="button" data-testid="library-refresh" onclick={() => void refreshLibrary()} disabled={operationPending}>Refresh</button>
    </div>
  </section>

  <section class="prompt-section prompt-editor library-editor" data-testid="library-editor" aria-busy={operationPending}>
    <div class="prompt-section-title"><h3>{editing ? 'Edit' : 'View'}</h3>{#if dirty}<span data-testid="library-dirty">unsaved</span>{/if}</div>
    {#if draft}
      <label>Title
        <input data-testid="library-title" value={draft.title} readonly={editorReadOnly} oninput={(event) => updateDraft('title', event.currentTarget.value)} />
      </label>
      <label>Description
        <input data-testid="library-description" value={draft.description} readonly={editorReadOnly} oninput={(event) => updateDraft('description', event.currentTarget.value)} />
      </label>
      <label>Tags
        <input data-testid="library-tags" value={draft.tags.join(', ')} readonly={editorReadOnly} oninput={(event) => setTags(event.currentTarget.value)} placeholder="review, reusable" />
      </label>
      <div class="library-content-label">Content</div>
      <div class:library-json-editor={kind === 'macro-template'}>
        <LineNumberedTextarea testId="library-content" value={draft.content} maxRows={24} ariaLabel={`${kindLabel(kind)} content`}
          showLineNumbers={kind === 'macro-template'} readOnly={editorReadOnly} disabled={operationPending}
          onInput={(value) => updateDraft('content', value)} />
      </div>
      {#if kind === 'macro-template'}
        <div class="prompt-editor-actions library-macro-actions">
          <button type="button" data-testid="library-validate" onclick={validateMacro}>Validate</button>
        </div>
        {#if validationText}<pre class="library-validation" data-testid="library-validation" role="status">{validationText}</pre>{/if}
      {/if}
      {#if leaseView}<small data-testid="library-lease-status">Lease {leaseView.mode} · epoch {leaseView.leaseEpoch}</small>{/if}
    {:else}
      <p class="empty-text">Select or create a {kindLabel(kind)} item.</p>
    {/if}
  </section>
</aside>
