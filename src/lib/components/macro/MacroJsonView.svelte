<script lang="ts">
  import type { MacroTemplate } from '../../macro/templateTypes'

  let {
    draft,
    jsonPreview,
    editing,
    saving,
    editText,
    editError,
    operationPending = false,
    onStartEdit,
    onEditTextChange,
    onSave,
    onCancel,
    onExportTemplate,
  } = $props<{
    draft: MacroTemplate | null
    jsonPreview: string
    editing: boolean
    saving: boolean
    editText: string
    editError: string | null
    operationPending?: boolean
    onStartEdit: () => void
    onEditTextChange: (value: string) => void
    onSave: () => void | Promise<void>
    onCancel: () => void
    onExportTemplate: () => void
  }>()

  let copyLabel = $state('Copy')
  const copyText = $derived(editing ? editText : jsonPreview)

  async function copyJson() {
    await navigator.clipboard.writeText(copyText)
    copyLabel = 'Copied'
    window.setTimeout(() => { copyLabel = 'Copy' }, 900)
  }
</script>

<section class="macro-section macro-json-section" data-testid="macro-json-view" data-json-editing={editing}>
  <div class="macro-section-title">
    <h3>JSON</h3>
    <div class="inline-actions">
      <button type="button" data-testid="macro-json-copy" onclick={copyJson} disabled={!draft}>{copyLabel}</button>
      {#if editing}
        <button type="button" data-testid="macro-save-json" onclick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" data-testid="macro-cancel-json" onclick={onCancel} disabled={saving}>Cancel</button>
      {:else}
        <button type="button" data-testid="macro-edit-json" onclick={onStartEdit} disabled={!draft || operationPending} title={operationPending ? 'Wait for the pending template operation to finish' : undefined}>Edit</button>
        <button type="button" data-testid="macro-export-json" onclick={onExportTemplate} disabled={!draft || operationPending} title={operationPending ? 'Wait for the pending template operation to finish' : undefined}>Export</button>
      {/if}
    </div>
  </div>
  {#if editError}
    <div class="macro-json-error" role="alert" data-testid="macro-json-error">{editError}</div>
  {/if}
  {#if editing}
    <p class="macro-json-edit-lock" data-testid="macro-json-edit-lock">Save or Cancel before leaving JSON or changing templates.</p>
    <textarea
      class="macro-json-editor"
      data-testid="macro-json-editor"
      aria-label="Macro JSON editor"
      spellcheck="false"
      value={editText}
      oninput={(event) => onEditTextChange(event.currentTarget.value)}
    ></textarea>
  {:else if draft}
    <pre data-testid="macro-json-preview">{jsonPreview}</pre>
  {:else}
    <p class="empty-text">No template selected.</p>
  {/if}
</section>
