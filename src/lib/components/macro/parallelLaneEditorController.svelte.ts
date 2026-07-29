import type {
  MacroDefinitionV6,
  MacroTerminalReference,
  ParallelLane,
  ParallelLaneActionNode,
  ParallelNode,
} from '../../macro/macroDefinitionTypes'
import {
  parallelActionTerminalReference,
  type ParallelTerminalUsageIndex,
} from '../../macro/parallelTerminalUsage'
import type { TerminalChoice } from '../../macro/macroTerminalChoices'
import {
  addParallelLane,
  addParallelLaneAction,
  moveParallelLaneAction,
  removeParallelLane,
  removeParallelLaneAction,
  renameParallelLane,
  renameParallelLaneAction,
  setParallelActionTerminal,
  setParallelLaneLabel,
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
  parallelActionCaptureAllowed,
  parallelActionCaptureKinds,
  parallelActionTerminalChoices,
  parallelActionUsage,
  parallelLaneActionPaletteItems,
  selectedParallelLane,
  unavailableParallelActionTerminalValues,
  type LaneActionType,
} from './parallelLaneEditorPolicy'

export type { LaneActionType } from './parallelLaneEditorPolicy'

type ParallelLaneEditorControllerOptions = {
  draft(): MacroDefinitionV6
  nodeId(): string
  selectedLaneId(): string
  setSelectedLaneId(laneId: string): void
  updateDraft(mutator: (template: MacroDefinitionV6) => void): void
  terminalChoices(): TerminalChoice[]
  terminalUsageIndex(): ParallelTerminalUsageIndex | undefined
  adoptTerminalSelection(template: MacroDefinitionV6, terminalIndex: number): boolean
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

  function actionTerminalChoices(action: ParallelLaneActionNode): TerminalChoice[] {
    return parallelActionTerminalChoices(action, options.terminalChoices())
  }

  function actionCaptureKinds(
    action: Extract<ParallelLaneActionNode, { type: 'capture-source' }>,
  ) {
    return parallelActionCaptureKinds(action, options.terminalChoices())
  }

  function actionCaptureAllowed(
    action: Extract<ParallelLaneActionNode, { type: 'capture-source' }>,
  ): boolean {
    return parallelActionCaptureAllowed(action, options.terminalChoices())
  }

  function terminalUsage(action: ParallelLaneActionNode) {
    const node = parallelNode()
    const usage = options.terminalUsageIndex()
    return node && usage ? parallelActionUsage(options.draft(), node, action, usage) : undefined
  }

  function unavailableActionTerminalValues(
    laneId: string,
    action: ParallelLaneActionNode,
  ): string[] {
    const node = parallelNode()
    return node
      ? unavailableParallelActionTerminalValues(
          options.draft(),
          node,
          laneId,
          action,
          options.terminalChoices(),
          options.terminalUsageIndex(),
        )
      : []
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
    let result = failedCommand()
    options.updateDraft((template) => {
      result = renameParallelLaneAction(template, options.nodeId(), laneId, actionId, nextId)
    })
    if (result.ok && collapsedLaneActionIds.includes(actionId)) {
      collapsedLaneActionIds = collapsedLaneActionIds.map((id) => id === actionId ? nextId : id)
    }
    return result.ok
  }

  function isLaneActionCollapsed(actionId: string): boolean {
    return collapsedLaneActionIds.includes(actionId)
  }

  function toggleLaneActionCollapsed(actionId: string): void {
    collapsedLaneActionIds = isLaneActionCollapsed(actionId)
      ? collapsedLaneActionIds.filter((id) => id !== actionId)
      : [...collapsedLaneActionIds, actionId]
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

  function setActionTerminalReference(
    laneId: string,
    actionId: string,
    terminal: MacroTerminalReference,
  ): boolean {
    const node = parallelNode()
    const lane = node ? findParallelLane(node, laneId) : undefined
    const action = lane ? findParallelLaneAction(lane, actionId) : undefined
    if (!node || !action || !parallelActionTerminalReference(action)) return false
    if (terminal.kind === 'terminal_index') {
      const compatible = actionTerminalChoices(action).some((choice) => choice.index === terminal.index)
      const blocked = unavailableActionTerminalValues(laneId, action)
        .some((value) => options.terminalChoices().find((choice) => choice.value === value)?.index === terminal.index)
      if (!compatible || blocked) {
        editNotice = blocked
          ? 'Target is already owned by an incompatible pane action.'
          : 'Target type is incompatible with this action.'
        return false
      }
    }
    editNotice = ''
    let result = failedCommand()
    options.updateDraft((template) => {
      result = setParallelActionTerminal(
        template,
        options.nodeId(),
        laneId,
        actionId,
        terminal,
        options.adoptTerminalSelection,
      )
    })
    return result.ok
  }

  function addAction(laneId: string, type: LaneActionType, insertionIndex?: number): boolean {
    let result = failedCommand()
    options.updateDraft((template) => {
      result = addParallelLaneAction(template, options.nodeId(), laneId, type, insertionIndex)
      if (!result.ok) return
      options.setSelectedLaneId(laneId)
      editNotice = ''
    })
    return result.ok
  }

  function removeAction(laneId: string, actionId: string): void {
    if (!confirm('Remove parallel lane action ' + actionId + '?')) return
    options.updateDraft((template) => {
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
    updateParallel,
    updateLaneAction,
    expectedTerminalTypeAt,
    laneActionPaletteItems: parallelLaneActionPaletteItems,
    actionTerminalChoices,
    actionCaptureKinds,
    actionCaptureAllowed,
    terminalUsage,
    unavailableActionTerminalValues,
    setLaneId,
    setLaneLabel,
    setLaneActionId,
    isLaneActionCollapsed,
    toggleLaneActionCollapsed,
    addLane,
    removeLane,
    setActionTerminalReference,
    addAction,
    removeAction,
    moveAction,
  }
}

function failedCommand(): ParallelLaneCommandResult {
  return { ok: false, reason: 'parallel_not_found' }
}
