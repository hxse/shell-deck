<script lang="ts">
  import type { MacroDefinitionV3 } from '../../macro/macroDefinitionTypes'
  import LineNumberedTextarea from './LineNumberedTextarea.svelte'

  let {
    draft,
    jsonPreview,
    editing,
    saving,
    editText,
    editError,
    operationPending = false,
    canEdit = true,
    onStartEdit,
    onEditTextChange,
    onSave,
    onCancel,
    onCopyResult = () => {},
  } = $props<{
    draft: MacroDefinitionV3 | null
    jsonPreview: string
    editing: boolean
    saving: boolean
    editText: string
    editError: string | null
    operationPending?: boolean
    canEdit?: boolean
    onStartEdit: () => void
    onEditTextChange: (value: string) => void
    onSave: () => void | Promise<void>
    onCancel: () => void
    onCopyResult?: (error: string | null) => void
  }>()

  let copyLabel = $state('Copy')
  const copyText = $derived(editing ? editText : jsonPreview)

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(copyText)
      copyLabel = 'Copied'
      onCopyResult(null)
      window.setTimeout(() => { copyLabel = 'Copy' }, 900)
    } catch {
      copyLabel = 'Copy'
      onCopyResult('clipboard_write_failed')
    }
  }
</script>

<section class="macro-section macro-json-section" data-testid="macro-json-view" data-json-editing={editing}>
  <div class="macro-section-title">
    <h3>JSON</h3>
    <div class="inline-actions">
      <button type="button" data-testid="macro-json-copy" onclick={copyJson} disabled={!draft && !editing}>{copyLabel}</button>
      {#if editing}
        <button type="button" data-testid="macro-save-json" onclick={onSave} disabled={saving} aria-disabled={saving || !canEdit}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" data-testid="macro-cancel-json" onclick={onCancel} disabled={saving}>Cancel</button>
      {:else}
        <button type="button" data-testid="macro-edit-json" onclick={onStartEdit} disabled={!draft || operationPending} aria-disabled={!draft || operationPending || !canEdit} title={!canEdit ? 'Room control is required' : operationPending ? 'Wait for the pending macro operation to finish' : undefined}>Edit</button>
      {/if}
    </div>
  </div>
  {#if editError}<div class="macro-json-error" role="alert" data-testid="macro-json-error">{editError}</div>{/if}
  {#if editing}
    <p class="macro-json-edit-lock" data-testid="macro-json-edit-lock">Save or Cancel before leaving JSON or changing macros.</p>
    <div class="macro-json-line-editor">
      <LineNumberedTextarea testId="macro-json-editor" value={editText} maxRows={30} ariaLabel="Macro JSON editor" disabled={saving || !canEdit} onInput={onEditTextChange} />
    </div>
  {:else if draft}
    <pre data-testid="macro-json-preview">{jsonPreview}</pre>
  {:else}
    <p class="empty-text">No macro selected.</p>
  {/if}
</section>
