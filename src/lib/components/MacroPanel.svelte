<script lang="ts">
  import { onMount } from 'svelte'
  import type { ContentEditLeaseChangedMessage, ContentRecordChangedMessage, RoomSnapshot, TerminalRuntimePosition } from '../protocol'
  import type { TerminalRoomClient } from '../terminalRoomClient'
  import type { MacroInsertionPaletteMode } from '../workspace/uiLayoutTypes'
  import { validateMacroDefinitionV5, validateRunnableMacroDefinitionV5 } from '../macro/macroDefinitionValidation'
  import { createMacroJsonEditSession, messageOf } from '../macro/macroJsonEditSession.svelte'
  import { createMacroRecordSession } from '../macro/macroRecordSession.svelte'
  import { createMacroRunnerSession } from '../macro/macroRunnerSession.svelte'
  import { validateMacroRuntimeBinding } from '../macro/macroRuntimeBinding'
  import type { MacroRunnerSnapshot } from '../macro/runnerTypes'
  import MacroEditorShell from './macro/MacroEditorShell.svelte'
  import MacroJsonView from './macro/MacroJsonView.svelte'
  import MacroTraceView from './macro/MacroTraceView.svelte'
  import MacroWorkbenchChrome, { type MacroView } from './macro/MacroWorkbenchChrome.svelte'

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

  let templateSearch = $state('')
  let macroView = $state<MacroView>('editor')
  let telegramProfileIds = $state<string[]>([])
  let telegramProfilesError = $state('')

  const jsonSession = createMacroJsonEditSession()
  const recordSession = createMacroRecordSession({
    roomClient: () => roomClient,
    canMutateShared: () => canMutateShared,
    connectionGeneration: () => connectionGeneration,
    contentRecordChanges: () => contentRecordChanges,
    contentEditLeaseChanges: () => contentEditLeaseChanges,
    json: jsonSession,
    showEditor: () => { macroView = 'editor' },
    showJson: () => { macroView = 'json' },
    onMutationDenied: (reason) => onMutationDenied(reason),
  })
  const runnerSession = createMacroRunnerSession({
    roomClient: () => roomClient,
    canMutateShared: () => canMutateShared,
    terminalStructureRevision: () => terminalStructureRevision,
    terminalPositions: () => terminalPositions,
    terminalStructureLocked: () => terminalStructureLocked,
    runnerSnapshot: () => runnerSnapshot,
    record: recordSession,
    json: jsonSession,
    onRoomSnapshot: (snapshot) => onRoomSnapshot(snapshot),
  })

  const templates = $derived(recordSession.templates)
  const filteredTemplates = $derived(templates.filter((template) => `${template.name}\n${template.description}`.toLowerCase().includes(templateSearch.trim().toLowerCase())))
  const selectedRecord = $derived(recordSession.selectedRecord)
  const draft = $derived(recordSession.draft)
  const dirty = $derived(recordSession.dirty)
  const contentEditing = $derived(recordSession.contentEditing)
  const leaseLost = $derived(recordSession.leaseLost)
  const operationPending = $derived(recordSession.operationPending)
  const editorGeneration = $derived(recordSession.editorGeneration)
  const saveToLibraryLabel = $derived(recordSession.saveToLibraryLabel)
  const jsonEditing = $derived(jsonSession.editing)
  const jsonText = $derived(jsonSession.text)
  const jsonError = $derived(jsonSession.error)
  const runner = $derived(runnerSession.runner)
  const traces = $derived(runnerSession.traces)
  const runnerInput = $derived(runnerSession.runnerInput)
  const runnerInputSyncing = $derived(runnerSession.runnerInputSyncing)
  const preparing = $derived(runnerSession.preparing)
  const portableValidation = $derived(validateMacroDefinitionV5(draft))
  const runnableValidation = $derived(validateRunnableMacroDefinitionV5(draft))
  const runtimeValidation = $derived(draft ? validateMacroRuntimeBinding(draft.terminalLayout, terminalPositions) : null)
  const jsonPreview = $derived(draft ? JSON.stringify(draft, null, 2) : '')
  const statusText = $derived(runtimeValidation?.code ?? 'no_macro_selected')
  const editorLocked = $derived(!canMutateShared || operationPending || (selectedRecord !== null && !contentEditing))
  const prepareState = $derived(runnerSession.prepareState)
  const startState = $derived(runnerSession.startState)
  const displayedErrorText = $derived([recordSession.errorText, recordSession.templateListProblem].filter((value): value is string => Boolean(value)).join('\n') || null)

  $effect(() => {
    onDirtyChange(dirty || jsonEditing || recordSession.publishedCreateBufferPreserved)
  })

  onMount(() => {
    const disposeRecordSession = recordSession.mount()
    runnerSession.mount()
    void loadNotificationProfiles()
    return disposeRecordSession
  })

  export async function loadFromLibrary(itemId: string, expectedRevision: number): Promise<{ selected: boolean; recordId: string }> {
    return await recordSession.loadFromLibrary(itemId, expectedRevision)
  }

  async function loadNotificationProfiles() {
    try {
      const response = await fetch('/api/notification-profiles/telegram')
      const body = await response.json() as { ok?: boolean; profiles?: string[]; error?: string }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'notification_profiles_unavailable')
      telegramProfileIds = body.profiles ?? []
    } catch (error) {
      telegramProfilesError = messageOf(error)
    }
  }

  const selectTemplate = recordSession.selectTemplate
  const createTemplate = recordSession.createTemplate
  const beginEdit = recordSession.beginEdit
  const saveTemplate = recordSession.saveTemplate
  const saveCurrentDraftToLibrary = recordSession.saveCurrentDraftToLibrary
  const cancelEdit = recordSession.cancelEdit
  const deleteTemplate = recordSession.deleteTemplate
  const updateDraft = recordSession.updateDraft
  const startJsonBuffer = recordSession.startJsonBuffer
  const saveJson = recordSession.saveJson
  const prepareTerminals = runnerSession.prepareTerminals
  const updateRunnerInput = runnerSession.updateRunnerInput
  const submitRunnerInput = runnerSession.submitRunnerInput
  const refreshRunner = runnerSession.refreshRunner
  const refreshTraces = runnerSession.refreshTraces
  const controlRunner = runnerSession.controlRunner

  function updateJsonText(value: string): void {
    jsonSession.update(value, operationPending)
  }

  function cancelJson(): void {
    jsonSession.cancel(operationPending)
  }
