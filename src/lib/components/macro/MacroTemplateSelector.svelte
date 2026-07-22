<script lang="ts">
  import LineNumberedTextarea from './LineNumberedTextarea.svelte'
  import type { MacroDefinitionV5, MacroRecord, MacroRecordSummary } from '../../macro/macroDefinitionTypes'

  let {
    templates,
    filteredTemplates,
    draft,
    selectedRecord,
    templateSearch,
    dirty,
    contentEditing,
    mutationAllowed = true,
    locked = false,
    onTemplateSearchChange,
    onSelectTemplate,
    onCreateTemplate,
    onBeginEdit,
    onSaveTemplate,
    saveToLibraryLabel = 'Save to Library',
    onSaveToLibrary,
    onCancelEdit,
    onDeleteTemplate,
    onUpdateDraft,
    onResetWidth,
  } = $props<{
    templates: MacroRecordSummary[]
    filteredTemplates: MacroRecordSummary[]
    draft: MacroDefinitionV5 | null
    selectedRecord: MacroRecord | null
    templateSearch: string
    dirty: boolean
    contentEditing: boolean
    mutationAllowed?: boolean
    locked?: boolean
    onTemplateSearchChange: (value: string) => void
    onSelectTemplate: (templateId: string) => Promise<boolean>
    onCreateTemplate: () => void
    onBeginEdit: () => void
    onSaveTemplate: () => void
    saveToLibraryLabel?: string
    onSaveToLibrary: () => void
    onCancelEdit: () => void
    onDeleteTemplate: () => void
    onUpdateDraft: (mutator: (definition: MacroDefinitionV5) => void) => void
    onResetWidth?: () => void
  }>()

  let templatePopoverOpen = $state(false)
  const editable = $derived(Boolean(draft) && mutationAllowed && (selectedRecord === null || contentEditing) && !locked)

  $effect(() => {
    if (!templatePopoverOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') templatePopoverOpen = false }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  })

  async function selectTemplate(event: Event) {
    const target = event.currentTarget as HTMLSelectElement
    const previous = selectedRecord?.id ?? ''
    const next = target.value
    if (!await onSelectTemplate(next)) target.value = selectedRecord?.id ?? previous
  }
</script>

<div class="macro-header">
  <h2>Macro</h2>
  <div class="macro-template-picker" data-testid="macro-template-picker">
    <button type="button" class="macro-template-drawer" data-testid="macro-template-drawer" aria-expanded={templatePopoverOpen} aria-controls="macro-template-drawer-body" onclick={() => { templatePopoverOpen = !templatePopoverOpen }}>
      <span class="macro-template-summary" data-testid="macro-template-summary">
        <span>Macro</span>
        <strong>{draft?.name ?? 'No macro selected'}{dirty ? ' *' : ''}</strong>
        <small>{templates.length} saved · {draft ? `${draft.body.length} nodes` : 'empty'}</small>
      </span>
    </button>

    {#if templatePopoverOpen}
      <button class="popover-dismiss-layer macro-template-dismiss-layer" type="button" data-testid="macro-template-dismiss-layer" aria-label="Close macros" onclick={() => { templatePopoverOpen = false }}></button>
      <section id="macro-template-drawer-body" class="macro-template-drawer-body macro-template-drawer-popover" data-testid="macro-template-drawer-body" aria-label="Macros">
        <div class="template-selector" data-testid="macro-template-selector">
          <label>Search<input data-testid="macro-template-search" value={templateSearch} oninput={(event) => onTemplateSearchChange(event.currentTarget.value)} placeholder="macro name" /></label>
          <label>Select<select data-testid="macro-template-select" value={selectedRecord?.id ?? ''} disabled={locked} onchange={selectTemplate}>
            <option value="">{templates.length === 0 ? 'No saved macros' : filteredTemplates.length === 0 && !selectedRecord ? 'No matching macros' : 'Select macro'}</option>
            {#if selectedRecord && !filteredTemplates.some((template: MacroRecordSummary) => template.id === selectedRecord?.id)}
              <option data-testid="macro-template-item" value={selectedRecord.id}>{selectedRecord.definition.name} · r{selectedRecord.revision} · selected</option>
            {/if}
            {#each filteredTemplates as template (template.id)}<option data-testid="macro-template-item" value={template.id}>{template.name} · r{template.revision} · {template.stepCount} steps</option>{/each}
          </select></label>
        </div>
        <div class="inline-actions template-toolbar" data-testid="macro-template-actions">
          <button type="button" data-testid="macro-create" onclick={onCreateTemplate} disabled={locked} aria-disabled={!mutationAllowed || locked}>New</button>
          {#if selectedRecord && !contentEditing}<button type="button" data-testid="macro-edit" onclick={onBeginEdit} disabled={locked} aria-disabled={!mutationAllowed || locked}>Edit</button>{/if}
          <button type="button" data-testid="macro-save" onclick={onSaveTemplate} disabled={!draft || !dirty || locked} aria-disabled={!editable || !dirty}>Save</button>
          <button type="button" data-testid="macro-save-to-library" onclick={onSaveToLibrary} disabled={!draft || locked} aria-disabled={!mutationAllowed || !draft || locked}>{saveToLibraryLabel}</button>
          {#if contentEditing}<button type="button" data-testid="macro-cancel-edit" onclick={onCancelEdit} disabled={locked}>{selectedRecord ? dirty ? 'Cancel' : 'Done' : 'Discard'}</button>{/if}
          <button type="button" data-testid="macro-delete" onclick={onDeleteTemplate} disabled={!selectedRecord || locked} aria-disabled={!mutationAllowed || !selectedRecord || locked}>Delete</button>
        </div>
        {#if draft}
          <div class="template-metadata" data-testid="macro-template-metadata">
            <label>Name<input data-testid="macro-name" value={draft.name} disabled={!editable} oninput={(event) => onUpdateDraft((definition: MacroDefinitionV5) => { definition.name = event.currentTarget.value })} /></label>
            <label>Description<LineNumberedTextarea testId="macro-description" value={draft.description} maxRows={3} ariaLabel="Macro description" showLineNumbers={false} disabled={!editable} onInput={(value) => onUpdateDraft((definition: MacroDefinitionV5) => { definition.description = value })} /></label>
            <code>{selectedRecord ? `${selectedRecord.id} · revision ${selectedRecord.revision}` : 'unsaved new macro'}</code>
          </div>
        {/if}
      </section>
    {/if}
  </div>
  <button type="button" data-testid="macro-reset-width" onclick={() => onResetWidth?.()}>Reset width</button>
</div>
