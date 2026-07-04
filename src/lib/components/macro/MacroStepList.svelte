<script lang="ts">
  import LineNumberedTextarea from "./LineNumberedTextarea.svelte"
  import type { CaptureSourceConfig, FlowV2ArtifactSource, FlowV2Node, MacroTemplate, MessageSpec, ParallelSendCaptureItem, TerminalTarget, SimpleTextMatchOp, TextFilterSpec, TextMatchCondition, ValidationResult, WaitNode } from "../../macro/templateTypes"

  type TerminalChoice = { value: string; label: string }
  type ArtifactChoice = { label: string; source: FlowV2ArtifactSource }
  type BlockTarget = { kind: "root" } | { kind: "if-branch"; nodeId: string; branchIndex: number } | { kind: "if-else"; nodeId: string } | { kind: "for"; nodeId: string }

  let {
    draft,
    validation,
    updateDraft,
    terminalChoices,
    choiceFromTarget,
    targetFromChoice,
    defaultCaptureSource,
    defaultParallelItem,
    defaultCondition,
    artifactChoices,
  } = $props<{
    draft: MacroTemplate
    validation: ValidationResult
    updateDraft: (mutator: (template: MacroTemplate) => void) => void
    terminalChoices: () => TerminalChoice[]
    choiceFromTarget: (target: TerminalTarget) => string
    targetFromChoice: (choice: string) => TerminalTarget
    defaultCaptureSource: (kind: CaptureSourceConfig["kind"]) => CaptureSourceConfig
    defaultParallelItem: (rawId: string, terminal: TerminalTarget) => ParallelSendCaptureItem
    defaultCondition: (template: MacroTemplate) => TextMatchCondition
    artifactChoices: (template: MacroTemplate) => ArtifactChoice[]
  }>()

  function updateNode(nodeId: string, mutator: (node: FlowV2Node) => void) {
    updateDraft((template: MacroTemplate) => {
      const node = findNode(template.body, nodeId)
      if (node) mutator(node)
    })
  }

  function removeNode(nodeId: string) {
    updateDraft((template: MacroTemplate) => { removeNodeFromList(template.body, nodeId) })
  }

  function moveNode(nodeId: string, offset: number) {
    updateDraft((template: MacroTemplate) => { moveNodeInList(template.body, nodeId, offset) })
  }

  function removeNodeFromList(nodes: FlowV2Node[], nodeId: string): boolean {
    const index = nodes.findIndex((node) => node.id === nodeId)
    if (index >= 0) {
      nodes.splice(index, 1)
      return true
    }
    for (const node of nodes) {
      if (node.type === "if") {
        for (const branch of node.branches) if (removeNodeFromList(branch.body, nodeId)) return true
        if (node.else && removeNodeFromList(node.else, nodeId)) return true
      }
      if (node.type === "for" && removeNodeFromList(node.body, nodeId)) return true
    }
    return false
  }

  function moveNodeInList(nodes: FlowV2Node[], nodeId: string, offset: number): boolean {
    const index = nodes.findIndex((node) => node.id === nodeId)
    if (index >= 0) {
      const nextIndex = index + offset
      if (nextIndex < 0 || nextIndex >= nodes.length) return true
      const [node] = nodes.splice(index, 1)
      nodes.splice(nextIndex, 0, node)
      return true
    }
    for (const node of nodes) {
      if (node.type === "if") {
        for (const branch of node.branches) if (moveNodeInList(branch.body, nodeId, offset)) return true
        if (node.else && moveNodeInList(node.else, nodeId, offset)) return true
      }
      if (node.type === "for" && moveNodeInList(node.body, nodeId, offset)) return true
    }
    return false
  }

  function setNodeId(oldId: string, nextId: string) {
    updateNode(oldId, (node) => { node.id = nextId })
  }

  function findNode(nodes: FlowV2Node[], nodeId: string): FlowV2Node | undefined {
    for (const node of nodes) {
      if (node.id === nodeId) return node
      if (node.type === "if") {
        for (const branch of node.branches) {
          const found = findNode(branch.body, nodeId)
          if (found) return found
        }
        if (node.else) {
          const found = findNode(node.else, nodeId)
          if (found) return found
        }
      }
      if (node.type === "for") {
        const found = findNode(node.body, nodeId)
        if (found) return found
      }
    }
  }

  function emptyArtifactSource(): ArtifactChoice["source"] {
    return { kind: "step_artifact", stepId: "", artifact: "captured_text" }
  }

  function sourceKey(source: ArtifactChoice["source"]) {
    if (!source.stepId) return ""
    return source.stepId + ":" + source.artifact
  }

  function sourceFromKey(key: string): ArtifactChoice["source"] {
    if (!key) return emptyArtifactSource()
    const [stepId, artifact] = key.split(":")
    return { kind: "step_artifact", stepId, artifact: artifact === "merged_text" ? "merged_text" : artifact === "extracted_text" ? "extracted_text" : "captured_text" }
  }

  function artifactChoicesBefore(nodeId: string): ArtifactChoice[] {
    return collectArtifactChoicesBefore(draft.body, nodeId, []).choices
  }

  function collectArtifactChoicesBefore(nodes: FlowV2Node[], targetNodeId: string, visible: ArtifactChoice[]): { choices: ArtifactChoice[]; found: boolean } {
    const choices = [...visible]
    for (const node of nodes) {
      if (node.id === targetNodeId) return { choices, found: true }
      if (node.type === "if") {
        for (const branch of node.branches) {
          const result = collectArtifactChoicesBefore(branch.body, targetNodeId, choices)
          if (result.found) return result
        }
        if (node.else) {
          const result = collectArtifactChoicesBefore(node.else, targetNodeId, choices)
          if (result.found) return result
        }
      } else if (node.type === "for") {
        const result = collectArtifactChoicesBefore(node.body, targetNodeId, choices)
        if (result.found) return result
      }
      const output = artifactOutputForNode(node)
      if (output) choices.push(output)
    }
    return { choices, found: false }
  }

  function artifactOutputForNode(node: FlowV2Node): ArtifactChoice | null {
    if (node.type === "capture-source") return { label: node.id + ".captured_text", source: { kind: "step_artifact", stepId: node.id, artifact: "captured_text" } }
    if (node.type === "parallel_send_capture") return { label: node.id + ".merged_text", source: { kind: "step_artifact", stepId: node.id, artifact: "merged_text" } }
    if (node.type === "extract_text") return { label: node.id + ".extracted_text", source: { kind: "step_artifact", stepId: node.id, artifact: "extracted_text" } }
    return null
  }

  function cloneMessage(message: MessageSpec): MessageSpec {
    return JSON.parse(JSON.stringify(message)) as MessageSpec
  }

  function addTextPart(message: MessageSpec, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    next.parts.push({ kind: "text", text: "" })
    onChange(next)
  }

  function addArtifactPart(choices: ArtifactChoice[], message: MessageSpec, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    next.parts.push({ kind: "artifact", source: choices[0]?.source ?? emptyArtifactSource() })
    onChange(next)
  }

  function updateTextPart(message: MessageSpec, index: number, text: string, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    const part = next.parts[index]
    if (part?.kind === "text") part.text = text
    onChange(next)
  }

  function updateArtifactPart(message: MessageSpec, index: number, sourceKeyValue: string, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    const part = next.parts[index]
    if (part?.kind === "artifact") part.source = sourceFromKey(sourceKeyValue)
    onChange(next)
  }

  function moveMessagePart(message: MessageSpec, index: number, offset: number, onChange: (message: MessageSpec) => void) {
    const target = index + offset
    if (target < 0 || target >= message.parts.length) return
    const next = cloneMessage(message)
    const [part] = next.parts.splice(index, 1)
    next.parts.splice(target, 0, part)
    onChange(next)
  }

  function removeMessagePart(message: MessageSpec, index: number, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    next.parts.splice(index, 1)
    if (next.parts.length === 0) next.parts.push({ kind: "text", text: "" })
    onChange(next)
  }

  function addElif(nodeId: string) {
    updateDraft((template: MacroTemplate) => {
      const node = findNode(template.body, nodeId)
      if (node?.type === "if") node.branches.push({ kind: "elif", condition: defaultCondition(template), body: [{ id: uniqueKey("return_elif", allNodeIds(template.body)), type: "return", reason: "elif" }] })
    })
  }

  function ensureElse(nodeId: string) {
    updateDraft((template: MacroTemplate) => {
      const node = findNode(template.body, nodeId)
      if (node?.type === "if" && !node.else) node.else = [{ id: uniqueKey("return_else", allNodeIds(template.body)), type: "return", reason: "else" }]
    })
  }


  function setSimpleMatcherOp(condition: TextMatchCondition, op: SimpleTextMatchOp): TextMatchCondition {
    if (condition.matcher.kind !== "simple") return condition
    return { ...condition, matcher: { kind: "simple", op, text: condition.matcher.text } }
  }

  function setSimpleMatcherText(condition: TextMatchCondition, text: string): TextMatchCondition {
    if (condition.matcher.kind !== "simple") return condition
    return { ...condition, matcher: { kind: "simple", op: condition.matcher.op, text } }
  }

  function setRegexMatcherPattern(condition: TextMatchCondition, pattern: string): TextMatchCondition {
    if (condition.matcher.kind !== "regex") return condition
    return { ...condition, matcher: { kind: "regex", pattern, flags: condition.matcher.flags } }
  }

  function setRegexMatcherFlags(condition: TextMatchCondition, flags: string): TextMatchCondition {
    if (condition.matcher.kind !== "regex") return condition
    return { ...condition, matcher: { kind: "regex", pattern: condition.matcher.pattern, flags } }
  }

  function keepCodexAgent(capture: CaptureSourceConfig): CaptureSourceConfig {
    return capture.kind === "agent-event" ? { ...capture, agent: { kind: "codex" } } : capture
  }

  function defaultTextFilter(): TextFilterSpec {
    return { kind: "exclude", matcher: { kind: "regex", pattern: "^\\s*[$#❯>]\\s*$" } }
  }

  function addTextFilter(nodeId: string) {
    updateNode(nodeId, (node) => {
      if (node.type === "extract_text") node.filters.push(defaultTextFilter())
    })
  }

  function removeTextFilter(nodeId: string, index: number) {
    updateNode(nodeId, (node) => {
      if (node.type === "extract_text") node.filters.splice(index, 1)
    })
  }

  function groupInputValue(group: string | number): string {
    return String(group)
  }

  function groupFromInput(value: string): string | number {
    return /^\d+$/.test(value) ? Number(value) : value
  }

  function addParallelItem(nodeId: string) {
    updateNode(nodeId, (node) => {
      if (node.type !== "parallel_send_capture") return
      const terminal = terminalChoices()[node.items.length]?.value ? targetFromChoice(terminalChoices()[node.items.length].value) : node.items[0]?.terminal ?? { kind: "index", value: 1 }
      node.items.push(defaultParallelItem("item_" + (node.items.length + 1), terminal))
    })
  }

  function setParallelItemWaitMode(parentId: string, itemId: string, mode: "none" | "duration" | "terminal-quiet") {
    updateNode(parentId, (node) => {
      if (node.type !== "parallel_send_capture") return
      const item = node.items.find((candidate) => candidate.id === itemId)
      if (!item) return
      if (mode === "none") {
        delete item.wait
      } else if (mode === "duration") {
        item.wait = { id: item.id + "_wait", type: "wait", mode, durationMs: 1500 }
      } else {
        item.wait = { id: item.id + "_wait", type: "wait", mode, terminal: item.terminal, quietMs: 1000, maxMs: 600000, onTimeout: "pause" }
      }
    })
  }

  function updateParallelItemWait(parentId: string, itemId: string, mutator: (wait: NonNullable<ParallelSendCaptureItem["wait"]>) => void) {
    updateNode(parentId, (node) => {
      if (node.type !== "parallel_send_capture") return
      const wait = node.items.find((candidate) => candidate.id === itemId)?.wait
      if (wait) mutator(wait)
    })
  }

  function addNodeToBlock(target: BlockTarget, type: FlowV2Node["type"]) {
    updateDraft((template: MacroTemplate) => {
      const nodes = blockNodes(template, target)
      if (nodes) nodes.push(defaultNode(template, type))
    })
  }

  function blockNodes(template: MacroTemplate, target: BlockTarget): FlowV2Node[] | undefined {
    if (target.kind === "root") return template.body
    const node = findNode(template.body, target.nodeId)
    if (target.kind === "for") return node?.type === "for" ? node.body : undefined
    if (target.kind === "if-else") return node?.type === "if" ? (node.else ??= []) : undefined
    return node?.type === "if" ? node.branches[target.branchIndex]?.body : undefined
  }

  function defaultNode(template: MacroTemplate, type: FlowV2Node["type"]): FlowV2Node {
    const terminal = firstTerminalTarget()
    const id = uniqueKey(type.replace(/[^A-Za-z0-9_-]/g, "_"), allNodeIds(template.body))
    if (type === "send_line") return { id, type, terminal, message: { parts: [{ kind: "text", text: "" }] } }
    if (type === "input_line") return { id, type, terminal, prompt: "Input", allowEmpty: false }
    if (type === "wait") return { id, type, mode: "duration", durationMs: 1500 }
    if (type === "capture-source") return { id, type, capture: defaultCaptureSource("terminal-buffer") }
    if (type === "extract_text") return { id, type, source: emptyArtifactSource(), split: { kind: "lines", keepEmpty: false }, filters: [], select: { mode: "last" }, extract: { kind: "none" }, trim: "right", onEmpty: "pause" }
    if (type === "parallel_send_capture") return { id, type, items: [defaultParallelItem(id + "_item", terminal)], merge: { kind: "sectioned_text", separator: "===== {itemId} | {terminalAlias} =====", order: "item_order", includeEmptyCaptures: true }, onItemFail: "pause" }
    if (type === "if") return { id, type, branches: [{ kind: "if", condition: defaultCondition(template), body: [] }] }
    if (type === "for") return { id, type, range: { count: 1 }, body: [] }
    if (type === "break") return { id, type, reason: "break" }
    if (type === "continue") return { id, type, reason: "continue" }
    return { id, type: "return", reason: "done" }
  }

  function firstTerminalTarget(): TerminalTarget {
    return terminalChoices()[0]?.value ? targetFromChoice(terminalChoices()[0].value) : { kind: "index", value: 1 }
  }

  function allNodeIds(nodes: FlowV2Node[]): string[] {
    return nodes.flatMap((node) => {
      const nested = node.type === "if"
        ? [...node.branches.flatMap((branch) => allNodeIds(branch.body)), ...(node.else ? allNodeIds(node.else) : [])]
        : node.type === "for" ? allNodeIds(node.body) : []
      return [node.id, ...nested]
    })
  }

  function uniqueKey(prefix: string, existing: string[]) {
    const base = sanitizeId(prefix) || "node"
    let candidate = base
    for (let index = 2; existing.includes(candidate); index += 1) candidate = base + "_" + index
    return candidate
  }

  function sanitizeId(value: string) {
    return value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[^A-Za-z0-9]+/, "") || "node"
  }