</script>

<section class="macro-panel" data-testid="macro-panel">
  <MacroWorkbenchChrome
    {templates} {filteredTemplates} {draft} {selectedRecord} {templateSearch} {dirty} {contentEditing} mutationAllowed={canMutateShared}
    errorText={displayedErrorText} {macroView} {runner} {statusText} {runnerInput} {runnerInputSyncing} {preparing} {saveToLibraryLabel}
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
          <MacroEditorShell {draft} validation={portableValidation} {runnableValidation} runtimePositions={terminalPositions} {insertionPaletteMode}
            {telegramProfileIds} {telegramProfilesError} locked={editorLocked} editorKey={`${selectedRecord?.id ?? 'new'}:${editorGeneration}`}
            lockedReason={!canMutateShared ? 'room_control_required' : operationPending ? 'operation_pending' : leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required'}
            {onMutationDenied} onUpdateDraft={updateDraft} />
        {:else}
          <p class="hint">Create or select a macro.</p>
        {/if}
      {/key}
    {:else if macroView === 'json'}
      <MacroJsonView {draft} {runnableValidation} {jsonPreview} editing={jsonEditing} saving={operationPending} editText={jsonText} editError={jsonError} canEdit={canMutateShared && (selectedRecord === null || contentEditing)}
        {operationPending} onStartEdit={startJsonBuffer} onEditTextChange={updateJsonText} onSave={saveJson} onCancel={cancelJson}
        onCopyResult={(error) => { recordSession.setErrorText(error) }} />
    {:else}
      <MacroTraceView {runner} {traces} />
    {/if}
  </div>
</section>
