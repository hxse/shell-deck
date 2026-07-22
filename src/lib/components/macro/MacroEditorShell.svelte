<script lang="ts">
  import type { TerminalRuntimePosition } from '../../protocol'
  import type { MacroDefinitionV5 } from '../../macro/macroDefinitionTypes'
  import type { MacroDefinitionValidation } from '../../macro/macroDefinitionValidation'
  import { adoptRuntimeTerminal, reconcileVisualTerminalLayout } from '../../macro/macroTerminalLayoutAuthoring'
  import { terminalRuntimeChoices, type TerminalChoice } from '../../macro/macroTerminalChoices'
  import MacroStepList from './MacroStepList.svelte'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'

  let {
    draft,
    validation,
    runnableValidation,
    runtimePositions = null,
    insertionPaletteMode,
    telegramProfileIds = [],
    telegramProfilesError = '',
    locked = false,
    lockedReason = 'macro_editor_read_only',
    currentNodeId = null,
    editorKey = 'new',
    onMutationDenied = () => {},
    onUpdateDraft,
  } = $props<{
    draft: MacroDefinitionV5
    validation: MacroDefinitionValidation
    runnableValidation: MacroDefinitionValidation
    runtimePositions?: TerminalRuntimePosition[] | null
    insertionPaletteMode: MacroInsertionPaletteMode
    telegramProfileIds?: string[]
    telegramProfilesError?: string
    locked?: boolean
    lockedReason?: string
    currentNodeId?: string | null
    editorKey?: string
    onMutationDenied?: (reason: string) => void
    onUpdateDraft: (mutator: (definition: MacroDefinitionV5) => void) => void
  }>()

  const lockedMessage = $derived(lockReasonMessage(lockedReason))
  const hardDisabled = $derived(locked && lockedReason === 'macro_run_active')

  function lockReasonMessage(reason: string): string {
    if (reason === 'macro_run_active') return 'Active macro run · editing is locked until the run finishes or stops.'
    if (reason === 'room_control_required') return 'Read-only · take Room control to edit this macro.'
    if (reason === 'operation_pending') return 'Read-only · wait for the pending macro operation to finish.'
    if (reason === 'content_edit_lease_lost') return 'Read-only · the content edit lease was lost.'
    if (reason === 'content_edit_lease_required') return 'Read-only · choose Edit to acquire the content lease.'
    return 'Macro editor is read-only.'
  }

  function terminalChoices(): TerminalChoice[] { return terminalRuntimeChoices(runtimePositions) }
  function choiceFromIndex(index: number): string { return String(index) }
  function updateVisualDraft(mutator: (definition: MacroDefinitionV5) => void) {
    onUpdateDraft((definition: MacroDefinitionV5) => {
      mutator(definition)
      reconcileVisualTerminalLayout(definition)
    })
  }

  function adoptTerminalSelection(definition: MacroDefinitionV5, terminalIndex: number): boolean {
    return adoptRuntimeTerminal(definition, terminalIndex, runtimePositions).ok
  }

  function guardLockedField(event: Event) {
    if (!locked) return
    const target = event.target
    if (target instanceof Element && target.closest('button')) return
    event.preventDefault()
    event.stopPropagation()
    onMutationDenied(lockedReason)
  }

  function guardLockedFields(node: HTMLElement) {
    const guard = (event: Event) => guardLockedField(event)
    node.addEventListener('click', guard)
    node.addEventListener('keydown', guard)
    node.addEventListener('beforeinput', guard)
    return {
      destroy() {
        node.removeEventListener('click', guard)
        node.removeEventListener('keydown', guard)
        node.removeEventListener('beforeinput', guard)
      },
    }
  }
</script>

<div class="macro-editor-layout no-tools grid min-h-0 min-w-0 grid-cols-1 gap-2 overflow-hidden pb-2">
    <main class="macro-editor-main grid min-h-0 min-w-0 content-start gap-1.5 overflow-auto">
      {#if locked}
        <div class="macro-editor-lock-notice alert alert-warning sticky top-0 z-[8] mb-2 min-h-9 border-2 px-3 py-2 text-xs font-bold shadow-sm" data-testid="macro-editor-lock-notice" data-lock-reason={lockedReason} role="status">
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.6]" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" /></svg>
          <span>{lockedMessage}</span>
        </div>
      {/if}
      <fieldset class="macro-editor-lock-surface fieldset min-w-0 border-0 p-0 data-[editor-locked=true]:cursor-not-allowed data-[editor-locked=true]:rounded-field data-[editor-locked=true]:bg-warning/10 data-[editor-locked=true]:ring-2 data-[editor-locked=true]:ring-warning/40 data-[editor-locked=true]:[&_input]:pointer-events-none data-[editor-locked=true]:[&_input]:bg-base-200 data-[editor-locked=true]:[&_input]:text-base-content/55 data-[editor-locked=true]:[&_select]:pointer-events-none data-[editor-locked=true]:[&_select]:bg-base-200 data-[editor-locked=true]:[&_select]:text-base-content/55 data-[editor-locked=true]:[&_textarea]:pointer-events-none data-[editor-locked=true]:[&_textarea]:bg-base-200 data-[editor-locked=true]:[&_textarea]:text-base-content/55 data-[editor-locked=true]:[&_.step-editor]:opacity-75 data-[editor-locked=true]:[&_.current-node]:opacity-100 data-[editor-lock-reason=macro_run_active]:bg-error/10 data-[editor-lock-reason=macro_run_active]:ring-error/50 disabled:pointer-events-auto disabled:opacity-100" data-testid="macro-editor-lock-surface" data-editor-locked={locked} data-editor-lock-reason={locked ? lockedReason : undefined} aria-disabled={hardDisabled} disabled={hardDisabled}
        use:guardLockedFields>
        {#key editorKey}
          <MacroStepList
            {draft}
            {validation}
            {runnableValidation}
            updateDraft={updateVisualDraft}
            {terminalChoices}
            {adoptTerminalSelection}
            {choiceFromIndex}
            {insertionPaletteMode}
            {telegramProfileIds}
            {telegramProfilesError}
            {currentNodeId}
          />
        {/key}
      </fieldset>
    </main>
  </div>
