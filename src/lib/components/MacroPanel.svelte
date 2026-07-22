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
  import { isActiveMacroRunnerStatus, type MacroRunnerSnapshot } from '../macro/runnerTypes'
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
  const runActive = $derived(isActiveMacroRunnerStatus(runner?.status))
  const traces = $derived(runnerSession.traces)
  const runnerInput = $derived(runnerSession.runnerInput)
  const runnerInputSyncing = $derived(runnerSession.runnerInputSyncing)
  const preparing = $derived(runnerSession.preparing)
  const portableValidation = $derived(validateMacroDefinitionV5(draft))
  const runnableValidation = $derived(validateRunnableMacroDefinitionV5(draft))
  const runtimeValidation = $derived(draft ? validateMacroRuntimeBinding(draft.terminalLayout, terminalPositions) : null)
  const jsonPreview = $derived(draft ? JSON.stringify(draft, null, 2) : '')
  const statusText = $derived(runtimeValidation?.code ?? 'no_macro_selected')
  const editorLocked = $derived(runActive || !canMutateShared || operationPending || (selectedRecord !== null && !contentEditing))
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
  const startJsonBuffer = recordSession.startJsonBuffer
  const saveJson = recordSession.saveJson
  const prepareTerminals = runnerSession.prepareTerminals
  const updateRunnerInput = runnerSession.updateRunnerInput
  const submitRunnerInput = runnerSession.submitRunnerInput
  const refreshRunner = runnerSession.refreshRunner
  const refreshTraces = runnerSession.refreshTraces
  const controlRunner = runnerSession.controlRunner

  function updateDraft(mutator: Parameters<typeof recordSession.updateDraft>[0]): void {
    if (runActive) {
      onMutationDenied('macro_run_active')
      return
    }
    recordSession.updateDraft(mutator)
  }

  function updateJsonText(value: string): void {
    jsonSession.update(value, operationPending)
  }

  function cancelJson(): void {
    jsonSession.cancel(operationPending)
  }
</script>

