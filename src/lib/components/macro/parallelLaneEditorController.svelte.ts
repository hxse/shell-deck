import type {
  FlowV2Node,
  MacroDefinitionV5,
  MacroTerminalReference,
  ParallelLane,
  ParallelLaneActionNode,
  ParallelLaneOutputNode,
  ParallelNode,
} from '../../macro/macroDefinitionTypes'
import {
  allMacroNodeIds,
  defaultParallelLane,
  defaultParallelLaneAction,
  nextParallelLaneId,
} from '../../macro/macroEditorDefaults'
import {
  laneArtifactChoices,
  parallelOutputSourceFromKey,
} from '../../macro/macroArtifactChoices'
import {
  isCaptureKindAllowed,
  terminalChoiceForIndex,
  type CapabilityCaptureKind,
  type TerminalChoice,
} from '../../macro/macroTerminalChoices'

export type LaneActionType = ParallelLaneActionNode['type']

type ParallelLaneEditorControllerOptions = {
  draft(): MacroDefinitionV5
  nodeId(): string
  selectedLaneId(): string
  setSelectedLaneId(laneId: string): void
  updateDraft(mutator: (template: MacroDefinitionV5) => void): void
  terminalChoices(): TerminalChoice[]
  adoptTerminalSelection(template: MacroDefinitionV5, terminalIndex: number): boolean
  choiceFromIndex(target: number): string
  closeLaneInsertion(restoreFocus: boolean): void
  closeLaneInsertionForLane(laneId: string): void
}

const laneActionPaletteItems: Array<{ type: LaneActionType; label: string; testId: string }> = [
  { type: 'send', label: 'send', testId: 'parallel-add-send' },
  { type: 'wait', label: 'wait', testId: 'parallel-add-wait' },
  { type: 'capture-source', label: 'capture', testId: 'parallel-add-capture' },
  { type: 'extract_text', label: 'extract', testId: 'parallel-add-extract' },
]

