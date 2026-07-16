<script lang="ts">
  import type { MacroDefinitionV3, MacroRecord, MacroRecordSummary } from '../../macro/macroDefinitionTypes'
  import type { MacroRunnerSnapshot } from '../../macro/runnerTypes'
  import MacroRunDock from './MacroRunDock.svelte'
  import MacroTemplateSelector from './MacroTemplateSelector.svelte'

  export type MacroView = 'editor' | 'json' | 'trace'

  let {
    templates, filteredTemplates, draft, selectedRecord, templateSearch, dirty, contentEditing, mutationAllowed = true,
    errorText, macroView, runner, statusText, runnerInput, runnerInputSyncing = false, preparing = false,
    prepareDisabled = false, prepareDisabledReason = '', startDisabled = false, startDisabledReason = '',
    jsonEditing = false, operationPending = false,
    onTemplateSearchChange, onSelectTemplate, onCreateTemplate, onBeginEdit, onSaveTemplate,
    onCancelEdit, onDeleteTemplate, onUpdateDraft, onResetWidth, onPrepare,
    onRunnerInputChange, onSubmitRunnerInput, onRefreshRunner, onMacroControl, onViewChange,
  } = $props<{
    templates: MacroRecordSummary[]; filteredTemplates: MacroRecordSummary[]; draft: MacroDefinitionV3 | null; selectedRecord: MacroRecord | null
    templateSearch: string; dirty: boolean; contentEditing: boolean; mutationAllowed?: boolean; errorText: string | null; macroView: MacroView; runner: MacroRunnerSnapshot | null
    statusText: string; runnerInput: string; runnerInputSyncing?: boolean; preparing?: boolean; prepareDisabled?: boolean; prepareDisabledReason?: string
    startDisabled?: boolean; startDisabledReason?: string; jsonEditing?: boolean; operationPending?: boolean
    onTemplateSearchChange: (value: string) => void; onSelectTemplate: (id: string) => Promise<boolean>; onCreateTemplate: () => void
    onBeginEdit: () => void; onSaveTemplate: () => void; onCancelEdit: () => void; onDeleteTemplate: () => void
    onUpdateDraft: (mutator: (definition: MacroDefinitionV3) => void) => void; onResetWidth?: () => void; onPrepare: () => void
    onRunnerInputChange: (value: string) => void; onSubmitRunnerInput: () => void; onRefreshRunner: () => void
    onMacroControl: (action: 'start' | 'pause' | 'resume' | 'stop') => void; onViewChange: (view: MacroView) => void
  }>()
</script>

<MacroTemplateSelector {templates} {filteredTemplates} {draft} {selectedRecord} {templateSearch} {dirty} {contentEditing} {mutationAllowed}
  onTemplateSearchChange={onTemplateSearchChange} onSelectTemplate={onSelectTemplate} onCreateTemplate={onCreateTemplate}
  onBeginEdit={onBeginEdit} onSaveTemplate={onSaveTemplate} onCancelEdit={onCancelEdit} onDeleteTemplate={onDeleteTemplate}
  onUpdateDraft={onUpdateDraft} onResetWidth={onResetWidth} locked={jsonEditing || operationPending} />

{#if errorText}<div class="macro-error" role="alert">{errorText}</div>{/if}

<div class="macro-sticky-head" data-testid="macro-sticky-head">
  <div class="macro-top-dock" data-testid="macro-top-dock">
    <MacroRunDock {runner} {statusText} {runnerInput} {runnerInputSyncing} {preparing} {prepareDisabled} {prepareDisabledReason} {startDisabled} {startDisabledReason}
      runtimeInputDisabled={!mutationAllowed || operationPending}
      onPrepare={onPrepare} onRunnerInputChange={onRunnerInputChange} onSubmitRunnerInput={onSubmitRunnerInput}
      onRefreshRunner={onRefreshRunner} onMacroControl={onMacroControl} />
  </div>
  <div class="macro-tabs" role="tablist" aria-label="Macro views">
    <button type="button" role="tab" aria-selected={macroView === 'editor'} class:active={macroView === 'editor'} data-testid="macro-tab-editor" disabled={jsonEditing} onclick={() => onViewChange('editor')}>Editor</button>
    <button type="button" role="tab" aria-selected={macroView === 'json'} class:active={macroView === 'json'} data-testid="macro-tab-json" onclick={() => onViewChange('json')}>JSON</button>
    <button type="button" role="tab" aria-selected={macroView === 'trace'} class:active={macroView === 'trace'} data-testid="macro-tab-trace" disabled={jsonEditing} onclick={() => onViewChange('trace')}>Trace</button>
  </div>
</div>
