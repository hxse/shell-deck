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
    editorKey?: string
    onMutationDenied?: (reason: string) => void
    onUpdateDraft: (mutator: (definition: MacroDefinitionV5) => void) => void
  }>()

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
      <fieldset class="macro-editor-lock-surface" data-testid="macro-editor-lock-surface" data-editor-locked={locked} aria-busy={locked}
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
          />
        {/key}
      </fieldset>
    </main>
  </div>
