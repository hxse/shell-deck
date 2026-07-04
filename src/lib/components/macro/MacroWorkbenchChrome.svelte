<script lang="ts">
  import type { MacroRunnerSnapshot } from '../../macro/runnerTypes'
  import type { MacroTemplate, TemplateSummary } from '../../macro/templateTypes'
  import MacroRunDock from './MacroRunDock.svelte'
  import MacroTemplateSelector from './MacroTemplateSelector.svelte'

  type MacroView = 'editor' | 'json' | 'trace'

  let {
    templates,
    filteredTemplates,
    draft,
    selectedTemplateId,
    selectedTemplateName,
    templateSearch,
    errorText,
    macroView,
    runner,
    statusText,
    runnerInput,
    onTemplateSearchChange,
    onSelectTemplate,
    onCreateTemplate,
    onSaveTemplate,
    onDuplicateTemplate,
    onImportTemplate,
    onExportTemplate,
    onDeleteTemplate,
    onUpdateDraft,
    onResetWidth,
    onRunnerInputChange,
    onSubmitRunnerInput,
    onRefreshRunner,
    onViewChange,
  } = $props<{
    templates: TemplateSummary[]
    filteredTemplates: TemplateSummary[]
    draft: MacroTemplate | null
    selectedTemplateId: string | null
    selectedTemplateName: string | null
    templateSearch: string
    errorText: string | null
    macroView: MacroView
    runner: MacroRunnerSnapshot | null
    statusText: string
    runnerInput: string
    onTemplateSearchChange: (value: string) => void
    onSelectTemplate: (templateId: string) => void
    onCreateTemplate: () => void
    onSaveTemplate: () => void
    onDuplicateTemplate: () => void
    onImportTemplate: (event: Event) => void
    onExportTemplate: () => void
    onDeleteTemplate: () => void
    onUpdateDraft: (mutator: (template: MacroTemplate) => void) => void
    onResetWidth?: () => void
    onRunnerInputChange: (value: string) => void
    onSubmitRunnerInput: () => void
    onRefreshRunner: () => void
    onViewChange: (view: MacroView) => void
  }>()
</script>

<MacroTemplateSelector
  {templates}
  {filteredTemplates}
  {draft}
  {selectedTemplateId}
  {selectedTemplateName}
  {templateSearch}
  onTemplateSearchChange={onTemplateSearchChange}
  onSelectTemplate={onSelectTemplate}
  onCreateTemplate={onCreateTemplate}
  onSaveTemplate={onSaveTemplate}
  onDuplicateTemplate={onDuplicateTemplate}
  onImportTemplate={onImportTemplate}
  onExportTemplate={onExportTemplate}
  onDeleteTemplate={onDeleteTemplate}
  onUpdateDraft={onUpdateDraft}
  onResetWidth={onResetWidth}
/>

{#if errorText}
  <div class="macro-error" role="alert">{errorText}</div>
{/if}

<div class="macro-sticky-head" data-testid="macro-sticky-head">
  <div class="macro-top-dock" data-testid="macro-top-dock">
    <MacroRunDock
      {runner}
      {statusText}
      {runnerInput}
      onRunnerInputChange={onRunnerInputChange}
      onSubmitRunnerInput={onSubmitRunnerInput}
      onRefreshRunner={onRefreshRunner}
    />
  </div>

  <div class="macro-tabs" role="tablist" aria-label="Macro views">
    <button type="button" role="tab" aria-selected={macroView === 'editor'} class:active={macroView === 'editor'} data-testid="macro-tab-editor" onclick={() => onViewChange('editor')}>Editor</button>
    <button type="button" role="tab" aria-selected={macroView === 'json'} class:active={macroView === 'json'} data-testid="macro-tab-json" onclick={() => onViewChange('json')}>JSON</button>
    <button type="button" role="tab" aria-selected={macroView === 'trace'} class:active={macroView === 'trace'} data-testid="macro-tab-trace" onclick={() => onViewChange('trace')}>Trace</button>
  </div>
</div>
