<script lang="ts">
  import { onMount } from 'svelte'
  import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
  import { cloneJsonValue } from '../jsonClone'
  import type { ContentEditLeaseChangedMessage, ContentRecordChangedMessage, RoomSnapshot, TerminalRuntimePosition } from '../protocol'
  import type { TerminalRoomClient } from '../terminalRoomClient'
  import { LibraryClient } from '../library/libraryClient'
  import type { MacroInsertionPaletteMode } from '../workspace/uiLayoutTypes'
  import type { MacroDefinitionV3, MacroRecord, MacroRecordSummary } from '../macro/macroDefinitionTypes'
  import { parseAndValidateMacroDefinitionJson, parseAndValidateMacroTerminalLayoutFromDefinitionJson, validateMacroDefinitionV3, validateMacroTerminalLayout } from '../macro/macroDefinitionValidation'
  import { validateMacroRuntimeBinding } from '../macro/macroRuntimeBinding'
  import { MacroRecordClient } from '../macro/macroRecordClient'
  import { MacroRunnerClient } from '../macro/macroRunnerClient'
  import type { MacroRunnerSnapshot, MacroRunTrace } from '../macro/runnerTypes'
  import MacroEditorShell from './macro/MacroEditorShell.svelte'
  import MacroJsonView from './macro/MacroJsonView.svelte'
  import MacroTraceView from './macro/MacroTraceView.svelte'
  import MacroWorkbenchChrome, { type MacroView } from './macro/MacroWorkbenchChrome.svelte'

  type PersistedDefinition = {
    record: MacroRecord
    editing: boolean
    leaseWarning: string | null
    preservePublishedCreateBuffer: boolean
  }
  type DefinitionOperationSource = 'visual' | 'json'
  type RefreshOutcome = 'applied' | 'stale' | 'retry'
  type TemplateRefreshResult = { outcome: RefreshOutcome; records?: MacroRecordSummary[] }
  type SequencedContentRecordChange = ContentRecordChangedMessage & { sequence: number }
  type ContentEditLeaseChange = ContentEditLeaseChangedMessage & { sequence: number }

  let {
    roomClient,
    canMutateShared,
    terminalStructureRevision,
    terminalPositions,
    terminalStructureLocked,
    runnerSnapshot,
    contentRecordChanges,
    contentEditLeaseChanges,
    connectionGeneration,
    insertionPaletteMode,
    onRoomSnapshot,
    onDirtyChange,
    onMutationDenied,
    onResetWidth,
  } = $props<{
    roomClient: TerminalRoomClient | null
    canMutateShared: boolean
    terminalStructureRevision: number
    terminalPositions: TerminalRuntimePosition[] | null
    terminalStructureLocked: boolean
    runnerSnapshot: MacroRunnerSnapshot | null
    contentRecordChanges: Array<ContentRecordChangedMessage & { sequence: number }>
    contentEditLeaseChanges: ContentEditLeaseChange[]
    connectionGeneration: number
    insertionPaletteMode: MacroInsertionPaletteMode
    onRoomSnapshot: (snapshot: RoomSnapshot) => void
    onDirtyChange: (dirty: boolean) => void
    onMutationDenied: (reason: string) => void
    onResetWidth?: () => void
  }>()

  const recordClient = new MacroRecordClient(() => roomClient?.controlGrant ?? null)
  const libraryClient = new LibraryClient(() => roomClient?.controlGrant ?? null)
  const runnerClient = new MacroRunnerClient(() => roomClient)

  let templates = $state<MacroRecordSummary[]>([])
  let selectedRecord = $state<MacroRecord | null>(null)
  let baseDefinition = $state<MacroDefinitionV3 | null>(null)
  let draft = $state<MacroDefinitionV3 | null>(null)
  let draftRevision = $state(0)
  let editorGeneration = $state(0)
  let contentEditing = $state(false)
  let leaseLost = $state(false)
  let publishedCreateBufferPreserved = $state(false)
  let editLease = $state<ContentEditLeaseGrant | null>(null)
  let leaseView = $state<ContentEditLeaseView | null>(null)
  let dirty = $state(false)
  let templateSearch = $state('')
  let macroView = $state<MacroView>('editor')
  let operationGeneration = $state(0)
  let operationControlEpoch = $state<number | null>(null)
  let operationPending = $state(false)
  let preparing = $state(false)
  let errorText = $state<string | null>(null)
  let saveToLibraryLabel = $state('Save to Library')
  let runner = $state<MacroRunnerSnapshot | null>(null)
  let traces = $state<MacroRunTrace[]>([])
  let runnerInput = $state('')
  let runnerInputDirty = $state(false)
  let runnerInputSyncing = $state(false)
  let runnerInputFlushPromise: Promise<void> | null = null
  let runnerInputEditGeneration = 0
  let runnerInputAcknowledgedGeneration = 0
  let jsonEditing = $state(false)
  let jsonText = $state('')
  let jsonRevision = $state(0)
  let jsonError = $state<string | null>(null)
  let telegramProfileIds = $state<string[]>([])
  let telegramProfilesError = $state('')
  let runnerRefreshGeneration = 0
  let observedContentChangeSequence = 0
  let handledContentLeaseChangeSequence = 0
  let contentChangeProcessing = Promise.resolve()
  let pendingMacroRecordChanges: SequencedContentRecordChange[] = []
  let templateListGeneration = 0
  let templateReadGeneration = 0
  let reconciledConnectionGeneration = 0
  let contentRetryAttempt = 0
  let contentRetryTimer: ReturnType<typeof setTimeout> | null = null
  let saveToLibraryResetTimer: ReturnType<typeof setTimeout> | null = null

  const filteredTemplates = $derived(templates.filter((template) => `${template.name}\n${template.description}`.toLowerCase().includes(templateSearch.trim().toLowerCase())))
  const portableValidation = $derived(validateMacroDefinitionV3(draft))
  const runtimeValidation = $derived(draft ? validateMacroRuntimeBinding(draft.terminalLayout, terminalPositions) : null)
  const jsonPreview = $derived(draft ? JSON.stringify(draft, null, 2) : '')
  const statusText = $derived(runtimeValidation?.code ?? 'no_macro_selected')
  const editorLocked = $derived(!canMutateShared || operationPending || (selectedRecord !== null && !contentEditing))
  const prepareState = $derived(resolvePrepareState())
  const startState = $derived(resolveStartState())

  $effect(() => {
    onDirtyChange(dirty || jsonEditing || publishedCreateBufferPreserved)
  })

  $effect(() => {
    const changes = contentEditLeaseChanges.filter((change: ContentEditLeaseChange) => change.sequence > handledContentLeaseChangeSequence)
    if (changes.length === 0) return
    handledContentLeaseChangeSequence = changes.at(-1)!.sequence
    const recordId = selectedRecord?.id
    const lease = editLease
    if (!recordId || !lease || !contentEditing) return
    const latest = changes.filter((change: ContentEditLeaseChange) => change.resourceKey.kind === 'macro' && change.resourceKey.itemId === recordId).at(-1)
    if (!latest) return
    if (latest.view.mode === 'held' && latest.view.leaseEpoch === lease.leaseEpoch) {
      leaseView = latest.view
      return
    }
    markEditLeaseLost(latest.view, 'content_edit_lease_lost')
  })

  onMount(() => {
    void reconcileSavedContentTruth(connectionGeneration, true)
    void refreshTraces()
    void loadNotificationProfiles()
    const focus = () => {
      resetContentRetry()
      void reconcileSavedContentTruth(connectionGeneration, false)
      scheduleMacroRecordChangeDrain()
    }
    window.addEventListener('focus', focus)
    return () => {
      window.removeEventListener('focus', focus)
      if (contentRetryTimer) clearTimeout(contentRetryTimer)
      if (saveToLibraryResetTimer) clearTimeout(saveToLibraryResetTimer)
      void releaseEditLease()
    }
  })

  $effect(() => {
    const generation = connectionGeneration
    if (generation <= 0 || generation === reconciledConnectionGeneration) return
    reconciledConnectionGeneration = generation
    resetContentRetry()
    void reconcileSavedContentTruth(generation, false)
    scheduleMacroRecordChangeDrain()
  })

  $effect(() => {
    const next = runnerSnapshot
    if (next) installRunnerSnapshot(next)
  })

  $effect(() => {
    const changes = contentRecordChanges.filter((change: SequencedContentRecordChange) => change.sequence > observedContentChangeSequence)
    if (changes.length === 0) return
    observedContentChangeSequence = changes.at(-1)!.sequence
    const macroChanges = changes.filter((change: SequencedContentRecordChange) => change.resourceKey.kind === 'macro')
    if (macroChanges.length > 0) {
      resetContentRetry()
      pendingMacroRecordChanges.push(...macroChanges)
      scheduleMacroRecordChangeDrain()
    }
  })

  $effect(() => {
    if (canMutateShared) return
    const input = runner?.runtimeInput
    runnerInput = input?.draft ?? ''
    runnerInputDirty = false
    runnerInputAcknowledgedGeneration = runnerInputEditGeneration
    if (selectedRecord && contentEditing && editLease) markEditLeaseLost(null, 'room_control_lost')
  })

  function emptyDefinition(): MacroDefinitionV3 {
    return { schemaVersion: 3, name: 'New Macro', description: '', terminalLayout: [], body: [] }
  }

  async function refreshTemplates(report = true): Promise<TemplateRefreshResult> {
    const generation = ++templateListGeneration
    try {
      const records = await recordClient.list()
      if (generation !== templateListGeneration) return { outcome: 'stale' }
      templates = records
      return { outcome: 'applied', records }
    }
    catch (error) {
      if (generation !== templateListGeneration) return { outcome: 'stale' }
      if (report) errorText = messageOf(error)
      return { outcome: 'retry' }
    }
  }

  export async function loadFromLibrary(itemId: string, expectedRevision: number): Promise<{ selected: boolean; recordId: string }> {
    const guard = {
      selectedRecordId: selectedRecord?.id ?? null,
      baseRecordRevision: selectedRecord?.revision ?? null,
      draftRevision,
      dirty,
      jsonEditing,
      editLeaseId: editLease?.editLeaseId ?? null,
      operationGeneration,
      operationPending,
      controlEpoch: roomClient?.controlGrant?.controlEpoch ?? null,
    }
    const record = await recordClient.createFromLibrary(itemId, expectedRevision)
    await refreshTemplates(false)
    const unchanged = !guard.dirty
      && !guard.jsonEditing
      && guard.editLeaseId === null
      && !guard.operationPending
      && !dirty
      && !jsonEditing
      && editLease === null
      && !operationPending
      && (selectedRecord?.id ?? null) === guard.selectedRecordId
      && (selectedRecord?.revision ?? null) === guard.baseRecordRevision
      && draftRevision === guard.draftRevision
      && operationGeneration === guard.operationGeneration
      && roomClient?.controlGrant?.controlEpoch === guard.controlEpoch
    if (unchanged) installRecord(record)
    else errorText = `Created ${record.id}; current Macro draft was not switched.`
    return { selected: unchanged, recordId: record.id }
  }

  async function loadNotificationProfiles() {
    try {
      const response = await fetch('/api/notification-profiles/telegram')
      const body = await response.json() as { ok?: boolean; profiles?: string[]; error?: string }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'notification_profiles_unavailable')
      telegramProfileIds = body.profiles ?? []
    } catch (error) { telegramProfilesError = messageOf(error) }
  }

  async function selectTemplate(id: string): Promise<boolean> {
    if (operationPending || jsonEditing) return false
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
        jsonEditing = false
        jsonText = ''
        jsonError = null
        macroView = 'editor'
        draftRevision += 1
        editorGeneration += 1
        errorText = null
        return true
      }
      const record = await recordClient.read(id)
      if (!canCommit(token)) return false
      installRecord(record)
      return true
    } catch (error) {
      if (canCommit(token)) reportMutationError(error)
      return false
    }
    finally { endOperation(token) }
  }

  async function createTemplate() {
    if (!canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (jsonEditing) return
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
      macroView = 'editor'
    } catch (error) { if (canCommit(token)) reportMutationError(error) }
    finally { endOperation(token) }
  }

  async function beginEdit(enterJson = false) {
    if (!selectedRecord || !roomClient || operationPending || !canMutateShared) {
      rejectMutation(!roomClient ? 'room_disconnected' : !canMutateShared ? 'room_control_required' : operationPending ? 'operation_pending' : 'no_saved_macro_selected')
      return
    }
    if (dirty && !confirm('Discard the unsaved draft and reload the latest saved Macro before editing?')) return
    const token = beginOperation()
    try {
      const acquired = await acquireFreshEditLease(selectedRecord.id, token, 'edit')
      if (!acquired) return
      editLease = acquired.grant
      leaseView = acquired.view
      installRecord(acquired.record, true)
      if (enterJson) openJsonBuffer()
    } catch (error) { if (canCommit(token)) reportMutationError(error) }
    finally { endOperation(token) }
  }

  async function cancelEdit() {
    if (operationPending) return
    const token = beginOperation()
    try {
      await releaseEditLease()
      if (!canCommit(token)) return
      jsonEditing = false
      jsonError = null
      if (baseDefinition) draft = cloneJsonValue(baseDefinition)
      else {
        selectedRecord = null
        draft = null
        macroView = 'editor'
        editorGeneration += 1
      }
      dirty = false
      contentEditing = false
      publishedCreateBufferPreserved = false
      draftRevision += 1
    } catch (error) { if (canCommit(token)) reportMutationError(error) }
    finally { endOperation(token) }
  }

  async function saveTemplate() {
    if (!canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (!draft) return
    const token = beginOperation()
    const revision = draftRevision
    const definition = cloneJsonValue(draft)
    try {
      const persisted = await persistDefinition(definition, token, revision)
      if (!persisted) return
      if (!canCommit(token, revision)) {
        reconcilePublishedCreate(persisted.record, definition, token, revision, 'visual')
        return
      }
      installRecord(persisted.record, persisted.editing, persisted.preservePublishedCreateBuffer)
      if (persisted.leaseWarning) errorText = persisted.leaseWarning
      await refreshTemplates(false)
    } catch (error) { if (canCommit(token)) reportMutationError(error, true) }
    finally { endOperation(token) }
  }

  async function saveCurrentDraftToLibrary() {
    if (!roomClient || !canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (jsonEditing) { rejectMutation('finish_json_edit_before_library_save'); return }
    if (!draft) { rejectMutation('no_current_macro'); return }
    const validation = validateMacroDefinitionV3(draft)
    if (!validation.ok) {
      errorText = formatIssues(validation.issues)
      onMutationDenied('invalid_macro_definition')
      return
    }
    const token = beginOperation()
    const revision = draftRevision
    const definition = cloneJsonValue(validation.value)
    saveToLibraryLabel = 'Saving…'
    try {
      await libraryClient.create('macro-template', {
        title: definition.name,
        content: JSON.stringify(definition, null, 2),
        description: definition.description,
        tags: [],
      })
      if (!canCommit(token, revision)) return
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

  async function deleteTemplate() {
    if (!roomClient || !canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (!selectedRecord) { rejectMutation('no_saved_macro_selected'); return }
    const selectedId = selectedRecord.id
    const token = beginOperation()
    let temporaryLease: ContentEditLeaseGrant | null = null
    try {
      let record = selectedRecord
      let lease = editLease
      if (!lease || !contentEditing) {
        const acquired = await acquireFreshEditLease(selectedId, token, 'delete')
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
      await recordClient.delete(record, lease)
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
      editorGeneration += 1
      await refreshTemplates(false)
    } catch (error) {
      if (temporaryLease) await roomClient.releaseContentEditLease(temporaryLease.editLeaseId).catch(() => {})
      if (canCommit(token)) reportMutationError(error)
    }
    finally { endOperation(token) }
  }

  async function acquireFreshEditLease(recordId: string, token: number, intent: 'edit' | 'delete'): Promise<{
    record: MacroRecord
    grant: ContentEditLeaseGrant
    view: ContentEditLeaseView
  } | null> {
    if (!roomClient || selectedRecord?.id !== recordId) return null
    const key = { kind: 'macro' as const, itemId: recordId }
    const view = await roomClient.contentEditLeaseView(key)
    if (!canCommit(token) || selectedRecord?.id !== recordId) return null
    let result: { view: ContentEditLeaseView; grant: ContentEditLeaseGrant }
    if (view.mode === 'held') {
      const suffix = intent === 'delete' ? ' to delete it?' : '?'
      if (!confirm(`This macro is being edited elsewhere. Take over its edit lease${suffix}`)) return null
      result = await roomClient.takeOverContentEditLease(key, view.leaseEpoch)
    } else result = await roomClient.acquireContentEditLease(key, view.leaseEpoch)
    try {
      if (!canCommit(token) || selectedRecord?.id !== recordId) {
        await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
        return null
      }
      const record = await recordClient.read(recordId)
      if (!canCommit(token) || selectedRecord?.id !== recordId) {
        await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
        return null
      }
      return { record, grant: result.grant, view: result.view }
    } catch (error) {
      await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
      throw error
    }
  }

  function updateDraft(mutator: (definition: MacroDefinitionV3) => void) {
    if (!canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
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

  function startJsonBuffer() {
    if (!draft || operationPending) return
    if (selectedRecord && !contentEditing) { void beginEdit(true); return }
    openJsonBuffer()
  }

  function openJsonBuffer() {
    if (!draft) return
    jsonText = JSON.stringify(draft, null, 2)
    jsonEditing = true
    jsonRevision += 1
    jsonError = null
    macroView = 'json'
  }

  function updateJsonText(value: string) { if (!operationPending) { jsonText = value; jsonRevision += 1; jsonError = null } }

  async function saveJson() {
    const parsed = parseAndValidateMacroDefinitionJson(jsonText)
    if (!parsed.ok) { jsonError = formatJsonValidation(parsed); return }
    if (!canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
    if (operationPending) { rejectMutation('operation_pending'); return }
    const token = beginOperation()
    const revision = jsonRevision
    const candidate = cloneJsonValue(parsed.value)
    try {
      const persisted = await persistDefinition(candidate, token, revision, 'json')
      if (!persisted) return
      if (!definitionOperationIsCurrent(token, revision, 'json')) {
        reconcilePublishedCreate(persisted.record, candidate, token, revision, 'json')
        return
      }
      const refreshed = await recordClient.list()
      if (!definitionOperationIsCurrent(token, revision, 'json')) return
      templates = refreshed
      installRecord(persisted.record, persisted.editing, persisted.preservePublishedCreateBuffer)
      if (persisted.leaseWarning) errorText = persisted.leaseWarning
    } catch (error) {
      if (definitionOperationIsCurrent(token, revision, 'json')) jsonError = formatError(error)
    } finally { endOperation(token) }
  }

  function cancelJson() {
    if (operationPending) return
    jsonEditing = false
    jsonError = null
    jsonText = ''
  }

  async function prepareTerminals() {
    if (!roomClient || !canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (terminalStructureLocked) { rejectMutation('room_structure_locked_by_run'); return }
    const layout = jsonEditing
      ? parseAndValidateMacroTerminalLayoutFromDefinitionJson(jsonText)
      : validateMacroTerminalLayout(draft?.terminalLayout)
    if (!layout.ok) {
      errorText = 'error' in layout ? formatJsonValidation(layout) : formatIssues(layout.issues)
      onMutationDenied(errorText)
      return
    }
    const token = beginOperation()
    preparing = true
    const capturedDraftRevision = jsonEditing ? jsonRevision : draftRevision
    try {
      const result = await runnerClient.prepare(layout.value, terminalStructureRevision)
      if (!canCommit(token, undefined, capturedDraftRevision)) return
      onRoomSnapshot(result.snapshot)
      errorText = result.ok ? null : `${result.error}: ${result.operation} terminal ${result.failedIndex}`
    } catch (error) { if (canCommit(token)) reportMutationError(error) }
    finally { preparing = false; endOperation(token) }
  }

  async function controlRunner(action: 'start' | 'pause' | 'resume' | 'stop') {
    if (!roomClient || !canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (action !== 'start') {
      const token = beginOperation()
      try {
        const nextRunner = action === 'pause' ? await runnerClient.pause()
          : action === 'resume' ? await runnerClient.resume()
            : await runnerClient.stop()
        if (canCommit(token)) installRunnerSnapshot(nextRunner)
      }
      catch (error) { if (canCommit(token)) reportMutationError(error) }
      finally { endOperation(token) }
      return
    }
    if (!draft || !portableValidation.ok || runtimeValidation?.status !== 'ready') {
      rejectMutation(startState.reason || 'macro_not_runnable')
      return
    }
    const token = beginOperation()
    const revision = draftRevision
    const structureRevision = terminalStructureRevision
    const definition = cloneJsonValue(draft)
    try {
      let record = selectedRecord
      let persisted: PersistedDefinition | null = null
      if (dirty) {
        persisted = await persistDefinition(definition, token, revision)
        record = persisted?.record ?? null
      }
      if (!record) return
      if (!canCommit(token, revision)) {
        if (dirty) reconcilePublishedCreate(record, definition, token, revision, 'visual')
        return
      }
      if (dirty) {
        installRecord(record, persisted?.editing ?? false, persisted?.preservePublishedCreateBuffer ?? false)
        if (persisted?.leaseWarning) errorText = persisted.leaseWarning
        await refreshTemplates(false)
      }
      if (!canCommit(token)) return
      const nextRunner = await runnerClient.start(record.id, record.revision, structureRevision)
      if (canCommit(token)) { installRunnerSnapshot(nextRunner); errorText = null }
    } catch (error) { if (canCommit(token)) reportMutationError(error, true) }
    finally { endOperation(token) }
  }

  async function persistDefinition(
    definition: MacroDefinitionV3,
    token: number,
    revision: number,
    source: DefinitionOperationSource = 'visual',
  ): Promise<PersistedDefinition | null> {
    const validation = validateMacroDefinitionV3(definition)
    if (!validation.ok) throw new Error(formatIssues(validation.issues))
    const record = selectedRecord
    const updateResult = record
      ? editLease && contentEditing ? await recordClient.update(record, validation.value, editLease) : (() => { throw new Error('content_edit_lease_required') })()
      : null
    const result = updateResult?.record ?? await recordClient.create(validation.value)
    if (!definitionOperationIsCurrent(token, revision, source)) {
      if (!record) reconcilePublishedCreate(result, definition, token, revision, source)
      return null
    }
    if (record && result.id !== record.id) throw new Error('macro_record_identity_changed')
    if (record && result.revision !== record.revision + 1) throw new Error('macro_revision_conflict')
    if (!record && result.revision !== 1) throw new Error('macro_revision_conflict')
    if (record) {
      if (!editLease || !contentEditing) throw new Error('content_edit_lease_required')
      if (updateResult?.leaseOutcome.status === 'retained') {
        editLease = updateResult.leaseOutcome.grant
        leaseView = { mode: 'held', leaseEpoch: updateResult.leaseOutcome.grant.leaseEpoch, expiresAt: updateResult.leaseOutcome.grant.expiresAt }
        return { record: result, editing: true, leaseWarning: null, preservePublishedCreateBuffer: false }
      }
      editLease = null
      leaseView = null
      return {
        record: result,
        editing: false,
        leaseWarning: updateResult?.leaseOutcome.status === 'lost' ? updateResult.leaseOutcome.reason : 'content_edit_lease_lost',
        preservePublishedCreateBuffer: false,
      }
    }
    const acquired = await acquireCreatedRecordEditLease(result, () => definitionOperationIsCurrent(token, revision, source))
    if (acquired === null || !definitionOperationIsCurrent(token, revision, source)) {
      reconcilePublishedCreate(result, definition, token, revision, source)
      return null
    }
    return {
      record: result,
      editing: acquired.ok,
      leaseWarning: acquired.ok ? null : `macro_saved_but_edit_lease_not_retained:${acquired.reason}`,
      preservePublishedCreateBuffer: !acquired.ok,
    }
  }

  function reconcilePublishedCreate(
    record: MacroRecord,
    definition: MacroDefinitionV3,
    token: number,
    revision: number,
    source: DefinitionOperationSource,
  ): boolean {
    const localIdentityMatches = operationGeneration === token
      && selectedRecord === null
      && (source === 'json' ? jsonRevision === revision : draftRevision === revision)
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

  async function acquireCreatedRecordEditLease(record: MacroRecord, operationIsCurrent: () => boolean): Promise<{ ok: true } | { ok: false; reason: string } | null> {
    if (!roomClient || !operationIsCurrent()) return null
    const key = { kind: 'macro' as const, itemId: record.id }
    try {
      const view = await roomClient.contentEditLeaseView(key)
      if (!operationIsCurrent()) return null
      if (view.mode !== 'available') return { ok: false, reason: 'content_edit_lease_held' }
      const acquired = await roomClient.acquireContentEditLease(key, view.leaseEpoch)
      if (!operationIsCurrent()) {
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

  async function submitRunnerInput() {
    if (!roomClient || !canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
    if (operationPending) { rejectMutation('operation_pending'); return }
    await flushRunnerInputDraft()
    const input = runner?.runtimeInput
    if (!input || runnerInputDirty) {
      if (!input) rejectMutation('runner_not_waiting_input')
      return
    }
    const token = beginOperation()
    const value = runnerInput
    try {
      const nextRunner = await runnerClient.submitInput(input.invocationId, value, input.inputRevision)
      if (canCommit(token)) installRunnerSnapshot(nextRunner)
    } catch (error) {
      if (canCommit(token)) {
        reportMutationError(error)
        if (messageOf(error) === 'runner_input_revision_conflict') await refreshRunner(false)
      }
    }
    finally { endOperation(token) }
  }

  function updateRunnerInput(value: string) {
    if (!roomClient || !canMutateShared) { rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected'); return }
    if (!runner?.runtimeInput) { rejectMutation('runner_not_waiting_input'); return }
    const requestInFlight = runnerInputFlushPromise !== null || runnerInputSyncing
    runnerInputEditGeneration += 1
    runnerInput = value
    if (!requestInFlight && value === runner.runtimeInput.draft) {
      runnerInputAcknowledgedGeneration = runnerInputEditGeneration
      runnerInputDirty = false
    } else runnerInputDirty = runnerInputEditGeneration > runnerInputAcknowledgedGeneration
    if (runnerInputDirty) void flushRunnerInputDraft()
  }

  function flushRunnerInputDraft(): Promise<void> {
    if (runnerInputFlushPromise) return runnerInputFlushPromise
    const operation = (async () => {
      runnerInputSyncing = true
      try {
        while (runnerInputEditGeneration > runnerInputAcknowledgedGeneration) {
          if (!roomClient || !canMutateShared) break
          const input = runner?.runtimeInput
          if (!input) break
          const desired = runnerInput
          const sentGeneration = runnerInputEditGeneration
          try {
            const next = await runnerClient.updateInputDraft(input.invocationId, desired, input.inputRevision)
            installRunnerSnapshot(next)
            const acknowledged = next.runtimeInput
            if (acknowledged?.invocationId === input.invocationId) {
              runnerInputAcknowledgedGeneration = Math.max(runnerInputAcknowledgedGeneration, sentGeneration)
              if (runnerInput === acknowledged.draft) {
                runnerInputAcknowledgedGeneration = runnerInputEditGeneration
              }
              runnerInputDirty = runnerInputAcknowledgedGeneration < runnerInputEditGeneration
            }
          } catch (error) {
            const reason = messageOf(error)
            if (reason === 'runner_input_revision_conflict') {
              const previousRevision = runner?.runtimeRevision
              await refreshRunner(false)
              if (runner?.runtimeRevision === previousRevision) {
                reportMutationError(error)
                break
              }
              continue
            }
            reportMutationError(error)
            break
          }
        }
      } finally {
        runnerInputDirty = runnerInputAcknowledgedGeneration < runnerInputEditGeneration
        runnerInputSyncing = false
      }
    })()
    runnerInputFlushPromise = operation
    void operation.finally(() => {
      if (runnerInputFlushPromise === operation) runnerInputFlushPromise = null
    })
    return operation
  }

  async function refreshRunner(report = true) {
    if (!roomClient) return
    const generation = ++runnerRefreshGeneration
    try {
      const nextRunner = await runnerClient.snapshot()
      if (generation === runnerRefreshGeneration) installRunnerSnapshot(nextRunner)
    }
    catch (error) { if (report) errorText = messageOf(error) }
  }

  async function refreshTraces(report = true) {
    if (!roomClient) return
    try { traces = await runnerClient.traces() }
    catch (error) { if (report) errorText = messageOf(error) }
  }

  function installRunnerSnapshot(next: MacroRunnerSnapshot) {
    if (runner && runner.roomGeneration === next.roomGeneration && next.runtimeRevision < runner.runtimeRevision) return
    const previousInput = runner?.runtimeInput
    runner = next
    const input = next.runtimeInput
    if (!input) {
      runnerInput = ''
      runnerInputDirty = false
      runnerInputEditGeneration = 0
      runnerInputAcknowledgedGeneration = 0
      return
    }
    if (previousInput?.invocationId !== input.invocationId) {
      runnerInput = input.draft
      runnerInputDirty = false
      runnerInputEditGeneration = 0
      runnerInputAcknowledgedGeneration = 0
      return
    }
    const hasUnacknowledgedLocalEdit = runnerInputEditGeneration > runnerInputAcknowledgedGeneration
    if (!hasUnacknowledgedLocalEdit || !canMutateShared || runnerInput === input.draft) {
      runnerInput = input.draft
      runnerInputDirty = false
      runnerInputAcknowledgedGeneration = runnerInputEditGeneration
    } else {
      runnerInputDirty = true
    }
  }

  function scheduleMacroRecordChangeDrain() {
    contentChangeProcessing = contentChangeProcessing
      .then(async () => { await drainMacroRecordChanges() })
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
      void reconcileSavedContentTruth(connectionGeneration, false)
      scheduleMacroRecordChangeDrain()
    }, delay)
  }

  function hasProtectedMacroBuffer(): boolean {
    return dirty || contentEditing || jsonEditing || leaseLost || publishedCreateBufferPreserved
  }

  function cleanReadonlySelectionMatches(id: string, revision: number, generation: number): boolean {
    return selectedRecord?.id === id
      && selectedRecord.revision === revision
      && editorGeneration === generation
      && !operationPending
      && !hasProtectedMacroBuffer()
  }

  async function reconcileSavedContentTruth(expectedConnectionGeneration: number, report: boolean) {
    const refreshed = await refreshTemplates(report)
    if (refreshed.outcome !== 'applied') {
      if (refreshed.outcome === 'retry') scheduleContentRetry()
      return
    }
    if (expectedConnectionGeneration > 0 && expectedConnectionGeneration !== connectionGeneration) return
    const current = selectedRecord
    if (!current) return
    const summary = refreshed.records?.find((candidate) => candidate.id === current.id)
    if (!summary) {
      errorText = 'macro_record_deleted_elsewhere'
      return
    }
    if (summary.revision <= current.revision) return
    if (operationPending || hasProtectedMacroBuffer()) {
      errorText = 'macro_record_changed_elsewhere'
      return
    }
    const readGeneration = ++templateReadGeneration
    const capturedEditorGeneration = editorGeneration
    try {
      const record = await recordClient.read(current.id)
      if (readGeneration !== templateReadGeneration) return
      if (expectedConnectionGeneration > 0 && expectedConnectionGeneration !== connectionGeneration) return
      if (!cleanReadonlySelectionMatches(current.id, current.revision, capturedEditorGeneration)) return
      if (record.revision < Math.max(current.revision, summary.revision)) {
        scheduleContentRetry()
        return
      }
      installRecord(record)
    } catch (error) {
      if (readGeneration !== templateReadGeneration) return
      if (isNotFoundError(error) && selectedRecord?.id === current.id) errorText = 'macro_record_deleted_elsewhere'
      else {
        if (report) errorText = messageOf(error)
        scheduleContentRetry()
      }
    }
  }

  async function drainMacroRecordChanges() {
    while (!operationPending && pendingMacroRecordChanges.length > 0) {
      const batch = pendingMacroRecordChanges.slice()
      const consumed = await handleMacroRecordChanges(batch)
      if (!consumed) { scheduleContentRetry(); return }
      const lastSequence = batch.at(-1)!.sequence
      pendingMacroRecordChanges = pendingMacroRecordChanges.filter((change) => change.sequence > lastSequence)
      resetContentRetry()
    }
  }

  async function handleMacroRecordChanges(changes: SequencedContentRecordChange[]): Promise<boolean> {
    if (operationPending) return false
    const refreshed = await refreshTemplates(false)
    if (refreshed.outcome !== 'applied' || operationPending) return false
    if (!selectedRecord) return true
    const change = changes.filter((candidate) => candidate.resourceKey.itemId === selectedRecord?.id).at(-1)
    if (!change) return true
    if (change.operation === 'deleted') {
      errorText = 'macro_record_deleted_elsewhere'
      return true
    }
    if (change.revision !== null && change.revision <= selectedRecord.revision) return true
    if (hasProtectedMacroBuffer()) {
      errorText = 'macro_record_changed_elsewhere'
      return true
    }
    const expectedId = selectedRecord.id
    const expectedRevision = selectedRecord.revision
    const capturedEditorGeneration = editorGeneration
    const requiredRevision = change.revision ?? expectedRevision
    const readGeneration = ++templateReadGeneration
    try {
      const record = await recordClient.read(expectedId)
      if (readGeneration !== templateReadGeneration) return false
      if (!cleanReadonlySelectionMatches(expectedId, expectedRevision, capturedEditorGeneration)) return false
      if (record.revision < Math.max(expectedRevision, requiredRevision)) return false
      installRecord(record)
    } catch (error) {
      if (readGeneration !== templateReadGeneration) return false
      if (isNotFoundError(error) && selectedRecord?.id === expectedId) {
        errorText = 'macro_record_deleted_elsewhere'
        return true
      }
      if (selectedRecord?.id === expectedId) errorText = messageOf(error)
      return false
    }
    return true
  }

  function installRecord(record: MacroRecord, editing = false, preservePublishedCreateBuffer = false) {
    selectedRecord = cloneJsonValue(record)
    baseDefinition = cloneJsonValue(record.definition)
    draft = cloneJsonValue(record.definition)
    dirty = false
    contentEditing = editing
    leaseLost = false
    publishedCreateBufferPreserved = preservePublishedCreateBuffer
    draftRevision += 1
    editorGeneration += 1
    jsonEditing = false
    jsonError = null
    errorText = null
  }

  async function releaseEditLease() {
    const lease = editLease
    editLease = null
    leaseView = null
    leaseLost = false
    if (lease && roomClient?.canMutateShared) await roomClient.releaseContentEditLease(lease.editLeaseId).catch(() => {})
  }

  function resolvePrepareState(): { disabled: boolean; reason: string } {
    if (!draft && !jsonEditing) return { disabled: true, reason: 'No current macro draft' }
    if (!roomClient || !canMutateShared) return { disabled: true, reason: 'Room control is required' }
    if (operationPending) return { disabled: true, reason: 'Wait for the pending macro operation' }
    if (terminalStructureLocked) return { disabled: true, reason: 'room_structure_locked_by_run' }
    const result = jsonEditing ? parseAndValidateMacroTerminalLayoutFromDefinitionJson(jsonText) : validateMacroTerminalLayout(draft?.terminalLayout)
    if (!result.ok) return { disabled: true, reason: 'Fix terminalLayout before preparing' }
    return { disabled: false, reason: '' }
  }

  function resolveStartState(): { disabled: boolean; reason: string } {
    if (!draft) return { disabled: true, reason: 'No current macro' }
    if (!roomClient || !canMutateShared) return { disabled: true, reason: 'Room control is required' }
    if (operationPending || jsonEditing) return { disabled: true, reason: 'Save or cancel the pending edit first' }
    if (!portableValidation.ok) return { disabled: true, reason: 'Fix macro validation issues' }
    if (runtimeValidation?.status !== 'ready') return { disabled: true, reason: runtimeValidation?.code ?? 'macro_terminal_checking' }
    if (dirty && selectedRecord && (!contentEditing || !editLease)) return { disabled: true, reason: 'Edit lease is required to save before Start' }
    return { disabled: false, reason: '' }
  }

  function markEditLeaseLost(view: ContentEditLeaseView | null, reason: string) {
    editLease = null
    leaseView = view
    contentEditing = false
    leaseLost = true
    errorText = reason
    onMutationDenied(reason)
  }

  function beginOperation(): number {
    operationGeneration += 1
    operationControlEpoch = roomClient?.controlGrant?.controlEpoch ?? null
    operationPending = true
    errorText = null
    return operationGeneration
  }
  function endOperation(token: number) {
    if (operationGeneration !== token) return
    operationPending = false
    scheduleMacroRecordChangeDrain()
  }
  function canCommit(token: number, expectedDraftRevision?: number, alternateRevision?: number): boolean {
    if (operationGeneration !== token) return false
    if (expectedDraftRevision !== undefined && draftRevision !== expectedDraftRevision) return false
    if (alternateRevision !== undefined && (jsonEditing ? jsonRevision : draftRevision) !== alternateRevision) return false
    if (operationControlEpoch !== null && roomClient?.controlGrant?.controlEpoch !== operationControlEpoch) return false
    return true
  }
  function definitionOperationIsCurrent(token: number, revision: number, source: DefinitionOperationSource): boolean {
    return source === 'json' ? canCommit(token, undefined, revision) : canCommit(token, revision)
  }

  function rejectMutation(reason: string) {
    errorText = reason
    onMutationDenied(reason)
  }

  function reportMutationError(error: unknown, formatted = false) {
    const reason = messageOf(error)
    errorText = formatted ? formatError(error) : reason
    onMutationDenied(reason)
  }

  function formatIssues(issues: Array<{ path: string; code?: string; message: string }>): string { return issues.map((issue) => `${issue.path || '<root>'}: ${issue.code ? `${issue.code}: ` : ''}${issue.message}`).join('\n') }
  function formatJsonValidation(result: { ok: false; error: { code: string; message?: string; issues?: Array<{ path: string; code?: string; message: string }> } }): string {
    return result.error.issues ? formatIssues(result.error.issues) : result.error.message ?? result.error.code
  }
  function formatError(error: unknown): string {
    const response = error instanceof Error && 'response' in error ? (error as Error & { response?: { issues?: Array<{ path: string; code?: string; message: string }> } }).response : undefined
    return response?.issues ? formatIssues(response.issues) : messageOf(error)
  }
  function isNotFoundError(error: unknown): boolean {
    return error instanceof Error && (error.message.startsWith('macro_record_not_found:') || ('status' in error && error.status === 404))
  }
  function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
</script>

<section class="macro-panel" data-testid="macro-panel">
  <MacroWorkbenchChrome
    {templates} {filteredTemplates} {draft} {selectedRecord} {templateSearch} {dirty} {contentEditing} mutationAllowed={canMutateShared}
    {errorText} {macroView} {runner} {statusText} {runnerInput} {runnerInputSyncing} {preparing} {saveToLibraryLabel}
    prepareDisabled={prepareState.disabled} prepareDisabledReason={prepareState.reason}
    startDisabled={startState.disabled} startDisabledReason={startState.reason}
    {jsonEditing} {operationPending}
    onTemplateSearchChange={(value) => { templateSearch = value }} onSelectTemplate={selectTemplate}
    onCreateTemplate={() => void createTemplate()} onBeginEdit={() => void beginEdit()} onSaveTemplate={() => void saveTemplate()}
    onSaveToLibrary={() => void saveCurrentDraftToLibrary()} onCancelEdit={() => void cancelEdit()} onDeleteTemplate={() => void deleteTemplate()} onUpdateDraft={updateDraft}
    onResetWidth={onResetWidth} onPrepare={() => void prepareTerminals()} onRunnerInputChange={updateRunnerInput}
    onSubmitRunnerInput={() => void submitRunnerInput()} onRefreshRunner={() => void refreshRunner()}
    onMacroControl={(action) => void controlRunner(action)} onViewChange={(view) => { if (!jsonEditing) { macroView = view; if (view === 'trace') void refreshTraces() } }}
  />

  <div class="macro-view-scroll" data-testid="macro-view-scroll">
    {#if macroView === 'editor'}
      {#key editorGeneration}
        {#if draft}
          <MacroEditorShell {draft} validation={portableValidation} runtimePositions={terminalPositions} {insertionPaletteMode}
            {telegramProfileIds} {telegramProfilesError} locked={editorLocked} editorKey={`${selectedRecord?.id ?? 'new'}:${editorGeneration}`}
            lockedReason={!canMutateShared ? 'room_control_required' : operationPending ? 'operation_pending' : leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required'}
            {onMutationDenied} onUpdateDraft={updateDraft} />
        {:else}
          <p class="hint">Create or select a macro.</p>
        {/if}
      {/key}
    {:else if macroView === 'json'}
      <MacroJsonView {draft} {jsonPreview} editing={jsonEditing} saving={operationPending} editText={jsonText} editError={jsonError} canEdit={canMutateShared && (selectedRecord === null || contentEditing)}
        {operationPending} onStartEdit={startJsonBuffer} onEditTextChange={updateJsonText} onSave={saveJson} onCancel={cancelJson}
        onCopyResult={(error) => { errorText = error }} />
    {:else}
      <MacroTraceView {runner} {traces} />
    {/if}
  </div>
</section>
