import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
import { cloneJsonValue } from '../jsonClone'
import type { ContentEditLeaseChangedMessage } from '../protocol'
import type { TerminalRoomClient } from '../terminalRoomClient'
import { validateMacroDefinitionV5 } from './macroDefinitionValidation'
import type { MacroDefinitionV5, MacroRecord, MacroRecordSummary } from './macroDefinitionTypes'
import {
  formatMacroError,
  formatMacroIssues,
  messageOf,
  type MacroJsonEditSession,
} from './macroJsonEditSession.svelte'
import type { SequencedContentRecordChange } from './macroInvalidationQueue'
import {
  MacroRecordMutationWorkflow,
  type PersistedDefinition,
} from './macroRecordMutationWorkflow'
import {
  MacroRecordRemoteSyncCoordinator,
  type MacroTemplateRefreshResult,
} from './macroRecordRemoteSyncCoordinator'
import type { MacroRecordListResult } from './macroRecordClient'

type ContentEditLeaseChange = ContentEditLeaseChangedMessage & { sequence: number }
type DefinitionOperationSource = 'visual' | 'json'

export type MacroOperationToken = {
  generation: number
  controlEpoch: number | null
  recordId: string | null
  recordRevision: number | null
  draftRevision: number
  jsonRevision: number
  editLeaseId: string | null
}

export type MacroStartRecordSnapshot = {
  definition: MacroDefinitionV5
  draftRevision: number
  dirty: boolean
  record: MacroRecord | null
}

type MacroRecordSessionOptions = {
  roomClient(): TerminalRoomClient | null
  canMutateShared(): boolean
  connectionGeneration(): number
  contentRecordChanges(): SequencedContentRecordChange[]
  contentEditLeaseChanges(): ContentEditLeaseChange[]
  json: MacroJsonEditSession
  showEditor(): void
  showJson(): void
  onMutationDenied(reason: string): void
}

