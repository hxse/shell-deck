<script lang="ts">
  import type { TerminalRuntimePosition } from '../../protocol'
  import type { CaptureSourceConfig, FlowV2ArtifactSource, MacroDefinitionV3, TextMatchCondition } from '../../macro/macroDefinitionTypes'
  import type { MacroDefinitionValidation } from '../../macro/macroDefinitionValidation'
  import { adoptRuntimeTerminal, reconcileVisualTerminalLayout } from '../../macro/macroTerminalLayoutAuthoring'
  import { terminalRuntimeChoices, type TerminalChoice } from '../../macro/macroTerminalChoices'
  import MacroStepList from './MacroStepList.svelte'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'

  let {
    draft,
    validation,
    runtimePositions = null,
    insertionPaletteMode,
    telegramProfileIds = [],
    telegramProfilesError = '',
    locked = false,
    editorKey = 'new',
    onUpdateDraft,
  } = $props<{
    draft: MacroDefinitionV3
    validation: MacroDefinitionValidation
    runtimePositions?: TerminalRuntimePosition[] | null
    insertionPaletteMode: MacroInsertionPaletteMode
    telegramProfileIds?: string[]
    telegramProfilesError?: string
    locked?: boolean
    editorKey?: string
    onUpdateDraft: (mutator: (definition: MacroDefinitionV3) => void) => void
  }>()

  function terminalChoices(): TerminalChoice[] { return terminalRuntimeChoices(runtimePositions) }
  function choiceFromIndex(index: number): string { return String(index) }
  function indexFromChoice(choice: string): number { return Number(choice) }
  function firstTerminalIndex(): number { return terminalChoices()[0]?.index ?? 1 }

  function updateVisualDraft(mutator: (definition: MacroDefinitionV3) => void) {
    onUpdateDraft((definition: MacroDefinitionV3) => {
      mutator(definition)
      reconcileVisualTerminalLayout(definition)
    })
  }

  function adoptTerminalSelection(definition: MacroDefinitionV3, terminalIndex: number): boolean {
    return adoptRuntimeTerminal(definition, terminalIndex, runtimePositions).ok
  }

  function defaultCaptureSource(kind: CaptureSourceConfig['kind']): CaptureSourceConfig {
    const terminalIndex = firstTerminalIndex()
    if (kind === 'agent-event') return { kind, terminalIndex, agent: { kind: 'codex' }, captureMode: 'result_only' }
    if (kind === 'text-box') return { kind, terminalIndex }
    return { kind, terminalIndex, mode: 'scrollback-tail', maxChars: 20000 }
  }

  function defaultCondition(source: FlowV2ArtifactSource): TextMatchCondition {
    return { kind: 'text_match', source, matcher: { kind: 'simple', op: 'contains', text: 'READY' }, scope: { kind: 'whole' } }
  }
</script>

<div class="macro-editor-layout no-tools">
    <main class="macro-editor-main">
      <fieldset class="macro-editor-lock-surface" data-testid="macro-editor-lock-surface" disabled={locked} inert={locked} aria-busy={locked} aria-disabled={locked}>
        {#key editorKey}
          <MacroStepList
            {draft}
            {validation}
            updateDraft={updateVisualDraft}
            {terminalChoices}
            {adoptTerminalSelection}
            {choiceFromIndex}
            {indexFromChoice}
            {defaultCaptureSource}
            {defaultCondition}
            {insertionPaletteMode}
            {telegramProfileIds}
            {telegramProfilesError}
          />
        {/key}
      </fieldset>
    </main>
  </div>
