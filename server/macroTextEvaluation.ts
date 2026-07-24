import type {
  FlowV2ArtifactSource,
  FlowV2Node,
  FlowV2JsonArtifactSource,
  MacroCondition,
  MessageSpec,
  TemplatableScalarText,
  TextMatchCondition,
} from '../src/lib/macro/macroDefinitionTypes'
import { renderScopedTemplate, renderTemplatableScalar, type TextListTemplateBinding } from '../src/lib/macro/scopedTextTemplate'
import { compactCanonicalJson, resolveJsonPointer, type JsonValue } from '../src/lib/macro/structuredJson'

export type MacroArtifactValue =
  | { kind: 'text'; value: string }
  | { kind: 'json'; value: JsonValue }
export type MacroArtifactMap = Map<string, Map<string, MacroArtifactValue>>

export function renderMacroMessage(
  message: MessageSpec,
  artifacts: MacroArtifactMap,
  templateBinding: TextListTemplateBinding | undefined,
): string {
  return message.parts.map((part) => {
    if (part.kind === 'text') return part.text
    if (part.kind === 'template') return renderScopedTemplate(part.template, templateBinding)
    return readMacroArtifact(artifacts, part.source)
  }).join('')
}

export function renderMacroScalar(value: TemplatableScalarText, templateBinding: TextListTemplateBinding | undefined): string {
  return renderTemplatableScalar(value, templateBinding)
}

export function readMacroArtifact(artifacts: MacroArtifactMap, source: FlowV2ArtifactSource): string {
  if (source.kind === 'unassigned') throw new Error('unassigned_artifact_reference')
  const artifact = artifacts.get(source.stepId)?.get(source.artifact)
  if (!artifact) throw new Error('artifact_not_found')
  if (source.artifact === 'captured_json') {
    if (artifact.kind !== 'json') throw new Error('artifact_type_mismatch')
    return compactCanonicalJson(artifact.value)
  }
  if (artifact.kind !== 'text') throw new Error('artifact_type_mismatch')
  return artifact.value
}

export function readMacroJsonArtifact(artifacts: MacroArtifactMap, source: FlowV2JsonArtifactSource): JsonValue {
  if (source.kind === 'unassigned') throw new Error('unassigned_artifact_reference')
  const artifact = artifacts.get(source.stepId)?.get(source.artifact)
  if (!artifact) throw new Error('artifact_not_found')
  if (artifact.kind !== 'json') throw new Error('artifact_type_mismatch')
  return artifact.value
}

export function assignedMacroTerminalIndex(reference: { kind: 'terminal_index'; index: number } | { kind: 'unassigned' }): number {
  if (reference.kind === 'unassigned') throw new Error('unassigned_terminal_reference')
  return reference.index
}

export function matchesMacroCondition(artifacts: MacroArtifactMap, condition: MacroCondition): boolean {
  if (condition.kind === 'json_match') {
    const resolved = resolveJsonPointer(readMacroJsonArtifact(artifacts, condition.source), condition.pointer)
    const matcher = condition.matcher
    if (matcher.kind === 'exists') return resolved.found
    if (matcher.kind === 'not_exists') return !resolved.found
    if (!('value' in matcher)) return false
    if (!resolved.found) return false
    const actual = resolved.value
    if (matcher.kind === 'equals') return isJsonScalar(actual) && actual === matcher.value
    if (matcher.kind === 'not_equals') return isJsonScalar(actual) && actual !== matcher.value
    if (typeof actual !== 'number') return false
    const expected = matcher.value
    if (typeof expected !== 'number') return false
    if (matcher.kind === 'less_than') return actual < expected
    if (matcher.kind === 'less_than_or_equal') return actual <= expected
    if (matcher.kind === 'greater_than') return actual > expected
    return actual >= expected
  }
  return matchesTextCondition(readMacroArtifact(artifacts, condition.source), condition)
}

function matchesTextCondition(text: string, condition: TextMatchCondition): boolean {
  const values = condition.scope.kind === 'whole' ? [text] : text.split(/\r?\n/).filter((line) => condition.scope.kind !== 'lines' || condition.scope.includeEmptyLines || line.length > 0)
  const matches = (value: string) => condition.matcher.kind === 'regex'
    ? new RegExp(condition.matcher.pattern, condition.matcher.flags).test(value)
    : simpleMatch(value, condition.matcher.op, condition.matcher.text)
  if (condition.scope.kind === 'whole') return matches(text)
  if (condition.scope.mode === 'first') return matches(values[0] ?? '')
  if (condition.scope.mode === 'last') return matches(values.at(-1) ?? '')
  if (condition.scope.mode === 'all') return values.every(matches)
  return values.some(matches)
}

function isJsonScalar(value: JsonValue): value is string | number | boolean | null {
  return value === null || typeof value !== 'object'
}

export function extractMacroText(input: string, node: Extract<FlowV2Node, { type: 'extract_text' }>): string {
  let values = node.split.kind === 'lines'
    ? input.split(/\r?\n/)
    : input.split(new RegExp(node.split.pattern, node.split.flags))
  if (!node.split.keepEmpty) values = values.filter(Boolean)
  for (const filter of node.filters) values = values.filter((value) => {
    const match = filter.matcher.kind === 'regex' ? new RegExp(filter.matcher.pattern, filter.matcher.flags).test(value) : simpleMatch(value, filter.matcher.op, filter.matcher.text)
    return filter.kind === 'include' ? match : !match
  })
  if (node.select.mode === 'index') {
    const selected = values.at(node.select.index)
    values = selected === undefined ? [] : [selected]
  }
  else if (node.select.mode === 'range') values = values.slice(node.select.start, node.select.end)
  let output = values.join('\n')
  if (node.extract.kind === 'regex') {
    const match = new RegExp(node.extract.pattern, node.extract.flags).exec(output)
    output = match ? String(match.groups?.[String(node.extract.group)] ?? match[Number(node.extract.group)] ?? '') : ''
  }
  if (node.trim === 'left' || node.trim === 'both') output = output.trimStart()
  if (node.trim === 'right' || node.trim === 'both') output = output.trimEnd()
  return output
}

function simpleMatch(value: string, op: string, expected: string): boolean {
  if (op === 'contains') return value.includes(expected)
  if (op === 'not_contains') return !value.includes(expected)
  if (op === 'equals') return value === expected
  if (op === 'not_equals') return value !== expected
  if (op === 'starts_with') return value.startsWith(expected)
  return value.endsWith(expected)
}