export function createMacroRecordSession(options: MacroRecordSessionOptions) {
  let templates = $state<MacroRecordSummary[]>([])
  let selectedRecord = $state<MacroRecord | null>(null)
  let baseDefinition = $state<MacroDefinitionV5 | null>(null)
  let draft = $state<MacroDefinitionV5 | null>(null)
  let draftRevision = $state(0)
  let editorGeneration = $state(0)
  let contentEditing = $state(false)
  let leaseLost = $state(false)
  let publishedCreateBufferPreserved = $state(false)
  let editLease = $state<ContentEditLeaseGrant | null>(null)
  let leaseView = $state<ContentEditLeaseView | null>(null)
  let dirty = $state(false)
  let operationGeneration = $state(0)
  let operationPending = $state(false)
  let errorText = $state<string | null>(null)
  let saveToLibraryLabel = $state('Save to Library')
  let templateListProblem = $state<string | null>(null)
  let handledContentLeaseChangeSequence = 0
  let templateListGeneration = 0
  let saveToLibraryResetTimer: ReturnType<typeof setTimeout> | null = null
  const mutations = new MacroRecordMutationWorkflow({
    roomClient: options.roomClient,
    selectedRecord: () => selectedRecord,
    editLease: () => editLease,
    contentEditing: () => contentEditing,
  })
  const remoteSync = new MacroRecordRemoteSyncCoordinator({
    connectionGeneration: options.connectionGeneration,
    snapshot: () => ({
      selectedRecord,
      editorGeneration,
      operationPending,
      protectedBuffer: dirty
        || contentEditing
        || options.json.editing
        || leaseLost
        || publishedCreateBufferPreserved,
    }),
    refreshTemplates,
    readRecord: (recordId) => mutations.read(recordId),
    installRecord: (record) => installRecord(record),
    setErrorText: (value) => { errorText = value },
  })

  $effect(() => {
    const changes = options.contentEditLeaseChanges()
      .filter((change) => change.sequence > handledContentLeaseChangeSequence)
    if (changes.length === 0) return
    handledContentLeaseChangeSequence = changes.at(-1)!.sequence
    const recordId = selectedRecord?.id
    const lease = editLease
    if (!recordId || !lease || !contentEditing) return
    const latest = changes
      .filter((change) => change.resourceKey.kind === 'macro' && change.resourceKey.itemId === recordId)
      .at(-1)
    if (!latest) return
    if (latest.view.mode === 'held' && latest.view.leaseEpoch === lease.leaseEpoch) {
      leaseView = latest.view
      return
    }
    markEditLeaseLost(latest.view, 'content_edit_lease_lost')
  })

  $effect(() => {
    const generation = options.connectionGeneration()
    remoteSync.connectionChanged(generation)
  })

  $effect(() => {
    remoteSync.observe(options.contentRecordChanges())
  })

  $effect(() => {
    if (options.canMutateShared()) return
    if (selectedRecord && contentEditing && editLease) markEditLeaseLost(null, 'room_control_lost')
  })

  function mount(): () => void {
    remoteSync.mount()
    const focus = () => remoteSync.focus()
    window.addEventListener('focus', focus)
    return () => {
      window.removeEventListener('focus', focus)
      remoteSync.dispose()
      if (saveToLibraryResetTimer) clearTimeout(saveToLibraryResetTimer)
      void releaseEditLease()
    }
  }

  async function refreshTemplates(report = true): Promise<MacroTemplateRefreshResult> {
    const generation = ++templateListGeneration
    try {
      const result = await mutations.list()
      if (generation !== templateListGeneration) return { outcome: 'stale' }
      installTemplateList(result)
      return { outcome: 'applied', records: result.templates }
    } catch (error) {
      if (generation !== templateListGeneration) return { outcome: 'stale' }
      templateListProblem = `Macro list unavailable: ${messageOf(error)}`
      if (report) errorText = messageOf(error)
      return { outcome: 'retry' }
    }
  }

  function installTemplateList(result: MacroRecordListResult): void {
    templates = result.templates
    templateListProblem = result.invalidRecords.length === 0
      ? null
      : `Invalid Macro records ignored: ${result.invalidRecords.map((record) => `${record.recordId} (${record.error})`).join(', ')}`
  }

  async function loadFromLibrary(itemId: string, expectedRevision: number): Promise<{ selected: boolean; recordId: string }> {
    const guard = {
      selectedRecordId: selectedRecord?.id ?? null,
      baseRecordRevision: selectedRecord?.revision ?? null,
      draftRevision,
      dirty,
      jsonEditing: options.json.editing,
      editLeaseId: editLease?.editLeaseId ?? null,
      operationGeneration,
      operationPending,
      controlEpoch: options.roomClient()?.controlGrant?.controlEpoch ?? null,
    }
    const record = await mutations.createFromLibrary(itemId, expectedRevision)
    await refreshTemplates(false)
    const unchanged = !guard.dirty
      && !guard.jsonEditing
      && guard.editLeaseId === null
      && !guard.operationPending
      && !dirty
      && !options.json.editing
      && editLease === null
      && !operationPending
      && (selectedRecord?.id ?? null) === guard.selectedRecordId
      && (selectedRecord?.revision ?? null) === guard.baseRecordRevision
      && draftRevision === guard.draftRevision
      && operationGeneration === guard.operationGeneration
      && options.roomClient()?.controlGrant?.controlEpoch === guard.controlEpoch
    if (unchanged) installRecord(record)
    else errorText = `Created ${record.id}; current Macro draft was not switched.`
    return { selected: unchanged, recordId: record.id }
  }

  async function selectTemplate(id: string): Promise<boolean> {
    if (operationPending || options.json.editing) return false
    if (dirty && !confirm('Discard unsaved macro changes?')) return false
    const token = beginOperation()
    try {
      await releaseEditLease()
      if (!id) {
        if (!canCommit(token)) return false
        selectedRecord = null
        baseDefinition = null
        draft = null
        dirty = false
        contentEditing = false
        leaseLost = false
        publishedCreateBufferPreserved = false
        options.json.clearSelection()
        options.showEditor()
        draftRevision += 1
        editorGeneration += 1
        errorText = null
        return true
      }
      const record = await mutations.read(id)
      if (!canCommit(token)) return false
      installRecord(record)
      return true
    } catch (error) {
      if (canCommit(token)) reportMutationError(error)
      return false
    } finally {
      endOperation(token)
    }
  }

  async function createTemplate(): Promise<void> {
    if (!options.canMutateShared()) {
      rejectMutation(options.roomClient() ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (options.json.editing) return
    if (dirty && !confirm('Discard unsaved macro changes?')) return
    const token = beginOperation()
    try {
      await releaseEditLease()
      if (!canCommit(token)) return
      selectedRecord = null
      baseDefinition = null
      draft = emptyDefinition()
      contentEditing = true
      leaseLost = false
      publishedCreateBufferPreserved = false
      dirty = true
      draftRevision += 1
      editorGeneration += 1
      errorText = null
      options.showEditor()
    } catch (error) {
      if (canCommit(token)) reportMutationError(error)
    } finally {
      endOperation(token)
    }
  }

  async function beginEdit(enterJson = false): Promise<void> {
    if (!selectedRecord || !options.roomClient() || operationPending || !options.canMutateShared()) {
      rejectMutation(!options.roomClient()
        ? 'room_disconnected'
        : !options.canMutateShared()
          ? 'room_control_required'
          : operationPending
            ? 'operation_pending'
            : 'no_saved_macro_selected')
      return
    }
    if (dirty && !confirm('Discard the unsaved draft and reload the latest saved Macro before editing?')) return
    const token = beginOperation()
    try {
      const acquired = await mutations.acquireFreshEditLease(selectedRecord.id, 'edit', () => canCommit(token))
      if (!acquired) return
      editLease = acquired.grant
      leaseView = acquired.view
      installRecord(acquired.record, true)
      if (enterJson) openJsonBuffer()
    } catch (error) {
      if (canCommit(token)) reportMutationError(error)
    } finally {
      endOperation(token)
    }
  }

  async function cancelEdit(): Promise<void> {
    if (operationPending) return
    const token = beginOperation()
    try {
      await releaseEditLease()
      if (!canCommit(token)) return
      options.json.closeAfterRecordInstall()
      if (baseDefinition) draft = cloneJsonValue(baseDefinition)
      else {
        selectedRecord = null
        draft = null
        options.showEditor()
        editorGeneration += 1
      }
      dirty = false
      contentEditing = false
      publishedCreateBufferPreserved = false
      leaseLost = false
      draftRevision += 1
    } catch (error) {
      if (canCommit(token)) reportMutationError(error)
    } finally {
      endOperation(token)
    }
  }

  async function saveTemplate(): Promise<void> {
    if (!options.canMutateShared()) {
      rejectMutation(options.roomClient() ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (!draft) return
    const token = beginOperation()
    const revision = draftRevision
    const definition = cloneJsonValue(draft)
    try {
      const persisted = await persistDefinition(definition, token, revision)
      if (!persisted) return
      if (!definitionOperationIsCurrent(token, revision, 'visual')) {
        reconcilePublishedCreate(persisted.record, definition, token, revision, 'visual')
        return
      }
      installRecord(persisted.record, persisted.editing, persisted.preservePublishedCreateBuffer)
      if (persisted.leaseWarning) errorText = persisted.leaseWarning
      await refreshTemplates(false)
    } catch (error) {
      if (canCommit(token)) reportMutationError(error, true)
    } finally {
      endOperation(token)
    }
  }

  async function saveCurrentDraftToLibrary(): Promise<void> {
    if (!options.roomClient() || !options.canMutateShared()) {
      rejectMutation(options.roomClient() ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (options.json.editing) { rejectMutation('finish_json_edit_before_library_save'); return }
    if (!draft) { rejectMutation('no_current_macro'); return }
    const validation = validateMacroDefinitionV5(draft)
    if (!validation.ok) {
      errorText = formatMacroIssues(validation.issues)
      options.onMutationDenied('invalid_macro_definition')
      return
    }
    const token = beginOperation()
    const revision = draftRevision
    const definition = cloneJsonValue(validation.value)
    saveToLibraryLabel = 'Saving…'
    try {
      await mutations.saveToLibrary(definition)
      if (!definitionOperationIsCurrent(token, revision, 'visual')) return
      saveToLibraryLabel = 'Saved'
      if (saveToLibraryResetTimer) clearTimeout(saveToLibraryResetTimer)
      saveToLibraryResetTimer = setTimeout(() => {
        saveToLibraryResetTimer = null
        if (saveToLibraryLabel === 'Saved') saveToLibraryLabel = 'Save to Library'
      }, 900)
    } catch (error) {
      if (canCommit(token)) reportMutationError(error, true)
    } finally {
      if (saveToLibraryLabel === 'Saving…') saveToLibraryLabel = 'Save to Library'
      endOperation(token)
    }
  }

  async function deleteTemplate(): Promise<void> {
    const roomClient = options.roomClient()
    if (!roomClient || !options.canMutateShared()) {
      rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (!selectedRecord) { rejectMutation('no_saved_macro_selected'); return }
    const selectedId = selectedRecord.id
    const token = beginOperation()
    let temporaryLease: ContentEditLeaseGrant | null = null
    try {
      let record = selectedRecord
      let lease = editLease
      if (!lease || !contentEditing) {
        const acquired = await mutations.acquireFreshEditLease(selectedId, 'delete', () => canCommit(token))
        if (!acquired) return
        record = acquired.record
        lease = acquired.grant
        temporaryLease = acquired.grant
      }
      if (!confirm(`Delete ${record.definition.name}?`)) {
        if (temporaryLease) await roomClient.releaseContentEditLease(temporaryLease.editLeaseId).catch(() => {})
        temporaryLease = null
        return
      }
      await mutations.delete(record, lease)
      temporaryLease = null
      if (!canCommit(token)) return
      editLease = null
      leaseView = null
      selectedRecord = null
      baseDefinition = null
      draft = null
      dirty = false
      contentEditing = false
      publishedCreateBufferPreserved = false
      leaseLost = false
      editorGeneration += 1
      await refreshTemplates(false)
    } catch (error) {
      if (temporaryLease) await roomClient.releaseContentEditLease(temporaryLease.editLeaseId).catch(() => {})
      if (canCommit(token)) reportMutationError(error)
    } finally {
      endOperation(token)
    }
  }

  function updateDraft(mutator: (definition: MacroDefinitionV5) => void): void {
    if (!options.canMutateShared()) {
      rejectMutation(options.roomClient() ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (!draft) return
    if (selectedRecord !== null && !contentEditing) {
      rejectMutation(leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required')
      return
    }
    const next = cloneJsonValue(draft)
    mutator(next)
    draft = next
    draftRevision += 1
    dirty = baseDefinition === null || JSON.stringify(next) !== JSON.stringify(baseDefinition)
  }

  function startJsonBuffer(): void {
    if (!draft || operationPending) return
    if (selectedRecord && !contentEditing) { void beginEdit(true); return }
    openJsonBuffer()
  }

  function openJsonBuffer(): void {
    if (!draft) return
    options.json.open(draft)
    options.showJson()
  }

  async function saveJson(): Promise<void> {
    const pending = options.json.beginCommit()
    if (!pending.ok) return
    if (!options.canMutateShared()) {
      options.json.finishCommit(pending.commit)
      rejectMutation(options.roomClient() ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (operationPending) {
      options.json.finishCommit(pending.commit)
      rejectMutation('operation_pending')
      return
    }
    const token = beginOperation()
    const { revision, candidate } = pending.commit
    try {
      const persisted = await persistDefinition(candidate, token, revision, 'json')
      if (!persisted) return
      if (!definitionOperationIsCurrent(token, revision, 'json')) {
        reconcilePublishedCreate(persisted.record, candidate, token, revision, 'json')
        return
      }
      const refreshed = await mutations.list()
      if (!definitionOperationIsCurrent(token, revision, 'json')) return
      installTemplateList(refreshed)
      installRecord(persisted.record, persisted.editing, persisted.preservePublishedCreateBuffer)
      if (persisted.leaseWarning) errorText = persisted.leaseWarning
    } catch (error) {
      if (definitionOperationIsCurrent(token, revision, 'json')) options.json.setError(formatMacroError(error))
    } finally {
      options.json.finishCommit(pending.commit)
      endOperation(token)
    }
  }

  function captureStartRecordSnapshot(): MacroStartRecordSnapshot | null {
    if (!draft) return null
    return {
      definition: cloneJsonValue(draft),
      draftRevision,
      dirty,
      record: selectedRecord ? cloneJsonValue(selectedRecord) : null,
    }
  }

  async function resolveStartRecord(
    token: MacroOperationToken,
    snapshot: MacroStartRecordSnapshot,
  ): Promise<MacroRecord | null> {
    let record = snapshot.record
    let persisted: PersistedDefinition | null = null
    if (snapshot.dirty) {
      persisted = await persistDefinition(snapshot.definition, token, snapshot.draftRevision)
      record = persisted?.record ?? null
    }
    if (!record) return null
    if (!definitionOperationIsCurrent(token, snapshot.draftRevision, 'visual')) {
      if (snapshot.dirty) reconcilePublishedCreate(record, snapshot.definition, token, snapshot.draftRevision, 'visual')
      return null
    }
    if (snapshot.dirty) {
      installRecord(record, persisted?.editing ?? false, persisted?.preservePublishedCreateBuffer ?? false)
      if (persisted?.leaseWarning) errorText = persisted.leaseWarning
      await refreshTemplates(false)
    }
    return canCommit(token) ? record : null
  }

  async function persistDefinition(
    definition: MacroDefinitionV5,
    token: MacroOperationToken,
    revision: number,
    source: DefinitionOperationSource = 'visual',
  ): Promise<PersistedDefinition | null> {
    const outcome = await mutations.persistDefinition(
      definition,
      () => definitionOperationIsCurrent(token, revision, source),
      (outcome) => {
        if (outcome.kind === 'published_create') {
          reconcilePublishedCreate(outcome.record, definition, token, revision, source)
          return
        }
        editLease = outcome.value.editLease
        leaseView = outcome.value.leaseView
      },
    )
    return outcome.kind === 'persisted' ? outcome.value : null
  }

  function reconcilePublishedCreate(
    record: MacroRecord,
    definition: MacroDefinitionV5,
    token: MacroOperationToken,
    revision: number,
    source: DefinitionOperationSource,
  ): boolean {
    const localIdentityMatches = operationGeneration === token.generation
      && selectedRecord === null
      && (source === 'json' ? options.json.revision === revision : draftRevision === revision)
    if (!localIdentityMatches || record.revision !== 1) return false
    editLease = null
    leaseView = null
    installRecord(record, false, true)
    draft = cloneJsonValue(definition)
    baseDefinition = cloneJsonValue(record.definition)
    dirty = false
    errorText = 'macro_saved_but_edit_lease_not_retained:operation_context_changed'
    return true
  }

  function installRecord(
    record: MacroRecord,
    editing = false,
    preservePublishedCreateBuffer = false,
  ): void {
    selectedRecord = cloneJsonValue(record)
    baseDefinition = cloneJsonValue(record.definition)
    draft = cloneJsonValue(record.definition)
    dirty = false
    contentEditing = editing
    leaseLost = false
    publishedCreateBufferPreserved = preservePublishedCreateBuffer
    draftRevision += 1
    editorGeneration += 1
    options.json.closeAfterRecordInstall()
    errorText = null
  }

  async function releaseEditLease(): Promise<void> {
    const lease = editLease
    editLease = null
    leaseView = null
    leaseLost = false
    await mutations.releaseEditLease(lease)
  }

  function markEditLeaseLost(view: ContentEditLeaseView | null, reason: string): void {
    editLease = null
    leaseView = view
    contentEditing = false
    leaseLost = true
    errorText = reason
    options.onMutationDenied(reason)
  }

  function beginOperation(): MacroOperationToken {
    operationGeneration += 1
    operationPending = true
    errorText = null
    return {
      generation: operationGeneration,
      controlEpoch: options.roomClient()?.controlGrant?.controlEpoch ?? null,
      recordId: selectedRecord?.id ?? null,
      recordRevision: selectedRecord?.revision ?? null,
      draftRevision,
      jsonRevision: options.json.revision,
      editLeaseId: editLease?.editLeaseId ?? null,
    }
  }

  function endOperation(token: MacroOperationToken): void {
    if (operationGeneration !== token.generation) return
    operationPending = false
    remoteSync.operationEnded()
  }

  function canCommit(token: MacroOperationToken): boolean {
    if (operationGeneration !== token.generation) return false
    if (token.controlEpoch !== null && options.roomClient()?.controlGrant?.controlEpoch !== token.controlEpoch) return false
    return true
  }

  function definitionOperationIsCurrent(
    token: MacroOperationToken,
    revision: number,
    source: DefinitionOperationSource,
  ): boolean {
    if (!canCommit(token)) return false
    return source === 'json' ? options.json.revision === revision : draftRevision === revision
  }

  function rejectMutation(reason: string): void {
    errorText = reason
    options.onMutationDenied(reason)
  }

  function reportMutationError(error: unknown, formatted = false): void {
    const reason = messageOf(error)
    errorText = formatted ? formatMacroError(error) : reason
    options.onMutationDenied(reason)
  }

  function emptyDefinition(): MacroDefinitionV5 {
    return { schemaVersion: 5, name: 'New Macro', description: '', terminalLayout: [], body: [] }
  }

  return {
    get templates() { return templates },
    get selectedRecord() { return selectedRecord },
    get draft() { return draft },
    get draftRevision() { return draftRevision },
    get editorGeneration() { return editorGeneration },
    get contentEditing() { return contentEditing },
    get leaseLost() { return leaseLost },
    get publishedCreateBufferPreserved() { return publishedCreateBufferPreserved },
    get editLease() { return editLease },
    get dirty() { return dirty },
    get operationPending() { return operationPending },
    get errorText() { return errorText },
    get templateListProblem() { return templateListProblem },
    get saveToLibraryLabel() { return saveToLibraryLabel },
    mount,
    loadFromLibrary,
    selectTemplate,
    createTemplate,
    beginEdit,
    cancelEdit,
    saveTemplate,
    saveCurrentDraftToLibrary,
    deleteTemplate,
    updateDraft,
    startJsonBuffer,
    saveJson,
    captureStartRecordSnapshot,
    resolveStartRecord,
    beginOperation,
    endOperation,
    canCommit,
    rejectMutation,
    reportMutationError,
    setErrorText: (value: string | null) => { errorText = value },
  }
}

export type MacroRecordSession = ReturnType<typeof createMacroRecordSession>