export function createParallelLaneEditorController(options: ParallelLaneEditorControllerOptions) {
  let collapsedLaneActionIds = $state<string[]>([])
  let editNotice = $state('')

  function parallelNode(): ParallelNode | undefined {
    return findParallel(options.draft().body, options.nodeId())
  }

  function selectedLane(): ParallelLane | undefined {
    const node = parallelNode()
    return node?.lanes.find((lane) => lane.id === options.selectedLaneId()) ?? node?.lanes[0]
  }

  function collectsAnyLaneText(): boolean {
    return Boolean(parallelNode()?.lanes.some((lane) => laneOutput(lane)?.source.kind !== 'none'))
  }

  function updateParallel(mutator: (node: ParallelNode) => void): void {
    options.updateDraft((template) => {
      const node = findParallel(template.body, options.nodeId())
      if (node) mutator(node)
    })
  }

  function updateLane(laneId: string, mutator: (lane: ParallelLane) => void): void {
    updateParallel((node) => {
      const lane = node.lanes.find((candidate) => candidate.id === laneId)
      if (lane) mutator(lane)
    })
  }

  function updateLaneAction(
    laneId: string,
    actionId: string,
    mutator: (action: ParallelLaneActionNode) => void,
  ): void {
    updateLane(laneId, (lane) => {
      const action = lane.body.find((item): item is ParallelLaneActionNode => (
        item.id === actionId && item.type !== 'output'
      ))
      if (action) mutator(action)
    })
  }

  function choiceForIndex(target: number): TerminalChoice | undefined {
    return terminalChoiceForIndex(target, options.terminalChoices())
  }

  function expectedTerminalTypeAt(terminal: MacroTerminalReference): 'shell' | 'text' | undefined {
    return terminal.kind === 'terminal_index'
      ? options.draft().terminalLayout[terminal.index - 1]?.type
      : undefined
  }

  function laneChoice(lane: ParallelLane): TerminalChoice | undefined {
    return lane.terminal.kind === 'terminal_index' ? choiceForIndex(lane.terminal.index) : undefined
  }

  function laneAllowsAction(lane: ParallelLane, type: LaneActionType): boolean {
    const capabilities = laneChoice(lane)?.capabilities
    if (!capabilities) return true
    if (type === 'wait') return capabilities.canWaitQuiet
    return true
  }

  function laneActionPaletteItemsFor(
    lane: ParallelLane,
  ): Array<{ type: LaneActionType; label: string; testId: string }> {
    return laneActionPaletteItems.filter((item) => laneAllowsAction(lane, item.type))
  }

  function laneCaptureKinds(lane: ParallelLane): CapabilityCaptureKind[] {
    return laneChoice(lane)?.capabilities.captureKinds ?? ['terminal-buffer', 'agent-event', 'text-box']
  }

  function laneCaptureAllowed(
    lane: ParallelLane,
    action: Extract<ParallelLaneActionNode, { type: 'capture-source' }>,
  ): boolean {
    const choice = laneChoice(lane)
    return choice ? isCaptureKindAllowed(choice.capabilities, action.capture.kind) : true
  }

  function incompatibleLaneActionIds(lane: ParallelLane, target: number): string[] {
    const targetChoice = choiceForIndex(target)
    if (!targetChoice) return []
    return lane.body.flatMap((item) => {
      if (item.type === 'output') return []
      if (item.type === 'wait') return targetChoice.capabilities.canWaitQuiet ? [] : [item.id]
      if (item.type === 'capture-source') {
        return isCaptureKindAllowed(targetChoice.capabilities, item.capture.kind) ? [] : [item.id]
      }
      return []
    })
  }

  function setLaneId(laneId: string, nextId: string): boolean {
    const node = parallelNode()
    if (!node) return false
    if (nextId !== laneId && node.lanes.some((lane) => lane.id === nextId)) {
      editNotice = 'Duplicate lane id blocked: ' + nextId
      return false
    }
    editNotice = ''
    updateParallel((parallel) => {
      const lane = parallel.lanes.find((candidate) => candidate.id === laneId)
      if (!lane) return
      lane.id = nextId
      options.setSelectedLaneId(nextId)
    })
    return true
  }

  function setLaneLabel(laneId: string, nextLabel: string): boolean {
    const node = parallelNode()
    if (!node) return false
    const normalized = nextLabel.trim()
    if (normalized && node.lanes.some((lane) => lane.id !== laneId && lane.label.trim() === normalized)) {
      editNotice = 'Duplicate lane label blocked: ' + normalized
      return false
    }
    editNotice = ''
    updateLane(laneId, (lane) => { lane.label = nextLabel })
    return true
  }

  function setLaneActionId(laneId: string, actionId: string, nextId: string): boolean {
    if (nextId !== actionId && allMacroNodeIds(options.draft().body).includes(nextId)) {
      editNotice = 'Duplicate action id blocked: ' + nextId
      return false
    }
    editNotice = ''
    updateLaneAction(laneId, actionId, (action) => { action.id = nextId })
    if (collapsedLaneActionIds.includes(actionId)) {
      collapsedLaneActionIds = collapsedLaneActionIds.map((id) => id === actionId ? nextId : id)
    }
    return true
  }

  function isLaneActionCollapsed(actionId: string): boolean {
    return collapsedLaneActionIds.includes(actionId)
  }

  function toggleLaneActionCollapsed(actionId: string): void {
    collapsedLaneActionIds = isLaneActionCollapsed(actionId)
      ? collapsedLaneActionIds.filter((id) => id !== actionId)
      : [...collapsedLaneActionIds, actionId]
  }

  function setLaneOutputId(laneId: string, outputId: string, nextId: string): boolean {
    if (nextId !== outputId && allMacroNodeIds(options.draft().body).includes(nextId)) {
      editNotice = 'Duplicate output id blocked: ' + nextId
      return false
    }
    editNotice = ''
    updateLane(laneId, (lane) => {
      const output = lane.body.find((candidate): candidate is ParallelLaneOutputNode => (
        candidate.id === outputId && candidate.type === 'output'
      ))
      if (output) output.id = nextId
    })
    return true
  }

  function setLaneCollectsText(laneId: string, enabled: boolean): boolean {
    const lane = parallelNode()?.lanes.find((candidate) => candidate.id === laneId)
    const output = lane ? laneOutput(lane) : undefined
    if (!lane || !output) return false
    if (!enabled) {
      editNotice = ''
      updateLane(laneId, (item) => {
        const target = laneOutput(item)
        if (target) target.source = { kind: 'none' }
      })
      return true
    }
    const choices = laneArtifactChoices(lane, output.id)
    const source = choices.at(-1)?.source
    if (!source) {
      editNotice = 'Add Capture or Extract before collecting lane text.'
      return false
    }
    editNotice = ''
    updateLane(laneId, (item) => {
      const target = laneOutput(item)
      if (target) target.source = { ...source }
    })
    return true
  }

  function setLaneOutputSource(laneId: string, outputId: string, value: string): void {
    editNotice = ''
    updateLane(laneId, (lane) => {
      const output = lane.body.find((candidate): candidate is ParallelLaneOutputNode => (
        candidate.id === outputId && candidate.type === 'output'
      ))
      if (output) output.source = parallelOutputSourceFromKey(value)
    })
  }

  function addLane(): void {
    options.updateDraft((template) => {
      const node = findParallel(template.body, options.nodeId())
      if (!node) return
      const terminal: MacroTerminalReference = { kind: 'unassigned' }
      const lane = defaultParallelLane(
        template,
        nextParallelLaneId(node.lanes),
        terminal,
        node.lanes.map((item) => item.id),
      )
      node.lanes.push(lane)
      options.setSelectedLaneId(lane.id)
      options.closeLaneInsertion(false)
    })
  }

  function removeLane(laneId: string): void {
    const node = parallelNode()
    const lane = node?.lanes.find((candidate) => candidate.id === laneId)
    if (!node || !lane || node.lanes.length <= 1) return
    if (!confirm('Remove parallel lane ' + laneId + '?')) return
    const removedActionIds = new Set(
      lane.body.filter((item) => item.type !== 'output').map((item) => item.id),
    )
    updateParallel((parallel) => {
      parallel.lanes = parallel.lanes.filter((candidate) => candidate.id !== laneId)
      if (options.selectedLaneId() === laneId) {
        options.setSelectedLaneId(parallel.lanes[0]?.id ?? '')
      }
      options.closeLaneInsertionForLane(laneId)
    })
    collapsedLaneActionIds = collapsedLaneActionIds.filter((id) => !removedActionIds.has(id))
  }

  function setLaneTerminalReference(laneId: string, terminal: MacroTerminalReference): boolean {
    const lane = parallelNode()?.lanes.find((candidate) => candidate.id === laneId)
    if (!lane) return false
    const incompatible = terminal.kind === 'terminal_index'
      ? incompatibleLaneActionIds(lane, terminal.index)
      : []
    if (incompatible.length > 0) {
      const target = terminal.kind === 'terminal_index' ? choiceForIndex(terminal.index) : undefined
      editNotice = 'Lane terminal change blocked; incompatible actions for '
        + (target?.label ?? 'terminal') + ': ' + incompatible.join(', ')
      return false
    }
    editNotice = ''
    let updated = false
    options.updateDraft((template) => {
      if (terminal.kind === 'terminal_index'
        && !options.adoptTerminalSelection(template, terminal.index)) return
      const node = findParallel(template.body, options.nodeId())
      const item = node?.lanes.find((candidate) => candidate.id === laneId)
      if (!item) return
      item.terminal = terminal
      updated = true
    })
    return updated
  }

  function isTerminalChoiceUsedByOtherLane(laneId: string, choiceValue: string): boolean {
    const node = parallelNode()
    if (!node) return false
    return node.lanes.some((lane) => lane.id !== laneId
      && lane.terminal.kind === 'terminal_index'
      && options.choiceFromIndex(lane.terminal.index) === choiceValue)
  }

  function unavailableLaneTerminalValues(laneId: string): string[] {
    return options.terminalChoices()
      .filter((choice) => isTerminalChoiceUsedByOtherLane(laneId, choice.value))
      .map((choice) => choice.value)
  }

  function addAction(laneId: string, type: LaneActionType, insertionIndex?: number): boolean {
    let added = false
    options.updateDraft((template) => {
      const node = findParallel(template.body, options.nodeId())
      const lane = node?.lanes.find((candidate) => candidate.id === laneId)
      if (!lane) return
      const output = outputIndex(lane)
      const maxIndex = output < 0 ? lane.body.length : output
      const targetIndex = Math.max(0, Math.min(insertionIndex ?? maxIndex, maxIndex))
      const captureKind = laneCaptureKinds(lane)[0] ?? 'terminal-buffer'
      lane.body.splice(targetIndex, 0, defaultParallelLaneAction(template, type, captureKind))
      options.setSelectedLaneId(lane.id)
      editNotice = ''
      added = true
    })
    return added
  }

  function removeAction(laneId: string, actionId: string): void {
    updateLane(laneId, (lane) => {
      const index = lane.body.findIndex((item) => item.id === actionId)
      if (index < 0 || lane.body[index]?.type === 'output') return
      if (!confirm('Remove parallel lane action ' + actionId + '?')) return
      lane.body.splice(index, 1)
      collapsedLaneActionIds = collapsedLaneActionIds.filter((id) => id !== actionId)
    })
  }

  function moveAction(laneId: string, actionId: string, offset: -1 | 1): void {
    updateLane(laneId, (lane) => {
      const index = lane.body.findIndex((item) => item.id === actionId)
      const output = outputIndex(lane)
      const target = index + offset
      if (index < 0 || lane.body[index]?.type === 'output') return
      if (target < 0 || target >= (output < 0 ? lane.body.length : output)) return
      const [item] = lane.body.splice(index, 1)
      lane.body.splice(target, 0, item)
    })
  }

  function outputIndex(lane: ParallelLane): number {
    return lane.body.findIndex((item) => item.type === 'output')
  }

  function laneOutput(lane: ParallelLane): ParallelLaneOutputNode | undefined {
    return lane.body.find((item): item is ParallelLaneOutputNode => item.type === 'output')
  }

  return {
    get editNotice() { return editNotice },
    parallelNode,
    selectedLane,
    collectsAnyLaneText,
    updateParallel,
    updateLaneAction,
    expectedTerminalTypeAt,
    laneActionPaletteItemsFor,
    laneCaptureKinds,
    laneCaptureAllowed,
    setLaneId,
    setLaneLabel,
    setLaneActionId,
    isLaneActionCollapsed,
    toggleLaneActionCollapsed,
    setLaneOutputId,
    setLaneCollectsText,
    setLaneOutputSource,
    addLane,
    removeLane,
    setLaneTerminalReference,
    unavailableLaneTerminalValues,
    addAction,
    removeAction,
    moveAction,
  }
}

function findParallel(nodes: FlowV2Node[], id: string): ParallelNode | undefined {
  for (const node of nodes) {
    if (node.type === 'parallel' && node.id === id) return node
    if (node.type === 'if') {
      for (const branch of node.branches) {
        const found = findParallel(branch.body, id)
        if (found) return found
      }
      if (node.else) {
        const found = findParallel(node.else, id)
        if (found) return found
      }
    }
    if (node.type === 'for') {
      const found = findParallel(node.body, id)
      if (found) return found
    }
    if ((node.type === 'break' || node.type === 'continue' || node.type === 'finish') && node.body) {
      const found = findParallel(node.body, id)
      if (found) return found
    }
  }
}
