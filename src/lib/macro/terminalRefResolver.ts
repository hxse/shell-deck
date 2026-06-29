import type { TerminalIndexMapItem } from '../protocol'
import type { TerminalTarget } from './templateTypes'

export type ResolvedTerminalRef = {
  terminalId: string
  terminalAlias: string
  terminalIndex: number
  ref: TerminalTarget
}

export function resolveTerminalTargetInConfig(ref: TerminalTarget, indexMap: TerminalIndexMapItem[]): ResolvedTerminalRef {
  const found = ref.kind === 'id'
    ? indexMap.find((item) => item.terminalId === ref.value)
    : ref.kind === 'alias'
      ? indexMap.find((item) => item.terminalAlias === ref.value)
      : indexMap.find((item) => item.index === ref.value)
  if (!found) throw new Error('terminal_ref_not_found:' + ref.kind + ':' + ref.value)
  return {
    terminalId: found.terminalId,
    terminalAlias: found.terminalAlias,
    terminalIndex: found.index,
    ref,
  }
}
