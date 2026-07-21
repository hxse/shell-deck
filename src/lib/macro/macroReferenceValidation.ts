import type { MacroTerminalLayoutItem, TerminalType } from './macroDefinitionTypes'
import { add, finishIssues, type MacroDefinitionIssue, type ValidationContext } from './macroValidationContext'
import { exactKeys, literal, object, positiveInteger, stringValue, type RecordValue } from './macroValidationPrimitives'

export type MacroTerminalLayoutValidation =
  | { ok: true; value: MacroTerminalLayoutItem[] }
  | { ok: false; issues: MacroDefinitionIssue[] }

type TerminalCapability = 'send' | 'input' | 'terminal-quiet' | 'terminal-buffer' | 'text-box' | 'agent-event' | 'parallel'

export function validateMacroTerminalLayout(input: unknown, path = 'terminalLayout'): MacroTerminalLayoutValidation {
  const issues: MacroDefinitionIssue[] = []
  if (!Array.isArray(input)) {
    add(issues, 'expected_array', path, 'terminalLayout must be an array')
    return { ok: false, issues: finishIssues(issues) }
  }
  const value: MacroTerminalLayoutItem[] = []
  for (let offset = 0; offset < input.length; offset += 1) {
    const itemPath = `${path}[${offset}]`
    const item = object(input[offset], issues, itemPath)
    if (!item) continue
    exactKeys(item, ['index', 'type'], issues, itemPath)
    const index = positiveInteger(item.index, issues, `${itemPath}.index`)
    const type = literal<TerminalType>(item.type, ['shell', 'text'], issues, `${itemPath}.type`, 'terminal type must be shell or text')
    if (index !== undefined && index !== offset + 1) {
      add(issues, 'terminal_layout_not_contiguous', `${itemPath}.index`, `terminalLayout index must be ${offset + 1}`)
    }
    if (index !== undefined && type !== undefined) value.push({ index, type })
  }
  return issues.length === 0 ? { ok: true, value } : { ok: false, issues: finishIssues(issues) }
}

export function validateArtifactReference(value: unknown, path: string, context: ValidationContext): void {
  const source = object(value, context.issues, path)
  if (!source) return
  if (source.kind === 'unassigned') {
    exactKeys(source, ['kind'], context.issues, path)
    if (context.mode === 'runnable') add(context.issues, 'unassigned_artifact_reference', path, 'artifact source must be assigned before Start')
    return
  }
  validateAssignedArtifactObject(source, path, context)
}

export function validateAssignedArtifact(value: unknown, path: string, context: ValidationContext): void {
  const source = object(value, context.issues, path)
  if (!source) return
  validateAssignedArtifactObject(source, path, context)
}

export function validateTerminalSlot(value: unknown, inherited: number | null | undefined, capability: TerminalCapability, path: string, context: ValidationContext): number | null | undefined {
  if (inherited === null) return null
  if (inherited !== undefined) {
    validateTerminalIndex(inherited, capability, path, context)
    return inherited
  }
  return validateTerminalReference(value, capability, path, context)
}

export function validateTerminalReference(value: unknown, capability: TerminalCapability, path: string, context: ValidationContext): number | null | undefined {
  const reference = object(value, context.issues, path)
  if (!reference) return undefined
  if (reference.kind === 'unassigned') {
    exactKeys(reference, ['kind'], context.issues, path)
    if (context.mode === 'runnable') add(context.issues, 'unassigned_terminal_reference', path, 'terminal target must be assigned before Start')
    return null
  }
  exactKeys(reference, ['kind', 'index'], context.issues, path)
  if (reference.kind !== 'terminal_index') {
    add(context.issues, 'invalid_literal', `${path}.kind`, 'terminal reference kind must be terminal_index or unassigned')
    return undefined
  }
  const index = positiveInteger(reference.index, context.issues, `${path}.index`)
  if (index === undefined) return undefined
  validateTerminalIndex(index, capability, `${path}.index`, context)
  return index
}

function validateAssignedArtifactObject(source: RecordValue, path: string, context: ValidationContext): void {
  exactKeys(source, ['kind', 'stepId', 'artifact'], context.issues, path)
  if (source.kind !== 'step_artifact') add(context.issues, 'invalid_literal', `${path}.kind`, 'artifact source kind must be step_artifact')
  const stepId = stringValue(source.stepId, context.issues, `${path}.stepId`, { nonEmpty: true })
  const artifact = literal(source.artifact, ['captured_text', 'merged_text', 'extracted_text'], context.issues, `${path}.artifact`, 'unsupported artifact name')
  if (stepId && artifact && !context.artifactOutputs.get(stepId)?.has(artifact)) add(context.issues, 'invalid_reference', path, 'artifact source must reference an earlier compatible output')
}

function validateTerminalIndex(index: number, capability: TerminalCapability, path: string, context: ValidationContext): void {
  const type = context.layout.get(index)
  if (!type) {
    add(context.issues, 'terminal_reference_missing', path, 'terminal reference index must exist in terminalLayout')
    return
  }
  const allowed = type === 'shell'
    ? capability !== 'text-box'
    : capability === 'send' || capability === 'input' || capability === 'text-box' || capability === 'parallel'
  if (!allowed) add(context.issues, 'terminal_capability_mismatch', path, `${capability} is not supported by ${type} terminal`)
}
