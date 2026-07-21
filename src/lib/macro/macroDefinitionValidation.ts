import { cloneJsonValue } from '../jsonClone'
import type { MacroDefinitionV5, MacroTerminalLayoutItem, TerminalType } from './macroDefinitionTypes'
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
  | { ok: true; value: MacroDefinitionV5 }
  | { ok: false; issues: MacroDefinitionIssue[] }
export type MacroDefinitionJsonValidation =
  | { ok: true; value: MacroDefinitionV5 }
  | { ok: false; error: InvalidJsonError }
  | { ok: false; error: { code: 'invalid_macro_definition'; issues: MacroDefinitionIssue[] } }
export type MacroTerminalLayoutJsonValidation =
  | { ok: true; value: MacroTerminalLayoutItem[] }
  | { ok: false; error: InvalidJsonError }
  | { ok: false; error: { code: 'invalid_terminal_layout'; issues: MacroDefinitionIssue[] } }

const TOP_LEVEL_KEYS = ['schemaVersion', 'name', 'description', 'terminalLayout', 'body'] as const

export function validateMacroDefinitionV5(input: unknown): MacroDefinitionValidation {
  return validateMacroDefinition(input, 'persistable')
}

export function validateRunnableMacroDefinitionV5(input: unknown): MacroDefinitionValidation {
  const persistable = validateMacroDefinition(input, 'persistable')
  return persistable.ok ? validateMacroDefinition(persistable.value, 'runnable') : persistable
}

function validateMacroDefinition(input: unknown, mode: ValidationContext['mode']): MacroDefinitionValidation {
  const issues: MacroDefinitionIssue[] = []
  const definition = object(input, issues, '')
  if (!definition) return { ok: false, issues: finishIssues(issues) }
  exactKeys(definition, TOP_LEVEL_KEYS, issues, '')
  if (definition.schemaVersion !== 5) add(issues, 'invalid_literal', 'schemaVersion', 'schemaVersion must be 5')
  stringValue(definition.name, issues, 'name', { nonEmpty: true })
  stringValue(definition.description, issues, 'description')
  const layoutResult = validateMacroTerminalLayout(definition.terminalLayout)
  if (!layoutResult.ok) issues.push(...layoutResult.issues)
  const layout = new Map<number, TerminalType>(layoutResult.ok ? layoutResult.value.map((item) => [item.index, item.type]) : [])
  const context: ValidationContext = { issues, layout, nodeIds: new Set(), artifactOutputs: new Map(), loopDepth: 0, templateScopeDepth: 0, mode }
  validateNodeList(definition.body, 'body', context, false, false)
  if (issues.length > 0) return { ok: false, issues: finishIssues(issues) }
  return { ok: true, value: cloneJsonValue(input) as MacroDefinitionV5 }
}

export function parseAndValidateMacroDefinitionJson(text: string): MacroDefinitionJsonValidation {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  const validated = validateMacroDefinitionV5(parsed.value)
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
