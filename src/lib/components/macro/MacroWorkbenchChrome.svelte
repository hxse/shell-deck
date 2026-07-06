<script lang="ts">
  import type { MacroRunnerSnapshot } from '../../macro/runnerTypes'
  import type { MacroTemplate, TemplateSummary } from '../../macro/templateTypes'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
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
    insertionPaletteMode,
    onInsertionPaletteModeChange,
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
    insertionPaletteMode: MacroInsertionPaletteMode
    onInsertionPaletteModeChange: (mode: MacroInsertionPaletteMode) => void
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
      onMacroControl={onMacroControl}
    />
  </div>

  <div class="macro-tabs" role="tablist" aria-label="Macro views">
    <button type="button" role="tab" aria-selected={macroView === 'editor'} class:active={macroView === 'editor'} data-testid="macro-tab-editor" onclick={() => onViewChange('editor')}>Editor</button>
    <button type="button" role="tab" aria-selected={macroView === 'json'} class:active={macroView === 'json'} data-testid="macro-tab-json" onclick={() => onViewChange('json')}>JSON</button>
    <button type="button" role="tab" aria-selected={macroView === 'trace'} class:active={macroView === 'trace'} data-testid="macro-tab-trace" onclick={() => onViewChange('trace')}>Trace</button>
    <button
      type="button"
      class="macro-insertion-placement-toggle"
      data-testid="macro-insertion-placement-toggle"
      aria-pressed={insertionPaletteMode === 'center'}
      title={insertionPaletteMode === 'anchored' ? 'Insertion palette opens near the clicked button' : 'Insertion palette opens in the center'}
      onclick={() => onInsertionPaletteModeChange(insertionPaletteMode === 'anchored' ? 'center' : 'anchored')}
    >
      Insert: {insertionPaletteMode === 'anchored' ? 'near' : 'center'}
    </button>
  </div>
</div>
