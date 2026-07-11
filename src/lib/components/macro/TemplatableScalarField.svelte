<script lang="ts">
  import { tick } from "svelte"
  import { FOR_TEXT_TEMPLATE_TOKEN, isScopedTemplateText, scopedTemplateSyntaxIssue } from "../../macro/scopedTextTemplate"
  import { templatableScalarValue, withScalarTemplateMode, type TextTemplateScope } from "../../macro/scopedTextTemplateEditor"
  import type { TemplatableScalarText } from "../../macro/templateTypes"

  let {
    label,
    value,
    onChange,
    templateScope = null,
    testId = undefined,
  } = $props<{
    label: string
    value: TemplatableScalarText
    onChange: (value: TemplatableScalarText) => void
    templateScope?: TextTemplateScope | null
    testId?: string
  }>()

  let inputElement = $state<HTMLInputElement | null>(null)
  const templateEnabled = $derived(isScopedTemplateText(value))
  const textValue = $derived(templatableScalarValue(value))
  const templateIssue = $derived(templateEnabled ? scopedTemplateSyntaxIssue(textValue) : null)

  function updateText(text: string) {
    onChange(templateEnabled ? { kind: "template", template: text } : text)
  }

  function setTemplateEnabled(enabled: boolean) {
    if (enabled && !templateScope) return
    onChange(withScalarTemplateMode(value, enabled))
  }

  async function insertTemplateToken() {
    if (!templateScope || !templateEnabled) return
    const start = inputElement?.selectionStart ?? textValue.length
    const end = inputElement?.selectionEnd ?? start
    const next = textValue.slice(0, start) + FOR_TEXT_TEMPLATE_TOKEN + textValue.slice(end)
    updateText(next)
    await tick()
    const cursor = start + FOR_TEXT_TEMPLATE_TOKEN.length
    inputElement?.focus()
    inputElement?.setSelectionRange(cursor, cursor)
  }
</script>

<div class="templatable-scalar-field" data-testid={testId ? testId + "-field" : undefined}>
  <label>{label}<input bind:this={inputElement} data-testid={testId} value={textValue} oninput={(event) => updateText(event.currentTarget.value)} /></label>
  {#if templateScope || templateEnabled}
    <label class="checkbox-row template-toggle-row">
      <input
        type="checkbox"
        data-testid={testId ? testId + "-template-toggle" : "scalar-template-toggle"}
        checked={templateEnabled}
        onchange={(event) => setTemplateEnabled(event.currentTarget.checked)}
      />
      Use {FOR_TEXT_TEMPLATE_TOKEN} template
    </label>
  {/if}
  {#if templateEnabled && templateScope}
    <div class="template-tools" data-testid={testId ? testId + "-template-tools" : "scalar-template-tools"}>
      <small>
        Available: {FOR_TEXT_TEMPLATE_TOKEN} · from {templateScope.forStepId}
        {#if templateScope.shadowedForStepId} · shadows {templateScope.shadowedForStepId}{/if}
      </small>
      <button type="button" data-testid={testId ? testId + "-template-insert" : "scalar-template-insert"} onclick={insertTemplateToken}>Insert {FOR_TEXT_TEMPLATE_TOKEN}</button>
    </div>
  {:else if templateEnabled}
    <p class="template-scope-issue" data-testid={testId ? testId + "-template-scope-issue" : "scalar-template-scope-issue"}>This template needs an enclosing text-list for. Turn template off or move it back into scope.</p>
  {/if}
  {#if templateIssue}
    <p class="template-scope-issue" data-testid={testId ? testId + "-template-syntax-issue" : "scalar-template-syntax-issue"}>{templateIssue}</p>
  {/if}
</div>

<style>
  .templatable-scalar-field {
    display: grid;
    min-width: 0;
    gap: 6px;
  }

  .template-toggle-row {
    justify-self: start;
    font-size: 12px;
  }

  .template-tools {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border: 1px solid #b8d5ec;
    border-radius: 6px;
    background: #f2f8fd;
    color: #28516f;
  }

  .template-tools button {
    min-height: 28px;
    flex: 0 0 auto;
  }

  .template-scope-issue {
    margin: 0;
    padding: 6px 8px;
    border: 1px solid #e7b2b2;
    border-radius: 6px;
    background: #fff4f4;
    color: #8f2626;
    font-size: 12px;
  }
</style>
