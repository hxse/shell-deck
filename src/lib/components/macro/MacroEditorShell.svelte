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

<div class="macro-editor-layout no-tools">
    <main class="macro-editor-main">
      {#if locked}
        <div class="macro-editor-lock-notice" data-testid="macro-editor-lock-notice" data-lock-reason={lockedReason} role="status">
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" /></svg>
          <span>{lockedMessage}</span>
        </div>
      {/if}
      <fieldset class="macro-editor-lock-surface" data-testid="macro-editor-lock-surface" data-editor-locked={locked} data-editor-lock-reason={locked ? lockedReason : undefined} aria-disabled={hardDisabled} disabled={hardDisabled}
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
