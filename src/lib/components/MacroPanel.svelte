<script lang="ts">
  import { onMount } from 'svelte'
  import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
  import { cloneJsonValue } from '../jsonClone'
  import type { RoomSnapshot, TerminalRuntimePosition } from '../protocol'
  import type { TerminalRoomClient } from '../terminalRoomClient'
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
  }
  type DefinitionOperationSource = 'visual' | 'json'

  let {
    roomClient,
    canMutateShared,
    terminalStructureRevision,
    terminalPositions,
    terminalStructureLocked,
    insertionPaletteMode,
    onRoomSnapshot,
    onDirtyChange,
    onResetWidth,
  } = $props<{
    roomClient: TerminalRoomClient | null
    canMutateShared: boolean
    terminalStructureRevision: number
    terminalPositions: TerminalRuntimePosition[] | null
    terminalStructureLocked: boolean
    insertionPaletteMode: MacroInsertionPaletteMode
    onRoomSnapshot: (snapshot: RoomSnapshot) => void
    onDirtyChange: (dirty: boolean) => void
    onResetWidth?: () => void
  }>()

  const recordClient = new MacroRecordClient(() => roomClient?.controlGrant ?? null)
  const runnerClient = new MacroRunnerClient(() => roomClient)

  let templates = $state<MacroRecordSummary[]>([])
  let selectedRecord = $state<MacroRecord | null>(null)
  let baseDefinition = $state<MacroDefinitionV3 | null>(null)
  let draft = $state<MacroDefinitionV3 | null>(null)
  let draftRevision = $state(0)
  let editorGeneration = $state(0)
  let contentEditing = $state(false)
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
  let runner = $state<MacroRunnerSnapshot | null>(null)
  let traces = $state<MacroRunTrace[]>([])
  let runnerInput = $state('')
  let jsonEditing = $state(false)
  let jsonText = $state('')
  let jsonRevision = $state(0)
  let jsonError = $state<string | null>(null)
  let telegramProfileIds = $state<string[]>([])
  let telegramProfilesError = $state('')
  let runnerRefreshGeneration = 0

  const filteredTemplates = $derived(templates.filter((template) => `${template.name}\n${template.description}`.toLowerCase().includes(templateSearch.trim().toLowerCase())))
  const portableValidation = $derived(validateMacroDefinitionV3(draft))
  const runtimeValidation = $derived(draft ? validateMacroRuntimeBinding(draft.terminalLayout, terminalPositions) : null)
  const jsonPreview = $derived(draft ? JSON.stringify(draft, null, 2) : '')
  const statusText = $derived(runtimeValidation?.code ?? 'no_macro_selected')
  const editorLocked = $derived(!canMutateShared || operationPending || (selectedRecord !== null && !contentEditing))
  const prepareState = $derived(resolvePrepareState())
  const startState = $derived(resolveStartState())

  $effect(() => {
    onDirtyChange(dirty || jsonEditing)
  })

  onMount(() => {
    void refreshTemplates()
    void refreshRunner()
    void refreshTraces()
    void loadNotificationProfiles()
    const timer = window.setInterval(() => { if (roomClient) void refreshRunner(false) }, 900)
    const focus = () => { void refreshTemplates(false) }
    window.addEventListener('focus', focus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); void releaseEditLease() }
  })

  function emptyDefinition(): MacroDefinitionV3 {
    return { schemaVersion: 3, name: 'New Macro', description: '', terminalLayout: [], body: [] }
  }

  async function refreshTemplates(report = true) {
    try { templates = await recordClient.list() }
    catch (error) { if (report) errorText = messageOf(error) }
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
      if (canCommit(token)) errorText = messageOf(error)
      return false
    }
    finally { endOperation(token) }
  }

  async function createTemplate() {
    if (operationPending || jsonEditing) return
    if (dirty && !confirm('Discard unsaved macro changes?')) return
    const token = beginOperation()
    try {
      await releaseEditLease()
      if (!canCommit(token)) return
      selectedRecord = null
      baseDefinition = null
      draft = emptyDefinition()
      contentEditing = true
      dirty = true
      draftRevision += 1
      editorGeneration += 1
      errorText = null
      macroView = 'editor'
    } catch (error) { if (canCommit(token)) errorText = messageOf(error) }
    finally { endOperation(token) }
  }

  async function beginEdit(enterJson = false) {
    if (!selectedRecord || !roomClient || operationPending || !canMutateShared) {
      errorText = canMutateShared ? 'no_saved_macro_selected' : 'room_control_required'
      return
    }
    const token = beginOperation()
    try {
      const acquired = await acquireFreshEditLease(selectedRecord.id, token, 'edit')
      if (!acquired) return
      editLease = acquired.grant
      leaseView = acquired.view
      installRecord(acquired.record, true)
      if (enterJson) openJsonBuffer()
    } catch (error) { if (canCommit(token)) errorText = messageOf(error) }
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
      draftRevision += 1
    } catch (error) { if (canCommit(token)) errorText = messageOf(error) }
    finally { endOperation(token) }
  }

  async function saveTemplate() {
    if (!draft || operationPending) return
    const token = beginOperation()
    const revision = draftRevision
    const definition = cloneJsonValue(draft)
    try {
      const persisted = await persistDefinition(definition, token, revision)
      if (!persisted || !canCommit(token, revision)) return
      installRecord(persisted.record, persisted.editing)
      if (persisted.leaseWarning) errorText = persisted.leaseWarning
      await refreshTemplates(false)
    } catch (error) { if (canCommit(token)) errorText = formatError(error) }
    finally { endOperation(token) }
  }

  async function deleteTemplate() {
    if (!selectedRecord || !roomClient || operationPending || !canMutateShared) {
      errorText = canMutateShared ? 'no_saved_macro_selected' : 'room_control_required'
      return
    }
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
      editorGeneration += 1
      await refreshTemplates(false)
    } catch (error) {
      if (temporaryLease) await roomClient.releaseContentEditLease(temporaryLease.editLeaseId).catch(() => {})
      if (canCommit(token)) errorText = messageOf(error)
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
    if (!draft || operationPending || (selectedRecord !== null && !contentEditing)) return
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
    if (operationPending) return
    const token = beginOperation()
    const revision = jsonRevision
    const candidate = cloneJsonValue(parsed.value)
    try {
      const persisted = await persistDefinition(candidate, token, revision, 'json')
      if (!persisted || !definitionOperationIsCurrent(token, revision, 'json')) return
      const refreshed = await recordClient.list()
      if (!definitionOperationIsCurrent(token, revision, 'json')) return
      templates = refreshed
      installRecord(persisted.record, persisted.editing)
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
    if (operationPending || !roomClient) return
    const layout = jsonEditing
      ? parseAndValidateMacroTerminalLayoutFromDefinitionJson(jsonText)
      : validateMacroTerminalLayout(draft?.terminalLayout)
    if (!layout.ok) {
      errorText = 'error' in layout ? formatJsonValidation(layout) : formatIssues(layout.issues)
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
    } catch (error) { if (canCommit(token)) errorText = messageOf(error) }
    finally { preparing = false; endOperation(token) }
  }

  async function controlRunner(action: 'start' | 'pause' | 'resume' | 'stop') {
    if (operationPending) return
    if (action !== 'start') {
      const token = beginOperation()
      try {
        const nextRunner = action === 'pause' ? await runnerClient.pause()
          : action === 'resume' ? await runnerClient.resume()
            : await runnerClient.stop()
        if (canCommit(token)) installRunnerSnapshot(nextRunner)
      }
      catch (error) { if (canCommit(token)) errorText = messageOf(error) }
      finally { endOperation(token) }
      return
    }
    if (!draft || !portableValidation.ok || runtimeValidation?.status !== 'ready') return
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
      if (!record || !canCommit(token, revision)) return
      if (dirty) {
        installRecord(record, persisted?.editing ?? false)
        if (persisted?.leaseWarning) errorText = persisted.leaseWarning
        await refreshTemplates(false)
      }
      if (!canCommit(token)) return
      const nextRunner = await runnerClient.start(record.id, record.revision, structureRevision)
      if (canCommit(token)) { installRunnerSnapshot(nextRunner); errorText = null }
    } catch (error) { if (canCommit(token)) errorText = formatError(error) }
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
    if (!definitionOperationIsCurrent(token, revision, source)) return null
    if (record && result.id !== record.id) throw new Error('macro_record_identity_changed')
    if (record && result.revision !== record.revision + 1) throw new Error('macro_revision_conflict')
    if (!record && result.revision !== 1) throw new Error('macro_revision_conflict')
    if (record) {
      if (!editLease || !contentEditing) throw new Error('content_edit_lease_required')
      if (updateResult?.leaseOutcome.status === 'retained') {
        editLease = updateResult.leaseOutcome.grant
        leaseView = { mode: 'held', leaseEpoch: updateResult.leaseOutcome.grant.leaseEpoch, expiresAt: updateResult.leaseOutcome.grant.expiresAt }
        return { record: result, editing: true, leaseWarning: null }
      }
      editLease = null
      leaseView = null
      return { record: result, editing: false, leaseWarning: updateResult?.leaseOutcome.status === 'lost' ? updateResult.leaseOutcome.reason : 'content_edit_lease_lost' }
    }
    const acquired = await acquireCreatedRecordEditLease(result, () => definitionOperationIsCurrent(token, revision, source))
    if (acquired === null) return null
    return {
      record: result,
      editing: acquired.ok,
      leaseWarning: acquired.ok ? null : `macro_saved_but_edit_lease_not_retained:${acquired.reason}`,
    }
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
    if (operationPending) return
    const token = beginOperation()
    const value = runnerInput
    try {
      const nextRunner = await runnerClient.submitInput(value)
      if (canCommit(token)) installRunnerSnapshot(nextRunner)
    } catch (error) { if (canCommit(token)) errorText = messageOf(error) }
    finally { endOperation(token) }
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
    const waitingInvocationChanged = next.inputPrompt !== null && (
      runner?.runId !== next.runId
      || runner?.currentNodeId !== next.currentNodeId
      || runner?.inputPrompt !== next.inputPrompt
      || runner?.status !== 'waiting_input'
    )
    if (waitingInvocationChanged) runnerInput = next.inputDefaultText ?? ''
    else if (next.inputPrompt === null) runnerInput = ''
    runner = next
  }

  function installRecord(record: MacroRecord, editing = false) {
    selectedRecord = cloneJsonValue(record)
    baseDefinition = cloneJsonValue(record.definition)
    draft = cloneJsonValue(record.definition)
    dirty = false
    contentEditing = editing
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

  function beginOperation(): number {
    operationGeneration += 1
    operationControlEpoch = roomClient?.controlGrant?.controlEpoch ?? null
    operationPending = true
    errorText = null
    return operationGeneration
  }
  function endOperation(token: number) { if (operationGeneration === token) operationPending = false }
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

  function formatIssues(issues: Array<{ path: string; code?: string; message: string }>): string { return issues.map((issue) => `${issue.path || '<root>'}: ${issue.code ? `${issue.code}: ` : ''}${issue.message}`).join('\n') }
  function formatJsonValidation(result: { ok: false; error: { code: string; message?: string; issues?: Array<{ path: string; code?: string; message: string }> } }): string {
    return result.error.issues ? formatIssues(result.error.issues) : result.error.message ?? result.error.code
  }
  function formatError(error: unknown): string {
    const response = error instanceof Error && 'response' in error ? (error as Error & { response?: { issues?: Array<{ path: string; code?: string; message: string }> } }).response : undefined
    return response?.issues ? formatIssues(response.issues) : messageOf(error)
  }
  function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
</script>

<section class="macro-panel" data-testid="macro-panel">
  <MacroWorkbenchChrome
    {templates} {filteredTemplates} {draft} {selectedRecord} {templateSearch} {dirty} {contentEditing} mutationAllowed={canMutateShared}
    {errorText} {macroView} {runner} {statusText} {runnerInput} {preparing}
    prepareDisabled={prepareState.disabled} prepareDisabledReason={prepareState.reason}
    startDisabled={startState.disabled} startDisabledReason={startState.reason}
    {jsonEditing} {operationPending}
    onTemplateSearchChange={(value) => { templateSearch = value }} onSelectTemplate={selectTemplate}
    onCreateTemplate={() => void createTemplate()} onBeginEdit={() => void beginEdit()} onSaveTemplate={() => void saveTemplate()}
    onCancelEdit={() => void cancelEdit()} onDeleteTemplate={() => void deleteTemplate()} onUpdateDraft={updateDraft}
    onResetWidth={onResetWidth} onPrepare={() => void prepareTerminals()} onRunnerInputChange={(value) => { runnerInput = value }}
    onSubmitRunnerInput={() => void submitRunnerInput()} onRefreshRunner={() => void refreshRunner()}
    onMacroControl={(action) => void controlRunner(action)} onViewChange={(view) => { if (!jsonEditing) { macroView = view; if (view === 'trace') void refreshTraces() } }}
  />

  <div class="macro-view-scroll" data-testid="macro-view-scroll">
    {#if macroView === 'editor'}
      {#key editorGeneration}
        {#if draft}
          <MacroEditorShell {draft} validation={portableValidation} runtimePositions={terminalPositions} {insertionPaletteMode}
            {telegramProfileIds} {telegramProfilesError} locked={editorLocked} editorKey={`${selectedRecord?.id ?? 'new'}:${editorGeneration}`}
            onUpdateDraft={updateDraft} />
        {:else}
          <p class="hint">Create or select a macro.</p>
        {/if}
      {/key}
    {:else if macroView === 'json'}
      <MacroJsonView {draft} {jsonPreview} editing={jsonEditing} saving={operationPending} editText={jsonText} editError={jsonError} canEdit={canMutateShared}
        {operationPending} onStartEdit={startJsonBuffer} onEditTextChange={updateJsonText} onSave={saveJson} onCancel={cancelJson}
        onCopyResult={(error) => { errorText = error }} />
    {:else}
      <MacroTraceView {runner} {traces} />
    {/if}
  </div>
</section>
