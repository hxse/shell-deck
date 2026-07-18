import type { TerminalRuntimePosition } from '../protocol'
import type {
  FlowV2Node,
  MacroDefinitionV4,
  MacroTerminalLayoutItem,
} from './macroDefinitionTypes'

export type AdoptRuntimeTerminalResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_terminal_index' | 'invalid_macro_layout' | 'runtime_terminal_unavailable' }

export function referencedTerminalIndexes(definition: MacroDefinitionV4): number[] {
  const indexes = new Set<number>()
  collectNodeTerminalIndexes(definition.body, indexes)
  return [...indexes].sort((left, right) => left - right)
}

export function reconcileVisualTerminalLayout(definition: MacroDefinitionV4): void {
  const lastReferencedIndex = referencedTerminalIndexes(definition).at(-1) ?? 0
  if (definition.terminalLayout.length > lastReferencedIndex) {
    definition.terminalLayout = definition.terminalLayout.slice(0, lastReferencedIndex)
  }
}

export function adoptRuntimeTerminal(
  definition: MacroDefinitionV4,
  terminalIndex: number,
  runtimePositions: TerminalRuntimePosition[] | null,
): AdoptRuntimeTerminalResult {
  if (!Number.isInteger(terminalIndex) || terminalIndex < 1) {
    return { ok: false, reason: 'invalid_terminal_index' }
  }
  if (!isContinuousLayout(definition.terminalLayout)) {
    return { ok: false, reason: 'invalid_macro_layout' }
  }

  const runtimeByIndex = new Map((runtimePositions ?? []).map((position) => [position.index, position]))
  const selected = runtimeByIndex.get(terminalIndex)
  if (!selected) return { ok: false, reason: 'runtime_terminal_unavailable' }

  const nextLayout = definition.terminalLayout.map((item) => ({ ...item }))
  for (let index = nextLayout.length + 1; index <= terminalIndex; index += 1) {
    const runtime = runtimeByIndex.get(index)
    if (!runtime) return { ok: false, reason: 'runtime_terminal_unavailable' }
    nextLayout.push({ index, type: runtime.type })
  }
  nextLayout[terminalIndex - 1] = { index: terminalIndex, type: selected.type }
  definition.terminalLayout = nextLayout
  return { ok: true }
}

function collectNodeTerminalIndexes(nodes: FlowV2Node[], indexes: Set<number>): void {
  for (const node of nodes) {
    if (node.type === 'send' || node.type === 'input') addAssignedIndex(node.terminal, indexes)
    if (node.type === 'wait' && node.mode === 'terminal-quiet') addAssignedIndex(node.terminal, indexes)
    if (node.type === 'capture-source') addAssignedIndex(node.capture.terminal, indexes)
    if (node.type === 'parallel') {
      for (const lane of node.lanes) addAssignedIndex(lane.terminal, indexes)
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

function addAssignedIndex(reference: { kind: 'terminal_index'; index: number } | { kind: 'unassigned' }, indexes: Set<number>): void {
  if (reference.kind === 'terminal_index') indexes.add(reference.index)
}

function isContinuousLayout(layout: MacroTerminalLayoutItem[]): boolean {
  return layout.every((item, offset) => (
    item.index === offset + 1
    && (item.type === 'shell' || item.type === 'text')
  ))
}
