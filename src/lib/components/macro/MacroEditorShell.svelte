<script lang="ts">
  import type { TerminalRuntimePosition } from '../../protocol'
  import type { MacroDefinitionV6 } from '../../macro/macroDefinitionTypes'
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
    onBeginEdit,
    onMutationDenied = () => {},
    onUpdateDraft,
  } = $props<{
    draft: MacroDefinitionV6
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
    onBeginEdit: () => void
    onMutationDenied?: (reason: string) => void
    onUpdateDraft: (mutator: (definition: MacroDefinitionV6) => void) => void
  }>()

  const lockedMessage = $derived(lockReasonMessage(lockedReason))
  const hardDisabled = $derived(locked && lockedReason === 'macro_run_active')
  const normalReadOnly = $derived(lockedReason === 'content_edit_lease_required')
  const runLocked = $derived(lockedReason === 'macro_run_active')

  function lockReasonMessage(reason: string): string {
    if (reason === 'macro_run_active') return 'Active macro run · editing is locked until the run finishes or stops.'
    if (reason === 'room_control_required') return 'Read-only · take Room control to edit this macro.'
    if (reason === 'operation_pending') return 'Read-only · wait for the pending macro operation to finish.'
    if (reason === 'content_edit_lease_lost') return 'Read-only · the content edit lease was lost.'
    if (reason === 'content_edit_lease_required') return 'Read-only · click to Edit and acquire the content lease.'
    return 'Macro editor is read-only.'
  }

  function activateNormalReadOnlyNotice(event: MouseEvent | KeyboardEvent): void {
    if (!normalReadOnly || !locked) return
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
    }
    onBeginEdit()
  }

  function terminalChoices(): TerminalChoice[] { return terminalRuntimeChoices(runtimePositions) }
  function updateVisualDraft(mutator: (definition: MacroDefinitionV6) => void) {
    onUpdateDraft((definition: MacroDefinitionV6) => {
      mutator(definition)
      reconcileVisualTerminalLayout(definition)
    })
  }

  function adoptTerminalSelection(definition: MacroDefinitionV6, terminalIndex: number): boolean {
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
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (role is button exactly when normalReadOnly enables tabindex) -->
        <div class="macro-editor-lock-notice alert sticky top-0 z-[8] mb-2 min-h-9 px-3 py-2 text-xs font-bold data-[click-to-edit=true]:cursor-pointer data-[click-to-edit=true]:select-none data-[click-to-edit=true]:transition-colors data-[click-to-edit=true]:hover:bg-info/20 data-[click-to-edit=true]:active:bg-info/25 data-[click-to-edit=true]:focus-visible:outline-2 data-[click-to-edit=true]:focus-visible:-outline-offset-2 data-[click-to-edit=true]:focus-visible:outline-info/60" class:alert-info={normalReadOnly} class:alert-soft={normalReadOnly} class:alert-warning={!normalReadOnly && !runLocked} class:alert-error={runLocked} data-testid="macro-editor-lock-notice" data-lock-reason={lockedReason} data-click-to-edit={normalReadOnly} role={normalReadOnly ? 'button' : 'status'} tabindex={normalReadOnly ? 0 : undefined} onclick={normalReadOnly ? activateNormalReadOnlyNotice : undefined} onkeydown={normalReadOnly ? activateNormalReadOnlyNotice : undefined}>
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.6]" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" /></svg>
          <span>{lockedMessage}</span>
        </div>
      {/if}
      <fieldset class="macro-editor-lock-surface fieldset min-w-0 border-0 p-0 data-[editor-locked=true]:cursor-default data-[editor-locked=true]:[&_input]:pointer-events-none data-[editor-locked=true]:[&_select]:pointer-events-none data-[editor-locked=true]:[&_textarea]:pointer-events-none data-[editor-lock-reason=macro_run_active]:rounded-field data-[editor-lock-reason=macro_run_active]:bg-error/10 data-[editor-lock-reason=macro_run_active]:ring-2 data-[editor-lock-reason=macro_run_active]:ring-error/50 disabled:pointer-events-auto disabled:opacity-100" data-testid="macro-editor-lock-surface" data-editor-locked={locked} data-editor-lock-reason={locked ? lockedReason : undefined} aria-disabled={hardDisabled} disabled={hardDisabled}
        use:guardLockedFields>
        {#key editorKey}
          <MacroStepList
            {draft}
            {validation}
            {runnableValidation}
            updateDraft={updateVisualDraft}
            {terminalChoices}
            {adoptTerminalSelection}
            {insertionPaletteMode}
            {telegramProfileIds}
            {telegramProfilesError}
            {currentNodeId}
          />
        {/key}
      </fieldset>
    </main>
  </div>
