import type {
  MacroDefinitionV5,
  MacroTerminalReference,
  ParallelLane,
  ParallelLaneActionNode,
  ParallelNode,
} from '../../macro/macroDefinitionTypes'
import type { TerminalChoice } from '../../macro/macroTerminalChoices'
import {
  addParallelLane,
  addParallelLaneAction,
  moveParallelLaneAction,
  removeParallelLane,
  removeParallelLaneAction,
  renameParallelLane,
  renameParallelLaneAction,
  renameParallelLaneOutput,
  setParallelLaneCollectsText,
  setParallelLaneLabel,
  setParallelLaneOutputSource,
  setParallelLaneTerminal,
  type ParallelLaneCommandResult,
} from './parallelLaneEditorCommands'
import {
  duplicateMacroNodeId,
  duplicateParallelLaneId,
  duplicateParallelLaneLabel,
  expectedParallelTerminalTypeAt,
  findParallel,
  findParallelLane,
  findParallelLaneAction,
  incompatibleParallelLaneActionIds,
  parallelCollectsAnyLaneText,
  parallelLaneActionPaletteItems,
  parallelLaneCaptureAllowed,
  parallelLaneCaptureKinds,
  parallelLaneOutput,
  parallelLaneOutputSourceChoices,
  parallelTerminalChoiceForIndex,
  selectedParallelLane,
  unavailableParallelLaneTerminalValues,
  type LaneActionType,
} from './parallelLaneEditorPolicy'

export type { LaneActionType } from './parallelLaneEditorPolicy'

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

