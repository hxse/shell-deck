import type {
  FlowV2Node,
  MacroDefinitionV5,
  MacroTerminalReference,
  ParallelLane,
  ParallelLaneActionNode,
  ParallelCaptureSourceConfig,
  ParallelLaneOutputNode,
  ParallelNode,
} from '../../macro/macroDefinitionTypes'
import {
  laneArtifactChoices,
  textArtifactChoices,
  type TextArtifactChoice,
} from '../../macro/macroArtifactChoices'
import { allMacroNodeIds } from '../../macro/macroEditorDefaults'
import {
  isCaptureKindAllowed,
  terminalChoiceForIndex,
  type TerminalChoice,
} from '../../macro/macroTerminalChoices'

export type LaneActionType = ParallelLaneActionNode['type']
export type LaneActionPaletteItem = {
  type: LaneActionType
  label: string
  testId: string
}

const LANE_ACTION_PALETTE_ITEMS: LaneActionPaletteItem[] = [
  { type: 'send', label: 'send', testId: 'parallel-add-send' },
  { type: 'wait', label: 'wait', testId: 'parallel-add-wait' },
  { type: 'capture-source', label: 'capture', testId: 'parallel-add-capture' },
  { type: 'extract_text', label: 'extract', testId: 'parallel-add-extract' },
]

export function findParallel(nodes: FlowV2Node[], id: string): ParallelNode | undefined {
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

export function findParallelLane(node: ParallelNode, laneId: string): ParallelLane | undefined {
  return node.lanes.find((lane) => lane.id === laneId)
}

export function findParallelLaneAction(
  lane: ParallelLane,
  actionId: string,
): ParallelLaneActionNode | undefined {
  return lane.body.find((item): item is ParallelLaneActionNode => (
    item.id === actionId && item.type !== 'output'
  ))
}

export function findParallelLaneOutput(
  lane: ParallelLane,
  outputId: string,
): ParallelLaneOutputNode | undefined {
  return lane.body.find((item): item is ParallelLaneOutputNode => (
    item.id === outputId && item.type === 'output'
  ))
}

export function parallelLaneOutput(lane: ParallelLane): ParallelLaneOutputNode | undefined {
  return lane.body.find((item): item is ParallelLaneOutputNode => item.type === 'output')
}

export function parallelLaneOutputIndex(lane: ParallelLane): number {
  return lane.body.findIndex((item) => item.type === 'output')
}

export function selectedParallelLane(
  node: ParallelNode | undefined,
  selectedLaneId: string,
): ParallelLane | undefined {
  return node?.lanes.find((lane) => lane.id === selectedLaneId) ?? node?.lanes[0]
}

export function parallelCollectsAnyLaneText(node: ParallelNode | undefined): boolean {
  return Boolean(node?.lanes.some((lane) => parallelLaneOutput(lane)?.source.kind !== 'none'))
}

export function expectedParallelTerminalTypeAt(
  definition: MacroDefinitionV5,
  terminal: MacroTerminalReference,
): 'shell' | 'text' | undefined {
  return terminal.kind === 'terminal_index'
    ? definition.terminalLayout[terminal.index - 1]?.type
    : undefined
}

export function parallelLaneTerminalChoice(
  lane: ParallelLane,
  choices: TerminalChoice[],
): TerminalChoice | undefined {
  return lane.terminal.kind === 'terminal_index'
    ? parallelTerminalChoiceForIndex(lane.terminal.index, choices)
    : undefined
}

export function parallelTerminalChoiceForIndex(
  target: number,
  choices: TerminalChoice[],
): TerminalChoice | undefined {
  return terminalChoiceForIndex(target, choices)
}

export function parallelLaneActionPaletteItems(
  lane: ParallelLane,
  choices: TerminalChoice[],
): LaneActionPaletteItem[] {
  const capabilities = parallelLaneTerminalChoice(lane, choices)?.capabilities
  return LANE_ACTION_PALETTE_ITEMS.filter((item) => (
    !capabilities || item.type !== 'wait' || capabilities.canWaitQuiet
  ))
}

export function parallelLaneCaptureKinds(
  lane: ParallelLane,
  choices: TerminalChoice[],
): ParallelCaptureSourceConfig['kind'][] {
  return (
    parallelLaneTerminalChoice(lane, choices)?.capabilities.captureKinds
    ?? ['terminal-buffer', 'agent-event', 'text-box']
  ).filter((kind): kind is ParallelCaptureSourceConfig['kind'] => kind !== 'structured-json')
}

export function parallelLaneCaptureAllowed(
  lane: ParallelLane,
  action: Extract<ParallelLaneActionNode, { type: 'capture-source' }>,
  choices: TerminalChoice[],
): boolean {
  const choice = parallelLaneTerminalChoice(lane, choices)
  return choice ? isCaptureKindAllowed(choice.capabilities, action.capture.kind) : true
}

export function incompatibleParallelLaneActionIds(
  lane: ParallelLane,
  target: number,
  choices: TerminalChoice[],
): string[] {
  const targetChoice = parallelTerminalChoiceForIndex(target, choices)
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

export function unavailableParallelLaneTerminalValues(
  node: ParallelNode | undefined,
  laneId: string,
  choices: TerminalChoice[],
  choiceFromIndex: (target: number) => string,
): string[] {
  if (!node) return []
  return choices
    .filter((choice) => node.lanes.some((lane) => (
      lane.id !== laneId
      && lane.terminal.kind === 'terminal_index'
      && choiceFromIndex(lane.terminal.index) === choice.value
    )))
    .map((choice) => choice.value)
}

export function parallelLaneOutputSourceChoices(
  lane: ParallelLane,
  outputId: string,
): TextArtifactChoice[] {
  return textArtifactChoices(laneArtifactChoices(lane, outputId))
}

export function duplicateParallelLaneId(
  node: ParallelNode,
  laneId: string,
  nextId: string,
): boolean {
  return nextId !== laneId && node.lanes.some((lane) => lane.id === nextId)
}

export function duplicateParallelLaneLabel(
  node: ParallelNode,
  laneId: string,
  nextLabel: string,
): string | undefined {
  const normalized = nextLabel.trim()
  return normalized
    && node.lanes.some((lane) => lane.id !== laneId && lane.label.trim() === normalized)
    ? normalized
    : undefined
}

export function duplicateMacroNodeId(
  definition: MacroDefinitionV5,
  currentId: string,
  nextId: string,
): boolean {
  return nextId !== currentId && allMacroNodeIds(definition.body).includes(nextId)
}