</script>

<section class="macro-section">
  <div class="macro-section-title"><h3>Flow V2 Body</h3></div>
  <div class="step-list" data-testid="macro-step-list">
    {@render NodeListEditor(draft.body, { kind: "root" }, false, "Root body")}
  </div>
</section>

{#snippet NodeListEditor(nodes: FlowV2Node[], target: BlockTarget, allowLoopControls: boolean, label: string)}
  <details class="flow-block" data-testid="flow-block" open>
    <summary class="step-title flow-block-title" data-testid="flow-block-summary">
      <strong>{label}</strong>
      <small>{nodes.length} nodes</small>
    </summary>
    {#if target.kind !== "root"}
      <div class="inline-actions flow-block-actions">
          <button type="button" data-testid="block-add-send" onclick={() => addNodeToBlock(target, "send_line")}>send</button>
          <button type="button" data-testid="block-add-wait" onclick={() => addNodeToBlock(target, "wait")}>wait</button>
          <button type="button" data-testid="block-add-capture" onclick={() => addNodeToBlock(target, "capture-source")}>capture</button>
          <button type="button" data-testid="block-add-extract" onclick={() => addNodeToBlock(target, "extract_text")}>extract</button>
          <button type="button" data-testid="block-add-if" onclick={() => addNodeToBlock(target, "if")}>if</button>
          <button type="button" data-testid="block-add-for" onclick={() => addNodeToBlock(target, "for")}>for</button>
          {#if allowLoopControls}
            <button type="button" data-testid="block-add-break" onclick={() => addNodeToBlock(target, "break")}>break</button>
            <button type="button" data-testid="block-add-continue" onclick={() => addNodeToBlock(target, "continue")}>continue</button>
          {/if}
          <button type="button" data-testid="block-add-return" onclick={() => addNodeToBlock(target, "return")}>return</button>
      </div>
    {/if}
    {#each nodes as node, index (node.id)}
      {@render NodeEditor(node, index, allowLoopControls)}
    {/each}
  </details>
{/snippet}

{#snippet NodeEditor(node: FlowV2Node, index: number, allowLoopControls: boolean)}
  <article class="step-editor flow-node-editor">
    <div class="step-title">
      <strong>{index + 1}. {node.type}</strong>
      <div class="inline-actions">
        <button type="button" onclick={() => moveNode(node.id, -1)}>Up</button>
        <button type="button" onclick={() => moveNode(node.id, 1)}>Down</button>
        <button type="button" onclick={() => removeNode(node.id)}>Remove</button>
      </div>
    </div>
    <div class="macro-row">
      <label>Node id<input value={node.id} oninput={(event) => setNodeId(node.id, event.currentTarget.value)} /></label>
    </div>

    {#if node.type === "send_line"}
      <label>Terminal
        <select data-testid="send-line-terminal" value={choiceFromTarget(node.terminal)} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "send_line") item.terminal = targetFromChoice(event.currentTarget.value) })}>
          {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
        </select>
      </label>
      {@render MessagePartsEditor(node.message, (message: MessageSpec) => updateNode(node.id, (item) => { if (item.type === "send_line") item.message = message }), artifactChoicesBefore(node.id))}
    {:else if node.type === "input_line"}
      <label>Terminal
        <select data-testid="input-line-terminal" value={choiceFromTarget(node.terminal)} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "input_line") item.terminal = targetFromChoice(event.currentTarget.value) })}>
          {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
        </select>
      </label>
      <label>Prompt<input value={node.prompt} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "input_line") item.prompt = event.currentTarget.value })} /></label>
      <label class="checkbox-row"><input type="checkbox" checked={node.allowEmpty} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "input_line") item.allowEmpty = event.currentTarget.checked })} />Allow empty</label>
      <label>Default source
        <select data-testid="input-line-default-source" value={node.defaultSource ? sourceKey(node.defaultSource) : ""} onchange={(event) => updateNode(node.id, (item) => { if (item.type !== "input_line") return; item.defaultSource = event.currentTarget.value ? sourceFromKey(event.currentTarget.value) : undefined })}>
          <option value="">none</option>{#each artifactChoicesBefore(node.id) as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}
        </select>
      </label>
    {:else if node.type === "wait"}
      <label>Mode
        <select data-testid="wait-mode" value={node.mode} onchange={(event) => updateNode(node.id, (item) => {
          if (item.type !== "wait") return
          const mode = event.currentTarget.value
          if (mode === "duration") Object.assign(item, { mode, durationMs: 1500 })
          if (mode === "terminal-quiet") Object.assign(item, { mode, terminal: { kind: "index", value: 1 }, quietMs: 1000, maxMs: 600000, onTimeout: "pause" })
          if (mode === "user-continue") Object.assign(item, { mode, prompt: "Continue when ready" })
        })}>
          <option value="duration">duration</option><option value="terminal-quiet">terminal-quiet</option><option value="user-continue">user-continue</option>
        </select>
      </label>
      {#if node.mode === "duration"}
        <label>Duration ms<input type="number" value={node.durationMs} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "duration") item.durationMs = Number(event.currentTarget.value) })} /></label>
      {:else if node.mode === "terminal-quiet"}
        <label>Terminal<select value={choiceFromTarget(node.terminal)} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "terminal-quiet") item.terminal = targetFromChoice(event.currentTarget.value) })}>{#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}</select></label>
        <div class="macro-row"><label>Quiet ms<input type="number" value={node.quietMs} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "terminal-quiet") item.quietMs = Number(event.currentTarget.value) })} /></label><label>Max ms<input type="number" value={node.maxMs} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "terminal-quiet") item.maxMs = Number(event.currentTarget.value) })} /></label><label>On timeout<select value={node.onTimeout} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "terminal-quiet") item.onTimeout = event.currentTarget.value as "pause" | "return" })}><option value="pause">pause</option><option value="return">return</option></select></label></div>
      {:else}
        <label>Prompt<input value={node.prompt} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "user-continue") item.prompt = event.currentTarget.value })} /></label>
      {/if}
    {:else if node.type === "capture-source"}
      {@render CaptureEditor({ capture: node.capture }, terminalChoices, choiceFromTarget, targetFromChoice, defaultCaptureSource, (capture: CaptureSourceConfig) => updateNode(node.id, (item) => { if (item.type === "capture-source") item.capture = capture }))}
    {:else if node.type === "extract_text"}
      {@render ExtractTextEditor(node, artifactChoicesBefore(node.id), (mutator: (item: Extract<FlowV2Node, { type: "extract_text" }>) => void) => updateNode(node.id, (item) => { if (item.type === "extract_text") mutator(item) }))}
    {:else if node.type === "if"}
      {#each node.branches as branch, branchIndex}
        <div class="flow-branch-card">
          <strong>{branch.kind}</strong>
          {@render ConditionEditor(branch.condition, artifactChoicesBefore(node.id), (condition: TextMatchCondition) => updateNode(node.id, (item) => { if (item.type === "if") item.branches[branchIndex].condition = condition }))}
          {@render NodeListEditor(branch.body, { kind: "if-branch", nodeId: node.id, branchIndex }, allowLoopControls, branch.kind + " body")}
        </div>
      {/each}
      <div class="inline-actions"><button type="button" data-testid="add-flow-elif" onclick={() => addElif(node.id)}>Add elif</button><button type="button" data-testid="add-flow-else" onclick={() => ensureElse(node.id)}>Add else</button></div>
      {#if node.else}{@render NodeListEditor(node.else, { kind: "if-else", nodeId: node.id }, allowLoopControls, "else body")}{/if}
    {:else if node.type === "for"}
      <label>Count<input type="number" value={node.range.count} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "for") item.range.count = Number(event.currentTarget.value) })} /></label>
      {@render NodeListEditor(node.body, { kind: "for", nodeId: node.id }, true, "for body")}
    {:else if node.type === "parallel_send_capture"}
      <div class="macro-row"><label>Separator<input value={node.merge.separator} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "parallel_send_capture") item.merge.separator = event.currentTarget.value })} /></label><label class="checkbox-row"><input type="checkbox" checked={node.merge.includeEmptyCaptures} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "parallel_send_capture") item.merge.includeEmptyCaptures = event.currentTarget.checked })} />Include empty captures</label></div>
      {#each node.items as item}
        <div class="parallel-lane-card">
          <div class="step-title"><strong>{item.id}</strong><button type="button" onclick={() => updateNode(node.id, (parent) => { if (parent.type === "parallel_send_capture") parent.items = parent.items.filter((candidate) => candidate.id !== item.id) })}>Remove</button></div>
          <label>Item id<input value={item.id} oninput={(event) => updateNode(node.id, (parent) => { if (parent.type !== "parallel_send_capture") return; const target = parent.items.find((candidate) => candidate.id === item.id); if (target) target.id = event.currentTarget.value })} /></label>
          <label>Terminal<select value={choiceFromTarget(item.terminal)} onchange={(event) => updateNode(node.id, (parent) => { if (parent.type !== "parallel_send_capture") return; const target = parent.items.find((candidate) => candidate.id === item.id); if (!target) return; const terminal = targetFromChoice(event.currentTarget.value); target.terminal = terminal; target.send.terminal = terminal; target.capture.capture.terminal = terminal; if (target.wait?.mode === "terminal-quiet") target.wait.terminal = terminal })}>{#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}</select></label>
          {@render MessagePartsEditor(item.send.message, (message: MessageSpec) => updateNode(node.id, (parent) => { if (parent.type !== "parallel_send_capture") return; const target = parent.items.find((candidate) => candidate.id === item.id); if (target) target.send.message = message }), artifactChoicesBefore(node.id))}
          {@render ParallelItemWaitEditor(node.id, item)}
          {@render CaptureEditor(item.capture, terminalChoices, choiceFromTarget, targetFromChoice, defaultCaptureSource, (capture: CaptureSourceConfig) => updateNode(node.id, (parent) => { if (parent.type !== "parallel_send_capture") return; const target = parent.items.find((candidate) => candidate.id === item.id); if (target) target.capture.capture = capture }))}
        </div>
      {/each}
      <button type="button" data-testid="parallel-add-item" onclick={() => addParallelItem(node.id)}>Add item</button>
    {:else}
      <label>Reason<input value={node.reason ?? ""} oninput={(event) => updateNode(node.id, (item) => { if ("reason" in item) item.reason = event.currentTarget.value || undefined })} /></label>
    {/if}
  </article>
{/snippet}

{#if !validation.ok}
  <section class="macro-section validation-panel" data-testid="macro-validation">
    <h3>Validation</h3>
    <p>{validation.issues.length} issues</p>
    <ul>{#each validation.issues as issue}<li><strong>{issue.path}</strong> {issue.message}</li>{/each}</ul>
  </section>
{/if}

{#snippet ParallelItemWaitEditor(parentId: string, item: ParallelSendCaptureItem)}
  <section class="message-part-row" data-testid="parallel-item-wait-editor">
    <div class="step-title"><strong>Wait</strong></div>
    <label>Mode
      <select data-testid="parallel-item-wait-mode" value={item.wait?.mode ?? "none"} onchange={(event) => setParallelItemWaitMode(parentId, item.id, event.currentTarget.value as "none" | "duration" | "terminal-quiet")}>
        <option value="none">none</option><option value="duration">duration</option><option value="terminal-quiet">terminal-quiet</option>
      </select>
    </label>
    {#if item.wait?.mode === "duration"}
      <label>Duration ms<input type="number" value={item.wait.durationMs} oninput={(event) => updateParallelItemWait(parentId, item.id, (wait) => { if (wait.mode === "duration") wait.durationMs = Number(event.currentTarget.value) })} /></label>
    {:else if item.wait?.mode === "terminal-quiet"}
      <div class="macro-row">
        <label>Quiet ms<input type="number" value={item.wait.quietMs} oninput={(event) => updateParallelItemWait(parentId, item.id, (wait) => { if (wait.mode === "terminal-quiet") wait.quietMs = Number(event.currentTarget.value) })} /></label>
        <label>Max ms<input type="number" value={item.wait.maxMs} oninput={(event) => updateParallelItemWait(parentId, item.id, (wait) => { if (wait.mode === "terminal-quiet") wait.maxMs = Number(event.currentTarget.value) })} /></label>
        <label>On timeout<select value={item.wait.onTimeout} onchange={(event) => updateParallelItemWait(parentId, item.id, (wait) => { if (wait.mode === "terminal-quiet") wait.onTimeout = event.currentTarget.value as "pause" })}><option value="pause">pause</option></select></label>
      </div>
    {/if}
  </section>
{/snippet}

{#snippet MessagePartsEditor(message: MessageSpec, onChange: (message: MessageSpec) => void, choices: ArtifactChoice[])}
  <div class="message-parts-editor" data-testid="message-parts-editor">
    <div class="inline-actions">
      <button type="button" data-testid="message-add-text" onclick={() => addTextPart(message, onChange)}>Add Text</button>
      <button type="button" data-testid="message-add-source" title="Add source artifact" onclick={() => addArtifactPart(choices, message, onChange)}>Add Source</button>
    </div>
    {#each message.parts as part, partIndex}
      <div class="message-part-row" data-testid="message-part-row">
        <div class="step-title">
          <strong>{partIndex + 1}. {part.kind}</strong>
          <div class="inline-actions">
            <button type="button" onclick={() => moveMessagePart(message, partIndex, -1, onChange)}>Up</button>
            <button type="button" onclick={() => moveMessagePart(message, partIndex, 1, onChange)}>Down</button>
            <button type="button" onclick={() => removeMessagePart(message, partIndex, onChange)}>Remove</button>
          </div>
        </div>
        {#if part.kind === "text"}
          <label>Text<LineNumberedTextarea testId="message-text-part" value={part.text} ariaLabel="Message text part" onInput={(value: string) => updateTextPart(message, partIndex, value, onChange)} /></label>
        {:else}
          <label>Source artifact
            <select data-testid="message-source-part" value={sourceKey(part.source)} onchange={(event) => updateArtifactPart(message, partIndex, event.currentTarget.value, onChange)}>
              <option value="">none</option>{#each choices as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}
            </select>
          </label>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet ExtractTextEditor(node: Extract<FlowV2Node, { type: "extract_text" }>, choices: ArtifactChoice[], updateExtract: (mutator: (item: Extract<FlowV2Node, { type: "extract_text" }>) => void) => void)}
  <label>Source
    <select data-testid="extract-text-source" value={sourceKey(node.source)} onchange={(event) => updateExtract((item) => { item.source = sourceFromKey(event.currentTarget.value) })}>
      {#each choices as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}
    </select>
  </label>
  <div class="macro-row">
    <label>Split
      <select data-testid="extract-text-split-kind" value={node.split.kind} onchange={(event) => updateExtract((item) => { item.split = event.currentTarget.value === "regex" ? { kind: "regex", pattern: "\\n+", flags: "", keepEmpty: false } : { kind: "lines", keepEmpty: false } })}>
        <option value="lines">lines</option><option value="regex">regex</option>
      </select>
    </label>
    <label class="checkbox-row"><input type="checkbox" checked={node.split.keepEmpty} onchange={(event) => updateExtract((item) => { item.split.keepEmpty = event.currentTarget.checked })} />Keep empty</label>
  </div>
  {#if node.split.kind === "regex"}
    <div class="macro-row"><label>Split pattern<input data-testid="extract-text-split-pattern" value={node.split.pattern} oninput={(event) => updateExtract((item) => { if (item.split.kind === "regex") item.split.pattern = event.currentTarget.value })} /></label><label>Flags<input value={node.split.flags ?? ""} oninput={(event) => updateExtract((item) => { if (item.split.kind === "regex") item.split.flags = event.currentTarget.value })} /></label></div>
  {/if}

  <div class="step-title"><strong>Filters</strong><button type="button" data-testid="extract-add-filter" onclick={() => addTextFilter(node.id)}>Add filter</button></div>
  {#each node.filters as filter, filterIndex}
    <div class="message-part-row" data-testid="extract-filter-row">
      <div class="macro-row">
        <label>Mode<select value={filter.kind} onchange={(event) => updateExtract((item) => { item.filters[filterIndex].kind = event.currentTarget.value as "include" | "exclude" })}><option value="include">include</option><option value="exclude">exclude</option></select></label>
        <label>Matcher<select value={filter.matcher.kind} onchange={(event) => updateExtract((item) => { item.filters[filterIndex].matcher = event.currentTarget.value === "regex" ? { kind: "regex", pattern: "READY", flags: "" } : { kind: "simple", op: "contains", text: "READY" } })}><option value="simple">simple</option><option value="regex">regex</option></select></label>
        <button type="button" onclick={() => removeTextFilter(node.id, filterIndex)}>Remove</button>
      </div>
      {#if filter.matcher.kind === "simple"}
        <div class="macro-row"><label>Op<select value={filter.matcher.op} onchange={(event) => updateExtract((item) => { const target = item.filters[filterIndex]; if (target.matcher.kind === "simple") target.matcher.op = event.currentTarget.value as SimpleTextMatchOp })}><option value="contains">contains</option><option value="not_contains">not_contains</option><option value="equals">equals</option><option value="not_equals">not_equals</option><option value="starts_with">starts_with</option><option value="ends_with">ends_with</option></select></label><label>Text<input value={filter.matcher.text} oninput={(event) => updateExtract((item) => { const target = item.filters[filterIndex]; if (target.matcher.kind === "simple") target.matcher.text = event.currentTarget.value })} /></label></div>
      {:else}
        <div class="macro-row"><label>Pattern<input value={filter.matcher.pattern} oninput={(event) => updateExtract((item) => { const target = item.filters[filterIndex]; if (target.matcher.kind === "regex") target.matcher.pattern = event.currentTarget.value })} /></label><label>Flags<input value={filter.matcher.flags ?? ""} oninput={(event) => updateExtract((item) => { const target = item.filters[filterIndex]; if (target.matcher.kind === "regex") target.matcher.flags = event.currentTarget.value })} /></label></div>
      {/if}
    </div>
  {/each}

  <div class="macro-row">
    <label>Select
      <select data-testid="extract-text-select-mode" value={node.select.mode} onchange={(event) => updateExtract((item) => { const mode = event.currentTarget.value; item.select = mode === "index" ? { mode, index: 0 } : mode === "range" ? { mode, start: 0 } : { mode: mode as "first" | "last" | "all" } })}>
        <option value="first">first</option><option value="last">last</option><option value="all">all</option><option value="index">index</option><option value="range">range</option>
      </select>
    </label>
    {#if node.select.mode === "index"}<label>Index<input type="number" min="0" value={node.select.index} oninput={(event) => updateExtract((item) => { if (item.select.mode === "index") item.select.index = Number(event.currentTarget.value) })} /></label>{/if}
    {#if node.select.mode === "range"}<label>Start<input type="number" min="0" value={node.select.start} oninput={(event) => updateExtract((item) => { if (item.select.mode === "range") item.select.start = Number(event.currentTarget.value) })} /></label><label>End<input type="number" min="0" value={node.select.end ?? ""} oninput={(event) => updateExtract((item) => { if (item.select.mode === "range") item.select.end = event.currentTarget.value === "" ? undefined : Number(event.currentTarget.value) })} /></label>{/if}
  </div>

  <div class="macro-row">
    <label>Extract
      <select data-testid="extract-text-extract-kind" value={node.extract.kind} onchange={(event) => updateExtract((item) => { item.extract = event.currentTarget.value === "regex" ? { kind: "regex", pattern: "(.*)", flags: "", group: 1 } : { kind: "none" } })}>
        <option value="none">none</option><option value="regex">regex group</option>
      </select>
    </label>
    <label>Trim<select value={node.trim} onchange={(event) => updateExtract((item) => { item.trim = event.currentTarget.value as never })}><option value="none">none</option><option value="left">left</option><option value="right">right</option><option value="both">both</option></select></label>
    <label>On empty<select value={node.onEmpty} onchange={(event) => updateExtract((item) => { item.onEmpty = event.currentTarget.value as never })}><option value="pause">pause</option><option value="fail">fail</option><option value="return">return</option></select></label>
  </div>
  {#if node.extract.kind === "regex"}
    <div class="macro-row"><label>Pattern<input data-testid="extract-text-regex-pattern" value={node.extract.pattern} oninput={(event) => updateExtract((item) => { if (item.extract.kind === "regex") item.extract.pattern = event.currentTarget.value })} /></label><label>Flags<input value={node.extract.flags ?? ""} oninput={(event) => updateExtract((item) => { if (item.extract.kind === "regex") item.extract.flags = event.currentTarget.value })} /></label><label>Group<input value={groupInputValue(node.extract.group)} oninput={(event) => updateExtract((item) => { if (item.extract.kind === "regex") item.extract.group = groupFromInput(event.currentTarget.value) })} /></label></div>
  {/if}
{/snippet}

{#snippet CaptureEditor(node: { capture: CaptureSourceConfig }, terminalChoices: () => TerminalChoice[], choiceFromTarget: (target: TerminalTarget) => string, targetFromChoice: (choice: string) => TerminalTarget, defaultCaptureSource: (kind: CaptureSourceConfig["kind"]) => CaptureSourceConfig, onChange: (capture: CaptureSourceConfig) => void)}
  <label>Capture kind<select data-testid="capture-step-kind" value={node.capture.kind} onchange={(event) => onChange(defaultCaptureSource(event.currentTarget.value as CaptureSourceConfig["kind"]))}><option value="terminal-buffer">terminal-buffer</option><option value="text-box">text-box</option><option value="agent-event">agent-event</option></select></label>
  <label>Terminal<select data-testid="capture-step-terminal" value={choiceFromTarget(node.capture.terminal)} onchange={(event) => { const next = JSON.parse(JSON.stringify(node.capture)) as CaptureSourceConfig; next.terminal = targetFromChoice(event.currentTarget.value); onChange(next) }}>{#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}</select></label>
  {#if node.capture.kind === "terminal-buffer"}
    <label>Mode<select data-testid="capture-terminal-buffer-mode" value={node.capture.mode} onchange={(event) => { if (node.capture.kind === "terminal-buffer") onChange({ ...node.capture, mode: event.currentTarget.value as "scrollback-tail" | "raw-stream-tail" }) }}><option value="scrollback-tail">screen text tail</option><option value="raw-stream-tail">raw stream tail (debug only)</option></select></label>
    <label>Max chars<input type="number" value={node.capture.maxChars} oninput={(event) => { if (node.capture.kind === "terminal-buffer") onChange({ ...node.capture, maxChars: Number(event.currentTarget.value) }) }} /></label>
  {:else if node.capture.kind === "agent-event"}
    <label>Agent<select data-testid="capture-agent-kind" value={node.capture.agent.kind} onchange={() => onChange(keepCodexAgent(node.capture))}><option value="codex">codex</option></select></label>
    <p class="hint">Codex Stop hook: last_assistant_message</p>
  {:else}
    <p class="hint">Text box capture reads the selected text deck slot as plain text.</p>
  {/if}
{/snippet}

{#snippet ConditionEditor(condition: TextMatchCondition, choices: ArtifactChoice[], onChange: (condition: TextMatchCondition) => void)}
  <div class="condition-row">
    <label>Source<select value={sourceKey(condition.source)} onchange={(event) => onChange({ ...condition, source: sourceFromKey(event.currentTarget.value) })}>{#each choices as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
    <label>Matcher<select value={condition.matcher.kind} onchange={(event) => onChange({ ...condition, matcher: event.currentTarget.value === "regex" ? { kind: "regex", pattern: "READY", flags: "i" } : { kind: "simple", op: "contains", text: "READY" } })}><option value="simple">simple</option><option value="regex">regex</option></select></label>
    {#if condition.matcher.kind === "simple"}
      <label>Op<select value={condition.matcher.op} onchange={(event) => onChange(setSimpleMatcherOp(condition, event.currentTarget.value as SimpleTextMatchOp))}><option value="contains">contains</option><option value="not_contains">not_contains</option><option value="equals">equals</option><option value="not_equals">not_equals</option><option value="starts_with">starts_with</option><option value="ends_with">ends_with</option></select></label>
      <label>Text<input value={condition.matcher.text} oninput={(event) => onChange(setSimpleMatcherText(condition, event.currentTarget.value))} /></label>
    {:else}
      <label>Pattern<input value={condition.matcher.pattern} oninput={(event) => onChange(setRegexMatcherPattern(condition, event.currentTarget.value))} /></label>
      <label>Flags<input value={condition.matcher.flags ?? ""} oninput={(event) => onChange(setRegexMatcherFlags(condition, event.currentTarget.value))} /></label>
    {/if}
    <label>Scope<select value={condition.scope.kind === "lines" ? "lines:" + condition.scope.mode : "whole"} onchange={(event) => { const value = event.currentTarget.value; onChange({ ...condition, scope: value === "whole" ? { kind: "whole" } : { kind: "lines", mode: value.split(":")[1] as never, includeEmptyLines: false } }) }}><option value="whole">whole</option><option value="lines:first">lines.first</option><option value="lines:last">lines.last</option><option value="lines:any">lines.any</option><option value="lines:all">lines.all</option></select></label>
  </div>
{/snippet}
