<script lang="ts">
  import type { MacroDefinitionV6 } from '../../macro/macroDefinitionTypes'
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
    insertionPaletteMode,
    telegramProfileIds = [],
    telegramProfilesError = '',
    currentNodeId = null,
  } = $props<{
    draft: MacroDefinitionV6
    validation: MacroDefinitionValidation
    runnableValidation: MacroDefinitionValidation
    updateDraft: (mutator: (template: MacroDefinitionV6) => void) => void
    terminalChoices: () => TerminalChoice[]
    adoptTerminalSelection: (template: MacroDefinitionV6, terminalIndex: number) => boolean
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

<details class="macro-section validation-panel validation-panel-compact min-h-0 shrink-0 border-y border-base-300 bg-base-100" data-testid="macro-validation">
  <summary class="flex min-h-8 items-center px-3 py-2 text-xs" data-testid="macro-validation-toggle">
    <strong>Validation</strong>
    <span class="badge badge-sm ml-2 text-[11px]" class:badge-success={validation.ok && runnableIssues.length === 0} class:badge-warning={validation.ok && runnableIssues.length > 0} class:badge-error={!validation.ok} class:ok={validation.ok && runnableIssues.length === 0} class:warning={validation.ok && runnableIssues.length > 0} class:bad={!validation.ok} data-testid="macro-validation-summary">{validationSummary}</span>
  </summary>
  {#if validation.ok}
    <p class="px-3 text-xs">Template validation passed.</p>
    {#if runnableIssues.length > 0}
      <p class="runnable-validation-warning px-3 text-xs text-warning" data-testid="macro-runnable-warning">Save is allowed, but Start requires {runnableIssues.length} reference{runnableIssues.length === 1 ? '' : 's'} to be assigned.</p>
      <ul class="px-7 pb-2 text-xs">{#each runnableIssues as issue}<li><strong>{issue.path}</strong> {issue.message}</li>{/each}</ul>
    {/if}
  {:else}
    <ul class="px-7 pb-2 text-xs">{#each validation.issues as issue}<li><strong>{issue.path}</strong> {issue.message}</li>{/each}</ul>
  {/if}
</details>

<MacroFlowNodeList
  {draft}
  {updateDraft}
  {terminalChoices}
  {adoptTerminalSelection}
  {insertionPaletteMode}
  {telegramProfileIds}
  {telegramProfilesError}
  {currentNodeId}
/>
