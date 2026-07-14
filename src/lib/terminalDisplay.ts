import type { TerminalSnapshot } from './protocol'

export type TerminalDisplaySource = Pick<TerminalSnapshot, 'terminalIndex' | 'terminalId' | 'cwd' | 'backend' | 'status'>

export function terminalDisplayLabel(terminal: TerminalDisplaySource): string {
  return [
    String(terminal.terminalIndex),
    terminal.terminalId,
    ...(terminal.cwd === null ? [] : [terminal.cwd]),
    terminal.backend,
    terminal.status,
  ].join(' · ')
}
