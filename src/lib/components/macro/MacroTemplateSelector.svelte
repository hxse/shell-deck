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

<div class="macro-header grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-1.5 gap-y-1 border-b border-base-300 bg-base-100 px-1.5 py-[3px]">
  <h2 class="row-start-1">Macro</h2>
  <div class="macro-template-picker relative row-start-1 min-w-0" data-testid="macro-template-picker">
    <button type="button" class="macro-template-drawer btn btn-sm relative z-[46] box-border !h-[26px] !min-h-[26px] w-full min-w-0 justify-start rounded-field border-base-300 bg-base-100 px-1.5 text-left" data-testid="macro-template-drawer" aria-expanded={templatePopoverOpen} aria-controls="macro-template-drawer-body" onclick={() => { templatePopoverOpen = !templatePopoverOpen }}>
      <span class="macro-template-summary grid min-h-[26px] min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 leading-none" data-testid="macro-template-summary">
        <span class="text-[10px] font-extrabold tracking-wide text-base-content/55 uppercase">Macro</span>
        <strong class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-base-content">{draft?.name ?? 'No macro selected'}{dirty ? ' *' : ''}</strong>
        <small class="text-[10px] font-semibold whitespace-nowrap text-base-content/55">{templates.length} saved · {draft ? `${draft.body.length} nodes` : 'empty'}</small>
      </span>
    </button>

    {#if templatePopoverOpen}
      <button class="popover-dismiss-layer macro-template-dismiss-layer fixed inset-0 z-[44] !h-auto !min-h-0 !w-auto cursor-default !rounded-none !border-0 !bg-transparent !p-0" type="button" data-testid="macro-template-dismiss-layer" aria-label="Close macros" onclick={() => { templatePopoverOpen = false }}></button>
      <section id="macro-template-drawer-body" class="macro-template-drawer-body macro-template-drawer-popover absolute top-[calc(100%+6px)] right-0 left-0 z-[45] grid max-h-[min(70vh,620px)] gap-2.5 overflow-auto rounded-box border border-base-300 bg-base-100 p-2.5 shadow-xl" data-testid="macro-template-drawer-body" aria-label="Macros">
        <div class="template-selector grid grid-cols-[minmax(120px,0.8fr)_minmax(180px,1.2fr)] gap-2 [@media(max-width:760px)]:grid-cols-1" data-testid="macro-template-selector">
          <label>Search<input class="input input-xs w-full" data-testid="macro-template-search" value={templateSearch} oninput={(event) => onTemplateSearchChange(event.currentTarget.value)} placeholder="macro name" /></label>
          <label>Select<select class="select select-xs w-full" data-testid="macro-template-select" value={selectedRecord?.id ?? ''} disabled={locked} onchange={selectTemplate}>
            <option value="">{templates.length === 0 ? 'No saved macros' : filteredTemplates.length === 0 && !selectedRecord ? 'No matching macros' : 'Select macro'}</option>
            {#if selectedRecord && !filteredTemplates.some((template: MacroRecordSummary) => template.id === selectedRecord?.id)}
              <option data-testid="macro-template-item" value={selectedRecord.id}>{selectedRecord.definition.name} · r{selectedRecord.revision} · selected</option>
            {/if}
            {#each filteredTemplates as template (template.id)}<option data-testid="macro-template-item" value={template.id}>{template.name} · r{template.revision} · {template.stepCount} steps</option>{/each}
          </select></label>
        </div>
        <div class="inline-actions template-toolbar flex flex-wrap items-center justify-start gap-1" data-testid="macro-template-actions">
          <button class="btn btn-xs btn-primary !pointer-events-auto" type="button" data-testid="macro-create" onclick={onCreateTemplate} disabled={locked} aria-disabled={!mutationAllowed || locked}>New</button>
          {#if selectedRecord && !contentEditing}<button class="btn btn-xs btn-outline !pointer-events-auto" type="button" data-testid="macro-edit" onclick={onBeginEdit} disabled={locked} aria-disabled={!mutationAllowed || locked}>Edit</button>{/if}
          <button class="btn btn-xs btn-success btn-outline !pointer-events-auto" type="button" data-testid="macro-save" onclick={onSaveTemplate} disabled={!draft || !dirty || locked} aria-disabled={!editable || !dirty}>Save</button>
          <button class="btn btn-xs btn-secondary btn-outline !pointer-events-auto" type="button" data-testid="macro-save-to-library" onclick={onSaveToLibrary} disabled={!draft || locked} aria-disabled={!mutationAllowed || !draft || locked}>{saveToLibraryLabel}</button>
          {#if contentEditing}<button class="btn btn-xs btn-ghost" type="button" data-testid="macro-cancel-edit" onclick={onCancelEdit} disabled={locked}>{selectedRecord ? dirty ? 'Cancel' : 'Done' : 'Discard'}</button>{/if}
          <button class="btn btn-xs btn-error btn-outline !pointer-events-auto" type="button" data-testid="macro-delete" onclick={onDeleteTemplate} disabled={!selectedRecord || locked} aria-disabled={!mutationAllowed || !selectedRecord || locked}>Delete</button>
        </div>
        {#if draft}
          <div class="template-metadata grid gap-2" data-testid="macro-template-metadata">
            <label>Name<input class="input input-xs w-full" data-testid="macro-name" value={draft.name} disabled={!editable} oninput={(event) => onUpdateDraft((definition: MacroDefinitionV5) => { definition.name = event.currentTarget.value })} /></label>
            <label>Description<LineNumberedTextarea testId="macro-description" value={draft.description} maxRows={3} ariaLabel="Macro description" showLineNumbers={false} disabled={!editable} onInput={(value) => onUpdateDraft((definition: MacroDefinitionV5) => { definition.description = value })} /></label>
            <code class="text-[11px] text-base-content/60">{selectedRecord ? `${selectedRecord.id} · revision ${selectedRecord.revision}` : 'unsaved new macro'}</code>
          </div>
        {/if}
      </section>
    {/if}
  </div>
  <button class="btn btn-xs btn-ghost row-start-1" type="button" data-testid="macro-reset-width" onclick={() => onResetWidth?.()}>Reset width</button>
</div>
