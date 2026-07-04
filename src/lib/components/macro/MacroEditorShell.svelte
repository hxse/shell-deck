<script lang="ts">
  import type { TerminalIndexMapItem, TerminalSnapshot } from "../../protocol"
  import type { ProfileCatalogSummary } from "../../macro/profileCatalogSummary"
  import type { CaptureSourceConfig, FlowV2Node, MacroTemplate, MessageSpec, ParallelSendCaptureItem, TerminalTarget, ValidationResult } from "../../macro/templateTypes"
  import MacroActionPalette from "./MacroActionPalette.svelte"
  import MacroStepList from "./MacroStepList.svelte"

  let { draft = $bindable<MacroTemplate | null>(), catalog, terminals, indexMap, validation, macroControl } = $props<{
    draft: MacroTemplate | null
    catalog: ProfileCatalogSummary | null
    terminals: TerminalSnapshot[]
    indexMap: TerminalIndexMapItem[]
    validation: ValidationResult
    macroControl: (action: "start" | "pause" | "resume" | "stop") => void
  }>()

  function updateDraft(mutator: (template: MacroTemplate) => void) {
    if (!draft) return
    const next = JSON.parse(JSON.stringify(draft)) as MacroTemplate
    mutator(next)
    draft = next
  }

  function addNode(type: FlowV2Node["type"]) {
    updateDraft((template) => template.body.push(defaultNode(template, type)))
  }

  function defaultNode(template: MacroTemplate, type: FlowV2Node["type"]): FlowV2Node {
    const terminal = firstTerminalTarget()
    const id = uniqueKey(type.replace(/[^A-Za-z0-9_-]/g, "_"), allNodeIds(template.body))
    if (type === "send_line") return { id, type, terminal, message: defaultMessage("") }
    if (type === "input_line") return { id, type, terminal, prompt: "Input", allowEmpty: false }
    if (type === "wait") return { id, type, mode: "duration", durationMs: 1500 }
    if (type === "capture-source") return { id, type, capture: defaultCaptureSource("terminal-buffer") }
    if (type === "extract_text") return { id, type, source: defaultArtifactSource(template), split: { kind: "lines", keepEmpty: false }, filters: [], select: { mode: "last" }, extract: { kind: "none" }, trim: "right", onEmpty: "pause" }
    if (type === "parallel_send_capture") return { id, type, items: [defaultParallelItem(id + "_item", terminal)], merge: { kind: "sectioned_text", separator: "===== {itemId} | {terminalAlias} =====", order: "item_order", includeEmptyCaptures: true }, onItemFail: "pause" }
    if (type === "if") return { id, type, branches: [{ kind: "if", condition: defaultCondition(template), body: [{ id: uniqueKey("return", allNodeIds(template.body)), type: "return", reason: "matched" }] }] }
    if (type === "for") return { id, type, range: { count: 1 }, body: [{ id: uniqueKey("return", allNodeIds(template.body)), type: "return", reason: "loop" }] }
    if (type === "break") return { id, type, reason: "break" }
    if (type === "continue") return { id, type, reason: "continue" }
    return { id, type: "return", reason: "done" }
  }

  function defaultParallelItem(rawId: string, terminal: TerminalTarget): ParallelSendCaptureItem {
    const id = sanitizeId(rawId)
    return {
      id,
      terminal,
      send: { id: id + "_send", type: "send_line", terminal, message: defaultMessage("") },
      wait: { id: id + "_wait", type: "wait", mode: "terminal-quiet", terminal, quietMs: 1000, maxMs: 600000, onTimeout: "pause" },
      capture: { id: id + "_capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal, mode: "scrollback-tail", maxChars: 20000 } },
    }
  }

  function defaultCondition(template: MacroTemplate) {
    return { kind: "text_match" as const, source: defaultArtifactSource(template), matcher: { kind: "simple" as const, op: "contains" as const, text: "READY" }, scope: { kind: "whole" as const } }
  }

  function defaultArtifactSource(template: MacroTemplate) {
    return artifactChoices(template)[0]?.source ?? { kind: "step_artifact" as const, stepId: "capture_1", artifact: "captured_text" as const }
  }

  function defaultMessage(text: string): MessageSpec {
    return { parts: [{ kind: "text", text }] }
  }

  function terminalChoices() {
    const aliases = indexMap.map((item: TerminalIndexMapItem) => ({ value: "alias:" + item.terminalAlias, label: "alias:" + item.terminalAlias }))
    const indices = indexMap.map((item: TerminalIndexMapItem) => ({ value: "index:" + item.index, label: "#" + item.index + " " + item.terminalAlias }))
    const ids = terminals.map((terminal: TerminalSnapshot) => ({ value: "id:" + terminal.terminalId, label: terminal.terminalId }))
    return [...aliases, ...indices, ...ids]
  }

  function targetFromChoice(choice: string): TerminalTarget {
    const [kind, ...rest] = choice.split(":")
    const value = rest.join(":")
    if (kind === "index") return { kind: "index", value: Number(value) }
    if (kind === "id") return { kind: "id", value }
    return { kind: "alias", value }
  }

  function choiceFromTarget(target: TerminalTarget): string {
    return target.kind + ":" + target.value
  }

  function firstTerminalTarget(): TerminalTarget {
    return indexMap[0]?.terminalAlias ? { kind: "alias", value: indexMap[0].terminalAlias } : { kind: "index", value: 1 }
  }

  function defaultCaptureSource(kind: CaptureSourceConfig["kind"]): CaptureSourceConfig {
    const terminal = firstTerminalTarget()
    if (kind === "agent-event") return { kind, terminal, agent: { kind: "codex" }, eventKind: "stop", field: "last_assistant_message" }
    if (kind === "text-box") return { kind, terminal }
    return { kind, terminal, mode: "scrollback-tail", maxChars: 20000 }
  }

  function artifactChoices(template: MacroTemplate) {
    return collectArtifactChoices(template.body)
  }

  function collectArtifactChoices(nodes: FlowV2Node[]) {
    const choices: Array<{ label: string; source: { kind: "step_artifact"; stepId: string; artifact: "captured_text" | "merged_text" | "extracted_text" } }> = []
    for (const node of nodes) {
      if (node.type === "capture-source") choices.push({ label: node.id + ".captured_text", source: { kind: "step_artifact", stepId: node.id, artifact: "captured_text" } })
      if (node.type === "parallel_send_capture") choices.push({ label: node.id + ".merged_text", source: { kind: "step_artifact", stepId: node.id, artifact: "merged_text" } })
      if (node.type === "extract_text") choices.push({ label: node.id + ".extracted_text", source: { kind: "step_artifact", stepId: node.id, artifact: "extracted_text" } })
      if (node.type === "if") {
        for (const branch of node.branches) choices.push(...collectArtifactChoices(branch.body))
        if (node.else) choices.push(...collectArtifactChoices(node.else))
      }
      if (node.type === "for") choices.push(...collectArtifactChoices(node.body))
    }
    return choices
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

{#if draft}
  <div class="macro-editor-layout">
    <main class="macro-editor-main">
      <MacroStepList
        {draft}
        {validation}
        {updateDraft}
        {terminalChoices}
        {choiceFromTarget}
        {targetFromChoice}
        {defaultCaptureSource}
        {defaultParallelItem}
        {defaultCondition}
        {artifactChoices}
      />
    </main>
    <MacroActionPalette {draft} {addNode} {macroControl} />
  </div>
{:else}
  <p class="hint">Create or import a macro template.</p>
{/if}
