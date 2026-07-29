import type { TerminalRuntimePosition } from '../protocol'
import type {
  FlowV2Node,
  MacroDefinitionV6,
  MacroTerminalLayoutItem,
} from './macroDefinitionTypes'

export type AdoptRuntimeTerminalResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_terminal_index' | 'invalid_macro_layout' | 'runtime_terminal_unavailable' }

export type ProjectRuntimeTerminalLayoutResult =
  | { ok: true; layout: MacroTerminalLayoutItem[] }
  | Exclude<AdoptRuntimeTerminalResult, { ok: true }>

export function referencedTerminalIndexes(definition: MacroDefinitionV6): number[] {
  const indexes = new Set<number>()
  collectNodeTerminalIndexes(definition.body, indexes)
  return [...indexes].sort((left, right) => left - right)
}

export function reconcileVisualTerminalLayout(definition: MacroDefinitionV6): void {
  const lastReferencedIndex = referencedTerminalIndexes(definition).at(-1) ?? 0
  if (definition.terminalLayout.length > lastReferencedIndex) {
    definition.terminalLayout = definition.terminalLayout.slice(0, lastReferencedIndex)
  }
}

export function adoptRuntimeTerminal(
  definition: MacroDefinitionV6,
  terminalIndex: number,
  runtimePositions: TerminalRuntimePosition[] | null,
): AdoptRuntimeTerminalResult {
  const projected = projectRuntimeTerminalLayout(
    definition.terminalLayout,
    terminalIndex,
    runtimePositions,
  )
  if (!projected.ok) return projected
  definition.terminalLayout = projected.layout
  return { ok: true }
}

export function projectRuntimeTerminalLayout(
  currentLayout: MacroTerminalLayoutItem[],
  terminalIndex: number,
  runtimePositions: Array<Pick<TerminalRuntimePosition, 'index' | 'type'>> | null,
): ProjectRuntimeTerminalLayoutResult {
  if (!Number.isInteger(terminalIndex) || terminalIndex < 1) {
    return { ok: false, reason: 'invalid_terminal_index' }
  }
  if (!isContinuousLayout(currentLayout)) {
    return { ok: false, reason: 'invalid_macro_layout' }
  }

  const runtimeByIndex = new Map((runtimePositions ?? []).map((position) => [position.index, position]))
  const selected = runtimeByIndex.get(terminalIndex)
  if (!selected) return { ok: false, reason: 'runtime_terminal_unavailable' }

  const nextLayout = currentLayout.map((item) => ({ ...item }))
  for (let index = nextLayout.length + 1; index <= terminalIndex; index += 1) {
    const runtime = runtimeByIndex.get(index)
    if (!runtime) return { ok: false, reason: 'runtime_terminal_unavailable' }
    nextLayout.push({ index, type: runtime.type })
  }
  nextLayout[terminalIndex - 1] = { index: terminalIndex, type: selected.type }
  return { ok: true, layout: nextLayout }
}

function collectNodeTerminalIndexes(nodes: FlowV2Node[], indexes: Set<number>): void {
  for (const node of nodes) {
    if (node.type === 'send' || node.type === 'input') addAssignedIndex(node.terminal, indexes)
    if (node.type === 'wait' && node.mode === 'terminal-quiet') addAssignedIndex(node.terminal, indexes)
    if (node.type === 'capture-source') addAssignedIndex(node.capture.terminal, indexes)
    if (node.type === 'parallel') {
      for (const lane of node.lanes) collectParallelLaneTerminalIndexes(lane.body, indexes)
    }
    if (node.type === 'if') {
      for (const branch of node.branches) collectNodeTerminalIndexes(branch.body, indexes)
      if (node.else) collectNodeTerminalIndexes(node.else, indexes)
    }
    if (node.type === 'for') collectNodeTerminalIndexes(node.body, indexes)
    if ((node.type === 'break' || node.type === 'continue' || node.type === 'finish') && node.body) {
      collectNodeTerminalIndexes(node.body, indexes)
    }
  }
}

function collectParallelLaneTerminalIndexes(
  actions: Extract<FlowV2Node, { type: 'parallel' }>['lanes'][number]['body'],
  indexes: Set<number>,
): void {
  for (const action of actions) {
    if (action.type === 'send') addAssignedIndex(action.terminal, indexes)
    if (action.type === 'wait' && action.mode === 'terminal-quiet') addAssignedIndex(action.terminal, indexes)
    if (action.type === 'capture-source') addAssignedIndex(action.capture.terminal, indexes)
  }
}

function addAssignedIndex(reference: { kind: 'terminal_index'; index: number } | { kind: 'unassigned' }, indexes: Set<number>): void {
  if (reference.kind === 'terminal_index') indexes.add(reference.index)
}

function isContinuousLayout(layout: MacroTerminalLayoutItem[]): boolean {
  return layout.every((item, offset) => (
    item.index === offset + 1
    && (item.type === 'shell' || item.type === 'text')
  ))
}
