export const TERMINAL_ENDINGS = ['none', 'lf', 'cr', 'crlf'] as const

export type TerminalEnding = (typeof TERMINAL_ENDINGS)[number]

const TERMINAL_ENDING_SET = new Set<string>(TERMINAL_ENDINGS)
const TERMINAL_ENDING_SEQUENCES: Record<TerminalEnding, string> = {
  none: '',
  lf: '\n',
  cr: '\r',
  crlf: '\r\n',
}

export function isTerminalEnding(value: unknown): value is TerminalEnding {
  return typeof value === 'string' && TERMINAL_ENDING_SET.has(value)
}

export function terminalEndingSequence(ending: TerminalEnding): string {
  if (!isTerminalEnding(ending)) throw new Error('unsupported_terminal_ending:' + String(ending))
  return TERMINAL_ENDING_SEQUENCES[ending]
}
