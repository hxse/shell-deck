<script lang="ts">
  import LineNumberedTextarea from "./LineNumberedTextarea.svelte"
  import MacroIconButton from "./MacroIconButton.svelte"
  import { LOOP_INDEX_TEMPLATE_TOKEN, LOOP_KEY_TEMPLATE_TOKEN, LOOP_VALUE_TEMPLATE_TOKEN, scopedTemplateSyntaxIssue } from "../../macro/scopedTextTemplate"
  import { messageTextPartValue, withMessagePartTemplateMode, type TextTemplateScope } from "../../macro/scopedTextTemplateEditor"
  import type { MessagePart, MessageSpec } from '../../macro/macroDefinitionTypes'
  import {
    artifactSourceFromKey,
    artifactSourceKey,
    type ArtifactChoice,
  } from '../../macro/macroArtifactChoices'

  let {
    message,
    onUpdate,
    choices,
    templateScope = null,
    testId = "message-parts-editor",
    textPartTestId = "message-text-part",
  } = $props<{
    message: MessageSpec
    onUpdate: (mutator: (message: MessageSpec) => void) => void
    choices: ArtifactChoice[]
    templateScope?: TextTemplateScope | null
    testId?: string
    textPartTestId?: string
  }>()

  let structureVersion = $state(0)

  function addTextPart() {
    structureVersion += 1
    onUpdate((target: MessageSpec) => { target.parts.push({ kind: "text", text: "" }) })
  }

  function addArtifactPart() {
    structureVersion += 1
    onUpdate((target: MessageSpec) => { target.parts.push({ kind: "artifact", source: { kind: 'unassigned' } }) })
  }

  function updateTextPart(index: number, text: string) {
    onUpdate((target: MessageSpec) => {
      const part = target.parts[index]
      if (part?.kind === "text") part.text = text
      if (part?.kind === "template") part.template = text
    })
  }

  function setTextPartTemplateEnabled(index: number, enabled: boolean) {
    if (enabled && !templateScope) return
    onUpdate((target: MessageSpec) => {
      const part = target.parts[index]
      if (part?.kind !== "text" && part?.kind !== "template") return
      target.parts[index] = withMessagePartTemplateMode(part, enabled)
    })
  }

  function updateArtifactPart(index: number, key: string) {
    onUpdate((target: MessageSpec) => {
      const part = target.parts[index]
      if (part?.kind === "artifact") part.source = artifactSourceFromKey(key)
    })
  }

  function removePart(index: number) {
    structureVersion += 1
    onUpdate((target: MessageSpec) => { target.parts.splice(index, 1) })
  }

  function movePart(index: number, offset: number) {
    const target = index + offset
    if (target < 0 || target >= message.parts.length) return
    structureVersion += 1
    onUpdate((message: MessageSpec) => {
      const [part] = message.parts.splice(index, 1)
      message.parts.splice(target, 0, part)
    })
  }

  function isTextConsumerPart(part: MessagePart): part is Extract<MessagePart, { kind: "text" | "template" }> {
    return part.kind === "text" || part.kind === "template"
  }

  function templateSyntaxIssue(part: Extract<MessagePart, { kind: "text" | "template" }>): string | null {
    return part.kind === "template" ? scopedTemplateSyntaxIssue(part.template) : null
  }

  const loopTemplateInsertActions = [
    { text: LOOP_INDEX_TEMPLATE_TOKEN, label: LOOP_INDEX_TEMPLATE_TOKEN, testId: "message-template-insert-index" },
    { text: LOOP_KEY_TEMPLATE_TOKEN, label: LOOP_KEY_TEMPLATE_TOKEN, testId: "message-template-insert-key" },
    { text: LOOP_VALUE_TEMPLATE_TOKEN, label: LOOP_VALUE_TEMPLATE_TOKEN, testId: "message-template-insert-value" },
  ]
</script>

<div class="message-parts-editor grid min-w-0 gap-2" data-testid={testId}>
  <div class="inline-actions flex flex-wrap justify-end gap-1.5">
    <button class="btn btn-xs btn-primary" type="button" data-testid="message-add-text" onclick={addTextPart}>Add Text</button>
    <button class="btn btn-xs btn-primary" type="button" data-testid="message-add-source" title="Add source artifact" onclick={addArtifactPart}>Add Source</button>
  </div>
  {#each message.parts as part, partIndex (structureVersion + ":" + partIndex)}
    <div class="message-part-row card min-w-0 gap-2 bg-base-200/60 p-2 shadow-sm" data-testid="message-part-row">
      <div class="step-title flex min-w-0 flex-wrap items-center justify-between gap-2">
        <strong>{partIndex + 1}. {part.kind}</strong>
        <div class="inline-actions flex flex-wrap gap-1">
          <MacroIconButton kind="up" disabled={partIndex === 0} testId="message-part-up" onClick={() => movePart(partIndex, -1)} />
          <MacroIconButton kind="down" disabled={partIndex === message.parts.length - 1} testId="message-part-down" onClick={() => movePart(partIndex, 1)} />
          <MacroIconButton kind="remove" testId="message-part-remove" onClick={() => removePart(partIndex)} />
        </div>
      </div>
      {#if isTextConsumerPart(part)}
        {#if templateScope || part.kind === "template"}
          <label class="checkbox-row template-toggle-row flex w-fit cursor-pointer items-center gap-1.5 text-xs">
            <input
              class="checkbox checkbox-xs"
              type="checkbox"
              data-testid="message-template-toggle"
              checked={part.kind === "template"}
              onchange={(event) => setTextPartTemplateEnabled(partIndex, event.currentTarget.checked)}
            />
            Use loop template
          </label>
        {/if}
        {#if part.kind === "template" && !templateScope}
          <p class="template-scope-issue alert alert-error px-2 py-1.5 text-xs" data-testid="message-template-scope-issue">This template needs an enclosing text-list for. Turn template off or move it back into scope.</p>
        {/if}
        {#if templateSyntaxIssue(part)}
          <p class="template-scope-issue alert alert-error px-2 py-1.5 text-xs" data-testid="message-template-syntax-issue">{templateSyntaxIssue(part)}</p>
        {/if}
        <label>Text
          <LineNumberedTextarea
            testId={textPartTestId}
            value={messageTextPartValue(part)}
            ariaLabel="Message text part"
            maxRows={3}
            onInput={(text: string) => updateTextPart(partIndex, text)}
            insertActions={part.kind === "template" && templateScope ? loopTemplateInsertActions : []}
          />
        </label>
      {:else}
        <label>Source artifact
          <select class="select box-border select-xs select-ghost w-full bg-base-content/15" class:select-warning={part.source.kind === 'unassigned'} data-testid="message-source-part" value={artifactSourceKey(part.source)} onchange={(event) => updateArtifactPart(partIndex, event.currentTarget.value)}>
            <option value="">Unassigned</option>{#each choices as choice}<option value={artifactSourceKey(choice.source)}>{choice.label}</option>{/each}
          </select>
        </label>
        {#if part.source.kind === 'unassigned'}
          <small class="artifact-source-warning text-[11px] text-warning" data-testid="message-source-warning">Source is unassigned. Save is allowed, but Start requires an earlier compatible output.</small>
        {/if}
      {/if}
    </div>
  {/each}
</div>
