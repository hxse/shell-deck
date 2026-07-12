<script lang="ts">
  import { tick } from "svelte"
  import LineNumberedTextarea from "./LineNumberedTextarea.svelte"
  import MessagePartsEditor from "./MessagePartsEditor.svelte"
  import ParallelLaneTabs from "./ParallelLaneTabs.svelte"
  import TerminalEndingField from "./TerminalEndingField.svelte"
  import TemplatableScalarField from "./TemplatableScalarField.svelte"
  import { addElifToIfNode, canMoveNodeToAnchor, cloneBodyPath, ensureElseForIfNode, findNodePosition, isInsertionAnchorValid, insertNodeAtAnchor, moveNodeAtPosition, moveNodeToAnchor, removeNodeAtPosition, type BodyPath, type InsertionAnchor } from "../../macro/flowV2EditorCommands"
  import { LOOP_INDEX_TEMPLATE_TOKEN, LOOP_KEY_TEMPLATE_TOKEN, LOOP_VALUE_TEMPLATE_TOKEN } from "../../macro/scopedTextTemplate"
  import { hasNonDefaultTextListItems, type TextTemplateScope } from "../../macro/scopedTextTemplateEditor"
  import type { CaptureSourceConfig, FlowV2ArtifactSource, FlowV2Node, MacroTemplate, MessageSpec, NotificationLevel, NotifyChannel, ParallelLane, ParallelLaneActionNode, ParallelLaneNode, ParallelLaneOutputNode, TerminalEnding, TerminalTarget, SimpleTextMatchOp, TextFilterSpec, TextListItem, TextMatchCondition, ValidationResult, WaitNode } from "../../macro/templateTypes"
  import { isCaptureKindAllowed, terminalChoiceForTarget, type CapabilityCaptureKind, type TerminalChoice } from "../../macro/tabCapabilities"
  import type { MacroInsertionPaletteMode } from "../../workspace/uiLayoutTypes"

  type ArtifactChoice = { label: string; source: FlowV2ArtifactSource }
  type InsertableNodeType = FlowV2Node["type"]
  type InsertionPalettePosition = { x: number; y: number; placement: "above" | "below"; maxHeight?: number }

  let {
    draft,
    validation,
    updateDraft,
    terminalChoices,
    choiceFromTarget,
    targetFromChoice,
    defaultCaptureSource,
    defaultCondition,
    artifactChoices,
    insertionPaletteMode,
    telegramProfileIds = [],
    telegramProfilesError = '',
  } = $props<{
    draft: MacroTemplate
    validation: ValidationResult
    updateDraft: (mutator: (template: MacroTemplate) => void) => void
    terminalChoices: () => TerminalChoice[]
    choiceFromTarget: (target: TerminalTarget) => string
    targetFromChoice: (choice: string) => TerminalTarget
    defaultCaptureSource: (kind: CaptureSourceConfig["kind"]) => CaptureSourceConfig
    defaultCondition: (template: MacroTemplate) => TextMatchCondition
    artifactChoices: (template: MacroTemplate) => ArtifactChoice[]
    insertionPaletteMode: MacroInsertionPaletteMode
    telegramProfileIds?: string[]
    telegramProfilesError?: string
  }>()

  let insertionAnchor = $state<InsertionAnchor | null>(null)
  let insertionSummary = $state("")
  let insertionAllowsLoopControls = $state(false)
  let insertionPosition = $state<InsertionPalettePosition | null>(null)
  let insertionActionOnly = $state(false)
  let insertionTriggerElement = $state<HTMLElement | null>(null)
  let insertionPaletteElement = $state<HTMLElement | null>(null)
  let insertionNotice = $state("")
  let moveNodeId = $state("")
  let collapsedNodeIds = $state<string[]>([])
  let idEditNotice = $state("")

  let textListStructureVersions = $state<Record<string, number>>({})
  const insertionPaletteAnchored = $derived(insertionPaletteMode === "anchored" && insertionPosition !== null)
  const insertionPaletteStyle = $derived(insertionPaletteAnchored && insertionPosition ? "--palette-x: " + insertionPosition.x + "px; --palette-y: " + insertionPosition.y + "px;" + (insertionPosition.maxHeight ? " --palette-max-height: " + insertionPosition.maxHeight + "px;" : "") : "")
  const validationSummary = $derived(validation.ok ? "success" : validation.issues.length + " issues - " + (validation.issues[0] ? validation.issues[0].path + " " + validation.issues[0].message : ""))

  const actionPaletteItems: Array<{ type: InsertableNodeType; label: string; testId: string }> = [
    { type: "send", label: "send", testId: "add-step-send" },
    { type: "notify", label: "notify", testId: "add-step-notify" },
    { type: "input", label: "input", testId: "add-step-input" },
    { type: "wait", label: "wait", testId: "add-step-wait" },
    { type: "capture-source", label: "capture", testId: "add-step-capture" },
    { type: "extract_text", label: "extract", testId: "add-step-extract" },
    { type: "parallel", label: "parallel", testId: "add-step-parallel" },
  ]

  const flowPaletteItems: Array<{ type: InsertableNodeType; label: string; testId: string; loopOnly?: boolean }> = [
    { type: "if", label: "if", testId: "add-flow-if" },
    { type: "for", label: "for", testId: "add-flow-for" },
    { type: "finish", label: "finish", testId: "add-flow-finish" },
    { type: "break", label: "break", testId: "add-flow-break", loopOnly: true },
    { type: "continue", label: "continue", testId: "add-flow-continue", loopOnly: true },
  ]

  $effect(() => {
    const anchor = insertionAnchor
    if (!anchor) return
    if (isOpenInsertionAnchorValid(anchor)) return
    insertionNotice = "Insertion target changed. Choose an insertion point again."
    closeInsertion(false)
  })

  function isOpenInsertionAnchorValid(anchor: InsertionAnchor): boolean {
    if (isInsertionAnchorValid(draft, anchor)) return true
    if (anchor.kind === "inside" && anchor.slot === "control" && anchor.anchorNodeId) {
      return findNodePosition(draft, anchor.anchorNodeId) !== undefined
    }
    return false
  }

  function openInsertion(anchor: InsertionAnchor, summary: string, allowLoopControls: boolean, event?: MouseEvent, actionOnly = false) {
    const target = event?.currentTarget
    insertionTriggerElement = target instanceof HTMLElement ? target : null
    insertionNotice = ""
    insertionAnchor = { ...anchor, parentPath: cloneBodyPath(anchor.parentPath) }
    insertionSummary = summary
    insertionAllowsLoopControls = allowLoopControls
    insertionActionOnly = actionOnly
    insertionPosition = insertionPaletteMode === "anchored" ? positionInsertionPalette(event) : null
    moveNodeId = ""
    void settleInsertionPalette(true)
  }

  function positionInsertionPalette(event?: MouseEvent): InsertionPalettePosition | null {
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

  async function settleInsertionPalette(shouldFocus: boolean) {
    await tick()
    clampInsertionPaletteToViewport()
    if (shouldFocus) focusInsertionPalette()
  }

  function clampInsertionPaletteToViewport() {
    if (!insertionPaletteAnchored || !insertionPosition || !insertionPaletteElement || !insertionTriggerElement) return
    const triggerRect = insertionTriggerElement.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const width = insertionPaletteElement.offsetWidth
    const height = insertionPaletteElement.offsetHeight
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
    insertionPosition = { x, y, placement, maxHeight }
  }

  function focusInsertionPalette() {
    const focusable = insertionPaletteElement?.querySelector<HTMLElement>("button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled])")
    focusable?.focus()
  }

  function handleInsertionResize() {
    if (insertionAnchor) void settleInsertionPalette(false)
  }

  function clamp(value: number, min: number, max: number): number {
    if (max < min) return min
    return Math.max(min, Math.min(max, value))
  }

  function terminalChoiceTitle(value: string) {
    const choice = terminalChoices().find((item: TerminalChoice) => item.value === value)
    return choice?.title ?? choice?.label ?? value
  }

  function quietTerminalChoices(): TerminalChoice[] {
    return terminalChoices().filter((choice: TerminalChoice) => choice.capabilities.canWaitQuiet)
  }

  function quietChoiceFromTarget(target: TerminalTarget): string {
    const value = choiceFromTarget(target)
    return quietTerminalChoices().some((choice) => choice.value === value) ? value : ""
  }

  function firstQuietTerminalTarget(): TerminalTarget | null {
    const choice = quietTerminalChoices()[0]
    return choice ? targetFromChoice(choice.value) : null
  }

  function choiceForTarget(target: TerminalTarget): TerminalChoice | undefined {
    return terminalChoiceForTarget(target, terminalChoices())
  }

  function captureKindsForTarget(target: TerminalTarget): CapabilityCaptureKind[] {
    return choiceForTarget(target)?.capabilities.captureKinds ?? ["terminal-buffer", "agent-event", "text-box"]
  }

  function defaultCaptureForTarget(kind: CaptureSourceConfig["kind"], terminal: TerminalTarget): CaptureSourceConfig {
    if (kind === "agent-event") return { kind, terminal, agent: { kind: "codex" }, captureMode: "result_only" }
    if (kind === "text-box") return { kind, terminal }
    return { kind, terminal, mode: "scrollback-tail", maxChars: 20000 }
  }

  function defaultCaptureForFirstTab(): CaptureSourceConfig {
    const terminal = firstTerminalTarget()
    const kind = captureKindsForTarget(terminal)[0] ?? "terminal-buffer"
    return defaultCaptureForTarget(kind, terminal)
  }

  function notifyChannel(node: Extract<FlowV2Node, { type: "notify" }>, kind: NotifyChannel["kind"]): NotifyChannel | undefined {
    return node.channels.find((channel) => channel.kind === kind)
  }

  function defaultNotifyChannel(kind: NotifyChannel["kind"]): NotifyChannel {
    if (kind === "telegram") return { kind, profileId: "default" }
    if (kind === "system") return { kind }
    return { kind, toast: true, sound: "success" }
  }

  function setNotifyChannelEnabled(nodeId: string, kind: NotifyChannel["kind"], enabled: boolean) {
    updateNode(nodeId, (node) => {
      if (node.type !== "notify") return
      const exists = node.channels.some((channel) => channel.kind === kind)
      if (enabled && !exists) node.channels.push(defaultNotifyChannel(kind))
      if (!enabled) node.channels = node.channels.filter((channel) => channel.kind !== kind)
    })
  }

  function telegramProfileChoices(currentProfileId: string): string[] {
    const choices = [...telegramProfileIds]
    if (currentProfileId && !choices.includes(currentProfileId)) choices.unshift(currentProfileId)
    return choices
  }

  function updateNotifyChannel(nodeId: string, kind: NotifyChannel["kind"], mutator: (channel: NotifyChannel) => void) {
    updateNode(nodeId, (node) => {
      if (node.type !== "notify") return
      let channel = node.channels.find((item) => item.kind === kind)
      if (!channel) {
        channel = defaultNotifyChannel(kind)
        node.channels.push(channel)
      }
      mutator(channel)
    })
  }

  function setWaitMode(item: WaitNode, mode: string, terminal: TerminalTarget | null = null) {
    const record = item as unknown as Record<string, unknown>
    delete record.durationMs
    delete record.terminal
    delete record.quietMs
    delete record.maxMs
    delete record.onTimeout
    delete record.prompt
    if (mode === "duration") Object.assign(record, { mode: "duration", durationMs: 1500 })
    if (mode === "terminal-quiet" && terminal) Object.assign(record, { mode: "terminal-quiet", terminal, quietMs: 1000, maxMs: 600000, onTimeout: "pause" })
    if (mode === "user-continue") Object.assign(record, { mode: "user-continue", prompt: "Continue when ready" })
  }

  function closeInsertion(restoreFocus: boolean) {
    const trigger = insertionTriggerElement
    insertionAnchor = null
    insertionSummary = ""
    insertionAllowsLoopControls = false
    insertionActionOnly = false
    insertionPosition = null
    insertionTriggerElement = null
    insertionPaletteElement = null
    moveNodeId = ""
    if (restoreFocus && trigger) void tick().then(() => trigger.focus())
  }

  function cancelInsertion() {
    closeInsertion(true)
  }

  function handleInsertionKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && insertionAnchor) cancelInsertion()
  }

  function insertFromPalette(type: InsertableNodeType) {
    if (!insertionAnchor) return
    const anchor = insertionAnchor
    let inserted = false
    let reason = "unknown"
    updateDraft((template: MacroTemplate) => {
      const result = insertNodeAtAnchor(template, anchor, defaultNode(template, type))
      inserted = result.ok
      reason = result.reason ?? "unknown"
    })
    if (inserted) {
      cancelInsertion()
    } else {
      insertionNotice = "Insertion failed: " + reason
      void settleInsertionPalette(false)
    }
  }

  function moveExistingNodeFromPalette() {
    if (!insertionAnchor || !moveNodeId) return
    const anchor = { ...insertionAnchor, parentPath: cloneBodyPath(insertionAnchor.parentPath) } as InsertionAnchor
    const nodeId = moveNodeId
    let moved = false
    updateDraft((template: MacroTemplate) => {
      moved = moveNodeToAnchor(template, nodeId, anchor).ok
    })
    if (moved) cancelInsertion()
  }

  function movableNodeChoices() {
    const anchor = insertionAnchor
    if (!anchor) return []
    return allNodeChoices(draft.body).filter((choice) => (!insertionActionOnly || isActionType(choice.type)) && canMoveNodeToAnchor(draft, choice.id, anchor))
  }

  function isNodeCollapsed(nodeId: string): boolean {
    return collapsedNodeIds.includes(nodeId)
  }

  function toggleNodeCollapsed(nodeId: string) {
    collapsedNodeIds = isNodeCollapsed(nodeId) ? collapsedNodeIds.filter((id) => id !== nodeId) : [...collapsedNodeIds, nodeId]
  }

  function beforeAnchor(bodyPath: BodyPath, index: number, anchorNodeId?: string): InsertionAnchor {
    return { kind: "before", parentPath: cloneBodyPath(bodyPath), index, anchorNodeId }
  }

  function afterAnchor(bodyPath: BodyPath, index: number, anchorNodeId?: string): InsertionAnchor {
    return { kind: "after", parentPath: cloneBodyPath(bodyPath), index, anchorNodeId }
  }

  function insideAnchor(bodyPath: BodyPath, index: number, slot: "if" | "elif" | "else" | "for" | "control", branchIndex?: number, anchorNodeId?: string): InsertionAnchor {
    return { kind: "inside", parentPath: cloneBodyPath(bodyPath), index, slot, branchIndex, anchorNodeId }
  }

  function insertIntoEmptyBody(bodyPath: BodyPath, label: string, allowLoopControls: boolean, event?: MouseEvent, actionOnly = false) {
    const anchor = emptyBodyInsertionAnchor(bodyPath)
    if (!anchor) {
      insertionNotice = "Insertion failed: body_not_found"
      return
    }
    openInsertion(anchor, "Insert into " + label, allowLoopControls, event, actionOnly)
  }

  function emptyBodyInsertionAnchor(bodyPath: BodyPath): InsertionAnchor | null {
    const last = bodyPath[bodyPath.length - 1]
    if (last?.kind === "control") {
      const position = findNodePosition(draft, last.nodeId)
      if (!position) return null
      return insideAnchor(position.bodyPath, position.index, "control", undefined, last.nodeId)
    }
    return { kind: "before", parentPath: cloneBodyPath(bodyPath), index: 0 }
  }

  function moveNodeAt(bodyPath: BodyPath, index: number, offset: -1 | 1) {
    updateDraft((template: MacroTemplate) => { moveNodeAtPosition(template, { bodyPath: cloneBodyPath(bodyPath), index }, offset) })
  }

  function removeNodeAt(bodyPath: BodyPath, index: number, nodeId: string) {
    if (!confirm("Remove macro node " + nodeId + "?")) return
    updateDraft((template: MacroTemplate) => { removeNodeAtPosition(template, { bodyPath: cloneBodyPath(bodyPath), index }) })
  }

  function addElifAt(bodyPath: BodyPath, index: number) {
    updateDraft((template: MacroTemplate) => {
      addElifToIfNode(template, { bodyPath: cloneBodyPath(bodyPath), index }, { kind: "elif", condition: defaultCondition(template), body: [] })
    })
  }

  function ensureElseAt(bodyPath: BodyPath, index: number) {
    updateDraft((template: MacroTemplate) => { ensureElseForIfNode(template, { bodyPath: cloneBodyPath(bodyPath), index }) })
  }

  function updateNode(nodeId: string, mutator: (node: FlowV2Node) => void) {
    updateDraft((template: MacroTemplate) => {
      const node = findNode(template.body, nodeId)
      if (node) mutator(node)
    })
  }

  function setNodeId(oldId: string, nextId: string): boolean {
    if (nextId !== oldId && allNodeIds(draft.body).includes(nextId)) {
      idEditNotice = "Duplicate node id blocked: " + nextId
      return false
    }
    idEditNotice = ""
    updateNode(oldId, (node) => { node.id = nextId })
    return true
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
      if (isControlTerminalNode(node) && node.body) {
        const found = findNode(node.body, nodeId)
        if (found) return found
      }
    }
  }

  function emptyArtifactSource(): ArtifactChoice["source"] {
    return { kind: "step_artifact", stepId: "", artifact: "captured_text" }
  }

  function sourceKey(source?: ArtifactChoice["source"]) {
    if (!source?.stepId) return ""
    return source.stepId + ":" + source.artifact
  }

  function sourceFromKey(key: string): ArtifactChoice["source"] | undefined {
    if (!key) return undefined
    const [stepId, artifact] = key.split(":")
    return { kind: "step_artifact", stepId, artifact: artifact === "merged_text" ? "merged_text" : artifact === "extracted_text" ? "extracted_text" : "captured_text" }
  }

  function requiredSourceFromKey(key: string, fallback: ArtifactChoice["source"]): ArtifactChoice["source"] {
    return sourceFromKey(key) ?? fallback
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
      } else if (isControlTerminalNode(node) && node.body) {
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
    if (node.type === "parallel") return { label: node.id + ".merged_text", source: { kind: "step_artifact", stepId: node.id, artifact: "merged_text" } }
    if (node.type === "extract_text") return { label: node.id + ".extracted_text", source: { kind: "step_artifact", stepId: node.id, artifact: "extracted_text" } }
    return null
  }

  function addElif(nodeId: string) {
    updateDraft((template: MacroTemplate) => {
      const node = findNode(template.body, nodeId)
      if (node?.type === "if") node.branches.push({ kind: "elif", condition: defaultCondition(template), body: [{ id: uniqueKey("finish_elif", allNodeIds(template.body)), type: "finish", reason: "elif" }] })
    })
  }

  function ensureElse(nodeId: string) {
    updateDraft((template: MacroTemplate) => {
      const node = findNode(template.body, nodeId)
      if (node?.type === "if" && !node.else) node.else = [{ id: uniqueKey("finish_else", allNodeIds(template.body)), type: "finish", reason: "else" }]
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

  function addParallelLane(nodeId: string) {
    updateDraft((template: MacroTemplate) => {
      const node = findNode(template.body, nodeId)
      if (node?.type !== "parallel") return
      const terminal = nextParallelLaneTerminal(node.lanes)
      node.lanes.push(defaultParallelLane(template, nextParallelLaneId(node.lanes), terminal, node.lanes.map((item) => item.id)))
    })
  }

  function removeParallelLane(nodeId: string, laneId: string) {
    updateNode(nodeId, (node) => {
      if (node.type !== "parallel" || node.lanes.length <= 1) return
      if (!confirm("Remove parallel lane " + laneId + "?")) return
      node.lanes = node.lanes.filter((lane) => lane.id !== laneId)
    })
  }

  function updateParallelLane(nodeId: string, laneId: string, mutator: (lane: ParallelLane) => void) {
    updateNode(nodeId, (node) => {
      if (node.type !== "parallel") return
      const lane = node.lanes.find((candidate) => candidate.id === laneId)
      if (lane) mutator(lane)
    })
  }

  function defaultParallelLane(template: MacroTemplate, rawId: string, terminal: TerminalTarget, existingLaneIds: string[] = []): ParallelLane {
    const ids = allNodeIds(template.body)
    const id = uniqueKey(rawId, existingLaneIds)
    return { id, label: id, terminal, body: [{ id: uniqueKey(id + "_output", [...ids, id]), type: "output", source: { kind: "none" } }] }
  }

  function nextParallelLaneId(lanes: ParallelLane[]): string {
    const maxOrdinal = lanes.reduce((max, lane) => {
      const match = /^lane_(\d+)$/.exec(lane.id)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const ordinal = maxOrdinal > 0 ? maxOrdinal + 1 : lanes.length + 1
    return uniqueKey("lane_" + ordinal, lanes.map((lane) => lane.id))
  }

  function nextParallelLaneTerminal(lanes: ParallelLane[]): TerminalTarget {
    const used = new Set(lanes.map((lane) => choiceFromTarget(lane.terminal)))
    const choice = terminalChoices().find((item: TerminalChoice) => !used.has(item.value))
    return choice ? targetFromChoice(choice.value) : lanes[0]?.terminal ?? firstTerminalTarget()
  }

  function defaultNode(template: MacroTemplate, type: FlowV2Node["type"]): FlowV2Node {
    const terminal = firstTerminalTarget()
    const id = uniqueKey(type.replace(/[^A-Za-z0-9_]/g, "_"), allNodeIds(template.body))
    if (type === "send") return { id, type, terminal, message: { parts: [] }, ending: "cr" }
    if (type === "notify") return { id, type, level: "info", title: "Macro notification", message: { parts: [] }, channels: [{ kind: "app", toast: true, sound: "success" }], onFailure: "continue" }
    if (type === "input") return { id, type, terminal, prompt: "Input", allowEmpty: false, ending: "cr" }
    if (type === "wait") return { id, type, mode: "duration", durationMs: 1500 }
    if (type === "capture-source") return { id, type, capture: defaultCaptureForFirstTab() }
    if (type === "extract_text") return { id, type, source: artifactChoices(template)[0]?.source ?? emptyArtifactSource(), split: { kind: "lines", keepEmpty: false }, filters: [], select: { mode: "index", index: -1 }, extract: { kind: "none" }, trim: "right", onEmpty: "pause" }
    if (type === "parallel") return { id, type, lanes: [defaultParallelLane(template, "lane_1", terminal)], merge: { kind: "sectioned_text", separator: "\n\n===== {laneId} | {laneLabel} | {terminalAlias} =====\n\n", includeEmptyOutputs: false }, onLaneFail: "pause" }
    if (type === "if") return { id, type, branches: [{ kind: "if", condition: defaultCondition(template), body: [] }] }
    if (type === "for") return { id, type, range: { kind: "count", count: 1 }, body: [] }
    if (type === "break") return { id, type, reason: "break", body: [] }
    if (type === "continue") return { id, type, reason: "continue", body: [] }
    return { id, type: "finish", reason: "done", body: [] }
  }

  function firstTerminalTarget(): TerminalTarget {
    return terminalChoices()[0]?.value ? targetFromChoice(terminalChoices()[0].value) : { kind: "index", value: 1 }
  }

  function allNodeIds(nodes: FlowV2Node[]): string[] {
    return nodes.flatMap((node) => {
      const nested = node.type === "if"
        ? [...node.branches.flatMap((branch) => allNodeIds(branch.body)), ...(node.else ? allNodeIds(node.else) : [])]
        : node.type === "for" ? allNodeIds(node.body)
          : node.type === "parallel" ? node.lanes.flatMap((lane) => lane.body.map((item) => item.id))
            : isControlTerminalNode(node) && node.body ? allNodeIds(node.body) : []
      return [node.id, ...nested]
    })
  }

  function allNodeChoices(nodes: FlowV2Node[]): Array<{ id: string; type: FlowV2Node["type"] }> {
    return nodes.flatMap((node) => {
      const nested = node.type === "if"
        ? [...node.branches.flatMap((branch) => allNodeChoices(branch.body)), ...(node.else ? allNodeChoices(node.else) : [])]
        : node.type === "for" ? allNodeChoices(node.body)
          : isControlTerminalNode(node) && node.body ? allNodeChoices(node.body) : []
      return [{ id: node.id, type: node.type }, ...nested]
    })
  }

  function isActionType(type: FlowV2Node["type"]): boolean {
    return type === "send" || type === "notify" || type === "input" || type === "wait" || type === "capture-source" || type === "extract_text" || type === "parallel"
  }

  function isControlTerminalNode(node: FlowV2Node): node is Extract<FlowV2Node, { type: "break" | "continue" | "finish" }> {
    return node.type === "break" || node.type === "continue" || node.type === "finish"
  }

  function setForRangeMode(nodeId: string, mode: "count" | "forever" | "text-list"): boolean {
    const current = findNode(draft.body, nodeId)
    if (current?.type !== "for") return false
    if (current.range.kind === "text-list" && mode !== "text-list" && hasNonDefaultTextListItems(current.range.items)) {
      if (!confirm("Switching from text-list will discard its items. Continue?")) return false
    }
    updateNode(nodeId, (node) => {
      if (node.type !== "for") return
      if (mode === "text-list") node.range = { kind: "text-list", items: [{ key: "", value: "" }] }
      else if (mode === "forever") node.range = { kind: "forever" }
      else node.range = { kind: "count", count: 1 }
    })
    return true
  }

  function bumpTextListStructureVersion(nodeId: string) {
    textListStructureVersions = {
      ...textListStructureVersions,
      [nodeId]: (textListStructureVersions[nodeId] ?? 0) + 1,
    }
  }

  function textListItemEditorKey(nodeId: string, itemIndex: number): string {
    return nodeId + ":" + (textListStructureVersions[nodeId] ?? 0) + ":" + itemIndex
  }

  function addTextListItem(nodeId: string) {
    let changed = false
    updateNode(nodeId, (node) => {
      if (node.type !== "for" || node.range.kind !== "text-list") return
      node.range.items.push({ key: "", value: "" })
      changed = true
    })
    if (changed) bumpTextListStructureVersion(nodeId)
  }

  function updateTextListItem(nodeId: string, itemIndex: number, field: keyof TextListItem, value: string) {
    updateNode(nodeId, (node) => {
      if (node.type === "for" && node.range.kind === "text-list" && node.range.items[itemIndex]) node.range.items[itemIndex][field] = value
    })
  }

  function removeTextListItem(nodeId: string, itemIndex: number) {
    let changed = false
    updateNode(nodeId, (node) => {
      if (node.type !== "for" || node.range.kind !== "text-list" || node.range.items.length <= 1) return
      node.range.items.splice(itemIndex, 1)
      changed = true
    })
    if (changed) bumpTextListStructureVersion(nodeId)
  }

  function moveTextListItem(nodeId: string, itemIndex: number, offset: -1 | 1) {
    let changed = false
    updateNode(nodeId, (node) => {
      if (node.type !== "for" || node.range.kind !== "text-list") return
      const target = itemIndex + offset
      if (target < 0 || target >= node.range.items.length) return
      const [item] = node.range.items.splice(itemIndex, 1)
      node.range.items.splice(target, 0, item)
      changed = true
    })
    if (changed) bumpTextListStructureVersion(nodeId)
  }

  function forBodyTemplateScope(node: Extract<FlowV2Node, { type: "for" }>, inherited: TextTemplateScope | null): TextTemplateScope | null {
    return node.range.kind === "text-list"
      ? { forStepId: node.id, shadowedForStepId: inherited?.forStepId }
      : inherited
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

<svelte:window onkeydown={handleInsertionKeydown} onresize={handleInsertionResize} />

<details class="macro-section validation-panel validation-panel-compact" data-testid="macro-validation">
  <summary>
    <strong>Validation</strong>
    <span class:ok={validation.ok} class:bad={!validation.ok} data-testid="macro-validation-summary">{validationSummary}</span>
  </summary>
  {#if validation.ok}
    <p>Template validation passed.</p>
  {:else}
    <ul>{#each validation.issues as issue}<li><strong>{issue.path}</strong> {issue.message}</li>{/each}</ul>
  {/if}
</details>

{#if insertionNotice}
  <p class="macro-insertion-notice" data-testid="macro-insertion-notice">{insertionNotice}</p>
{/if}
{#if idEditNotice}
  <p class="macro-insertion-notice" data-testid="macro-id-edit-notice">{idEditNotice}</p>
{/if}

<section class="macro-section">
  <div class="macro-section-title"><h3>Flow V2 Body</h3></div>
  <div class="step-list" data-testid="macro-step-list">
    {@render NodeListEditor(draft.body, [], false, "Root body", false, null)}
  </div>
</section>

{#snippet NodeListEditor(nodes: FlowV2Node[], bodyPath: BodyPath, allowLoopControls: boolean, label: string, actionOnly: boolean, templateScope: TextTemplateScope | null)}
  <details class="flow-block" data-testid="flow-block" open>
    <summary class="step-title flow-block-title" data-testid="flow-block-summary">
      <strong>{label}</strong>
      <small>{nodes.length} nodes</small>
    </summary>
    {#if nodes.length === 0}
      <div class="empty-flow-body" data-testid="empty-flow-body">
        <button type="button" data-testid="empty-body-add" onclick={(event) => insertIntoEmptyBody(bodyPath, label, allowLoopControls, event, actionOnly)}>Add inside</button>
      </div>
    {/if}
    {#each nodes as node, index (node.id)}
      {@render NodeEditor(node, index, bodyPath, allowLoopControls, actionOnly, templateScope)}
    {/each}
  </details>
{/snippet}

{#snippet NodeEditor(node: FlowV2Node, index: number, bodyPath: BodyPath, allowLoopControls: boolean, actionOnly: boolean, templateScope: TextTemplateScope | null)}
  <article class="step-editor flow-node-editor" class:collapsed={isNodeCollapsed(node.id)}>
    <div class="step-title">
      <strong>{index + 1}. {node.type}{#if node.type === "for" && node.range.kind === "text-list"} <small data-testid="for-text-list-summary">text-list · {LOOP_INDEX_TEMPLATE_TOKEN} · {LOOP_KEY_TEMPLATE_TOKEN} · {LOOP_VALUE_TEMPLATE_TOKEN} · {node.range.items.length} items</small>{/if}</strong>
      <div class="inline-actions node-menu" data-testid="node-menu">
        <button type="button" data-testid="node-add-before" onclick={(event) => openInsertion(beforeAnchor(bodyPath, index, node.id), "Insert before: " + node.id, allowLoopControls, event, actionOnly)}>Add before</button>
        <button type="button" data-testid="node-add-after" onclick={(event) => openInsertion(afterAnchor(bodyPath, index, node.id), "Insert after: " + node.id, allowLoopControls, event, actionOnly)}>Add after</button>
        <button type="button" data-testid="node-toggle-collapse" aria-expanded={!isNodeCollapsed(node.id)} onclick={() => toggleNodeCollapsed(node.id)}>{isNodeCollapsed(node.id) ? "Expand" : "Collapse"}</button>
        <button type="button" data-testid="node-move-up" onclick={() => moveNodeAt(bodyPath, index, -1)}>Move up</button>
        <button type="button" data-testid="node-move-down" onclick={() => moveNodeAt(bodyPath, index, 1)}>Move down</button>
        <button type="button" data-testid="node-remove" onclick={() => removeNodeAt(bodyPath, index, node.id)}>Remove</button>
      </div>
    </div>
    <div class="macro-row">
      <label>Node id<input data-testid="node-id-input" value={node.id} oninput={(event) => { if (!setNodeId(node.id, event.currentTarget.value)) event.currentTarget.value = node.id }} /></label>
    </div>

    {#if node.type === "send"}
      <label>Target tab
        <select data-testid="send-terminal" value={choiceFromTarget(node.terminal)} title={terminalChoiceTitle(choiceFromTarget(node.terminal))} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "send") item.terminal = targetFromChoice(event.currentTarget.value) })}>
          {#each terminalChoices() as choice}<option value={choice.value} title={choice.title}>{choice.label}</option>{/each}
        </select>
      </label>
      <MessagePartsEditor message={node.message} onChange={(message: MessageSpec) => updateNode(node.id, (item) => { if (item.type === "send") item.message = message })} choices={artifactChoicesBefore(node.id)} {templateScope} />
      <TerminalEndingField value={node.ending} onChange={(ending: TerminalEnding) => updateNode(node.id, (item) => { if (item.type === "send") item.ending = ending })} testId="send-ending-sequence" />
    {:else if node.type === "notify"}
      <div class="macro-row">
        <label>Level<select data-testid="notify-level" value={node.level} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "notify") item.level = event.currentTarget.value as NotificationLevel })}><option value="info">info</option><option value="success">success</option><option value="warning">warning</option><option value="error">error</option></select></label>
        <label>On failure<select data-testid="notify-on-failure" value={node.onFailure} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "notify") item.onFailure = event.currentTarget.value as "continue" | "pause" | "fail" })}><option value="continue">continue</option><option value="pause">pause</option><option value="fail">fail</option></select></label>
      </div>
      <TemplatableScalarField label="Title" value={node.title} onChange={(value) => updateNode(node.id, (item) => { if (item.type === "notify") item.title = value })} {templateScope} testId="notify-title" />
      <MessagePartsEditor message={node.message} onChange={(message: MessageSpec) => updateNode(node.id, (item) => { if (item.type === "notify") item.message = message })} choices={artifactChoicesBefore(node.id)} {templateScope} />
      <div class="message-part-row" data-testid="notify-channels">
        <div class="step-title"><strong>Channels</strong></div>
        <div class="macro-row">
          <label class="checkbox-row"><input type="checkbox" data-testid="notify-channel-app" checked={Boolean(notifyChannel(node, "app"))} onchange={(event) => setNotifyChannelEnabled(node.id, "app", event.currentTarget.checked)} />app</label>
          <label class="checkbox-row"><input type="checkbox" data-testid="notify-channel-system" checked={Boolean(notifyChannel(node, "system"))} onchange={(event) => setNotifyChannelEnabled(node.id, "system", event.currentTarget.checked)} />system</label>
          <label class="checkbox-row"><input type="checkbox" data-testid="notify-channel-telegram" checked={Boolean(notifyChannel(node, "telegram"))} onchange={(event) => setNotifyChannelEnabled(node.id, "telegram", event.currentTarget.checked)} />telegram</label>
        </div>
        {#if notifyChannel(node, "app")?.kind === "app"}
          {@const appChannel = notifyChannel(node, "app")}
          {#if appChannel?.kind === "app"}
            <div class="macro-row">
              <label class="checkbox-row"><input type="checkbox" data-testid="notify-app-toast" checked={appChannel.toast} onchange={(event) => updateNotifyChannel(node.id, "app", (channel) => { if (channel.kind === "app") channel.toast = event.currentTarget.checked })} />Toast</label>
              <label>Sound<select data-testid="notify-app-sound" value={appChannel.sound} onchange={(event) => updateNotifyChannel(node.id, "app", (channel) => { if (channel.kind === "app") channel.sound = event.currentTarget.value as "none" | "bell" | "chime" | "ping" | "pulse" | "success" | "warning" | "alert" })}><option value="success">success</option><option value="bell">bell</option><option value="chime">chime</option><option value="ping">ping</option><option value="pulse">pulse</option><option value="warning">warning</option><option value="alert">alert</option><option value="none">none</option></select></label>
            </div>
          {/if}
        {/if}
        {#if notifyChannel(node, "telegram")?.kind === "telegram"}
          {@const telegramChannel = notifyChannel(node, "telegram")}
          {#if telegramChannel?.kind === "telegram"}
            <label>Telegram profile<select data-testid="notify-telegram-profile" value={telegramChannel.profileId} onchange={(event) => updateNotifyChannel(node.id, "telegram", (channel) => { if (channel.kind === "telegram") channel.profileId = event.currentTarget.value })}>{#each telegramProfileChoices(telegramChannel.profileId) as profileId}<option value={profileId}>{profileId}</option>{/each}</select></label>
            {#if telegramProfilesError}<p class="macro-insertion-notice" data-testid="notify-telegram-profile-status">Telegram profiles unavailable: {telegramProfilesError}</p>{/if}
          {/if}
        {/if}
      </div>
    {:else if node.type === "input"}
      <label>Target tab
        <select data-testid="input-terminal" value={choiceFromTarget(node.terminal)} title={terminalChoiceTitle(choiceFromTarget(node.terminal))} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "input") item.terminal = targetFromChoice(event.currentTarget.value) })}>
          {#each terminalChoices() as choice}<option value={choice.value} title={choice.title}>{choice.label}</option>{/each}
        </select>
      </label>
      <TemplatableScalarField label="Prompt" value={node.prompt} onChange={(value) => updateNode(node.id, (item) => { if (item.type === "input") item.prompt = value })} {templateScope} testId="input-prompt" multiline maxRows={3} />
      <label class="checkbox-row"><input type="checkbox" checked={node.allowEmpty} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "input") item.allowEmpty = event.currentTarget.checked })} />Allow empty</label>
      <TerminalEndingField value={node.ending} onChange={(ending: TerminalEnding) => updateNode(node.id, (item) => { if (item.type === "input") item.ending = ending })} testId="input-ending-sequence" />
      <label>Default source
        <select data-testid="input-default-source" value={node.defaultSource ? sourceKey(node.defaultSource) : ""} onchange={(event) => updateNode(node.id, (item) => { if (item.type !== "input") return; item.defaultSource = event.currentTarget.value ? sourceFromKey(event.currentTarget.value) : undefined })}>
          <option value="">none</option>{#each artifactChoicesBefore(node.id) as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}
        </select>
      </label>
    {:else if node.type === "wait"}
      <label>Mode
        <select data-testid="wait-mode" value={node.mode} onchange={(event) => updateNode(node.id, (item) => {
          if (item.type !== "wait") return
          setWaitMode(item, event.currentTarget.value, firstQuietTerminalTarget())
        })}>
          <option value="duration">duration</option><option value="terminal-quiet" disabled={quietTerminalChoices().length === 0}>terminal-quiet</option><option value="user-continue">user-continue</option>
        </select>
      </label>
      {#if node.mode === "duration"}
        <label>Duration ms<input type="number" value={node.durationMs} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "duration") item.durationMs = Number(event.currentTarget.value) })} /></label>
      {:else if node.mode === "terminal-quiet"}
        <label>Target tab<select data-testid="wait-target-tab" value={quietChoiceFromTarget(node.terminal)} title={terminalChoiceTitle(quietChoiceFromTarget(node.terminal) || choiceFromTarget(node.terminal))} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "terminal-quiet" && event.currentTarget.value) item.terminal = targetFromChoice(event.currentTarget.value) })}><option value="" disabled>Choose shell tab</option>{#each quietTerminalChoices() as choice}<option value={choice.value} title={choice.title}>{choice.label}</option>{/each}</select></label>
        <div class="macro-row"><label>Quiet ms<input type="number" value={node.quietMs} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "terminal-quiet") item.quietMs = Number(event.currentTarget.value) })} /></label><label>Max ms<input type="number" value={node.maxMs} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "terminal-quiet") item.maxMs = Number(event.currentTarget.value) })} /></label><label>On timeout<select value={node.onTimeout} onchange={(event) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "terminal-quiet") item.onTimeout = event.currentTarget.value as "pause" | "finish" })}><option value="pause">pause</option><option value="finish">finish</option></select></label></div>
      {:else}
        <TemplatableScalarField label="Prompt" value={node.prompt} onChange={(value) => updateNode(node.id, (item) => { if (item.type === "wait" && item.mode === "user-continue") item.prompt = value })} {templateScope} testId="wait-user-continue-prompt" multiline maxRows={3} />
      {/if}
    {:else if node.type === "capture-source"}
      {@render CaptureEditor({ capture: node.capture }, terminalChoices, choiceFromTarget, targetFromChoice, defaultCaptureSource, (capture: CaptureSourceConfig) => updateNode(node.id, (item) => { if (item.type === "capture-source") item.capture = capture }))}
    {:else if node.type === "extract_text"}
      {@render ExtractTextEditor(node, artifactChoicesBefore(node.id), (mutator: (item: Extract<FlowV2Node, { type: "extract_text" }>) => void) => updateNode(node.id, (item) => { if (item.type === "extract_text") mutator(item) }))}
    {:else if node.type === "if"}
      {#each node.branches as branch, branchIndex}
        <div class="flow-branch-card">
          <div class="step-title"><strong>{branch.kind}</strong><button type="button" data-testid={branch.kind === "if" ? "node-add-inside-if" : "node-add-inside-elif"} onclick={(event) => openInsertion(insideAnchor(bodyPath, index, branch.kind === "if" ? "if" : "elif", branchIndex, node.id), "Insert inside " + branch.kind + ": " + node.id, allowLoopControls, event)}>Add inside {branch.kind}</button></div>
          {@render ConditionEditor(branch.condition, artifactChoicesBefore(node.id), (condition: TextMatchCondition) => updateNode(node.id, (item) => { if (item.type === "if") item.branches[branchIndex].condition = condition }))}
          {@render NodeListEditor(branch.body, [...bodyPath, { kind: "if-branch", nodeId: node.id, branchIndex }], allowLoopControls, branch.kind + " body", false, templateScope)}
        </div>
      {/each}
      <div class="inline-actions"><button type="button" data-testid="add-flow-elif" onclick={() => addElifAt(bodyPath, index)}>Add elif</button>{#if !node.else}<button type="button" data-testid="add-flow-else" onclick={() => ensureElseAt(bodyPath, index)}>Add else</button>{/if}</div>
      {#if node.else}<div class="flow-branch-card"><div class="step-title"><strong>else</strong><button type="button" data-testid="node-add-inside-else" onclick={(event) => openInsertion(insideAnchor(bodyPath, index, "else", undefined, node.id), "Insert inside else: " + node.id, allowLoopControls, event)}>Add inside else</button></div>{@render NodeListEditor(node.else, [...bodyPath, { kind: "if-else", nodeId: node.id }], allowLoopControls, "else body", false, templateScope)}</div>{/if}
    {:else if node.type === "for"}
      <div class="macro-row"><label>Mode<select data-testid="for-range-mode" value={node.range.kind} onchange={(event) => { const previous = node.range.kind; const mode = event.currentTarget.value as "count" | "forever" | "text-list"; if (!setForRangeMode(node.id, mode)) event.currentTarget.value = previous }}><option value="count">count</option><option value="forever">forever</option><option value="text-list">text-list</option></select></label>{#if node.range.kind === "count"}<label>Count<input data-testid="for-range-count" type="number" value={node.range.count} oninput={(event) => updateNode(node.id, (item) => { if (item.type === "for") item.range = { kind: "count", count: Number(event.currentTarget.value) } })} /></label>{/if}</div>
      {#if node.range.kind === "text-list"}
        <div class="text-list-items" data-testid="for-text-list-items">
          <div class="step-title"><strong>Items</strong><button type="button" data-testid="for-text-list-add" onclick={() => addTextListItem(node.id)}>Add item</button></div>
          {#each node.range.items as item, itemIndex (textListItemEditorKey(node.id, itemIndex))}
            <div class="message-part-row text-list-item-card" data-testid="for-text-list-item-card">
              <div class="step-title"><strong data-testid="for-text-list-index">{itemIndex + 1}</strong><div class="inline-actions"><button type="button" disabled={itemIndex === 0} onclick={() => moveTextListItem(node.id, itemIndex, -1)}>Up</button><button type="button" disabled={itemIndex === node.range.items.length - 1} onclick={() => moveTextListItem(node.id, itemIndex, 1)}>Down</button><button type="button" disabled={node.range.items.length <= 1} onclick={() => removeTextListItem(node.id, itemIndex)}>Remove</button></div></div>
              <label>Key<input data-testid="for-text-list-key" value={item.key} oninput={(event) => updateTextListItem(node.id, itemIndex, "key", event.currentTarget.value)} /></label>
              <label>Value<LineNumberedTextarea testId="for-text-list-value" value={item.value} maxRows={3} ariaLabel={"Text-list item " + (itemIndex + 1) + " value"} onInput={(value: string) => updateTextListItem(node.id, itemIndex, "value", value)} /></label>
            </div>
          {/each}
        </div>
      {/if}
      <div class="inline-actions"><button type="button" data-testid="node-add-inside-for" onclick={(event) => openInsertion(insideAnchor(bodyPath, index, "for", undefined, node.id), "Insert inside for: " + node.id, true, event)}>Add inside for</button></div>{@render NodeListEditor(node.body, [...bodyPath, { kind: "for", nodeId: node.id }], true, "for body", false, forBodyTemplateScope(node, templateScope))}
    {:else if node.type === "parallel"}
      <ParallelLaneTabs {draft} nodeId={node.id} {updateDraft} {terminalChoices} {choiceFromTarget} {targetFromChoice} {defaultCaptureSource} outerArtifactChoices={artifactChoicesBefore(node.id)} {templateScope} />
    {:else}
      <label>Reason<input value={node.reason ?? ""} oninput={(event) => updateNode(node.id, (item) => { if ("reason" in item) item.reason = event.currentTarget.value || undefined })} /></label>
      {#if node.type === "finish" || node.type === "break" || node.type === "continue"}
        <div class="inline-actions"><button type="button" data-testid="node-add-inside-control" onclick={(event) => openInsertion(insideAnchor(bodyPath, index, "control", undefined, node.id), "Insert action before " + node.type + ": " + node.id, false, event, true)}>Add action</button></div>
        {@render NodeListEditor(node.body ?? [], [...bodyPath, { kind: "control", nodeId: node.id }], false, node.type + " action body", true, templateScope)}
      {/if}
    {/if}
  </article>
{/snippet}

{#if insertionAnchor}
  <div class="macro-insertion-mode" class:anchored={insertionPaletteAnchored} class:centered={!insertionPaletteAnchored} data-testid="macro-insertion-mode" data-placement-mode={insertionPaletteMode}>
    <button type="button" class="macro-insertion-scrim" data-testid="macro-insertion-cancel-scrim" aria-label="Cancel insertion" onclick={cancelInsertion}></button>
    <section bind:this={insertionPaletteElement} class="floating-insertion-palette" class:anchored={insertionPaletteAnchored} class:above={insertionPosition?.placement === "above"} class:below={insertionPosition?.placement === "below"} style={insertionPaletteStyle} data-testid="macro-insertion-palette" aria-label="Insert macro node">
      <div class="palette-heading"><span>{insertionSummary}</span><small>choose node</small></div>
      <div class="step-palette" data-testid="macro-actions-palette">
        <div class="palette-heading"><span>Actions</span><small>do work</small></div>
        <div class="step-actions">
          {#each actionPaletteItems as item}
            <button type="button" data-testid={item.testId} title={item.type} onclick={() => insertFromPalette(item.type)}><span class="tool-label">{item.label}</span></button>
          {/each}
        </div>
      </div>
      {#if !insertionActionOnly}
        <div class="step-palette flow-palette" data-testid="macro-flow-palette">
          <div class="palette-heading"><span>Flow</span><small>py-like</small></div>
          <div class="step-actions">
            {#each flowPaletteItems as item}
              {#if !item.loopOnly || insertionAllowsLoopControls}
                <button type="button" data-testid={item.testId} title={item.type} onclick={() => insertFromPalette(item.type)}><span class="tool-label">{item.label}</span></button>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
      <div class="step-palette move-existing-palette" data-testid="macro-move-existing-palette">
        <div class="palette-heading"><span>Move existing</span><small>move node id here</small></div>
        <div class="move-existing-row">
          <select data-testid="macro-move-existing-select" value={moveNodeId} onchange={(event) => { moveNodeId = event.currentTarget.value }}>
            <option value="">Select node id</option>
            {#each movableNodeChoices() as choice}
              <option value={choice.id}>{choice.id} · {choice.type}</option>
            {/each}
          </select>
          <button type="button" data-testid="macro-move-existing" onclick={moveExistingNodeFromPalette} disabled={!moveNodeId}>Move</button>
        </div>
      </div>
      <button type="button" data-testid="macro-insertion-cancel" onclick={cancelInsertion}>Cancel</button>
    </section>
  </div>
{/if}

{#snippet ExtractTextEditor(node: Extract<FlowV2Node, { type: "extract_text" }>, choices: ArtifactChoice[], updateExtract: (mutator: (item: Extract<FlowV2Node, { type: "extract_text" }>) => void) => void)}
  <label>Source
    <select data-testid="extract-text-source" value={sourceKey(node.source)} onchange={(event) => updateExtract((item) => { item.source = requiredSourceFromKey(event.currentTarget.value, item.source) })}>
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
      <select data-testid="extract-text-select-mode" value={node.select.mode} onchange={(event) => updateExtract((item) => { const mode = event.currentTarget.value; item.select = mode === "index" ? { mode, index: -1 } : mode === "range" ? { mode, start: -1 } : { mode: "all" } })}>
        <option value="all">all</option><option value="index">index</option><option value="range">range</option>
      </select>
    </label>
    {#if node.select.mode === "index"}<label>Index<input type="number" value={node.select.index} oninput={(event) => updateExtract((item) => { if (item.select.mode === "index") item.select.index = Number(event.currentTarget.value) })} /></label>{/if}
    {#if node.select.mode === "range"}<label>Start<input type="number" value={node.select.start} oninput={(event) => updateExtract((item) => { if (item.select.mode === "range") item.select.start = Number(event.currentTarget.value) })} /></label><label>End<input type="number" value={node.select.end ?? ""} oninput={(event) => updateExtract((item) => { if (item.select.mode === "range") item.select.end = event.currentTarget.value === "" ? undefined : Number(event.currentTarget.value) })} /></label>{/if}
  </div>

  <div class="macro-row">
    <label>Extract
      <select data-testid="extract-text-extract-kind" value={node.extract.kind} onchange={(event) => updateExtract((item) => { item.extract = event.currentTarget.value === "regex" ? { kind: "regex", pattern: "(.*)", flags: "", group: 1 } : { kind: "none" } })}>
        <option value="none">none</option><option value="regex">regex group</option>
      </select>
    </label>
    <label>Trim<select value={node.trim} onchange={(event) => updateExtract((item) => { item.trim = event.currentTarget.value as never })}><option value="none">none</option><option value="left">left</option><option value="right">right</option><option value="both">both</option></select></label>
    <label>On empty<select data-testid="extract-text-on-empty" value={node.onEmpty} onchange={(event) => updateExtract((item) => { item.onEmpty = event.currentTarget.value as never })}><option value="pause">pause</option><option value="continue">continue</option><option value="fail">fail</option><option value="finish">finish</option></select></label>
  </div>
  {#if node.extract.kind === "regex"}
    <div class="macro-row"><label>Pattern<input data-testid="extract-text-regex-pattern" value={node.extract.pattern} oninput={(event) => updateExtract((item) => { if (item.extract.kind === "regex") item.extract.pattern = event.currentTarget.value })} /></label><label>Flags<input value={node.extract.flags ?? ""} oninput={(event) => updateExtract((item) => { if (item.extract.kind === "regex") item.extract.flags = event.currentTarget.value })} /></label><label>Group<input value={groupInputValue(node.extract.group)} oninput={(event) => updateExtract((item) => { if (item.extract.kind === "regex") item.extract.group = groupFromInput(event.currentTarget.value) })} /></label></div>
  {/if}
{/snippet}

{#snippet CaptureEditor(node: { capture: CaptureSourceConfig }, terminalChoices: () => TerminalChoice[], choiceFromTarget: (target: TerminalTarget) => string, targetFromChoice: (choice: string) => TerminalTarget, defaultCaptureSource: (kind: CaptureSourceConfig["kind"]) => CaptureSourceConfig, onChange: (capture: CaptureSourceConfig) => void)}
  {@const sourceChoice = choiceForTarget(node.capture.terminal)}
  {@const allowedKinds = captureKindsForTarget(node.capture.terminal)}
  {@const captureAllowed = sourceChoice ? isCaptureKindAllowed(sourceChoice.capabilities, node.capture.kind) : true}
  <label>Source tab<select data-testid="capture-step-terminal" value={choiceFromTarget(node.capture.terminal)} title={terminalChoiceTitle(choiceFromTarget(node.capture.terminal))} onchange={(event) => { const terminal = targetFromChoice(event.currentTarget.value); const allowed = captureKindsForTarget(terminal); const kind = allowed.includes(node.capture.kind) ? node.capture.kind : allowed[0] ?? "terminal-buffer"; onChange(defaultCaptureForTarget(kind, terminal)) }}>{#each terminalChoices() as choice}<option value={choice.value} title={choice.title}>{choice.label}</option>{/each}</select></label>
  {#if allowedKinds.length > 1}
    <label>Capture kind<select data-testid="capture-step-kind" value={node.capture.kind} onchange={(event) => onChange(defaultCaptureForTarget(event.currentTarget.value as CaptureSourceConfig["kind"], node.capture.terminal))}>{#each allowedKinds as kind}<option value={kind}>{kind}</option>{/each}</select></label>
  {:else}
    <p class="hint" data-testid="capture-kind-fixed">Capture kind: {allowedKinds[0] ?? node.capture.kind}</p>
  {/if}
  {#if !captureAllowed}
    <p class="macro-insertion-notice" data-testid="capture-kind-invalid">Capture kind {node.capture.kind} is not valid for this source tab.</p>
    {#if allowedKinds[0]}<button type="button" data-testid="capture-kind-repair" onclick={() => onChange(defaultCaptureForTarget(allowedKinds[0], node.capture.terminal))}>Use {allowedKinds[0]}</button>{/if}
  {:else if node.capture.kind === "terminal-buffer"}
    <label>Mode<select data-testid="capture-terminal-buffer-mode" value={node.capture.mode} onchange={(event) => { if (node.capture.kind === "terminal-buffer") onChange({ ...node.capture, mode: event.currentTarget.value as "scrollback-tail" | "raw-stream-tail" }) }}><option value="scrollback-tail">screen text tail</option><option value="raw-stream-tail">raw stream tail (debug only)</option></select></label>
    <label>Max chars<input type="number" value={node.capture.maxChars} oninput={(event) => { if (node.capture.kind === "terminal-buffer") onChange({ ...node.capture, maxChars: Number(event.currentTarget.value) }) }} /></label>
  {:else if node.capture.kind === "agent-event"}
    <label>Agent<select data-testid="capture-agent-kind" value={node.capture.agent.kind} onchange={() => onChange(keepCodexAgent(node.capture))}><option value="codex">codex</option></select></label>
    <label>Mode<select data-testid="capture-agent-mode" value={node.capture.captureMode ?? "result_only"} onchange={(event) => { if (node.capture.kind === "agent-event") onChange({ ...node.capture, captureMode: event.currentTarget.value as "result_only" | "prompt_only" | "prompt_and_result" }) }}><option value="result_only">result only</option><option value="prompt_only">prompt only</option><option value="prompt_and_result">prompt + result</option></select></label>
    <p class="hint">Codex hook fields only: UserPromptSubmit.prompt and Stop.last_assistant_message</p>
  {:else}
    <p class="hint">Captures this text tab as plain text.</p>
  {/if}
{/snippet}

{#snippet ConditionEditor(condition: TextMatchCondition, choices: ArtifactChoice[], onChange: (condition: TextMatchCondition) => void)}
  <div class="condition-row">
    <label>Source<select value={sourceKey(condition.source)} onchange={(event) => onChange({ ...condition, source: requiredSourceFromKey(event.currentTarget.value, condition.source) })}>{#each choices as choice}<option value={sourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
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

<style>
  .text-list-items {
    display: grid;
    min-width: 0;
    gap: 8px;
  }

  .text-list-item-card {
    min-width: 0;
    background: #fbfdff;
  }

  .text-list-item-card > .step-title {
    flex-wrap: wrap;
  }

  [data-testid="for-text-list-summary"] {
    color: #376b91;
    font-size: 11px;
    font-weight: 700;
  }
</style>
