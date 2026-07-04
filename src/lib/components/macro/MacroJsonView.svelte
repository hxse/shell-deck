<script lang="ts">
  import type { MacroTemplate, ValidationResult } from '../../macro/templateTypes'

  let { draft, validation, jsonPreview, onSaveTemplate, onExportTemplate } = $props<{
    draft: MacroTemplate | null
    validation: ValidationResult
    jsonPreview: string
    onSaveTemplate: () => void
    onExportTemplate: () => void
  }>()
</script>

<section class="macro-section macro-json-section" data-testid="macro-json-view">
  <div class="macro-section-title">
    <h3>JSON</h3>
    <div class="inline-actions">
      <button type="button" data-testid="macro-save-json" onclick={onSaveTemplate} disabled={!draft || !validation.ok}>Save</button>
      <button type="button" data-testid="macro-export-json" onclick={onExportTemplate} disabled={!draft}>Export</button>
    </div>
  </div>
  {#if draft}<pre data-testid="macro-json-preview">{jsonPreview}</pre>{:else}<p class="empty-text">No template selected.</p>{/if}
</section>
