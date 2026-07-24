import type { TerminalType } from './macroDefinitionTypes'

export const MACRO_DEFINITION_ISSUE_CODES = [
  'expected_object',
  'expected_array',
  'expected_string',
  'expected_boolean',
  'expected_number',
  'expected_integer',
  'missing_field',
  'unknown_field',
  'invalid_literal',
  'invalid_identifier',
  'duplicate_identifier',
  'invalid_reference',
  'invalid_regex',
  'invalid_json_schema',
  'invalid_json_pointer',
  'invalid_template_syntax',
  'invalid_range',
  'terminal_layout_not_contiguous',
  'terminal_reference_missing',
  'terminal_capability_mismatch',
  'unassigned_terminal_reference',
  'unassigned_artifact_reference',
  'semantic_conflict',
] as const

export type MacroDefinitionIssueCode = (typeof MACRO_DEFINITION_ISSUE_CODES)[number]
export type MacroDefinitionIssue = { code: MacroDefinitionIssueCode; path: string; message: string }
export type ValidationContext = {
  issues: MacroDefinitionIssue[]
  layout: Map<number, TerminalType>
  nodeIds: Set<string>
  artifactOutputs: Map<string, Set<string>>
  loopDepth: number
  templateScopeDepth: number
  mode: 'persistable' | 'runnable'
  onNodeVisited?: () => void
}

export function add(issues: MacroDefinitionIssue[], code: MacroDefinitionIssueCode, path: string, message: string): void {
  issues.push({ code, path, message })
}

export function finishIssues(issues: MacroDefinitionIssue[]): MacroDefinitionIssue[] {
  const unique = new Map<string, MacroDefinitionIssue>()
  for (const issue of issues) unique.set(`${issue.path}\u0000${issue.code}`, issue)
  return [...unique.values()].sort((left, right) => {
    const path = compareCodePoints(left.path, right.path)
    return path === 0 ? compareCodePoints(left.code, right.code) : path
  })
}

export function registerArtifact(context: ValidationContext, stepId: string, artifact: string): void {
  const existing = context.artifactOutputs.get(stepId) ?? new Set<string>()
  existing.add(artifact)
  context.artifactOutputs.set(stepId, existing)
}

export function childContext(context: ValidationContext, changes: Partial<Pick<ValidationContext, 'loopDepth' | 'templateScopeDepth'>> = {}): ValidationContext {
  return {
    ...context,
    ...changes,
    artifactOutputs: new Map([...context.artifactOutputs.entries()].map(([stepId, artifacts]) => [stepId, new Set(artifacts)])),
  }
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map((value) => value.codePointAt(0)!)
  const rightPoints = [...right].map((value) => value.codePointAt(0)!)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index]
  return leftPoints.length - rightPoints.length
}
