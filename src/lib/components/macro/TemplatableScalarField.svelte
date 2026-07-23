<script lang="ts">
  import { tick } from "svelte"
  import LineNumberedTextarea from "./LineNumberedTextarea.svelte"
  import { LOOP_INDEX_TEMPLATE_TOKEN, LOOP_KEY_TEMPLATE_TOKEN, LOOP_VALUE_TEMPLATE_TOKEN, isScopedTemplateText, scopedTemplateSyntaxIssue } from "../../macro/scopedTextTemplate"
  import { templatableScalarValue, withScalarTemplateMode, type TextTemplateScope } from "../../macro/scopedTextTemplateEditor"
  import type { TemplatableScalarText } from '../../macro/macroDefinitionTypes'

  let {
    label,
    value,
    onChange,
    templateScope = null,
    testId = undefined,
    multiline = false,
    maxRows = 3,
  } = $props<{
    label: string
    value: TemplatableScalarText
    onChange: (value: TemplatableScalarText) => void
    templateScope?: TextTemplateScope | null
    testId?: string
    multiline?: boolean
    maxRows?: number
  }>()

  let inputElement = $state<HTMLInputElement | null>(null)
  const templateEnabled = $derived(isScopedTemplateText(value))
  const textValue = $derived(templatableScalarValue(value))
  const templateIssue = $derived(templateEnabled ? scopedTemplateSyntaxIssue(textValue) : null)
  const loopTemplateInsertActions = $derived([
    { text: LOOP_INDEX_TEMPLATE_TOKEN, label: LOOP_INDEX_TEMPLATE_TOKEN, testId: testId ? testId + "-template-insert-index" : "scalar-template-insert-index" },
    { text: LOOP_KEY_TEMPLATE_TOKEN, label: LOOP_KEY_TEMPLATE_TOKEN, testId: testId ? testId + "-template-insert-key" : "scalar-template-insert-key" },
    { text: LOOP_VALUE_TEMPLATE_TOKEN, label: LOOP_VALUE_TEMPLATE_TOKEN, testId: testId ? testId + "-template-insert-value" : "scalar-template-insert-value" },
  ])

  function updateText(text: string) {
    onChange(templateEnabled ? { kind: "template", template: text } : text)
  }

  function setTemplateEnabled(enabled: boolean) {
    if (enabled && !templateScope) return
    onChange(withScalarTemplateMode(value, enabled))
  }

  async function insertTemplateToken(token: string) {
    if (!templateScope || !templateEnabled) return
    const start = inputElement?.selectionStart ?? textValue.length
    const end = inputElement?.selectionEnd ?? start
    const next = textValue.slice(0, start) + token + textValue.slice(end)
    updateText(next)
    await tick()
    const cursor = start + token.length
    inputElement?.focus()
    inputElement?.setSelectionRange(cursor, cursor)
  }
</script>

<div class="templatable-scalar-field grid min-w-0 gap-1.5" data-testid={testId ? testId + "-field" : undefined}>
  {#if multiline}
    <label>{label}
      <LineNumberedTextarea
        {testId}
        value={textValue}
        {maxRows}
        ariaLabel={label}
        onInput={updateText}
        insertActions={templateEnabled && templateScope ? loopTemplateInsertActions : []}
      />
    </label>
  {:else}
    <label>{label}<input class="input box-border input-xs input-ghost w-full bg-base-content/15" bind:this={inputElement} data-testid={testId} value={textValue} oninput={(event) => updateText(event.currentTarget.value)} /></label>
  {/if}
  {#if templateScope || templateEnabled}
    <label class="checkbox-row template-toggle-row flex w-fit cursor-pointer items-center gap-1.5 text-xs">
      <input
        class="checkbox checkbox-xs"
        type="checkbox"
        data-testid={testId ? testId + "-template-toggle" : "scalar-template-toggle"}
        checked={templateEnabled}
        onchange={(event) => setTemplateEnabled(event.currentTarget.checked)}
      />
      Use loop template
    </label>
  {/if}
  {#if templateEnabled && templateScope && !multiline}
    <div class="template-tools flex min-w-0 flex-wrap items-center justify-end gap-1 rounded-md bg-primary/10 px-1.5 py-1 text-primary shadow-sm" data-testid={testId ? testId + "-template-tools" : "scalar-template-tools"}>
      <div class="template-insert-actions flex min-w-0 flex-wrap justify-end gap-1">
        {#each loopTemplateInsertActions as action}
          <button class="btn btn-primary btn-xs !h-5 !min-h-5 px-1.5 !text-[11px] leading-tight" type="button" data-testid={action.testId} title={'Insert ' + action.text} onclick={() => insertTemplateToken(action.text)}>{action.label}</button>
        {/each}
      </div>
    </div>
  {:else if templateEnabled && !templateScope}
    <p class="template-scope-issue alert alert-error px-2 py-1.5 text-xs" data-testid={testId ? testId + "-template-scope-issue" : "scalar-template-scope-issue"}>This template needs an enclosing text-list for. Turn template off or move it back into scope.</p>
  {/if}
  {#if templateIssue}
    <p class="template-scope-issue alert alert-error px-2 py-1.5 text-xs" data-testid={testId ? testId + "-template-syntax-issue" : "scalar-template-syntax-issue"}>{templateIssue}</p>
  {/if}
</div>
