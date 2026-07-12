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
    onMacroControl,
    onViewChange,
    jsonEditing = false,
    operationPending = false,
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
    onMacroControl: (action: "start" | "pause" | "resume" | "stop") => void
    onViewChange: (view: MacroView) => void
    jsonEditing?: boolean
    operationPending?: boolean
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
  locked={jsonEditing || operationPending}
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
      onMacroControl={onMacroControl}
      startDisabled={jsonEditing || operationPending}
      startDisabledReason={jsonEditing ? "Save or Cancel JSON editing before starting the runner" : "Wait for the pending template operation to finish"}
    />
  </div>

  <div class="macro-tabs" role="tablist" aria-label="Macro views">
    <button type="button" role="tab" aria-selected={macroView === 'editor'} class:active={macroView === 'editor'} data-testid="macro-tab-editor" disabled={jsonEditing} title={jsonEditing ? 'Save or Cancel JSON editing first' : undefined} onclick={() => onViewChange('editor')}>Editor</button>
    <button type="button" role="tab" aria-selected={macroView === 'json'} class:active={macroView === 'json'} data-testid="macro-tab-json" onclick={() => onViewChange('json')}>JSON</button>
    <button type="button" role="tab" aria-selected={macroView === 'trace'} class:active={macroView === 'trace'} data-testid="macro-tab-trace" disabled={jsonEditing} title={jsonEditing ? 'Save or Cancel JSON editing first' : undefined} onclick={() => onViewChange('trace')}>Trace</button>
  </div>
</div>