<section class="macro-panel flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden border border-base-300 bg-base-100 text-[13px] text-base-content shadow-sm [&_h2]:m-0 [&_h2]:text-sm [&_h2]:font-bold [&_h3]:m-0 [&_h3]:text-[13px] [&_h3]:font-bold [&_label]:grid [&_label]:min-w-0 [&_label]:gap-1 [&_label]:text-[11px] [&_label]:font-semibold [&_input]:box-border [&_input]:h-[26px] [&_input]:min-w-0 [&_input]:w-full [&_input]:rounded-field [&_input]:border [&_input]:border-base-300 [&_input]:bg-base-100 [&_input]:px-2 [&_input]:py-1 [&_input]:text-xs [&_input]:text-base-content [&_input:focus]:border-primary [&_input:focus]:outline-none [&_input:read-only]:cursor-not-allowed [&_input:read-only]:bg-base-200 [&_input:read-only]:text-base-content/60 [&_input[type=checkbox]]:size-4 [&_input[type=checkbox]]:min-h-4 [&_input[type=checkbox]]:p-0 [&_input[type=checkbox]]:cursor-pointer [&_select]:box-border [&_select]:h-[26px] [&_select]:min-w-0 [&_select]:w-full [&_select]:rounded-field [&_select]:border [&_select]:border-base-300 [&_select]:bg-base-100 [&_select]:px-2 [&_select]:py-0 [&_select]:text-xs [&_select]:text-base-content [&_select:focus]:border-primary [&_select:focus]:outline-none [&_textarea]:box-border [&_textarea]:min-w-0 [&_textarea]:w-full [&_textarea]:rounded-field [&_textarea]:border [&_textarea]:border-base-300 [&_textarea]:bg-base-100 [&_textarea]:p-2 [&_textarea]:font-mono [&_textarea]:text-xs [&_textarea]:leading-[1.45] [&_textarea]:text-base-content [&_textarea:focus]:border-primary [&_textarea:focus]:outline-none [&_textarea:read-only]:cursor-not-allowed [&_textarea:read-only]:bg-base-200 [&_textarea:read-only]:text-base-content/60 [&_button]:box-border [&_button]:inline-flex [&_button]:h-7 [&_button]:min-h-7 [&_button]:items-center [&_button]:justify-center [&_button]:gap-1 [&_button]:rounded-field [&_button]:border [&_button]:border-base-300 [&_button]:bg-base-100 [&_button]:px-2 [&_button]:text-xs [&_button]:font-semibold [&_button]:text-base-content [&_button:hover]:border-primary/50 [&_button:hover]:bg-base-200 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-1 [&_button:focus-visible]:outline-primary [&_button[aria-disabled=true]]:!pointer-events-auto [&_button[aria-disabled=true]]:cursor-not-allowed [&_button[aria-disabled=true]]:bg-base-200 [&_button[aria-disabled=true]]:text-base-content/45 [&_button:disabled]:cursor-not-allowed [&_button:disabled]:bg-base-200 [&_button:disabled]:text-base-content/45 [&_summary]:cursor-pointer [&_code]:font-mono [&_pre]:m-0 [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:rounded-field [&_pre]:border [&_pre]:border-base-300 [&_pre]:bg-base-200 [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-[1.4] [&_small]:text-[11px] [&_small]:leading-[1.3] [&_.macro-row]:grid [&_.macro-row]:min-w-0 [&_.macro-row]:grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] [&_.macro-row]:items-end [&_.macro-row]:gap-2 [&_.checkbox-row]:!flex [&_.checkbox-row]:w-fit [&_.checkbox-row]:cursor-pointer [&_.checkbox-row]:items-center [&_.checkbox-row]:gap-1.5 [&_.checkbox-row]:text-xs [&_.step-title]:flex [&_.step-title]:min-w-0 [&_.step-title]:items-center [&_.step-title]:justify-between [&_.step-title]:gap-2 [&_.inline-actions]:flex [&_.inline-actions]:min-w-0 [&_.inline-actions]:flex-wrap [&_.inline-actions]:gap-1 [&_.message-part-row]:grid [&_.message-part-row]:min-w-0 [&_.message-part-row]:gap-2 [&_.message-part-row]:rounded-md [&_.message-part-row]:border [&_.message-part-row]:border-base-300 [&_.message-part-row]:bg-base-100 [&_.message-part-row]:p-2 [&_.hint]:m-0 [&_.hint]:text-xs [&_.hint]:text-base-content/55 [&_.agent-wait-limit]:grid [&_.agent-wait-limit]:min-w-0 [&_.agent-wait-limit]:grid-cols-[auto_minmax(0,1fr)] [&_.agent-wait-limit]:items-end [&_.agent-wait-limit]:gap-2 [&_.agent-timeout-hint]:self-center" data-testid="macro-panel">
  <MacroWorkbenchChrome
    {templates} {filteredTemplates} {draft} {selectedRecord} {templateSearch} {dirty} {contentEditing} mutationAllowed={canMutateShared}
    errorText={displayedErrorText} {macroView} {runner} {statusText} {runnerInput} {runnerInputSyncing} {preparing} {saveToLibraryLabel}
    prepareDisabled={prepareState.disabled} prepareDisabledReason={prepareState.reason}
    startDisabled={startState.disabled} startDisabledReason={startState.reason}
    {jsonEditing} {operationPending} {runActive}
    onTemplateSearchChange={(value) => { templateSearch = value }} onSelectTemplate={selectTemplate}
    onCreateTemplate={() => void createTemplate()} onBeginEdit={() => void beginEdit()} onSaveTemplate={() => void saveTemplate()}
    onSaveToLibrary={() => void saveCurrentDraftToLibrary()} onCancelEdit={() => void cancelEdit()} onDeleteTemplate={() => void deleteTemplate()} onUpdateDraft={updateDraft}
    onResetWidth={onResetWidth} onPrepare={() => void prepareTerminals()} onRunnerInputChange={updateRunnerInput}
    onSubmitRunnerInput={() => void submitRunnerInput()} onRefreshRunner={() => void refreshRunner()}
    onMacroControl={(action) => void controlRunner(action)} onViewChange={(view) => { if (!jsonEditing) { macroView = view; if (view === 'trace') void refreshTraces() } }}
  />

  <div class="macro-view-scroll min-h-0 min-w-0 flex-1 overflow-auto" data-testid="macro-view-scroll">
    {#if macroView === 'editor'}
      {#key editorGeneration}
        {#if draft}
          <MacroEditorShell {draft} validation={portableValidation} {runnableValidation} runtimePositions={terminalPositions} {insertionPaletteMode}
            {telegramProfileIds} {telegramProfilesError} locked={editorLocked} editorKey={`${selectedRecord?.id ?? 'new'}:${editorGeneration}`}
            lockedReason={runActive ? 'macro_run_active' : !canMutateShared ? 'room_control_required' : operationPending ? 'operation_pending' : leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required'}
            currentNodeId={runActive ? runner?.currentNodeId ?? null : null}
            {onMutationDenied} onUpdateDraft={updateDraft} />
        {:else}
          <p class="hint m-2 text-xs text-base-content/60">Create or select a macro.</p>
        {/if}
      {/key}
    {:else if macroView === 'json'}
      <MacroJsonView {draft} {runnableValidation} {jsonPreview} editing={jsonEditing} saving={operationPending} editText={jsonText} editError={jsonError} canEdit={!runActive && canMutateShared && (selectedRecord === null || contentEditing)}
        readOnlyReason={runActive ? 'Active macro run · JSON editing is locked until the run finishes or stops.' : !canMutateShared ? 'Read-only · take Room control to edit this macro.' : selectedRecord !== null && !contentEditing ? 'Read-only · choose Edit to acquire the content lease.' : ''}
        {operationPending} onStartEdit={startJsonBuffer} onEditTextChange={updateJsonText} onSave={saveJson} onCancel={cancelJson}
        onCopyResult={(error) => { recordSession.setErrorText(error) }} />
    {:else}
      <MacroTraceView {runner} {traces} />
    {/if}
  </div>
</section>