export function createParallelLaneEditorController(options: ParallelLaneEditorControllerOptions) {
  let collapsedLaneActionIds = $state<string[]>([])
  let editNotice = $state('')

  function parallelNode(): ParallelNode | undefined {
    return findParallel(options.draft().body, options.nodeId())
  }

  function selectedLane(): ParallelLane | undefined {
    return selectedParallelLane(parallelNode(), options.selectedLaneId())
  }

  function collectsAnyLaneText(): boolean {
    return parallelCollectsAnyLaneText(parallelNode())
  }

  function updateParallel(mutator: (node: ParallelNode) => void): void {
    options.updateDraft((template) => {
      const node = findParallel(template.body, options.nodeId())
      if (node) mutator(node)
    })
  }

  function updateLane(laneId: string, mutator: (lane: ParallelLane) => void): void {
    updateParallel((node) => {
      const lane = findParallelLane(node, laneId)
      if (lane) mutator(lane)
    })
  }

  function updateLaneAction(
    laneId: string,
    actionId: string,
    mutator: (action: ParallelLaneActionNode) => void,
  ): void {
    updateLane(laneId, (lane) => {
      const action = findParallelLaneAction(lane, actionId)
      if (action) mutator(action)
    })
  }

  function expectedTerminalTypeAt(terminal: MacroTerminalReference): 'shell' | 'text' | undefined {
    return expectedParallelTerminalTypeAt(options.draft(), terminal)
  }

  function laneActionPaletteItemsFor(lane: ParallelLane) {
    return parallelLaneActionPaletteItems(lane, options.terminalChoices())
  }

  function laneCaptureKinds(lane: ParallelLane) {
    return parallelLaneCaptureKinds(lane, options.terminalChoices())
  }

  function laneCaptureAllowed(
    lane: ParallelLane,
    action: Extract<ParallelLaneActionNode, { type: 'capture-source' }>,
  ): boolean {
    return parallelLaneCaptureAllowed(lane, action, options.terminalChoices())
  }

  function setLaneId(laneId: string, nextId: string): boolean {
    const node = parallelNode()
    if (!node) return false
    if (duplicateParallelLaneId(node, laneId, nextId)) {
      editNotice = 'Duplicate lane id blocked: ' + nextId
      return false
    }
    editNotice = ''
    let result = failedCommand()
    options.updateDraft((template) => {
      result = renameParallelLane(template, options.nodeId(), laneId, nextId)
      if (result.ok) options.setSelectedLaneId(nextId)
    })
    return result.ok
  }

  function setLaneLabel(laneId: string, nextLabel: string): boolean {
    const node = parallelNode()
    if (!node) return false
    const duplicate = duplicateParallelLaneLabel(node, laneId, nextLabel)
    if (duplicate) {
      editNotice = 'Duplicate lane label blocked: ' + duplicate
      return false
    }
    editNotice = ''
    let result = failedCommand()
    options.updateDraft((template) => {
      result = setParallelLaneLabel(template, options.nodeId(), laneId, nextLabel)
    })
    return result.ok
  }

  function setLaneActionId(laneId: string, actionId: string, nextId: string): boolean {
    if (duplicateMacroNodeId(options.draft(), actionId, nextId)) {
      editNotice = 'Duplicate action id blocked: ' + nextId
      return false
    }
    editNotice = ''
    options.updateDraft((template) => {
      renameParallelLaneAction(template, options.nodeId(), laneId, actionId, nextId)
    })
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
    if (duplicateMacroNodeId(options.draft(), outputId, nextId)) {
      editNotice = 'Duplicate output id blocked: ' + nextId
      return false
    }
    editNotice = ''
    let result = failedCommand()
    options.updateDraft((template) => {
      result = renameParallelLaneOutput(template, options.nodeId(), laneId, outputId, nextId)
    })
    return result.ok
  }

  function setLaneCollectsText(laneId: string, enabled: boolean): boolean {
    const lane = parallelNode()?.lanes.find((candidate) => candidate.id === laneId)
    const output = lane ? parallelLaneOutput(lane) : undefined
    if (!lane || !output) return false
    if (enabled && !parallelLaneOutputSourceChoices(lane, output.id).at(-1)?.source) {
      editNotice = 'Add Capture or Extract before collecting lane text.'
      return false
    }
    editNotice = ''
    let result = failedCommand()
    options.updateDraft((template) => {
      result = setParallelLaneCollectsText(template, options.nodeId(), laneId, enabled)
    })
    return result.ok
  }

  function setLaneOutputSource(laneId: string, outputId: string, value: string): void {
    editNotice = ''
    options.updateDraft((template) => {
      setParallelLaneOutputSource(template, options.nodeId(), laneId, outputId, value)
    })
  }

  function addLane(): void {
    options.updateDraft((template) => {
      const result = addParallelLane(template, options.nodeId())
      if (!result.ok || !result.addedLaneId) return
      options.setSelectedLaneId(result.addedLaneId)
      options.closeLaneInsertion(false)
    })
  }

  function removeLane(laneId: string): void {
    const node = parallelNode()
    const lane = node?.lanes.find((candidate) => candidate.id === laneId)
    if (!node || !lane || node.lanes.length <= 1) return
    if (!confirm('Remove parallel lane ' + laneId + '?')) return
    let result = failedCommand()
    options.updateDraft((template) => {
      result = removeParallelLane(template, options.nodeId(), laneId)
      if (!result.ok) return
      const parallel = findParallel(template.body, options.nodeId())
      if (options.selectedLaneId() === laneId) {
        options.setSelectedLaneId(parallel?.lanes[0]?.id ?? '')
      }
      options.closeLaneInsertionForLane(laneId)
    })
    if (result.ok) {
      const removed = new Set(result.removedActionIds ?? [])
      collapsedLaneActionIds = collapsedLaneActionIds.filter((id) => !removed.has(id))
    }
  }

  function setLaneTerminalReference(laneId: string, terminal: MacroTerminalReference): boolean {
    const lane = parallelNode()?.lanes.find((candidate) => candidate.id === laneId)
    if (!lane) return false
    const choices = options.terminalChoices()
    const incompatible = terminal.kind === 'terminal_index'
      ? incompatibleParallelLaneActionIds(lane, terminal.index, choices)
      : []
    if (incompatible.length > 0) {
      const target = terminal.kind === 'terminal_index'
        ? parallelTerminalChoiceForIndex(terminal.index, choices)
        : undefined
      editNotice = 'Lane terminal change blocked; incompatible actions for '
        + (target?.label ?? 'terminal') + ': ' + incompatible.join(', ')
      return false
    }
    editNotice = ''
    let result = failedCommand()
    options.updateDraft((template) => {
      result = setParallelLaneTerminal(
        template,
        options.nodeId(),
        laneId,
        terminal,
        choices,
        options.adoptTerminalSelection,
      )
    })
    return result.ok
  }

  function unavailableLaneTerminalValues(laneId: string): string[] {
    return unavailableParallelLaneTerminalValues(
      parallelNode(),
      laneId,
      options.terminalChoices(),
      options.choiceFromIndex,
    )
  }

  function addAction(laneId: string, type: LaneActionType, insertionIndex?: number): boolean {
    let result = failedCommand()
    options.updateDraft((template) => {
      result = addParallelLaneAction(
        template,
        options.nodeId(),
        laneId,
        type,
        options.terminalChoices(),
        insertionIndex,
      )
      if (!result.ok) return
      options.setSelectedLaneId(laneId)
      editNotice = ''
    })
    return result.ok
  }

  function removeAction(laneId: string, actionId: string): void {
    options.updateDraft((template) => {
      const node = findParallel(template.body, options.nodeId())
      const lane = node ? findParallelLane(node, laneId) : undefined
      if (!lane || !findParallelLaneAction(lane, actionId)) return
      if (!confirm('Remove parallel lane action ' + actionId + '?')) return
      const result = removeParallelLaneAction(template, options.nodeId(), laneId, actionId)
      if (result.ok) {
        collapsedLaneActionIds = collapsedLaneActionIds.filter((id) => id !== actionId)
      }
    })
  }

  function moveAction(laneId: string, actionId: string, offset: -1 | 1): void {
    options.updateDraft((template) => {
      moveParallelLaneAction(template, options.nodeId(), laneId, actionId, offset)
    })
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

function failedCommand(): ParallelLaneCommandResult {
  return { ok: false, reason: 'parallel_not_found' }
}
