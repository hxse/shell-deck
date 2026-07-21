import { scopedTemplateSyntaxIssue } from './scopedTextTemplate'
import { add, type MacroDefinitionIssue, type ValidationContext } from './macroValidationContext'

export type RecordValue = Record<string, unknown>

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const REGEX_FLAGS = /^[ims]*$/

export function object(value: unknown, issues: MacroDefinitionIssue[], path: string): RecordValue | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    add(issues, 'expected_object', path, 'value must be an object')
    return undefined
  }
  return value as RecordValue
}

export function exactKeys(value: RecordValue, required: readonly string[], issues: MacroDefinitionIssue[], path: string, optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) if (!allowed.has(key)) add(issues, 'unknown_field', childPath(path, key), `unknown field: ${key}`)
  for (const key of required) if (!Object.hasOwn(value, key)) add(issues, 'missing_field', childPath(path, key), `${key} is required`)
}

export function stringValue(value: unknown, issues: MacroDefinitionIssue[], path: string, options: { nonEmpty?: boolean } = {}): string | undefined {
  if (typeof value !== 'string') {
    add(issues, 'expected_string', path, 'value must be a string')
    return undefined
  }
  if (options.nonEmpty && value.length === 0) {
    add(issues, 'invalid_range', path, 'string must not be empty')
    return undefined
  }
  return value
}

export function booleanValue(value: unknown, issues: MacroDefinitionIssue[], path: string): boolean | undefined {
  if (typeof value !== 'boolean') {
    add(issues, 'expected_boolean', path, 'value must be boolean')
    return undefined
  }
  return value
}

export function positiveInteger(value: unknown, issues: MacroDefinitionIssue[], path: string): number | undefined {
  if (!Number.isInteger(value)) {
    add(issues, 'expected_integer', path, 'value must be an integer')
    return undefined
  }
  if ((value as number) < 1) {
    add(issues, 'invalid_range', path, 'value must be a positive integer')
    return undefined
  }
  return value as number
}

export function integerValue(value: unknown, issues: MacroDefinitionIssue[], path: string): number | undefined {
  if (!Number.isInteger(value)) {
    add(issues, 'expected_integer', path, 'value must be an integer')
    return undefined
  }
  return value as number
}

export function literal<T extends string>(value: unknown, values: readonly T[], issues: MacroDefinitionIssue[], path: string, message: string): T | undefined {
  if (!values.includes(value as T)) {
    add(issues, 'invalid_literal', path, message)
    return undefined
  }
  return value as T
}

export function validateIdentifier(value: unknown, issues: MacroDefinitionIssue[], path: string, seen: Set<string>): void {
  const identifier = stringValue(value, issues, path, { nonEmpty: true })
  if (!identifier) return
  if (!IDENTIFIER.test(identifier)) add(issues, 'invalid_identifier', path, 'identifier must start with a letter or digit and contain at most 64 letters, digits, underscores or hyphens')
  if (seen.has(identifier)) add(issues, 'duplicate_identifier', path, 'identifier must be unique')
  seen.add(identifier)
}

export function validatePublicIdentifier(value: unknown, issues: MacroDefinitionIssue[], path: string): void {
  const identifier = stringValue(value, issues, path, { nonEmpty: true })
  if (identifier !== undefined && !IDENTIFIER.test(identifier)) {
    add(issues, 'invalid_identifier', path, 'identifier must start with a letter or digit and contain at most 64 letters, digits, underscores or hyphens')
  }
}

export function validateTemplateString(value: unknown, path: string, context: ValidationContext): void {
  const text = stringValue(value, context.issues, path, { nonEmpty: true })
  if (text === undefined) return
  if (context.templateScopeDepth === 0) {
    add(context.issues, 'invalid_template_syntax', path, 'template syntax is only valid inside a text-list for body')
    return
  }
  const issue = scopedTemplateSyntaxIssue(text)
  if (issue) add(context.issues, 'invalid_template_syntax', path, issue)
}

export function validateRegex(pattern: unknown, flags: unknown, path: string, context: ValidationContext): void {
  const patternValue = stringValue(pattern, context.issues, `${path}.pattern`)
  const flagsValue = flags === undefined ? '' : stringValue(flags, context.issues, `${path}.flags`)
  if (flagsValue !== undefined && !REGEX_FLAGS.test(flagsValue)) add(context.issues, 'invalid_regex', `${path}.flags`, 'regex flags may only contain i, m or s')
  if (patternValue !== undefined && flagsValue !== undefined) {
    try { new RegExp(patternValue, flagsValue) }
    catch { add(context.issues, 'invalid_regex', `${path}.pattern`, 'invalid regular expression') }
  }
}

function childPath(path: string, key: string): string { return path ? `${path}.${key}` : key }
