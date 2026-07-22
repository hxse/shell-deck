<script lang="ts">
  import type { MacroDefinitionV5 } from '../../macro/macroDefinitionTypes'
  import type { MacroDefinitionIssue, MacroDefinitionValidation } from '../../macro/macroDefinitionValidation'
  import type { TerminalChoice } from '../../macro/macroTerminalChoices'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import MacroFlowNodeList from './MacroFlowNodeList.svelte'

  let {
    draft,
    validation,
    runnableValidation,
    updateDraft,
    terminalChoices,
    adoptTerminalSelection,
    choiceFromIndex,
    insertionPaletteMode,
    telegramProfileIds = [],
    telegramProfilesError = '',
    currentNodeId = null,
  } = $props<{
    draft: MacroDefinitionV5
    validation: MacroDefinitionValidation
    runnableValidation: MacroDefinitionValidation
    updateDraft: (mutator: (template: MacroDefinitionV5) => void) => void
    terminalChoices: () => TerminalChoice[]
    adoptTerminalSelection: (template: MacroDefinitionV5, terminalIndex: number) => boolean
    choiceFromIndex: (target: number) => string
    insertionPaletteMode: MacroInsertionPaletteMode
    telegramProfileIds?: string[]
    telegramProfilesError?: string
    currentNodeId?: string | null
  }>()

  const runnableIssues = $derived(runnableValidation.ok
    ? []
    : runnableValidation.issues.filter((issue: MacroDefinitionIssue) => issue.code === 'unassigned_terminal_reference' || issue.code === 'unassigned_artifact_reference'))
  const validationSummary = $derived(!validation.ok
    ? validation.issues.length + ' issues - ' + (validation.issues[0] ? validation.issues[0].path + ' ' + validation.issues[0].message : '')
    : runnableIssues.length > 0
      ? 'success · ' + runnableIssues.length + ' unassigned · not runnable'
      : 'success')
</script>

<details class="macro-section validation-panel validation-panel-compact" data-testid="macro-validation">
  <summary data-testid="macro-validation-toggle">
    <strong>Validation</strong>
    <span class:ok={validation.ok && runnableIssues.length === 0} class:warning={validation.ok && runnableIssues.length > 0} class:bad={!validation.ok} data-testid="macro-validation-summary">{validationSummary}</span>
  </summary>
  {#if validation.ok}
    <p>Template validation passed.</p>
    {#if runnableIssues.length > 0}
      <p class="runnable-validation-warning" data-testid="macro-runnable-warning">Save is allowed, but Start requires {runnableIssues.length} reference{runnableIssues.length === 1 ? '' : 's'} to be assigned.</p>
      <ul>{#each runnableIssues as issue}<li><strong>{issue.path}</strong> {issue.message}</li>{/each}</ul>
    {/if}
  {:else}
    <ul>{#each validation.issues as issue}<li><strong>{issue.path}</strong> {issue.message}</li>{/each}</ul>
  {/if}
</details>

<MacroFlowNodeList
  {draft}
  {updateDraft}
  {terminalChoices}
  {adoptTerminalSelection}
  {choiceFromIndex}
  {insertionPaletteMode}
  {telegramProfileIds}
  {telegramProfilesError}
  {currentNodeId}
/>

<style>
  .warning,
  .runnable-validation-warning {
    color: #8a5b0a;
  }
</style>
