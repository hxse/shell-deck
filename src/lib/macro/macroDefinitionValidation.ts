import { cloneJsonValue } from '../jsonClone'
import type { MacroDefinitionV6, MacroTerminalLayoutItem, TerminalType } from './macroDefinitionTypes'
import { parseJson, type InvalidJsonError } from './macroJsonTextParser'
import { validateNodeList } from './macroNodeValidation'
import { validateMacroTerminalLayout } from './macroReferenceValidation'
import {
  MACRO_DEFINITION_ISSUE_CODES,
  add,
  finishIssues,
  type MacroDefinitionIssue,
  type ValidationContext,
} from './macroValidationContext'
import { exactKeys, object, stringValue } from './macroValidationPrimitives'

export { MACRO_DEFINITION_ISSUE_CODES, validateMacroTerminalLayout }
export type {
  MacroDefinitionIssue,
  MacroDefinitionIssueCode,
} from './macroValidationContext'
export type { InvalidJsonError } from './macroJsonTextParser'
export type { MacroTerminalLayoutValidation } from './macroReferenceValidation'

export type MacroDefinitionValidation =
  | { ok: true; value: MacroDefinitionV6 }
  | { ok: false; issues: MacroDefinitionIssue[] }
export type MacroDefinitionDiagnostics = {
  persistable: MacroDefinitionValidation
  runnable: MacroDefinitionValidation
}
export type MacroDefinitionDiagnosticsMetrics = { nodeVisits: number }
export type MacroDefinitionJsonValidation =
  | { ok: true; value: MacroDefinitionV6 }
  | { ok: false; error: InvalidJsonError }
  | { ok: false; error: { code: 'invalid_macro_definition'; issues: MacroDefinitionIssue[] } }
export type MacroTerminalLayoutJsonValidation =
  | { ok: true; value: MacroTerminalLayoutItem[] }
  | { ok: false; error: InvalidJsonError }
  | { ok: false; error: { code: 'invalid_terminal_layout'; issues: MacroDefinitionIssue[] } }

const TOP_LEVEL_KEYS = ['schemaVersion', 'name', 'description', 'terminalLayout', 'body'] as const

export function validateMacroDefinitionV6(input: unknown): MacroDefinitionValidation {
  return diagnoseMacroDefinition(input, true).persistable
}

export function validateRunnableMacroDefinitionV6(input: unknown): MacroDefinitionValidation {
  return diagnoseMacroDefinition(input, true).runnable
}

export function diagnoseTrustedMacroDefinitionV6(
  input: unknown,
  metrics?: MacroDefinitionDiagnosticsMetrics,
): MacroDefinitionDiagnostics {
  return diagnoseMacroDefinition(input, false, metrics)
}

function diagnoseMacroDefinition(
  input: unknown,
  cloneSuccess: boolean,
  metrics?: MacroDefinitionDiagnosticsMetrics,
): MacroDefinitionDiagnostics {
  const issues: MacroDefinitionIssue[] = []
  const definition = object(input, issues, '')
  if (!definition) return failedDiagnostics(finishIssues(issues))
  exactKeys(definition, TOP_LEVEL_KEYS, issues, '')
  if (definition.schemaVersion !== 6) add(issues, 'invalid_literal', 'schemaVersion', 'schemaVersion must be 6')
  stringValue(definition.name, issues, 'name', { nonEmpty: true })
  stringValue(definition.description, issues, 'description')
  const layoutResult = validateMacroTerminalLayout(definition.terminalLayout)
  if (!layoutResult.ok) issues.push(...layoutResult.issues)
  const layout = new Map<number, TerminalType>(layoutResult.ok ? layoutResult.value.map((item) => [item.index, item.type]) : [])
  const context: ValidationContext = {
    issues,
    layout,
    nodeIds: new Set(),
    artifactOutputs: new Map(),
    loopDepth: 0,
    templateScopeDepth: 0,
    mode: 'runnable',
    onNodeVisited: metrics ? () => { metrics.nodeVisits += 1 } : undefined,
  }
  validateNodeList(definition.body, 'body', context, false, false)
  const ordered = finishIssues(issues)
  const persistableIssues = ordered.filter((issue) => (
    issue.code !== 'unassigned_terminal_reference'
      && issue.code !== 'unassigned_artifact_reference'
  ))
  if (persistableIssues.length > 0) return failedDiagnostics(persistableIssues)
  const value = cloneSuccess ? cloneJsonValue(input) as MacroDefinitionV6 : input as MacroDefinitionV6
  const persistable: MacroDefinitionValidation = { ok: true, value }
  const runnable: MacroDefinitionValidation = ordered.length > 0
    ? { ok: false, issues: ordered }
    : { ok: true, value }
  return { persistable, runnable }
}

function failedDiagnostics(issues: MacroDefinitionIssue[]): MacroDefinitionDiagnostics {
  const failed: MacroDefinitionValidation = { ok: false, issues }
  return { persistable: failed, runnable: failed }
}

export function parseAndValidateMacroDefinitionJson(text: string): MacroDefinitionJsonValidation {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  const validated = validateMacroDefinitionV6(parsed.value)
  return validated.ok
    ? validated
    : { ok: false, error: { code: 'invalid_macro_definition', issues: validated.issues } }
}

export function parseAndValidateMacroTerminalLayoutFromDefinitionJson(text: string): MacroTerminalLayoutJsonValidation {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  const issues: MacroDefinitionIssue[] = []
  const definition = object(parsed.value, issues, '')
  if (!definition) return { ok: false, error: { code: 'invalid_terminal_layout', issues: finishIssues(issues) } }
  if (!Object.hasOwn(definition, 'terminalLayout')) add(issues, 'missing_field', 'terminalLayout', 'terminalLayout is required')
  if (issues.length > 0) return { ok: false, error: { code: 'invalid_terminal_layout', issues: finishIssues(issues) } }
  const validated = validateMacroTerminalLayout(definition.terminalLayout)
  return validated.ok ? validated : { ok: false, error: { code: 'invalid_terminal_layout', issues: validated.issues } }
}
