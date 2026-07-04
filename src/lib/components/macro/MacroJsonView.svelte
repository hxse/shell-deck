<script lang="ts">
  import type { MacroTemplate, ValidationResult } from '../../macro/templateTypes'

  let { draft, validation, jsonPreview, onSaveTemplate, onExportTemplate } = $props<{
    draft: MacroTemplate | null
    validation: ValidationResult
    jsonPreview: string
    onSaveTemplate: () => void
    onExportTemplate: () => void
  }>()

  let copyLabel = $state('Copy')

  async function copyJson() {
    await navigator.clipboard.writeText(jsonPreview)
    copyLabel = 'Copied'
    window.setTimeout(() => { copyLabel = 'Copy' }, 900)
  }
</script>

<section class="macro-section macro-json-section" data-testid="macro-json-view">
  <div class="macro-section-title">
    <h3>JSON</h3>
    <div class="inline-actions">
      <button type="button" data-testid="macro-json-copy" onclick={copyJson} disabled={!draft}>{copyLabel}</button>
      <button type="button" data-testid="macro-save-json" onclick={onSaveTemplate} disabled={!draft || !validation.ok}>Save</button>
      <button type="button" data-testid="macro-export-json" onclick={onExportTemplate} disabled={!draft}>Export</button>
    </div>
  </div>
  {#if draft}<pre data-testid="macro-json-preview">{jsonPreview}</pre>{:else}<p class="empty-text">No template selected.</p>{/if}
</section>
