<script lang="ts">
  import type { MacroTemplate, TemplateSummary } from '../../macro/templateTypes'

  let {
    templates,
    filteredTemplates,
    draft,
    selectedTemplateId,
    selectedTemplateName,
    templateSearch,
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
  } = $props<{
    templates: TemplateSummary[]
    filteredTemplates: TemplateSummary[]
    draft: MacroTemplate | null
    selectedTemplateId: string | null
    selectedTemplateName: string | null
    templateSearch: string
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
  }>()

  let importInput = $state<HTMLInputElement | null>(null)
</script>

<div class="macro-header">
  <h2>Macro</h2>
  <details class="macro-template-drawer" data-testid="macro-template-drawer">
    <summary data-testid="macro-template-summary">
      <span>Template</span>
      <strong>{selectedTemplateName ?? 'No template selected'}</strong>
      <small>{templates.length} saved · {draft ? draft.steps.length + ' steps' : 'empty'}</small>
    </summary>
  </details>
  <div class="macro-template-drawer-body">
    <div class="template-selector" data-testid="macro-template-selector">
      <label>Search
        <input data-testid="macro-template-search" value={templateSearch} oninput={(event) => onTemplateSearchChange(event.currentTarget.value)} placeholder="template name" />
      </label>
      <label>Select
        <select data-testid="macro-template-select" value={selectedTemplateId ?? ''} onchange={(event) => { if (event.currentTarget.value) onSelectTemplate(event.currentTarget.value) }}>
          <option value="">{filteredTemplates.length === 0 ? 'No templates' : 'Select template'}</option>
          {#each filteredTemplates as template (template.id)}
            <option data-testid="macro-template-item" value={template.id}>{template.name} · {template.stepCount} steps</option>
          {/each}
        </select>
      </label>
    </div>
    <div class="inline-actions template-toolbar" data-testid="macro-template-actions">
      <button type="button" data-testid="macro-create" onclick={onCreateTemplate}>New</button>
      <button type="button" data-testid="macro-save" onclick={onSaveTemplate} disabled={!draft}>Save</button>
      <button type="button" data-testid="macro-duplicate" onclick={onDuplicateTemplate} disabled={!draft}>Duplicate</button>
      <button type="button" data-testid="macro-import" onclick={() => importInput?.click()}>Import</button>
      <button type="button" data-testid="macro-export" onclick={onExportTemplate} disabled={!draft}>Export</button>
      <button type="button" data-testid="macro-delete" onclick={onDeleteTemplate} disabled={!draft}>Delete</button>
      <input class="hidden-file" data-testid="macro-import-file" type="file" accept="application/json,.json" bind:this={importInput} onchange={onImportTemplate} />
    </div>
    {#if draft}
      <div class="template-metadata" data-testid="macro-template-metadata">
        <label>Name
          <input data-testid="macro-name" value={draft.name} oninput={(event) => onUpdateDraft((template: MacroTemplate) => { template.name = event.currentTarget.value })} />
        </label>
        <label>Description
          <textarea value={draft.description} oninput={(event) => onUpdateDraft((template: MacroTemplate) => { template.description = event.currentTarget.value })}></textarea>
        </label>
        <code>{draft.id}</code>
      </div>
    {/if}
  </div>
  <button type="button" data-testid="macro-reset-width" onclick={() => onResetWidth?.()}>Reset width</button>
</div>
