import type {
  MacroDefinitionV6,
  MacroTerminalReference,
  ParallelLane,
} from '../../macro/macroDefinitionTypes'
import {
  defaultParallelLane,
  defaultParallelLaneAction,
  nextParallelLaneId,
} from '../../macro/macroEditorDefaults'
import {
  duplicateMacroNodeId,
  duplicateParallelLaneId,
  duplicateParallelLaneLabel,
  findParallel,
  findParallelLane,
  findParallelLaneAction,
  type LaneActionType,
} from './parallelLaneEditorPolicy'

export type ParallelLaneCommandFailureReason =
  | 'parallel_not_found'
  | 'lane_not_found'
  | 'last_lane'
  | 'duplicate_lane_id'
  | 'duplicate_lane_label'
  | 'duplicate_node_id'
  | 'action_not_found'
  | 'action_has_no_terminal'
  | 'terminal_adoption_failed'
  | 'move_out_of_range'

export type ParallelLaneCommandResult =
  | {
      ok: true
      addedLaneId?: string
      addedActionId?: string
      renamed?: { from: string; to: string }
      removedLaneId?: string
      removedActionIds?: string[]
    }
  | { ok: false; reason: ParallelLaneCommandFailureReason }

export function renameParallelLane(
  draft: MacroDefinitionV6,
  nodeId: string,
  laneId: string,
  nextId: string,
): ParallelLaneCommandResult {
  const node = findParallel(draft.body, nodeId)
  if (!node) return { ok: false, reason: 'parallel_not_found' }
  const lane = findParallelLane(node, laneId)
  if (!lane) return { ok: false, reason: 'lane_not_found' }
  if (duplicateParallelLaneId(node, laneId, nextId)) {
    return { ok: false, reason: 'duplicate_lane_id' }
  }
  lane.id = nextId
  return { ok: true, renamed: { from: laneId, to: nextId } }
}

export function setParallelLaneLabel(
  draft: MacroDefinitionV6,
  nodeId: string,
  laneId: string,
  nextLabel: string,
): ParallelLaneCommandResult {
  const node = findParallel(draft.body, nodeId)
  if (!node) return { ok: false, reason: 'parallel_not_found' }
  const lane = findParallelLane(node, laneId)
  if (!lane) return { ok: false, reason: 'lane_not_found' }
  if (duplicateParallelLaneLabel(node, laneId, nextLabel)) {
    return { ok: false, reason: 'duplicate_lane_label' }
  }
  lane.label = nextLabel
  return { ok: true }
}

export function renameParallelLaneAction(
  draft: MacroDefinitionV6,
  nodeId: string,
  laneId: string,
  actionId: string,
  nextId: string,
): ParallelLaneCommandResult {
  if (duplicateMacroNodeId(draft, actionId, nextId)) {
    return { ok: false, reason: 'duplicate_node_id' }
  }
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const action = findParallelLaneAction(lane.value, actionId)
  if (!action) return { ok: false, reason: 'action_not_found' }
  action.id = nextId
  return { ok: true, renamed: { from: actionId, to: nextId } }
}

export function addParallelLane(
  draft: MacroDefinitionV6,
  nodeId: string,
): ParallelLaneCommandResult {
  const node = findParallel(draft.body, nodeId)
  if (!node) return { ok: false, reason: 'parallel_not_found' }
  const lane = defaultParallelLane(
    nextParallelLaneId(node.lanes),
    node.lanes.map((item) => item.id),
  )
  node.lanes.push(lane)
  return { ok: true, addedLaneId: lane.id }
}

export function removeParallelLane(
  draft: MacroDefinitionV6,
  nodeId: string,
  laneId: string,
): ParallelLaneCommandResult {
  const node = findParallel(draft.body, nodeId)
  if (!node) return { ok: false, reason: 'parallel_not_found' }
  const lane = findParallelLane(node, laneId)
  if (!lane) return { ok: false, reason: 'lane_not_found' }
  if (node.lanes.length <= 1) return { ok: false, reason: 'last_lane' }
  const removedActionIds = lane.body.map((item) => item.id)
  node.lanes = node.lanes.filter((candidate) => candidate.id !== laneId)
  return { ok: true, removedLaneId: laneId, removedActionIds }
}

export function setParallelActionTerminal(
  draft: MacroDefinitionV6,
  nodeId: string,
  laneId: string,
  actionId: string,
  terminal: MacroTerminalReference,
  adoptTerminalSelection: (draft: MacroDefinitionV6, terminalIndex: number) => boolean,
): ParallelLaneCommandResult {
  if (terminal.kind === 'terminal_index'
    && !adoptTerminalSelection(draft, terminal.index)) {
    return { ok: false, reason: 'terminal_adoption_failed' }
  }
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const action = findParallelLaneAction(lane.value, actionId)
  if (!action) return { ok: false, reason: 'action_not_found' }
  if (action.type === 'send') action.terminal = terminal
  else if (action.type === 'wait' && action.mode === 'terminal-quiet') action.terminal = terminal
  else if (action.type === 'capture-source') action.capture = { ...action.capture, terminal }
  else return { ok: false, reason: 'action_has_no_terminal' }
  return { ok: true }
}

export function addParallelLaneAction(
  draft: MacroDefinitionV6,
  nodeId: string,
  laneId: string,
  type: LaneActionType,
  insertionIndex?: number,
): ParallelLaneCommandResult {
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const targetIndex = Math.max(0, Math.min(insertionIndex ?? lane.value.body.length, lane.value.body.length))
  const action = defaultParallelLaneAction(draft, type)
  lane.value.body.splice(targetIndex, 0, action)
  return { ok: true, addedActionId: action.id }
}

export function removeParallelLaneAction(
  draft: MacroDefinitionV6,
  nodeId: string,
  laneId: string,
  actionId: string,
): ParallelLaneCommandResult {
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const index = lane.value.body.findIndex((item) => item.id === actionId)
  if (index < 0) return { ok: false, reason: 'action_not_found' }
  lane.value.body.splice(index, 1)
  return { ok: true, removedActionIds: [actionId] }
}

export function moveParallelLaneAction(
  draft: MacroDefinitionV6,
  nodeId: string,
  laneId: string,
  actionId: string,
  offset: -1 | 1,
): ParallelLaneCommandResult {
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const index = lane.value.body.findIndex((item) => item.id === actionId)
  if (index < 0) return { ok: false, reason: 'action_not_found' }
  const target = index + offset
  if (target < 0 || target >= lane.value.body.length) {
    return { ok: false, reason: 'move_out_of_range' }
  }
  const [item] = lane.value.body.splice(index, 1)
  lane.value.body.splice(target, 0, item)
  return { ok: true }
}

type LaneLookup =
  | { ok: true; value: ParallelLane }
  | { ok: false; reason: 'parallel_not_found' | 'lane_not_found' }

function laneFor(
  draft: MacroDefinitionV6,
  nodeId: string,
  laneId: string,
): LaneLookup {
  const node = findParallel(draft.body, nodeId)
  if (!node) return { ok: false, reason: 'parallel_not_found' }
  const lane = findParallelLane(node, laneId)
  return lane ? { ok: true, value: lane } : { ok: false, reason: 'lane_not_found' }
}
