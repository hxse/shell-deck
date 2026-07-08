<script lang="ts">
  import LineNumberedTextarea from "./LineNumberedTextarea.svelte"
  import { isCaptureKindAllowed, terminalChoiceForTarget, type CapabilityCaptureKind, type TerminalChoice } from "../../macro/tabCapabilities"
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
  } from "../../macro/templateTypes"

  type ArtifactChoice = { label: string; source: FlowV2ArtifactSource }
  type LaneActionType = ParallelLaneActionNode["type"]

  let {
    draft,
    nodeId,
    updateDraft,
    terminalChoices,
    choiceFromTarget,
    targetFromChoice,
    defaultCaptureSource,
    outerArtifactChoices,
  } = $props<{
    draft: MacroTemplate
    nodeId: string
    updateDraft: (mutator: (template: MacroTemplate) => void) => void
    terminalChoices: () => TerminalChoice[]
    choiceFromTarget: (target: TerminalTarget) => string
    targetFromChoice: (choice: string) => TerminalTarget
    defaultCaptureSource: (kind: CaptureSourceConfig["kind"]) => CaptureSourceConfig
    outerArtifactChoices: ArtifactChoice[]
  }>()

  let selectedLaneId = $state("")
  let laneInsertion = $state<{ laneId: string; index: number; summary: string } | null>(null)
  let editNotice = $state("")
  const parallelNode = $derived(findParallel(draft.body, nodeId))
  const selectedLane = $derived(parallelNode?.lanes.find((lane) => lane.id === selectedLaneId) ?? parallelNode?.lanes[0])
  const laneActionPaletteItems: Array<{ type: LaneActionType; label: string; testId: string }> = [
    { type: "send_line", label: "send", testId: "parallel-add-send" },
    { type: "wait", label: "wait", testId: "parallel-add-wait" },
    { type: "capture-source", label: "capture", testId: "parallel-add-capture" },
    { type: "extract_text", label: "extract", testId: "parallel-add-extract" },
  ]

  $effect(() => {
    if (!parallelNode) return
    if (!parallelNode.lanes.some((lane) => lane.id === selectedLaneId)) {
      selectedLaneId = parallelNode.lanes[0]?.id ?? ""
      laneInsertion = null
    } else if (laneInsertion && !parallelNode.lanes.some((lane) => lane.id === laneInsertion?.laneId)) {
      laneInsertion = null
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
    return true
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
      laneInsertion = null
    })
  }

  function removeLane(laneId: string) {
    updateParallel((node) => {
      if (node.lanes.length <= 1) return
      if (!confirm("Remove parallel lane " + laneId + "?")) return
      node.lanes = node.lanes.filter((lane) => lane.id !== laneId)
      if (selectedLaneId === laneId) selectedLaneId = node.lanes[0]?.id ?? ""
      if (laneInsertion?.laneId === laneId) laneInsertion = null
    })
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
        if (action.type === "send_line") action.terminal = terminal
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

  function openLaneInsertion(laneId: string, index: number, summary: string) {
    selectedLaneId = laneId
    laneInsertion = { laneId, index, summary }
  }

  function insertLaneAction(type: LaneActionType) {
    if (!laneInsertion) return
    addAction(laneInsertion.laneId, type, laneInsertion.index)
    laneInsertion = null
  }

  function cancelLaneInsertion() {
    laneInsertion = null
  }

  function removeAction(laneId: string, actionId: string) {
    updateLane(laneId, (lane) => {
      const index = lane.body.findIndex((item) => item.id === actionId)
      if (index < 0 || lane.body[index]?.type === "output") return
      if (!confirm("Remove parallel lane action " + actionId + "?")) return
      lane.body.splice(index, 1)
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
    if (type === "send_line") return { id, type, terminal: lane.terminal, message: { parts: [] } }
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

  function cloneMessage(message: MessageSpec): MessageSpec {
    return JSON.parse(JSON.stringify(message)) as MessageSpec
  }

  function addTextPart(message: MessageSpec, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    next.parts.push({ kind: "text", text: "" })
    onChange(next)
  }

  function addArtifactPart(message: MessageSpec, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    next.parts.push({ kind: "artifact" })
    onChange(next)
  }

  function updateTextPart(message: MessageSpec, index: number, text: string, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    const part = next.parts[index]
    if (part?.kind === "text") part.text = text
    onChange(next)
  }

  function updateArtifactPart(message: MessageSpec, index: number, key: string, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    const part = next.parts[index]
    if (part?.kind === "artifact") {
      const source = sourceFromKey(key)
      if (source) part.source = source
      else delete part.source
    }
    onChange(next)
  }

  function removeMessagePart(message: MessageSpec, index: number, onChange: (message: MessageSpec) => void) {
    const next = cloneMessage(message)
    next.parts.splice(index, 1)
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
</script>

{#if parallelNode}
  <section class="parallel-tabs-editor" data-testid="parallel-lane-tabs">
    <div class="macro-row">
      <label>Separator<input value={parallelNode.merge.separator} oninput={(event) => updateParallel((node) => { node.merge.separator = event.currentTarget.value })} /></label>
      <label class="checkbox-row"><input type="checkbox" checked={parallelNode.merge.includeEmptyOutputs} onchange={(event) => updateParallel((node) => { node.merge.includeEmptyOutputs = event.currentTarget.checked })} />Include empty outputs</label>
      <label>On lane fail<select data-testid="parallel-on-lane-fail" value={parallelNode.onLaneFail} onchange={(event) => updateParallel((node) => { node.onLaneFail = event.currentTarget.value as "pause" | "fail" })}><option value="pause">pause</option><option value="fail">fail</option></select></label>
    </div>

    <div class="parallel-tab-strip" role="tablist">
      {#each parallelNode.lanes as lane}
        <button type="button" class:active={selectedLane?.id === lane.id} data-testid="parallel-lane-tab" onclick={() => { selectedLaneId = lane.id; laneInsertion = null }}>{lane.label || lane.id}</button>
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
          <section class="floating-insertion-palette parallel-lane-insertion-palette" data-testid="parallel-lane-action-palette" aria-label="Insert parallel lane action">
            <div class="palette-heading"><span>{laneInsertion.summary}</span><small>lane action</small></div>
            <div class="step-palette">
              <div class="palette-heading"><span>Actions</span><small>send wait capture extract</small></div>
              <div class="step-actions">
                {#each laneActionPaletteItemsFor(selectedLane) as item}
                  <button type="button" data-testid={item.testId} onclick={() => insertLaneAction(item.type)}>{item.label}</button>
                {/each}
              </div>
            </div>
            <button type="button" onclick={cancelLaneInsertion}>Cancel</button>
          </section>
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
  <article class="step-card parallel-lane-action" data-testid="parallel-lane-action">
    <div class="step-title">
      <strong>{item.type}</strong>
      <div class="inline-actions">
        <button type="button" data-testid="parallel-lane-add-before" onclick={() => openLaneInsertion(lane.id, itemIndex, "Insert before: " + item.id)}>Add before</button>
        <button type="button" data-testid="parallel-lane-add-after" onclick={() => openLaneInsertion(lane.id, itemIndex + 1, "Insert after: " + item.id)}>Add after</button>
        <button type="button" onclick={() => moveAction(lane.id, item.id, -1)}>Up</button>
        <button type="button" onclick={() => moveAction(lane.id, item.id, 1)}>Down</button>
        <button type="button" onclick={() => removeAction(lane.id, item.id)}>Remove</button>
      </div>
    </div>
    <label>Action id<input data-testid="parallel-action-id-input" value={item.id} oninput={(event) => { if (!setLaneActionId(lane.id, item.id, event.currentTarget.value)) event.currentTarget.value = item.id }} /></label>

    {#if item.type === "send_line"}
      {@render MessagePartsEditor(item.message, (message: MessageSpec) => updateLaneAction(lane.id, item.id, (action) => { if (action.type === "send_line") action.message = message }), messageChoices(lane, item.id))}
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
      <button type="button" data-testid="parallel-lane-add-before-output" onclick={() => openLaneInsertion(lane.id, itemIndex, "Insert before Output")}>Add before output</button>
    </div>
    <label>Output id<input data-testid="parallel-output-id-input" value={output.id} oninput={(event) => { if (!setLaneOutputId(lane.id, output.id, event.currentTarget.value)) event.currentTarget.value = output.id }} /></label>
    <label>Source<select value={outputSourceKey(output.source)} onchange={(event) => updateLane(lane.id, (item) => { const node = item.body.find((candidate): candidate is ParallelLaneOutputNode => candidate.id === output.id && candidate.type === "output"); if (node) node.source = outputSourceFromKey(event.currentTarget.value) })}><option value="">none</option>{#each laneArtifactChoices(lane, output.id) as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
  </article>
{/snippet}

{#snippet MessagePartsEditor(message: MessageSpec, onChange: (message: MessageSpec) => void, choices: ArtifactChoice[])}
  <div class="message-parts-editor" data-testid="parallel-message-parts-editor">
    <div class="inline-actions"><button type="button" onclick={() => addTextPart(message, onChange)}>Add Text</button><button type="button" onclick={() => addArtifactPart(message, onChange)}>Add Source</button></div>
    {#each message.parts as part, index}
      <div class="message-part-row">
        <div class="step-title"><strong>{index + 1}. {part.kind}</strong><div class="inline-actions"><button type="button" onclick={() => moveMessagePart(message, index, -1, onChange)}>Up</button><button type="button" onclick={() => moveMessagePart(message, index, 1, onChange)}>Down</button><button type="button" onclick={() => removeMessagePart(message, index, onChange)}>Remove</button></div></div>
        {#if part.kind === "text"}
          <LineNumberedTextarea value={part.text} rows={3} onInput={(value: string) => updateTextPart(message, index, value, onChange)} />
        {:else}
          <label>Source<select value={sourceKey(part.source)} onchange={(event) => updateArtifactPart(message, index, event.currentTarget.value, onChange)}><option value="">none</option>{#each choices as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}
