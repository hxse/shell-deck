<script lang="ts">
  import type { TerminalIndexMapItem, TerminalSnapshot } from "../../protocol"
  import type { CaptureSourceConfig, FlowV2Node, MacroTemplate, TerminalTarget, ValidationResult } from "../../macro/templateTypes"
  import { tabCapabilitiesForBackend, type TerminalChoice } from "../../macro/tabCapabilities"
  import MacroStepList from "./MacroStepList.svelte"
  import type { MacroInsertionPaletteMode } from "../../workspace/uiLayoutTypes"

  let { draft, terminals, indexMap, validation, insertionPaletteMode, telegramProfileIds = [], telegramProfilesError = '', locked = false, onUpdateDraft } = $props<{
    draft: MacroTemplate | null
    terminals: TerminalSnapshot[]
    indexMap: TerminalIndexMapItem[]
    validation: ValidationResult
    insertionPaletteMode: MacroInsertionPaletteMode
    telegramProfileIds?: string[]
    telegramProfilesError?: string
    locked?: boolean
    onUpdateDraft: (mutator: (template: MacroTemplate) => void) => void
  }>()

  function defaultCondition(template: MacroTemplate) {
    return { kind: "text_match" as const, source: defaultArtifactSource(template), matcher: { kind: "simple" as const, op: "contains" as const, text: "READY" }, scope: { kind: "whole" as const } }
  }

  function defaultArtifactSource(template: MacroTemplate) {
    return artifactChoices(template)[0]?.source ?? { kind: "step_artifact" as const, stepId: "capture_1", artifact: "captured_text" as const }
  }

  function terminalChoices(): TerminalChoice[] {
    return indexMap.flatMap((item: TerminalIndexMapItem) => {
      const terminal = terminals.find((candidate: TerminalSnapshot) => candidate.terminalId === item.terminalId)
      if (!terminal) return []
      const capabilities = tabCapabilitiesForBackend(terminal.backend)
      return [{
        value: terminalChoiceValue(item),
        label: "#" + item.index + " | " + item.terminalAlias + " | " + capabilities.kind,
        title: "tab index: #" + item.index + "\nalias: " + item.terminalAlias + "\nid: " + item.terminalId + "\nkind: " + capabilities.kind,
        index: item.index,
        terminalId: item.terminalId,
        terminalAlias: item.terminalAlias,
        capabilities,
      }]
    })
  }

  function terminalChoiceValue(item: TerminalIndexMapItem): string {
    return "terminal:" + item.terminalId
  }

  function indexItemForTarget(target: TerminalTarget): TerminalIndexMapItem | undefined {
    if (target.kind === "id") return indexMap.find((item: TerminalIndexMapItem) => item.terminalId === target.value)
    if (target.kind === "alias") return indexMap.find((item: TerminalIndexMapItem) => item.terminalAlias === target.value)
    return indexMap.find((item: TerminalIndexMapItem) => item.index === target.value)
  }

  function targetFromChoice(choice: string): TerminalTarget {
    const [kind, ...rest] = choice.split(":")
    const value = rest.join(":")
    if (kind === "terminal") return { kind: "id", value }
    if (kind === "index") return { kind: "index", value: Number(value) }
    if (kind === "id") return { kind: "id", value }
    return { kind: "alias", value }
  }

  function choiceFromTarget(target: TerminalTarget): string {
    const item = indexItemForTarget(target)
    return item ? terminalChoiceValue(item) : target.kind + ":" + target.value
  }

  function firstTerminalTarget(): TerminalTarget {
    return indexMap[0]?.terminalAlias ? { kind: "alias", value: indexMap[0].terminalAlias } : { kind: "index", value: 1 }
  }

  function defaultCaptureSource(kind: CaptureSourceConfig["kind"]): CaptureSourceConfig {
    const terminal = firstTerminalTarget()
    if (kind === "agent-event") return { kind, terminal, agent: { kind: "codex" }, captureMode: "result_only" }
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
      if (node.type === "parallel") choices.push({ label: node.id + ".merged_text", source: { kind: "step_artifact", stepId: node.id, artifact: "merged_text" } })
      if (node.type === "extract_text") choices.push({ label: node.id + ".extracted_text", source: { kind: "step_artifact", stepId: node.id, artifact: "extracted_text" } })
      if (node.type === "if") {
        for (const branch of node.branches) choices.push(...collectArtifactChoices(branch.body))
        if (node.else) choices.push(...collectArtifactChoices(node.else))
      }
      if (node.type === "for") choices.push(...collectArtifactChoices(node.body))
      if ((node.type === "break" || node.type === "continue" || node.type === "finish") && node.body) choices.push(...collectArtifactChoices(node.body))
    }
    return choices
  }

  function sanitizeId(value: string) {
    return value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[^A-Za-z0-9]+/, "") || "node"
  }
</script>

{#if draft}
  <div class="macro-editor-layout no-tools">
    <main class="macro-editor-main">
      <fieldset class="macro-editor-lock-surface" data-testid="macro-editor-lock-surface" disabled={locked} inert={locked} aria-busy={locked} aria-disabled={locked}>
        {#key draft.id}
          <MacroStepList
            {draft}
            {validation}
            updateDraft={onUpdateDraft}
            {terminalChoices}
            {choiceFromTarget}
            {targetFromChoice}
            {defaultCaptureSource}
            {defaultCondition}
            {artifactChoices}
            {insertionPaletteMode}
            {telegramProfileIds}
            {telegramProfilesError}
          />
        {/key}
      </fieldset>
    </main>
  </div>
{:else}
  <p class="hint">Create or import a macro template.</p>
{/if}
