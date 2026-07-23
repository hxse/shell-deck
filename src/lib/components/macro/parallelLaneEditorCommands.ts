import type {
  MacroDefinitionV5,
  MacroTerminalReference,
  ParallelLane,
} from '../../macro/macroDefinitionTypes'
import {
  parallelOutputSourceFromKey,
} from '../../macro/macroArtifactChoices'
import {
  defaultParallelLane,
  defaultParallelLaneAction,
  nextParallelLaneId,
} from '../../macro/macroEditorDefaults'
import type { TerminalChoice } from '../../macro/macroTerminalChoices'
import {
  duplicateMacroNodeId,
  duplicateParallelLaneId,
  duplicateParallelLaneLabel,
  findParallel,
  findParallelLane,
  findParallelLaneAction,
  findParallelLaneOutput,
  incompatibleParallelLaneActionIds,
  parallelLaneCaptureKinds,
  parallelLaneOutput,
  parallelLaneOutputIndex,
  parallelLaneOutputSourceChoices,
  parallelTerminalChoiceForIndex,
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
  | 'output_not_found'
  | 'artifact_source_unavailable'
  | 'incompatible_lane_actions'
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
  | {
      ok: false
      reason: ParallelLaneCommandFailureReason
      incompatibleActionIds?: string[]
      targetLabel?: string
    }

export function renameParallelLane(
  draft: MacroDefinitionV5,
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
  draft: MacroDefinitionV5,
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
  draft: MacroDefinitionV5,
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

export function renameParallelLaneOutput(
  draft: MacroDefinitionV5,
  nodeId: string,
  laneId: string,
  outputId: string,
  nextId: string,
): ParallelLaneCommandResult {
  if (duplicateMacroNodeId(draft, outputId, nextId)) {
    return { ok: false, reason: 'duplicate_node_id' }
  }
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const output = findParallelLaneOutput(lane.value, outputId)
  if (!output) return { ok: false, reason: 'output_not_found' }
  output.id = nextId
  return { ok: true, renamed: { from: outputId, to: nextId } }
}

export function setParallelLaneCollectsText(
  draft: MacroDefinitionV5,
  nodeId: string,
  laneId: string,
  enabled: boolean,
): ParallelLaneCommandResult {
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const output = parallelLaneOutput(lane.value)
  if (!output) return { ok: false, reason: 'output_not_found' }
  if (!enabled) {
    output.source = { kind: 'none' }
    return { ok: true }
  }
  const source = parallelLaneOutputSourceChoices(lane.value, output.id).at(-1)?.source
  if (!source) return { ok: false, reason: 'artifact_source_unavailable' }
  output.source = { ...source }
  return { ok: true }
}

export function setParallelLaneOutputSource(
  draft: MacroDefinitionV5,
  nodeId: string,
  laneId: string,
  outputId: string,
  value: string,
): ParallelLaneCommandResult {
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const output = findParallelLaneOutput(lane.value, outputId)
  if (!output) return { ok: false, reason: 'output_not_found' }
  output.source = parallelOutputSourceFromKey(value)
  return { ok: true }
}

export function addParallelLane(
  draft: MacroDefinitionV5,
  nodeId: string,
): ParallelLaneCommandResult {
  const node = findParallel(draft.body, nodeId)
  if (!node) return { ok: false, reason: 'parallel_not_found' }
  const lane = defaultParallelLane(
    draft,
    nextParallelLaneId(node.lanes),
    { kind: 'unassigned' },
    node.lanes.map((item) => item.id),
  )
  node.lanes.push(lane)
  return { ok: true, addedLaneId: lane.id }
}

export function removeParallelLane(
  draft: MacroDefinitionV5,
  nodeId: string,
  laneId: string,
): ParallelLaneCommandResult {
  const node = findParallel(draft.body, nodeId)
  if (!node) return { ok: false, reason: 'parallel_not_found' }
  const lane = findParallelLane(node, laneId)
  if (!lane) return { ok: false, reason: 'lane_not_found' }
  if (node.lanes.length <= 1) return { ok: false, reason: 'last_lane' }
  const removedActionIds = lane.body
    .filter((item) => item.type !== 'output')
    .map((item) => item.id)
  node.lanes = node.lanes.filter((candidate) => candidate.id !== laneId)
  return { ok: true, removedLaneId: laneId, removedActionIds }
}

export function setParallelLaneTerminal(
  draft: MacroDefinitionV5,
  nodeId: string,
  laneId: string,
  terminal: MacroTerminalReference,
  choices: TerminalChoice[],
  adoptTerminalSelection: (draft: MacroDefinitionV5, terminalIndex: number) => boolean,
): ParallelLaneCommandResult {
  if (terminal.kind === 'terminal_index'
    && !adoptTerminalSelection(draft, terminal.index)) {
    return { ok: false, reason: 'terminal_adoption_failed' }
  }
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const incompatibleActionIds = terminal.kind === 'terminal_index'
    ? incompatibleParallelLaneActionIds(lane.value, terminal.index, choices)
    : []
  if (incompatibleActionIds.length > 0) {
    const target = terminal.kind === 'terminal_index'
      ? parallelTerminalChoiceForIndex(terminal.index, choices)
      : undefined
    return {
      ok: false,
      reason: 'incompatible_lane_actions',
      incompatibleActionIds,
      targetLabel: target?.label,
    }
  }
  lane.value.terminal = terminal
  return { ok: true }
}

export function addParallelLaneAction(
  draft: MacroDefinitionV5,
  nodeId: string,
  laneId: string,
  type: LaneActionType,
  choices: TerminalChoice[],
  insertionIndex?: number,
): ParallelLaneCommandResult {
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const output = parallelLaneOutputIndex(lane.value)
  const maxIndex = output < 0 ? lane.value.body.length : output
  const targetIndex = Math.max(0, Math.min(insertionIndex ?? maxIndex, maxIndex))
  const captureKind = parallelLaneCaptureKinds(lane.value, choices)[0] ?? 'terminal-buffer'
  const action = defaultParallelLaneAction(draft, type, captureKind)
  lane.value.body.splice(targetIndex, 0, action)
  return { ok: true, addedActionId: action.id }
}

export function removeParallelLaneAction(
  draft: MacroDefinitionV5,
  nodeId: string,
  laneId: string,
  actionId: string,
): ParallelLaneCommandResult {
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const index = lane.value.body.findIndex((item) => item.id === actionId)
  if (index < 0 || lane.value.body[index]?.type === 'output') {
    return { ok: false, reason: 'action_not_found' }
  }
  lane.value.body.splice(index, 1)
  return { ok: true, removedActionIds: [actionId] }
}

export function moveParallelLaneAction(
  draft: MacroDefinitionV5,
  nodeId: string,
  laneId: string,
  actionId: string,
  offset: -1 | 1,
): ParallelLaneCommandResult {
  const lane = laneFor(draft, nodeId, laneId)
  if (!lane.ok) return lane
  const index = lane.value.body.findIndex((item) => item.id === actionId)
  if (index < 0 || lane.value.body[index]?.type === 'output') {
    return { ok: false, reason: 'action_not_found' }
  }
  const output = parallelLaneOutputIndex(lane.value)
  const target = index + offset
  if (target < 0 || target >= (output < 0 ? lane.value.body.length : output)) {
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
  draft: MacroDefinitionV5,
  nodeId: string,
  laneId: string,
): LaneLookup {
  const node = findParallel(draft.body, nodeId)
  if (!node) return { ok: false, reason: 'parallel_not_found' }
  const lane = findParallelLane(node, laneId)
  return lane ? { ok: true, value: lane } : { ok: false, reason: 'lane_not_found' }
}
