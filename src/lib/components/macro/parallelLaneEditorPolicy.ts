import type {
  CaptureSourceConfig,
  FlowV2Node,
  MacroDefinitionV6,
  MacroTerminalReference,
  ParallelLane,
  ParallelLaneActionNode,
  ParallelNode,
} from '../../macro/macroDefinitionTypes'
import { allMacroNodeIds } from '../../macro/macroEditorDefaults'
import { projectRuntimeTerminalLayout } from '../../macro/macroTerminalLayoutAuthoring'
import {
  buildParallelTerminalUsage,
  canParallelActionUseTerminal,
  parallelActionTerminalReference,
  type ParallelTerminalUsage,
  type ParallelTerminalUsageIndex,
} from '../../macro/parallelTerminalUsage'
import {
  isCaptureKindAllowed,
  terminalChoiceForIndex,
  type CapabilityCaptureKind,
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
  { type: 'notify', label: 'notify', testId: 'parallel-add-notify' },
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
  return lane.body.find((item) => item.id === actionId)
}

export function selectedParallelLane(
  node: ParallelNode | undefined,
  selectedLaneId: string,
): ParallelLane | undefined {
  return node?.lanes.find((lane) => lane.id === selectedLaneId) ?? node?.lanes[0]
}

export function expectedParallelTerminalTypeAt(
  definition: MacroDefinitionV6,
  terminal: MacroTerminalReference,
): 'shell' | 'text' | undefined {
  return terminal.kind === 'terminal_index'
    ? definition.terminalLayout[terminal.index - 1]?.type
    : undefined
}

export function parallelLaneActionPaletteItems(): LaneActionPaletteItem[] {
  return LANE_ACTION_PALETTE_ITEMS
}

export function parallelActionTerminalChoices(
  action: ParallelLaneActionNode,
  choices: TerminalChoice[],
): TerminalChoice[] {
  if (action.type === 'wait') {
    return action.mode === 'terminal-quiet'
      ? choices.filter((choice) => choice.capabilities.canWaitQuiet)
      : []
  }
  if (action.type === 'capture-source') {
    return choices.filter((choice) => isCaptureKindAllowed(choice.capabilities, action.capture.kind))
  }
  return action.type === 'send' ? choices : []
}

export function parallelActionCaptureKinds(
  action: Extract<ParallelLaneActionNode, { type: 'capture-source' }>,
  choices: TerminalChoice[],
): Exclude<CaptureSourceConfig['kind'], 'structured-json'>[] {
  const terminal = action.capture.terminal
  const kinds: CapabilityCaptureKind[] = terminal.kind === 'terminal_index'
    ? terminalChoiceForIndex(terminal.index, choices)?.capabilities.captureKinds
      ?? ['terminal-buffer', 'agent-event', 'text-box']
    : ['terminal-buffer', 'agent-event', 'text-box']
  return kinds.filter((kind): kind is Exclude<CaptureSourceConfig['kind'], 'structured-json'> => (
    kind !== 'structured-json'
  ))
}

export function parallelActionCaptureAllowed(
  action: Extract<ParallelLaneActionNode, { type: 'capture-source' }>,
  choices: TerminalChoice[],
): boolean {
  const terminal = action.capture.terminal
  if (terminal.kind !== 'terminal_index') return true
  const choice = terminalChoiceForIndex(terminal.index, choices)
  return choice ? isCaptureKindAllowed(choice.capabilities, action.capture.kind) : true
}

export function unavailableParallelActionTerminalValues(
  definition: MacroDefinitionV6,
  node: ParallelNode,
  laneId: string,
  action: ParallelLaneActionNode,
  choices: TerminalChoice[],
  usageIndex = buildParallelTerminalUsage(node, definition.terminalLayout),
): string[] {
  const compatible = new Set(parallelActionTerminalChoices(action, choices).map((choice) => choice.value))
  return choices
    .filter((choice) => (
      compatible.has(choice.value)
      && !candidateTerminalAllowed(
        definition,
        node,
        laneId,
        action,
        choice,
        choices,
        usageIndex,
      )
    ))
    .map((choice) => choice.value)
}

function candidateTerminalAllowed(
  definition: MacroDefinitionV6,
  node: ParallelNode,
  laneId: string,
  action: ParallelLaneActionNode,
  choice: TerminalChoice,
  choices: TerminalChoice[],
  usageIndex: ParallelTerminalUsageIndex,
): boolean {
  const projected = projectRuntimeTerminalLayout(
    definition.terminalLayout,
    choice.index,
    choices,
  )
  return projected.ok && canParallelActionUseTerminal(
    node,
    projected.layout,
    laneId,
    action,
    choice.index,
    usageIndex,
  )
}

export function parallelActionUsage(
  definition: MacroDefinitionV6,
  node: ParallelNode,
  action: ParallelLaneActionNode,
  usageIndex = buildParallelTerminalUsage(node, definition.terminalLayout),
): ParallelTerminalUsage | undefined {
  if (!parallelActionTerminalReference(action)) return undefined
  return usageIndex.byActionId.get(action.id)
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
  definition: MacroDefinitionV6,
  currentId: string,
  nextId: string,
): boolean {
  return nextId !== currentId && allMacroNodeIds(definition.body).includes(nextId)
}
