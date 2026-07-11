<script lang="ts">
  import LineNumberedTextarea from "./LineNumberedTextarea.svelte"
  import { LOOP_INDEX_TEMPLATE_TOKEN, LOOP_KEY_TEMPLATE_TOKEN, LOOP_TEMPLATE_TOKENS, LOOP_VALUE_TEMPLATE_TOKEN, scopedTemplateSyntaxIssue } from "../../macro/scopedTextTemplate"
  import { messageTextPartValue, withMessagePartTemplateMode, type TextTemplateScope } from "../../macro/scopedTextTemplateEditor"
  import type { FlowV2ArtifactSource, MessagePart, MessageSpec } from "../../macro/templateTypes"

  export type ArtifactChoice = { label: string; source: FlowV2ArtifactSource }

  let {
    message,
    onChange,
    choices,
    templateScope = null,
    testId = "message-parts-editor",
    textPartTestId = "message-text-part",
  } = $props<{
    message: MessageSpec
    onChange: (message: MessageSpec) => void
    choices: ArtifactChoice[]
    templateScope?: TextTemplateScope | null
    testId?: string
    textPartTestId?: string
  }>()

  let structureVersion = $state(0)

  function cloneMessage(): MessageSpec {
    return JSON.parse(JSON.stringify(message)) as MessageSpec
  }

  function sourceKey(source?: FlowV2ArtifactSource): string {
    return source?.stepId ? source.stepId + ":" + source.artifact : ""
  }

  function sourceFromKey(key: string): FlowV2ArtifactSource | undefined {
    if (!key) return undefined
    const [stepId, artifact] = key.split(":")
    return {
      kind: "step_artifact",
      stepId,
      artifact: artifact === "merged_text" ? "merged_text" : artifact === "extracted_text" ? "extracted_text" : "captured_text",
    }
  }

  function addTextPart() {
    const next = cloneMessage()
    structureVersion += 1
    next.parts.push({ kind: "text", text: "" })
    onChange(next)
  }

  function addArtifactPart() {
    const next = cloneMessage()
    structureVersion += 1
    next.parts.push({ kind: "artifact" })
    onChange(next)
  }

  function updateTextPart(index: number, text: string) {
    const next = cloneMessage()
    const part = next.parts[index]
    if (part?.kind === "text") part.text = text
    if (part?.kind === "template") part.template = text
    onChange(next)
  }

  function setTextPartTemplateEnabled(index: number, enabled: boolean) {
    if (enabled && !templateScope) return
    const next = cloneMessage()
    const part = next.parts[index]
    if (part?.kind !== "text" && part?.kind !== "template") return
    next.parts[index] = withMessagePartTemplateMode(part, enabled)
    onChange(next)
  }

  function updateArtifactPart(index: number, key: string) {
    const next = cloneMessage()
    const part = next.parts[index]
    if (part?.kind !== "artifact") return
    const source = sourceFromKey(key)
    if (source) part.source = source
    else delete part.source
    onChange(next)
  }

  function removePart(index: number) {
    structureVersion += 1
    const next = cloneMessage()
    next.parts.splice(index, 1)
    onChange(next)
  }

  function movePart(index: number, offset: number) {
    const target = index + offset
    if (target < 0 || target >= message.parts.length) return
    const next = cloneMessage()
    structureVersion += 1
    const [part] = next.parts.splice(index, 1)
    next.parts.splice(target, 0, part)
    onChange(next)
  }

  function isTextConsumerPart(part: MessagePart): part is Extract<MessagePart, { kind: "text" | "template" }> {
    return part.kind === "text" || part.kind === "template"
  }

  function templateSyntaxIssue(part: Extract<MessagePart, { kind: "text" | "template" }>): string | null {
    return part.kind === "template" ? scopedTemplateSyntaxIssue(part.template) : null
  }

  const loopTemplateInsertActions = [
    { text: LOOP_INDEX_TEMPLATE_TOKEN, label: "Insert " + LOOP_INDEX_TEMPLATE_TOKEN, testId: "message-template-insert-index" },
    { text: LOOP_KEY_TEMPLATE_TOKEN, label: "Insert " + LOOP_KEY_TEMPLATE_TOKEN, testId: "message-template-insert-key" },
    { text: LOOP_VALUE_TEMPLATE_TOKEN, label: "Insert " + LOOP_VALUE_TEMPLATE_TOKEN, testId: "message-template-insert-value" },
  ]
  const availableLoopTokens = LOOP_TEMPLATE_TOKENS.join(" · ")
</script>

<div class="message-parts-editor" data-testid={testId}>
  <div class="inline-actions">
    <button type="button" data-testid="message-add-text" onclick={addTextPart}>Add Text</button>
    <button type="button" data-testid="message-add-source" title="Add source artifact" onclick={addArtifactPart}>Add Source</button>
  </div>
  {#each message.parts as part, partIndex (structureVersion + ":" + partIndex)}
    <div class="message-part-row" data-testid="message-part-row">
      <div class="step-title">
        <strong>{partIndex + 1}. {part.kind}</strong>
        <div class="inline-actions">
          <button type="button" onclick={() => movePart(partIndex, -1)}>Up</button>
          <button type="button" onclick={() => movePart(partIndex, 1)}>Down</button>
          <button type="button" onclick={() => removePart(partIndex)}>Remove</button>
        </div>
      </div>
      {#if isTextConsumerPart(part)}
        {#if templateScope || part.kind === "template"}
          <label class="checkbox-row template-toggle-row">
            <input
              type="checkbox"
              data-testid="message-template-toggle"
              checked={part.kind === "template"}
              onchange={(event) => setTextPartTemplateEnabled(partIndex, event.currentTarget.checked)}
            />
            Use loop template
          </label>
        {/if}
        {#if part.kind === "template" && templateScope}
          <small class="template-source" data-testid="message-template-source">
            Available: {availableLoopTokens} · from {templateScope.forStepId}
            {#if templateScope.shadowedForStepId} · shadows {templateScope.shadowedForStepId}{/if}
          </small>
        {:else if part.kind === "template"}
          <p class="template-scope-issue" data-testid="message-template-scope-issue">This template needs an enclosing text-list for. Turn template off or move it back into scope.</p>
        {/if}
        {#if templateSyntaxIssue(part)}
          <p class="template-scope-issue" data-testid="message-template-syntax-issue">{templateSyntaxIssue(part)}</p>
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
          <select data-testid="message-source-part" value={sourceKey(part.source)} onchange={(event) => updateArtifactPart(partIndex, event.currentTarget.value)}>
            <option value="">none</option>{#each choices as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}
          </select>
        </label>
      {/if}
    </div>
  {/each}
</div>

<style>
  .template-toggle-row {
    justify-self: start;
    font-size: 12px;
  }

  .template-source {
    display: block;
    color: #28516f;
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
