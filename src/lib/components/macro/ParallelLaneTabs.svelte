<script lang="ts">
  import { tick } from "svelte"
  import MessagePartsEditor from "./MessagePartsEditor.svelte"
  import NodeActionControls from "./NodeActionControls.svelte"
  import TerminalEndingField from "./TerminalEndingField.svelte"
  import TerminalInputDeliveryField from "./TerminalInputDeliveryField.svelte"
  import type { TextTemplateScope } from "../../macro/scopedTextTemplateEditor"
  import { isCaptureKindAllowed, terminalChoiceForTarget, type CapabilityCaptureKind, type TerminalChoice } from "../../macro/tabCapabilities"
  import type { MacroInsertionPaletteMode } from "../../workspace/uiLayoutTypes"
  import type {
    CaptureSourceConfig,
    FlowV2ArtifactSource,
    FlowV2Node,
    MacroTemplate,
    MessageSpec,
    ParallelLane,
    ParallelLaneActionNode,
    ParallelLaneNode,
    ParallelLaneOutputNode,
    ParallelNode,
    ParallelOutputSource,
    TerminalTarget,
    TerminalEnding,
    TerminalInputDelivery,
  } from "../../macro/templateTypes"

  type ArtifactChoice = { label: string; source: FlowV2ArtifactSource }
  type LaneActionType = ParallelLaneActionNode["type"]
  type InsertionPalettePosition = { x: number; y: number; placement: "above" | "below"; maxHeight?: number }

  let {
    draft,
    nodeId,
    updateDraft,
    terminalChoices,
    choiceFromTarget,
    targetFromChoice,
    defaultCaptureSource,
    outerArtifactChoices,
    templateScope = null,
    insertionPaletteMode,
  } = $props<{
    draft: MacroTemplate
    nodeId: string
    updateDraft: (mutator: (template: MacroTemplate) => void) => void
    terminalChoices: () => TerminalChoice[]
    choiceFromTarget: (target: TerminalTarget) => string
    targetFromChoice: (choice: string) => TerminalTarget
    defaultCaptureSource: (kind: CaptureSourceConfig["kind"]) => CaptureSourceConfig
    outerArtifactChoices: ArtifactChoice[]
    templateScope?: TextTemplateScope | null
    insertionPaletteMode: MacroInsertionPaletteMode
  }>()

  let selectedLaneId = $state("")
  let laneInsertion = $state<{ laneId: string; index: number; summary: string } | null>(null)
  let laneInsertionPosition = $state<InsertionPalettePosition | null>(null)
  let laneInsertionTriggerElement = $state<HTMLElement | null>(null)
  let laneInsertionPaletteElement = $state<HTMLElement | null>(null)
  let collapsedLaneActionIds = $state<string[]>([])
  let editNotice = $state("")
  const parallelNode = $derived(findParallel(draft.body, nodeId))
  const selectedLane = $derived(parallelNode?.lanes.find((lane) => lane.id === selectedLaneId) ?? parallelNode?.lanes[0])
  const laneInsertionAnchored = $derived(insertionPaletteMode === "anchored" && laneInsertionPosition !== null)
  const laneInsertionPaletteStyle = $derived(laneInsertionAnchored && laneInsertionPosition
    ? "--palette-x: " + laneInsertionPosition.x + "px; --palette-y: " + laneInsertionPosition.y + "px;" + (laneInsertionPosition.maxHeight ? " --palette-max-height: " + laneInsertionPosition.maxHeight + "px;" : "")
    : "")
  const laneActionPaletteItems: Array<{ type: LaneActionType; label: string; testId: string }> = [
    { type: "send", label: "send", testId: "parallel-add-send" },
    { type: "wait", label: "wait", testId: "parallel-add-wait" },
    { type: "capture-source", label: "capture", testId: "parallel-add-capture" },
    { type: "extract_text", label: "extract", testId: "parallel-add-extract" },
  ]

  $effect(() => {
    if (!parallelNode) return
    if (!parallelNode.lanes.some((lane) => lane.id === selectedLaneId)) {
      selectedLaneId = parallelNode.lanes[0]?.id ?? ""
      closeLaneInsertion(false)
    } else if (laneInsertion && !parallelNode.lanes.some((lane) => lane.id === laneInsertion?.laneId)) {
      closeLaneInsertion(false)
    }
  })

  function updateParallel(mutator: (node: ParallelNode) => void) {
    updateDraft((template: MacroTemplate) => {
      const node = findParallel(template.body, nodeId)
      if (node) mutator(node)
    })
  }

  function updateLane(laneId: string, mutator: (lane: ParallelLane) => void) {
    updateParallel((node) => {
      const lane = node.lanes.find((candidate) => candidate.id === laneId)
      if (lane) mutator(lane)
    })
  }

  function updateLaneAction(laneId: string, actionId: string, mutator: (action: ParallelLaneActionNode) => void) {
    updateLane(laneId, (lane) => {
      const action = lane.body.find((item): item is ParallelLaneActionNode => item.id === actionId && item.type !== "output")
      if (action) mutator(action)
    })
  }

  function choiceForTarget(target: TerminalTarget): TerminalChoice | undefined {
    return terminalChoiceForTarget(target, terminalChoices())
  }

  function laneChoice(lane: ParallelLane): TerminalChoice | undefined {
    return choiceForTarget(lane.terminal)
  }

  function laneAllowsAction(lane: ParallelLane, type: LaneActionType): boolean {
    const capabilities = laneChoice(lane)?.capabilities
    if (!capabilities) return true
    if (type === "wait") return capabilities.canWaitQuiet
    return true
  }

  function laneActionPaletteItemsFor(lane: ParallelLane): Array<{ type: LaneActionType; label: string; testId: string }> {
    return laneActionPaletteItems.filter((item) => laneAllowsAction(lane, item.type))
  }

  function laneCaptureKinds(lane: ParallelLane): CapabilityCaptureKind[] {
    return laneChoice(lane)?.capabilities.captureKinds ?? ["terminal-buffer", "agent-event", "text-box"]
  }

  function defaultCaptureForLane(lane: ParallelLane, kind?: CaptureSourceConfig["kind"]): CaptureSourceConfig {
    const selectedKind = kind ?? laneCaptureKinds(lane)[0] ?? "terminal-buffer"
    const capture = defaultCaptureSource(selectedKind)
    if ("terminal" in capture) capture.terminal = lane.terminal
    return capture
  }

  function setLaneWaitMode(item: Extract<ParallelLaneActionNode, { type: "wait" }>, mode: string, terminal: TerminalTarget) {
    const record = item as unknown as Record<string, unknown>
    delete record.durationMs
    delete record.terminal
    delete record.quietMs
    delete record.maxMs
    delete record.onTimeout
    if (mode === "duration") Object.assign(record, { mode: "duration", durationMs: 1500 })
    if (mode === "terminal-quiet") Object.assign(record, { mode: "terminal-quiet", terminal, quietMs: 1000, maxMs: 600000, onTimeout: "pause" })
  }

  function incompatibleLaneActionIds(lane: ParallelLane, target: TerminalTarget): string[] {
    const targetChoice = choiceForTarget(target)
    if (!targetChoice) return []
    return lane.body.flatMap((item) => {
      if (item.type === "output") return []
      if (item.type === "wait") return targetChoice.capabilities.canWaitQuiet ? [] : [item.id]
      if (item.type === "capture-source") return isCaptureKindAllowed(targetChoice.capabilities, item.capture.kind) ? [] : [item.id]
      return []
    })
  }

  function setLaneId(laneId: string, nextId: string): boolean {
    const node = parallelNode
    if (!node) return false
    if (nextId !== laneId && node.lanes.some((lane) => lane.id === nextId)) {
      editNotice = "Duplicate lane id blocked: " + nextId
      return false
    }
    editNotice = ""
    updateParallel((parallel) => {
      const lane = parallel.lanes.find((candidate) => candidate.id === laneId)
      if (!lane) return
      lane.id = nextId
      selectedLaneId = nextId
    })
    return true
  }

  function setLaneLabel(laneId: string, nextLabel: string): boolean {
    const node = parallelNode
    if (!node) return false
    const normalized = nextLabel.trim()
    if (normalized && node.lanes.some((lane) => lane.id !== laneId && lane.label.trim() === normalized)) {
      editNotice = "Duplicate lane label blocked: " + normalized
      return false
    }
    editNotice = ""
    updateLane(laneId, (lane) => { lane.label = nextLabel })
    return true
  }

  function setLaneActionId(laneId: string, actionId: string, nextId: string): boolean {
    if (nextId !== actionId && allNodeIds(draft.body).includes(nextId)) {
      editNotice = "Duplicate action id blocked: " + nextId
      return false
    }
    editNotice = ""
    updateLaneAction(laneId, actionId, (action) => { action.id = nextId })
    if (collapsedLaneActionIds.includes(actionId)) {
      collapsedLaneActionIds = collapsedLaneActionIds.map((id) => id === actionId ? nextId : id)
    }
    return true
  }

  function isLaneActionCollapsed(actionId: string): boolean {
    return collapsedLaneActionIds.includes(actionId)
  }

  function toggleLaneActionCollapsed(actionId: string) {
    collapsedLaneActionIds = isLaneActionCollapsed(actionId)
      ? collapsedLaneActionIds.filter((id) => id !== actionId)
      : [...collapsedLaneActionIds, actionId]
  }

  function setLaneOutputId(laneId: string, outputId: string, nextId: string): boolean {
    if (nextId !== outputId && allNodeIds(draft.body).includes(nextId)) {
      editNotice = "Duplicate output id blocked: " + nextId
      return false
    }
    editNotice = ""
    updateLane(laneId, (lane) => {
      const output = lane.body.find((candidate): candidate is ParallelLaneOutputNode => candidate.id === outputId && candidate.type === "output")
      if (output) output.id = nextId
    })
    return true
  }

  function addLane() {
    updateDraft((template: MacroTemplate) => {
      const node = findParallel(template.body, nodeId)
      if (!node) return
      const terminal = nextLaneTerminal(node.lanes)
      const lane = defaultLane(template, nextLaneId(node.lanes), terminal, node.lanes.map((item) => item.id))
      node.lanes.push(lane)
      selectedLaneId = lane.id
      closeLaneInsertion(false)
    })
  }

  function removeLane(laneId: string) {
    const node = parallelNode
    const lane = node?.lanes.find((candidate) => candidate.id === laneId)
    if (!node || !lane || node.lanes.length <= 1) return
    if (!confirm("Remove parallel lane " + laneId + "?")) return
    const removedActionIds = new Set(lane.body.filter((item) => item.type !== "output").map((item) => item.id))
    updateParallel((node) => {
      node.lanes = node.lanes.filter((lane) => lane.id !== laneId)
      if (selectedLaneId === laneId) selectedLaneId = node.lanes[0]?.id ?? ""
      if (laneInsertion?.laneId === laneId) closeLaneInsertion(false)
    })
    collapsedLaneActionIds = collapsedLaneActionIds.filter((id) => !removedActionIds.has(id))
  }

  function setLaneTerminal(laneId: string, terminal: TerminalTarget): boolean {
    const lane = parallelNode?.lanes.find((candidate) => candidate.id === laneId)
    if (!lane) return false
    const incompatible = incompatibleLaneActionIds(lane, terminal)
    if (incompatible.length > 0) {
      const target = choiceForTarget(terminal)
      editNotice = "Lane tab change blocked; incompatible actions for " + (target?.terminalAlias ?? "target tab") + ": " + incompatible.join(", ")
      return false
    }
    editNotice = ""
    updateLane(laneId, (item) => {
      item.terminal = terminal
      for (const action of item.body) {
        if (action.type === "send") action.terminal = terminal
        if (action.type === "wait" && action.mode === "terminal-quiet") action.terminal = terminal
        if (action.type === "capture-source" && "terminal" in action.capture) action.capture.terminal = terminal
      }
    })
    return true
  }

  function isTerminalChoiceUsedByOtherLane(laneId: string, choiceValue: string): boolean {
    const node = parallelNode
    if (!node) return false
    return node.lanes.some((lane) => lane.id !== laneId && choiceFromTarget(lane.terminal) === choiceValue)
  }

  function addAction(laneId: string, type: LaneActionType, insertionIndex?: number) {
    updateDraft((template: MacroTemplate) => {
      const node = findParallel(template.body, nodeId)
      const lane = node?.lanes.find((candidate) => candidate.id === laneId)
      if (!lane) return
      const output = outputIndex(lane)
      const maxIndex = output < 0 ? lane.body.length : output
      const targetIndex = Math.max(0, Math.min(insertionIndex ?? maxIndex, maxIndex))
      lane.body.splice(targetIndex, 0, defaultAction(template, lane, type))
      selectedLaneId = lane.id
    })
  }

  function openLaneInsertion(laneId: string, index: number, summary: string, event?: MouseEvent) {
    const target = event?.currentTarget
    selectedLaneId = laneId
    laneInsertionTriggerElement = target instanceof HTMLElement ? target : null
    laneInsertion = { laneId, index, summary }
    laneInsertionPosition = insertionPaletteMode === "anchored" ? positionLaneInsertionPalette(event) : null
    void settleLaneInsertionPalette(true)
  }

  function positionLaneInsertionPalette(event?: MouseEvent): InsertionPalettePosition | null {
    const target = event?.currentTarget
    if (!(target instanceof HTMLElement)) return null
    const rect = target.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const estimatedHalfWidth = 180
    const estimatedHeight = Math.min(360, Math.max(0, window.innerHeight - margin * 2))
    const preferred = rect.top > window.innerHeight / 2 ? "above" : "below"
    const aboveSpace = Math.max(0, rect.top - gap - margin)
    const belowSpace = Math.max(0, window.innerHeight - rect.bottom - gap - margin)
    const placement = preferred === "above"
      ? aboveSpace >= Math.min(estimatedHeight, belowSpace) ? "above" : "below"
      : belowSpace >= Math.min(estimatedHeight, aboveSpace) ? "below" : "above"
    const availableHeight = placement === "above" ? aboveSpace : belowSpace
    const maxHeight = Math.max(0, availableHeight)
    const x = clamp(rect.left + rect.width / 2, margin + estimatedHalfWidth, window.innerWidth - margin - estimatedHalfWidth)
    const y = placement === "above" ? rect.top - gap : rect.bottom + gap
    return { x, y, placement, maxHeight }
  }

  async function settleLaneInsertionPalette(shouldFocus: boolean) {
    await tick()
    clampLaneInsertionPaletteToViewport()
    if (shouldFocus) focusLaneInsertionPalette()
  }

  function clampLaneInsertionPaletteToViewport() {
    if (!laneInsertionAnchored || !laneInsertionPosition || !laneInsertionPaletteElement || !laneInsertionTriggerElement) return
    const triggerRect = laneInsertionTriggerElement.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const width = laneInsertionPaletteElement.offsetWidth
    const height = laneInsertionPaletteElement.offsetHeight
    if (width <= 0 || height <= 0) return
    const preferred = triggerRect.top > window.innerHeight / 2 ? "above" : "below"
    const aboveSpace = Math.max(0, triggerRect.top - gap - margin)
    const belowSpace = Math.max(0, window.innerHeight - triggerRect.bottom - gap - margin)
    const placement = preferred === "above"
      ? aboveSpace >= Math.min(height, belowSpace) ? "above" : "below"
      : belowSpace >= Math.min(height, aboveSpace) ? "below" : "above"
    const availableHeight = placement === "above" ? aboveSpace : belowSpace
    const maxHeight = Math.max(0, availableHeight)
    const effectiveHeight = maxHeight > 0 ? Math.min(height, maxHeight) : height
    const x = clamp(triggerRect.left + triggerRect.width / 2, margin + width / 2, window.innerWidth - margin - width / 2)
    const rawY = placement === "above" ? triggerRect.top - gap : triggerRect.bottom + gap
    const y = placement === "above"
      ? clamp(rawY, margin + effectiveHeight, window.innerHeight - margin)
      : clamp(rawY, margin, window.innerHeight - margin)
    laneInsertionPosition = { x, y, placement, maxHeight }
  }

  function focusLaneInsertionPalette() {
    const focusable = laneInsertionPaletteElement?.querySelector<HTMLElement>("button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled])")
    focusable?.focus()
  }

  function closeLaneInsertion(restoreFocus: boolean) {
    const trigger = laneInsertionTriggerElement
    laneInsertion = null
    laneInsertionPosition = null
    laneInsertionTriggerElement = null
    laneInsertionPaletteElement = null
    if (restoreFocus && trigger) void tick().then(() => trigger.focus())
  }

  function handleLaneInsertionKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && laneInsertion) cancelLaneInsertion()
  }

  function handleLaneInsertionResize() {
    if (laneInsertion) void settleLaneInsertionPalette(false)
  }

  function clamp(value: number, min: number, max: number): number {
    if (max < min) return min
    return Math.max(min, Math.min(max, value))
  }

  function insertLaneAction(type: LaneActionType) {
    if (!laneInsertion) return
    addAction(laneInsertion.laneId, type, laneInsertion.index)
    closeLaneInsertion(true)
  }

  function cancelLaneInsertion() {
    closeLaneInsertion(true)
  }

  function removeAction(laneId: string, actionId: string) {
    updateLane(laneId, (lane) => {
      const index = lane.body.findIndex((item) => item.id === actionId)
      if (index < 0 || lane.body[index]?.type === "output") return
      if (!confirm("Remove parallel lane action " + actionId + "?")) return
      lane.body.splice(index, 1)
      collapsedLaneActionIds = collapsedLaneActionIds.filter((id) => id !== actionId)
    })
  }

  function moveAction(laneId: string, actionId: string, offset: -1 | 1) {
    updateLane(laneId, (lane) => {
      const index = lane.body.findIndex((item) => item.id === actionId)
      const output = outputIndex(lane)
      const target = index + offset
      if (index < 0 || lane.body[index]?.type === "output") return
      if (target < 0 || target >= (output < 0 ? lane.body.length : output)) return
      const [item] = lane.body.splice(index, 1)
      lane.body.splice(target, 0, item)
    })
  }

  function outputIndex(lane: ParallelLane): number {
    return lane.body.findIndex((item) => item.type === "output")
  }

  function defaultLane(template: MacroTemplate, rawId: string, terminal: TerminalTarget, existingLaneIds: string[] = []): ParallelLane {
    const ids = allNodeIds(template.body)
    const id = uniqueKey(rawId, existingLaneIds)
    return { id, label: id, terminal, body: [{ id: uniqueKey(id + "_output", [...ids, id]), type: "output", source: { kind: "none" } }] }
  }

  function nextLaneId(lanes: ParallelLane[]): string {
    const maxOrdinal = lanes.reduce((max, lane) => {
      const match = /^lane_(\d+)$/.exec(lane.id)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const ordinal = maxOrdinal > 0 ? maxOrdinal + 1 : lanes.length + 1
    return uniqueKey("lane_" + ordinal, lanes.map((lane) => lane.id))
  }

  function nextLaneTerminal(lanes: ParallelLane[]): TerminalTarget {
    const used = new Set(lanes.map((lane) => choiceFromTarget(lane.terminal)))
    const choice = terminalChoices().find((item: TerminalChoice) => !used.has(item.value))
    return choice ? targetFromChoice(choice.value) : lanes[0]?.terminal ?? firstTerminalTarget()
  }

  function defaultAction(template: MacroTemplate, lane: ParallelLane, type: LaneActionType): ParallelLaneActionNode {
    const id = uniqueKey(type.replace(/[^A-Za-z0-9_]/g, "_"), allNodeIds(template.body))
    if (type === "send") return { id, type, terminal: lane.terminal, message: { parts: [] }, delivery: "auto", ending: "cr" }
    if (type === "wait") return { id, type, mode: "duration", durationMs: 1500 }
    if (type === "capture-source") {
      return { id, type, capture: defaultCaptureForLane(lane) }
    }
    return { id, type, source: laneArtifactChoices(lane, id)[0]?.source ?? emptyArtifactSource(), split: { kind: "lines", keepEmpty: false }, filters: [], select: { mode: "index", index: -1 }, extract: { kind: "none" }, trim: "right", onEmpty: "pause" }
  }

  function findParallel(nodes: FlowV2Node[], id: string): ParallelNode | undefined {
    for (const node of nodes) {
      if (node.type === "parallel" && node.id === id) return node
      if (node.type === "if") {
        for (const branch of node.branches) {
          const found = findParallel(branch.body, id)
          if (found) return found
        }
        if (node.else) {
          const found = findParallel(node.else, id)
          if (found) return found
        }
      }
      if (node.type === "for") {
        const found = findParallel(node.body, id)
        if (found) return found
      }
      if ((node.type === "break" || node.type === "continue" || node.type === "finish") && node.body) {
        const found = findParallel(node.body, id)
        if (found) return found
      }
    }
  }

  function allNodeIds(nodes: FlowV2Node[]): string[] {
    return nodes.flatMap((node) => {
      const nested = node.type === "if"
        ? [...node.branches.flatMap((branch) => allNodeIds(branch.body)), ...(node.else ? allNodeIds(node.else) : [])]
        : node.type === "for" ? allNodeIds(node.body)
          : node.type === "parallel" ? node.lanes.flatMap((lane) => lane.body.map((item) => item.id))
            : (node.type === "break" || node.type === "continue" || node.type === "finish") && node.body ? allNodeIds(node.body) : []
      return [node.id, ...nested]
    })
  }

  function uniqueKey(base: string, existing: string[]): string {
    const safe = base.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[^A-Za-z0-9]+/, "") || "node"
    const set = new Set(existing)
    if (!set.has(safe)) return safe
    let suffix = 2
    while (set.has(safe + "_" + suffix)) suffix += 1
    return safe + "_" + suffix
  }

  function firstTerminalTarget(): TerminalTarget {
    return terminalChoices()[0]?.value ? targetFromChoice(terminalChoices()[0].value) : { kind: "index", value: 1 }
  }

  function laneArtifactChoices(lane: ParallelLane, targetNodeId: string): ArtifactChoice[] {
    const choices: ArtifactChoice[] = []
    for (const item of lane.body) {
      if (item.id === targetNodeId) return choices
      if (item.type === "capture-source") choices.push({ label: item.id + ".captured_text", source: { kind: "step_artifact", stepId: item.id, artifact: "captured_text" } })
      if (item.type === "extract_text") choices.push({ label: item.id + ".extracted_text", source: { kind: "step_artifact", stepId: item.id, artifact: "extracted_text" } })
    }
    return choices
  }

  function messageChoices(lane: ParallelLane, actionId: string): ArtifactChoice[] {
    return [...outerArtifactChoices, ...laneArtifactChoices(lane, actionId)]
  }

  function emptyArtifactSource(): FlowV2ArtifactSource {
    return { kind: "step_artifact", stepId: "", artifact: "captured_text" }
  }

  function sourceKey(source?: FlowV2ArtifactSource): string {
    if (!source?.stepId) return ""
    return source.stepId + ":" + source.artifact
  }

  function sourceFromKey(key: string): FlowV2ArtifactSource | undefined {
    if (!key) return undefined
    const [stepId, artifact] = key.split(":")
    return { kind: "step_artifact", stepId, artifact: artifact === "extracted_text" ? "extracted_text" : artifact === "merged_text" ? "merged_text" : "captured_text" }
  }

  function requiredSourceFromKey(key: string, fallback: FlowV2ArtifactSource): FlowV2ArtifactSource {
    return sourceFromKey(key) ?? fallback
  }

  function outputSourceKey(source: ParallelOutputSource): string {
    return source.kind === "none" ? "" : sourceKey(source)
  }

  function outputSourceFromKey(key: string): ParallelOutputSource {
    return sourceFromKey(key) ?? { kind: "none" }
  }
</script>

<svelte:window onkeydown={handleLaneInsertionKeydown} onresize={handleLaneInsertionResize} />

{#if parallelNode}
  <section class="parallel-tabs-editor" data-testid="parallel-lane-tabs">
    <div class="macro-row">
      <label>Separator<input value={parallelNode.merge.separator} oninput={(event) => updateParallel((node) => { node.merge.separator = event.currentTarget.value })} /></label>
      <label class="checkbox-row"><input type="checkbox" checked={parallelNode.merge.includeEmptyOutputs} onchange={(event) => updateParallel((node) => { node.merge.includeEmptyOutputs = event.currentTarget.checked })} />Include empty outputs</label>
      <label>On lane fail<select data-testid="parallel-on-lane-fail" value={parallelNode.onLaneFail} onchange={(event) => updateParallel((node) => { node.onLaneFail = event.currentTarget.value as "pause" | "fail" })}><option value="pause">pause</option><option value="fail">fail</option></select></label>
    </div>

    <div class="parallel-tab-strip" role="tablist">
      {#each parallelNode.lanes as lane}
        <button type="button" class:active={selectedLane?.id === lane.id} data-testid="parallel-lane-tab" onclick={() => { selectedLaneId = lane.id; closeLaneInsertion(false) }}>{lane.label || lane.id}</button>
      {/each}
    </div>

    {#if selectedLane}
      <div class="parallel-lane-card active-lane" data-testid="parallel-lane-editor">
        <div class="step-title">
          <strong>{selectedLane.label || selectedLane.id}</strong>
          <div class="inline-actions parallel-lane-controls">
            <button type="button" data-testid="parallel-add-lane" onclick={addLane}>Add lane</button>
            <button type="button" data-testid="parallel-remove-lane" disabled={parallelNode.lanes.length <= 1} onclick={() => removeLane(selectedLane.id)}>Remove lane</button>
          </div>
        </div>
        <div class="macro-row">
          <label>Lane id<input data-testid="parallel-lane-id-input" value={selectedLane.id} oninput={(event) => { if (!setLaneId(selectedLane.id, event.currentTarget.value)) event.currentTarget.value = selectedLane.id }} /></label>
          <label>Label<input data-testid="parallel-lane-label-input" value={selectedLane.label} oninput={(event) => { if (!setLaneLabel(selectedLane.id, event.currentTarget.value)) event.currentTarget.value = selectedLane.label }} /></label>
          <label>Lane tab<select data-testid="parallel-lane-terminal" value={choiceFromTarget(selectedLane.terminal)} onchange={(event) => { const previous = choiceFromTarget(selectedLane.terminal); if (!setLaneTerminal(selectedLane.id, targetFromChoice(event.currentTarget.value))) event.currentTarget.value = previous }}>{#each terminalChoices() as choice}<option value={choice.value} title={choice.title} disabled={isTerminalChoiceUsedByOtherLane(selectedLane.id, choice.value)}>{choice.label}</option>{/each}</select></label>
        </div>
        {#if editNotice}
          <p class="macro-insertion-notice" data-testid="parallel-id-edit-notice">{editNotice}</p>
        {/if}

        {#if laneInsertion?.laneId === selectedLane.id}
          <div class="macro-insertion-mode" class:anchored={laneInsertionAnchored} class:centered={!laneInsertionAnchored} data-testid="parallel-lane-insertion-mode" data-placement-mode={insertionPaletteMode}>
            <button type="button" class="macro-insertion-scrim" data-testid="parallel-lane-insertion-cancel-scrim" aria-label="Cancel parallel lane insertion" onclick={cancelLaneInsertion}></button>
            <section bind:this={laneInsertionPaletteElement} class="floating-insertion-palette" class:anchored={laneInsertionAnchored} class:above={laneInsertionPosition?.placement === "above"} class:below={laneInsertionPosition?.placement === "below"} style={laneInsertionPaletteStyle} data-testid="parallel-lane-action-palette" aria-label="Insert parallel lane action">
              <div class="palette-heading"><span>{laneInsertion.summary}</span><small>choose action</small></div>
              <div class="step-palette">
                <div class="palette-heading"><span>Actions</span><small>do lane work</small></div>
                <div class="step-actions">
                  {#each laneActionPaletteItemsFor(selectedLane) as item}
                    <button type="button" data-testid={item.testId} title={item.type} onclick={() => insertLaneAction(item.type)}><span class="tool-label">{item.label}</span></button>
                  {/each}
                </div>
              </div>
              <button type="button" data-testid="parallel-lane-insertion-cancel" onclick={cancelLaneInsertion}>Cancel</button>
            </section>
          </div>
        {/if}

        {#each selectedLane.body as item, itemIndex}
          {#if item.type === "output"}
            {@render OutputEditor(selectedLane, item, itemIndex)}
          {:else}
            {@render LaneActionEditor(selectedLane, item, itemIndex)}
          {/if}
        {/each}
      </div>
    {/if}
  </section>
{/if}

{#snippet LaneActionEditor(lane: ParallelLane, item: ParallelLaneActionNode, itemIndex: number)}
  <article class="step-card parallel-lane-action" class:collapsed={isLaneActionCollapsed(item.id)} data-testid="parallel-lane-action">
    <div class="step-title node-title-row">
      <div class="node-title-cluster">
        <strong>{itemIndex + 1}. {item.type}</strong>
        {#if isLaneActionCollapsed(item.id)}<span class="collapse-state-badge" data-testid="node-collapsed-badge">Collapsed</span>{/if}
      </div>
      <NodeActionControls collapsed={isLaneActionCollapsed(item.id)} moveUpDisabled={itemIndex === 0} moveDownDisabled={lane.body[itemIndex + 1]?.type === "output"} groupTestId="parallel-node-action-controls" toggleTestId="parallel-node-toggle-collapse" moveUpTestId="parallel-node-move-up" moveDownTestId="parallel-node-move-down" addBeforeTestId="parallel-lane-add-before" addAfterTestId="parallel-lane-add-after" removeTestId="parallel-node-remove" onToggle={() => toggleLaneActionCollapsed(item.id)} onMoveUp={() => moveAction(lane.id, item.id, -1)} onMoveDown={() => moveAction(lane.id, item.id, 1)} onAddBefore={(event) => openLaneInsertion(lane.id, itemIndex, "Insert before: " + item.id, event)} onAddAfter={(event) => openLaneInsertion(lane.id, itemIndex + 1, "Insert after: " + item.id, event)} onRemove={() => removeAction(lane.id, item.id)} />
    </div>
    <label>Action id<input data-testid="parallel-action-id-input" value={item.id} oninput={(event) => { if (!setLaneActionId(lane.id, item.id, event.currentTarget.value)) event.currentTarget.value = item.id }} /></label>

    {#if item.type === "send"}
      <MessagePartsEditor message={item.message} onChange={(message: MessageSpec) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "send") action.message = message })} choices={messageChoices(lane, item.id)} {templateScope} testId="parallel-message-parts-editor" textPartTestId="parallel-message-text-part" />
      <TerminalInputDeliveryField value={item.delivery} onChange={(delivery: TerminalInputDelivery) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "send") action.delivery = delivery })} testId="parallel-send-input-delivery" />
      <TerminalEndingField value={item.ending} onChange={(ending: TerminalEnding) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "send") action.ending = ending })} testId="parallel-send-ending-sequence" />
    {:else if item.type === "wait"}
      <label>Mode<select value={item.mode} onchange={(event) => updateLaneAction(lane.id, item.id, (action) => {
        if (action.type !== "wait") return
        setLaneWaitMode(action, event.currentTarget.value, lane.terminal)
      })}><option value="duration">duration</option><option value="terminal-quiet">terminal-quiet</option></select></label>
      {#if item.mode === "duration"}
        <label>Duration ms<input type="number" value={item.durationMs} oninput={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "wait" && action.mode === "duration") action.durationMs = Number(event.currentTarget.value) })} /></label>
       {:else if item.mode === "terminal-quiet"}
        <div class="macro-row">
          <label>Quiet ms<input type="number" value={item.quietMs} oninput={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "wait" && action.mode === "terminal-quiet") action.quietMs = Number(event.currentTarget.value) })} /></label>
          <label>Max ms<input type="number" value={item.maxMs} oninput={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "wait" && action.mode === "terminal-quiet") action.maxMs = Number(event.currentTarget.value) })} /></label>
        </div>
      {/if}
    {:else if item.type === "capture-source"}
      {@const selectedLaneChoice = laneChoice(lane)}
      {@const allowedKinds = laneCaptureKinds(lane)}
      {@const captureAllowed = selectedLaneChoice ? isCaptureKindAllowed(selectedLaneChoice.capabilities, item.capture.kind) : true}
      {#if allowedKinds.length > 1}
        <label>Capture kind<select value={item.capture.kind} onchange={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "capture-source") action.capture = defaultCaptureForLane(lane, event.currentTarget.value as CaptureSourceConfig["kind"]) })}>{#each allowedKinds as kind}<option value={kind}>{kind}</option>{/each}</select></label>
      {:else}
        <p class="hint" data-testid="parallel-capture-kind-fixed">Capture kind: {allowedKinds[0] ?? item.capture.kind}</p>
      {/if}
      {#if !captureAllowed}
        <p class="macro-insertion-notice" data-testid="parallel-capture-kind-invalid">Capture kind {item.capture.kind} is not valid for this lane tab.</p>
        {#if allowedKinds[0]}<button type="button" data-testid="parallel-capture-kind-repair" onclick={() => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "capture-source") action.capture = defaultCaptureForLane(lane, allowedKinds[0]) })}>Use {allowedKinds[0]}</button>{/if}
      {:else if item.capture.kind === "terminal-buffer"}
        <div class="macro-row">
          <label>Mode<select value={item.capture.mode} onchange={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "capture-source" && action.capture.kind === "terminal-buffer") action.capture.mode = event.currentTarget.value as "scrollback-tail" | "raw-stream-tail" })}><option value="scrollback-tail">screen text</option><option value="raw-stream-tail">raw stream tail</option></select></label>
          <label>Max chars<input type="number" value={item.capture.maxChars} oninput={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "capture-source" && action.capture.kind === "terminal-buffer") action.capture.maxChars = Number(event.currentTarget.value) })} /></label>
        </div>
      {:else if item.capture.kind === "agent-event"}
        <div class="macro-row"><label>Agent<select value={item.capture.agent.kind} onchange={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "capture-source" && action.capture.kind === "agent-event") action.capture.agent = { kind: event.currentTarget.value as "codex" } })}><option value="codex">codex</option></select></label><label>Mode<select value={item.capture.captureMode ?? "result_only"} onchange={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "capture-source" && action.capture.kind === "agent-event") action.capture.captureMode = event.currentTarget.value as "result_only" | "prompt_only" | "prompt_and_result" })}><option value="result_only">result only</option><option value="prompt_only">prompt only</option><option value="prompt_and_result">prompt + result</option></select></label></div>
      {:else}
        <p class="hint">Captures this text lane tab as plain text.</p>
      {/if}
    {:else}
      <label>Source<select value={sourceKey(item.source)} onchange={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "extract_text") action.source = requiredSourceFromKey(event.currentTarget.value, action.source) })}>{#each laneArtifactChoices(lane, item.id) as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
      <div class="macro-row"><label>Select<select value={item.select.mode} onchange={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type !== "extract_text") return; const mode = event.currentTarget.value; action.select = mode === "all" ? { mode } : mode === "range" ? { mode, start: 0, end: 1 } : { mode: "index", index: -1 } })}><option value="all">all</option><option value="index">index</option><option value="range">range</option></select></label><label>Trim<select value={item.trim} onchange={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "extract_text") action.trim = event.currentTarget.value as typeof action.trim })}><option value="none">none</option><option value="left">left</option><option value="right">right</option><option value="both">both</option></select></label><label>On empty<select value={item.onEmpty} onchange={(event) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "extract_text") action.onEmpty = event.currentTarget.value as "pause" | "fail" })}><option value="pause">pause</option><option value="fail">fail</option></select></label></div>
    {/if}
  </article>
{/snippet}

{#snippet OutputEditor(lane: ParallelLane, output: ParallelLaneOutputNode, itemIndex: number)}
  <article class="step-card parallel-output-card" data-testid="parallel-lane-output">
    <div class="step-title">
      <span class="parallel-output-title"><strong>Output</strong><small>required final node</small></span>
      <button type="button" data-testid="parallel-lane-add-before-output" onclick={(event) => openLaneInsertion(lane.id, itemIndex, "Insert before Output", event)}>Add before output</button>
    </div>
    <label>Output id<input data-testid="parallel-output-id-input" value={output.id} oninput={(event) => { if (!setLaneOutputId(lane.id, output.id, event.currentTarget.value)) event.currentTarget.value = output.id }} /></label>
    <label>Source<select value={outputSourceKey(output.source)} onchange={(event) => updateLane(lane.id, (item) => { const node = item.body.find((candidate): candidate is ParallelLaneOutputNode => candidate.id === output.id && candidate.type === "output"); if (node) node.source = outputSourceFromKey(event.currentTarget.value) })}><option value="">none</option>{#each laneArtifactChoices(lane, output.id) as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
  </article>
{/snippet}
