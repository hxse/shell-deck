import type { MacroTerminalLayoutItem } from './macroDefinitionTypes'
import type { TerminalRuntimePosition } from '../protocol'

export type MacroTerminalDiagnostic = {
  index: number
  expectedType: 'shell' | 'text'
  actual: TerminalRuntimePosition | null
  status: 'ready' | 'missing' | 'type-mismatch' | 'not-ready'
}
export type MacroRuntimeBindingValidation =
  | { status: 'checking'; code: 'macro_terminal_checking'; diagnostics: MacroTerminalDiagnostic[] }
  | { status: 'mismatch'; code: 'macro_terminal_layout_mismatch'; diagnostics: MacroTerminalDiagnostic[] }
  | { status: 'not-ready'; code: 'macro_terminal_not_ready'; diagnostics: MacroTerminalDiagnostic[] }
  | { status: 'ready'; code: 'macro_terminal_ready'; diagnostics: MacroTerminalDiagnostic[] }

export function validateMacroRuntimeBinding(
  terminalLayout: MacroTerminalLayoutItem[],
  positions: TerminalRuntimePosition[] | null,
): MacroRuntimeBindingValidation {
  if (positions === null) return { status: 'checking', code: 'macro_terminal_checking', diagnostics: [] }
  const diagnostics = terminalLayout.map((required): MacroTerminalDiagnostic => {
    const actual = positions[required.index - 1] ?? null
    if (!actual) return { index: required.index, expectedType: required.type, actual, status: 'missing' }
    if (actual.index !== required.index || actual.type !== required.type) return { index: required.index, expectedType: required.type, actual, status: 'type-mismatch' }
    if (actual.readiness !== 'ready') return { index: required.index, expectedType: required.type, actual, status: 'not-ready' }
    return { index: required.index, expectedType: required.type, actual, status: 'ready' }
  })
  if (diagnostics.some((item) => item.status === 'missing' || item.status === 'type-mismatch')) {
    return { status: 'mismatch', code: 'macro_terminal_layout_mismatch', diagnostics }
  }
  if (diagnostics.some((item) => item.status === 'not-ready')) return { status: 'not-ready', code: 'macro_terminal_not_ready', diagnostics }
  return { status: 'ready', code: 'macro_terminal_ready', diagnostics }
}
