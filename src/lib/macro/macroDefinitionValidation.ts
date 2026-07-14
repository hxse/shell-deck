import { scopedTemplateSyntaxIssue } from './scopedTextTemplate'
import { isTerminalEnding } from './terminalEnding'
import { isTerminalInputDelivery } from './terminalInputDelivery'
import { cloneJsonValue } from '../jsonClone'
import type {
  MacroDefinitionV3,
  MacroTerminalLayoutItem,
  TerminalType,
} from './macroDefinitionTypes'

export const MACRO_DEFINITION_ISSUE_CODES = [
  'expected_object',
  'expected_array',
  'expected_string',
  'expected_boolean',
  'expected_integer',
  'missing_field',
  'unknown_field',
  'invalid_literal',
  'invalid_identifier',
  'duplicate_identifier',
  'invalid_reference',
  'invalid_regex',
  'invalid_template_syntax',
  'invalid_range',
  'terminal_layout_not_contiguous',
  'terminal_reference_missing',
  'terminal_capability_mismatch',
  'semantic_conflict',
] as const

export type MacroDefinitionIssueCode = (typeof MACRO_DEFINITION_ISSUE_CODES)[number]
export type MacroDefinitionIssue = { code: MacroDefinitionIssueCode; path: string; message: string }
export type MacroDefinitionValidation =
  | { ok: true; value: MacroDefinitionV3 }
  | { ok: false; issues: MacroDefinitionIssue[] }
export type MacroTerminalLayoutValidation =
  | { ok: true; value: MacroTerminalLayoutItem[] }
  | { ok: false; issues: MacroDefinitionIssue[] }
export type InvalidJsonError = { code: 'invalid_json'; offset: number; line: number; column: number; message: string }
export type MacroDefinitionJsonValidation =
  | { ok: true; value: MacroDefinitionV3 }
  | { ok: false; error: InvalidJsonError }
  | { ok: false; error: { code: 'invalid_macro_definition'; issues: MacroDefinitionIssue[] } }
export type MacroTerminalLayoutJsonValidation =
  | { ok: true; value: MacroTerminalLayoutItem[] }
  | { ok: false; error: InvalidJsonError }
  | { ok: false; error: { code: 'invalid_terminal_layout'; issues: MacroDefinitionIssue[] } }

type RecordValue = Record<string, unknown>
type ValidationContext = {
  issues: MacroDefinitionIssue[]
  layout: Map<number, TerminalType>
  nodeIds: Set<string>
  artifactOutputs: Map<string, Set<string>>
  loopDepth: number
  templateScopeDepth: number
}

const TOP_LEVEL_KEYS = ['schemaVersion', 'name', 'description', 'terminalLayout', 'body'] as const
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const REGEX_FLAGS = /^[ims]*$/

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

export function validateMacroDefinitionV3(input: unknown): MacroDefinitionValidation {
  const issues: MacroDefinitionIssue[] = []
  const definition = object(input, issues, '')
  if (!definition) return { ok: false, issues: finishIssues(issues) }
  exactKeys(definition, TOP_LEVEL_KEYS, issues, '')
  if (definition.schemaVersion !== 3) add(issues, 'invalid_literal', 'schemaVersion', 'schemaVersion must be 3')
  stringValue(definition.name, issues, 'name', { nonEmpty: true })
  stringValue(definition.description, issues, 'description')
  const layoutResult = validateMacroTerminalLayout(definition.terminalLayout)
  if (!layoutResult.ok) issues.push(...layoutResult.issues)
  const layout = new Map<number, TerminalType>(layoutResult.ok ? layoutResult.value.map((item) => [item.index, item.type]) : [])
  const context: ValidationContext = { issues, layout, nodeIds: new Set(), artifactOutputs: new Map(), loopDepth: 0, templateScopeDepth: 0 }
  validateNodeList(definition.body, 'body', context, false, false)
  if (issues.length > 0) return { ok: false, issues: finishIssues(issues) }
  return { ok: true, value: cloneJsonValue(input) as MacroDefinitionV3 }
}

export function parseAndValidateMacroDefinitionJson(text: string): MacroDefinitionJsonValidation {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  const validated = validateMacroDefinitionV3(parsed.value)
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

function validateNodeList(value: unknown, path: string, context: ValidationContext, requireNonEmpty: boolean, actionOnly: boolean): void {
  if (!Array.isArray(value)) {
    add(context.issues, 'expected_array', path, 'body must be an array')
    return
  }
  if (requireNonEmpty && value.length === 0) add(context.issues, 'invalid_range', path, 'body must not be empty')
  value.forEach((node, index) => validateNode(node, `${path}[${index}]`, context, actionOnly, undefined))
}

function validateNode(value: unknown, path: string, context: ValidationContext, actionOnly: boolean, inheritedTerminalIndex: number | undefined): void {
  const node = object(value, context.issues, path)
  if (!node) return
  validateIdentifier(node.id, context.issues, `${path}.id`, context.nodeIds)
  if (typeof node.type !== 'string') {
    add(context.issues, 'expected_string', `${path}.type`, 'node type must be a string')
    return
  }
  if (actionOnly && ['if', 'for', 'break', 'continue', 'finish'].includes(node.type)) {
    add(context.issues, 'semantic_conflict', `${path}.type`, 'this body only supports action nodes')
    return
  }
  switch (node.type) {
    case 'send': validateSend(node, path, context, inheritedTerminalIndex); break
    case 'notify': validateNotify(node, path, context); break
    case 'input': validateInput(node, path, context, inheritedTerminalIndex); break
    case 'wait': validateWait(node, path, context, inheritedTerminalIndex); break
    case 'capture-source': validateCaptureNode(node, path, context, inheritedTerminalIndex); break
    case 'extract_text': validateExtract(node, path, context); break
    case 'parallel': validateParallel(node, path, context); break
    case 'if': validateIf(node, path, context); break
    case 'for': validateFor(node, path, context); break
    case 'break':
    case 'continue':
    case 'finish': validateTerminalControl(node, path, context); break
    default: add(context.issues, 'invalid_literal', `${path}.type`, 'unsupported Flow node type')
  }
}

function validateSend(node: RecordValue, path: string, context: ValidationContext, inherited: number | undefined): void {
  exactKeys(node, inherited === undefined ? ['id', 'type', 'terminalIndex', 'message', 'delivery', 'ending'] : ['id', 'type', 'message', 'delivery', 'ending'], context.issues, path)
  validateTerminalUse(inherited ?? node.terminalIndex, 'send', `${path}.terminalIndex`, context)
  validateMessage(node.message, `${path}.message`, context)
  if (!isTerminalInputDelivery(node.delivery)) add(context.issues, 'invalid_literal', `${path}.delivery`, 'delivery must be auto, direct-bytes or bracketed-paste')
  if (!isTerminalEnding(node.ending)) add(context.issues, 'invalid_literal', `${path}.ending`, 'ending must be none, lf, cr or crlf')
}

function validateInput(node: RecordValue, path: string, context: ValidationContext, inherited: number | undefined): void {
  exactKeys(node, inherited === undefined ? ['id', 'type', 'terminalIndex', 'prompt', 'allowEmpty', 'delivery', 'ending'] : ['id', 'type', 'prompt', 'allowEmpty', 'delivery', 'ending'], context.issues, path, ['defaultSource'])
  validateTerminalUse(inherited ?? node.terminalIndex, 'input', `${path}.terminalIndex`, context)
  validateTemplatable(node.prompt, `${path}.prompt`, context, true)
  booleanValue(node.allowEmpty, context.issues, `${path}.allowEmpty`)
  if (!isTerminalInputDelivery(node.delivery)) add(context.issues, 'invalid_literal', `${path}.delivery`, 'delivery must be auto, direct-bytes or bracketed-paste')
  if (!isTerminalEnding(node.ending)) add(context.issues, 'invalid_literal', `${path}.ending`, 'ending must be none, lf, cr or crlf')
  if (node.defaultSource !== undefined) validateArtifact(node.defaultSource, `${path}.defaultSource`, context)
}

function validateNotify(node: RecordValue, path: string, context: ValidationContext): void {
  exactKeys(node, ['id', 'type', 'level', 'title', 'message', 'channels', 'onFailure'], context.issues, path)
  literal(node.level, ['info', 'success', 'warning', 'error'], context.issues, `${path}.level`, 'level must be info, success, warning or error')
  validateTemplatable(node.title, `${path}.title`, context, true)
  validateMessage(node.message, `${path}.message`, context)
  if (!Array.isArray(node.channels)) add(context.issues, 'expected_array', `${path}.channels`, 'channels must be an array')
  else {
    if (node.channels.length === 0) add(context.issues, 'invalid_range', `${path}.channels`, 'channels must not be empty')
    node.channels.forEach((channel, index) => validateNotifyChannel(channel, `${path}.channels[${index}]`, context))
  }
  literal(node.onFailure, ['continue', 'pause', 'fail'], context.issues, `${path}.onFailure`, 'onFailure must be continue, pause or fail')
}

function validateNotifyChannel(value: unknown, path: string, context: ValidationContext): void {
  const channel = object(value, context.issues, path)
  if (!channel) return
  if (channel.kind === 'app') {
    exactKeys(channel, ['kind', 'toast', 'sound'], context.issues, path)
    booleanValue(channel.toast, context.issues, `${path}.toast`)
    literal(channel.sound, ['none', 'bell', 'chime', 'ping', 'pulse', 'success', 'warning', 'alert'], context.issues, `${path}.sound`, 'unsupported notification sound')
  } else if (channel.kind === 'system') exactKeys(channel, ['kind'], context.issues, path)
  else if (channel.kind === 'telegram') {
    exactKeys(channel, ['kind', 'profileId'], context.issues, path)
    validatePublicIdentifier(channel.profileId, context.issues, `${path}.profileId`)
  } else add(context.issues, 'invalid_literal', `${path}.kind`, 'channel kind must be app, system or telegram')
}

function validateWait(node: RecordValue, path: string, context: ValidationContext, inherited: number | undefined): void {
  if (node.mode === 'duration') {
    exactKeys(node, ['id', 'type', 'mode', 'durationMs'], context.issues, path)
    positiveInteger(node.durationMs, context.issues, `${path}.durationMs`)
  } else if (node.mode === 'terminal-quiet') {
    exactKeys(node, inherited === undefined ? ['id', 'type', 'mode', 'terminalIndex', 'quietMs', 'maxMs', 'onTimeout'] : ['id', 'type', 'mode', 'quietMs', 'maxMs', 'onTimeout'], context.issues, path)
    validateTerminalUse(inherited ?? node.terminalIndex, 'terminal-quiet', `${path}.terminalIndex`, context)
    const quietMs = positiveInteger(node.quietMs, context.issues, `${path}.quietMs`)
    const maxMs = positiveInteger(node.maxMs, context.issues, `${path}.maxMs`)
    if (quietMs !== undefined && maxMs !== undefined && maxMs < quietMs) add(context.issues, 'invalid_range', `${path}.maxMs`, 'maxMs must be greater than or equal to quietMs')
    literal(node.onTimeout, ['pause', 'finish'], context.issues, `${path}.onTimeout`, 'onTimeout must be pause or finish')
  } else if (node.mode === 'user-continue') {
    exactKeys(node, ['id', 'type', 'mode', 'prompt'], context.issues, path)
    validateTemplatable(node.prompt, `${path}.prompt`, context, true)
  } else add(context.issues, 'invalid_literal', `${path}.mode`, 'wait mode must be duration, terminal-quiet or user-continue')
}

function validateCaptureNode(node: RecordValue, path: string, context: ValidationContext, inherited: number | undefined): void {
  exactKeys(node, ['id', 'type', 'capture'], context.issues, path)
  const capture = object(node.capture, context.issues, `${path}.capture`)
  if (!capture) return
  const inheritedKeys = inherited === undefined ? ['terminalIndex'] : []
  if (capture.kind === 'terminal-buffer') {
    exactKeys(capture, ['kind', ...inheritedKeys, 'mode', 'maxChars'], context.issues, `${path}.capture`)
    validateTerminalUse(inherited ?? capture.terminalIndex, 'terminal-buffer', `${path}.capture.terminalIndex`, context)
    literal(capture.mode, ['scrollback-tail', 'raw-stream-tail'], context.issues, `${path}.capture.mode`, 'unsupported terminal-buffer mode')
    positiveInteger(capture.maxChars, context.issues, `${path}.capture.maxChars`)
  } else if (capture.kind === 'text-box') {
    exactKeys(capture, ['kind', ...inheritedKeys], context.issues, `${path}.capture`)
    validateTerminalUse(inherited ?? capture.terminalIndex, 'text-box', `${path}.capture.terminalIndex`, context)
  } else if (capture.kind === 'agent-event') {
    exactKeys(capture, ['kind', ...inheritedKeys, 'agent', 'captureMode'], context.issues, `${path}.capture`)
    validateTerminalUse(inherited ?? capture.terminalIndex, 'agent-event', `${path}.capture.terminalIndex`, context)
    const agent = object(capture.agent, context.issues, `${path}.capture.agent`)
    if (agent) {
      exactKeys(agent, ['kind'], context.issues, `${path}.capture.agent`)
      if (agent.kind !== 'codex') add(context.issues, 'invalid_literal', `${path}.capture.agent.kind`, 'agent kind must be codex')
    }
    literal(capture.captureMode, ['result_only', 'prompt_only', 'prompt_and_result'], context.issues, `${path}.capture.captureMode`, 'unsupported agent capture mode')
  } else add(context.issues, 'invalid_literal', `${path}.capture.kind`, 'capture kind must be terminal-buffer, text-box or agent-event')
  if (typeof node.id === 'string') registerArtifact(context, node.id, 'captured_text')
}

function validateExtract(node: RecordValue, path: string, context: ValidationContext): void {
  exactKeys(node, ['id', 'type', 'source', 'split', 'filters', 'select', 'extract', 'trim', 'onEmpty'], context.issues, path)
  validateArtifact(node.source, `${path}.source`, context)
  validateSplit(node.split, `${path}.split`, context)
  if (!Array.isArray(node.filters)) add(context.issues, 'expected_array', `${path}.filters`, 'filters must be an array')
  else node.filters.forEach((filter, index) => validateFilter(filter, `${path}.filters[${index}]`, context))
  validateSelect(node.select, `${path}.select`, context)
  validateExtractSpec(node.extract, `${path}.extract`, context)
  literal(node.trim, ['none', 'left', 'right', 'both'], context.issues, `${path}.trim`, 'unsupported trim mode')
  literal(node.onEmpty, ['pause', 'fail', 'finish', 'continue'], context.issues, `${path}.onEmpty`, 'unsupported empty action')
  if (typeof node.id === 'string') registerArtifact(context, node.id, 'extracted_text')
}

function validateParallel(node: RecordValue, path: string, context: ValidationContext): void {
  exactKeys(node, ['id', 'type', 'lanes', 'merge', 'onLaneFail'], context.issues, path)
  if (!Array.isArray(node.lanes)) add(context.issues, 'expected_array', `${path}.lanes`, 'lanes must be an array')
  else {
    if (node.lanes.length === 0) add(context.issues, 'invalid_range', `${path}.lanes`, 'parallel must declare at least one lane')
    const laneIds = new Set<string>()
    const laneLabels = new Set<string>()
    const terminalIndexes = new Set<number>()
    node.lanes.forEach((value, index) => {
      const lanePath = `${path}.lanes[${index}]`
      const lane = object(value, context.issues, lanePath)
      if (!lane) return
      exactKeys(lane, ['id', 'label', 'terminalIndex', 'body'], context.issues, lanePath)
      validateIdentifier(lane.id, context.issues, `${lanePath}.id`, laneIds)
      const label = stringValue(lane.label, context.issues, `${lanePath}.label`)
      if (label?.trim()) {
        const normalized = label.trim()
        if (laneLabels.has(normalized)) add(context.issues, 'semantic_conflict', `${lanePath}.label`, 'parallel lane labels must be unique')
        laneLabels.add(normalized)
      }
      const terminalIndex = validateTerminalUse(lane.terminalIndex, 'parallel', `${lanePath}.terminalIndex`, context)
      if (terminalIndex !== undefined) {
        if (terminalIndexes.has(terminalIndex)) add(context.issues, 'semantic_conflict', `${lanePath}.terminalIndex`, 'parallel lanes must use distinct terminalIndex values')
        terminalIndexes.add(terminalIndex)
      }
      validateParallelLaneBody(lane.body, `${lanePath}.body`, context, terminalIndex)
    })
  }
  const merge = object(node.merge, context.issues, `${path}.merge`)
  if (merge) {
    exactKeys(merge, ['kind', 'separator', 'includeEmptyOutputs'], context.issues, `${path}.merge`)
    if (merge.kind !== 'sectioned_text') add(context.issues, 'invalid_literal', `${path}.merge.kind`, 'merge kind must be sectioned_text')
    stringValue(merge.separator, context.issues, `${path}.merge.separator`, { nonEmpty: true })
    booleanValue(merge.includeEmptyOutputs, context.issues, `${path}.merge.includeEmptyOutputs`)
  }
  literal(node.onLaneFail, ['pause', 'fail'], context.issues, `${path}.onLaneFail`, 'onLaneFail must be pause or fail')
  if (typeof node.id === 'string') registerArtifact(context, node.id, 'merged_text')
}

function validateParallelLaneBody(value: unknown, path: string, context: ValidationContext, terminalIndex: number | undefined): void {
  if (!Array.isArray(value)) {
    add(context.issues, 'expected_array', path, 'parallel lane body must be an array')
    return
  }
  if (value.length === 0) {
    add(context.issues, 'invalid_range', path, 'parallel lane body must end with output')
    return
  }
  const laneContext = childContext(context)
  const outputContext = { ...childContext(context), artifactOutputs: new Map<string, Set<string>>() }
  let outputCount = 0
  value.forEach((child, childIndex) => {
    const childPath = `${path}[${childIndex}]`
    const childRecord = object(child, context.issues, childPath)
    if (!childRecord) return
    if (childRecord.type === 'output') {
      outputCount += 1
      validateIdentifier(childRecord.id, context.issues, `${childPath}.id`, context.nodeIds)
      exactKeys(childRecord, ['id', 'type', 'source'], context.issues, childPath)
      const source = object(childRecord.source, context.issues, `${childPath}.source`)
      if (source?.kind === 'none') exactKeys(source, ['kind'], context.issues, `${childPath}.source`)
      else validateArtifact(childRecord.source, `${childPath}.source`, outputContext)
      if (childIndex !== value.length - 1) add(context.issues, 'semantic_conflict', `${childPath}.type`, 'parallel lane output must be the final node')
      return
    }
    if (typeof childRecord.type !== 'string') {
      validateIdentifier(childRecord.id, context.issues, `${childPath}.id`, context.nodeIds)
      add(context.issues, 'expected_string', `${childPath}.type`, 'parallel lane node type must be a string')
      return
    }
    if (childIndex === value.length - 1) add(context.issues, 'semantic_conflict', `${childPath}.type`, 'parallel lane must end with output')
    if (!['send', 'wait', 'capture-source', 'extract_text'].includes(childRecord.type)) {
      validateIdentifier(childRecord.id, context.issues, `${childPath}.id`, context.nodeIds)
      add(context.issues, 'semantic_conflict', `${childPath}.type`, 'parallel lane only supports send, wait, capture-source, extract_text and final output')
      return
    }
    validateNode(child, childPath, laneContext, false, terminalIndex)
    if (childRecord.type === 'wait' && childRecord.mode === 'user-continue') {
      add(context.issues, 'semantic_conflict', `${childPath}.mode`, 'parallel lane wait must not use user-continue')
    }
    if (childRecord.type === 'wait' && childRecord.mode === 'terminal-quiet' && childRecord.onTimeout !== 'pause') {
      add(context.issues, 'semantic_conflict', `${childPath}.onTimeout`, 'parallel lane wait onTimeout must be pause')
    }
    if (childRecord.type === 'extract_text' && childRecord.onEmpty !== 'pause' && childRecord.onEmpty !== 'fail') {
      add(context.issues, 'semantic_conflict', `${childPath}.onEmpty`, 'parallel lane extract onEmpty must be pause or fail')
    }
    if (typeof childRecord.id === 'string' && childRecord.type === 'capture-source') registerArtifact(outputContext, childRecord.id, 'captured_text')
    if (typeof childRecord.id === 'string' && childRecord.type === 'extract_text') registerArtifact(outputContext, childRecord.id, 'extracted_text')
  })
  if (outputCount === 0) add(context.issues, 'semantic_conflict', path, 'parallel lane must declare final output')
  if (outputCount > 1) add(context.issues, 'semantic_conflict', path, 'parallel lane must declare exactly one output')
}

function validateIf(node: RecordValue, path: string, context: ValidationContext): void {
  exactKeys(node, ['id', 'type', 'branches'], context.issues, path, ['else'])
  if (!Array.isArray(node.branches)) add(context.issues, 'expected_array', `${path}.branches`, 'branches must be an array')
  else {
    if (node.branches.length === 0) add(context.issues, 'invalid_range', `${path}.branches`, 'if must have at least one branch')
    node.branches.forEach((value, index) => {
      const branchPath = `${path}.branches[${index}]`
      const branch = object(value, context.issues, branchPath)
      if (!branch) return
      exactKeys(branch, ['kind', 'condition', 'body'], context.issues, branchPath)
      const expected = index === 0 ? 'if' : 'elif'
      if (branch.kind !== expected) add(context.issues, 'semantic_conflict', `${branchPath}.kind`, `branch ${index + 1} kind must be ${expected}`)
      validateCondition(branch.condition, `${branchPath}.condition`, context)
      validateNodeList(branch.body, `${branchPath}.body`, childContext(context), true, false)
    })
  }
  if (node.else !== undefined) validateNodeList(node.else, `${path}.else`, childContext(context), true, false)
}

function validateFor(node: RecordValue, path: string, context: ValidationContext): void {
  exactKeys(node, ['id', 'type', 'range', 'body'], context.issues, path)
  const range = object(node.range, context.issues, `${path}.range`)
  if (range) {
    if (range.kind === 'count') {
      exactKeys(range, ['kind', 'count'], context.issues, `${path}.range`)
      positiveInteger(range.count, context.issues, `${path}.range.count`)
    } else if (range.kind === 'forever') exactKeys(range, ['kind'], context.issues, `${path}.range`)
    else if (range.kind === 'text-list') {
      exactKeys(range, ['kind', 'items'], context.issues, `${path}.range`)
      if (!Array.isArray(range.items)) add(context.issues, 'expected_array', `${path}.range.items`, 'text-list items must be an array')
      else {
        if (range.items.length === 0) add(context.issues, 'invalid_range', `${path}.range.items`, 'text-list items must not be empty')
        range.items.forEach((value, index) => {
          const itemPath = `${path}.range.items[${index}]`
          const item = object(value, context.issues, itemPath)
          if (!item) return
          exactKeys(item, ['key', 'value'], context.issues, itemPath)
          const key = stringValue(item.key, context.issues, `${itemPath}.key`)
          if (key !== undefined && /[\r\n]/.test(key)) add(context.issues, 'invalid_range', `${itemPath}.key`, 'text-list item key must not contain CR or LF')
          stringValue(item.value, context.issues, `${itemPath}.value`)
        })
      }
    } else add(context.issues, 'invalid_literal', `${path}.range.kind`, 'for range kind must be count, forever or text-list')
  }
  const nested = childContext(context, {
    loopDepth: context.loopDepth + 1,
    templateScopeDepth: range?.kind === 'text-list' ? context.templateScopeDepth + 1 : context.templateScopeDepth,
  })
  validateNodeList(node.body, `${path}.body`, nested, true, false)
}

function validateTerminalControl(node: RecordValue, path: string, context: ValidationContext): void {
  exactKeys(node, ['id', 'type'], context.issues, path, ['reason', 'body'])
  if ((node.type === 'break' || node.type === 'continue') && context.loopDepth === 0) add(context.issues, 'semantic_conflict', `${path}.type`, `${node.type} must be inside a for node`)
  if (node.reason !== undefined) stringValue(node.reason, context.issues, `${path}.reason`, { nonEmpty: true })
  if (node.body !== undefined) validateNodeList(node.body, `${path}.body`, childContext(context), false, true)
}

function validateMessage(value: unknown, path: string, context: ValidationContext): void {
  const message = object(value, context.issues, path)
  if (!message) return
  exactKeys(message, ['parts'], context.issues, path)
  if (!Array.isArray(message.parts)) {
    add(context.issues, 'expected_array', `${path}.parts`, 'message parts must be an array')
    return
  }
  message.parts.forEach((value, index) => {
    const partPath = `${path}.parts[${index}]`
    const part = object(value, context.issues, partPath)
    if (!part) return
    if (part.kind === 'text') {
      exactKeys(part, ['kind', 'text'], context.issues, partPath)
      stringValue(part.text, context.issues, `${partPath}.text`)
    } else if (part.kind === 'template') {
      exactKeys(part, ['kind', 'template'], context.issues, partPath)
      validateTemplateString(part.template, `${partPath}.template`, context)
    } else if (part.kind === 'artifact') {
      exactKeys(part, ['kind'], context.issues, partPath, ['source'])
      if (part.source !== undefined) validateArtifact(part.source, `${partPath}.source`, context)
    } else add(context.issues, 'invalid_literal', `${partPath}.kind`, 'message part kind must be text, template or artifact')
  })
}

function validateTemplatable(value: unknown, path: string, context: ValidationContext, nonEmpty: boolean): void {
  if (typeof value === 'string') {
    stringValue(value, context.issues, path, { nonEmpty })
    return
  }
  const template = object(value, context.issues, path)
  if (!template) return
  exactKeys(template, ['kind', 'template'], context.issues, path)
  if (template.kind !== 'template') add(context.issues, 'invalid_literal', `${path}.kind`, 'templatable value kind must be template')
  validateTemplateString(template.template, `${path}.template`, context)
}

function validateTemplateString(value: unknown, path: string, context: ValidationContext): void {
  const text = stringValue(value, context.issues, path, { nonEmpty: true })
  if (text === undefined) return
  if (context.templateScopeDepth === 0) {
    add(context.issues, 'invalid_template_syntax', path, 'template syntax is only valid inside a text-list for body')
    return
  }
  const issue = scopedTemplateSyntaxIssue(text)
  if (issue) add(context.issues, 'invalid_template_syntax', path, issue)
}

function validateArtifact(value: unknown, path: string, context: ValidationContext): void {
  const source = object(value, context.issues, path)
  if (!source) return
  exactKeys(source, ['kind', 'stepId', 'artifact'], context.issues, path)
  if (source.kind !== 'step_artifact') add(context.issues, 'invalid_literal', `${path}.kind`, 'artifact source kind must be step_artifact')
  const stepId = stringValue(source.stepId, context.issues, `${path}.stepId`, { nonEmpty: true })
  const artifact = literal(source.artifact, ['captured_text', 'merged_text', 'extracted_text'], context.issues, `${path}.artifact`, 'unsupported artifact name')
  if (stepId && artifact && !context.artifactOutputs.get(stepId)?.has(artifact)) add(context.issues, 'invalid_reference', path, 'artifact source must reference an earlier compatible output')
}

function validateCondition(value: unknown, path: string, context: ValidationContext): void {
  const condition = object(value, context.issues, path)
  if (!condition) return
  exactKeys(condition, ['kind', 'source', 'matcher', 'scope'], context.issues, path)
  if (condition.kind !== 'text_match') add(context.issues, 'invalid_literal', `${path}.kind`, 'condition kind must be text_match')
  validateArtifact(condition.source, `${path}.source`, context)
  validateFilterMatcher(condition.matcher, `${path}.matcher`, context)
  const scope = object(condition.scope, context.issues, `${path}.scope`)
  if (!scope) return
  if (scope.kind === 'whole') exactKeys(scope, ['kind'], context.issues, `${path}.scope`)
  else if (scope.kind === 'lines') {
    exactKeys(scope, ['kind', 'mode'], context.issues, `${path}.scope`, ['includeEmptyLines'])
    literal(scope.mode, ['first', 'last', 'any', 'all'], context.issues, `${path}.scope.mode`, 'unsupported line scope mode')
    if (scope.includeEmptyLines !== undefined) booleanValue(scope.includeEmptyLines, context.issues, `${path}.scope.includeEmptyLines`)
  } else add(context.issues, 'invalid_literal', `${path}.scope.kind`, 'scope kind must be whole or lines')
}

function validateFilter(value: unknown, path: string, context: ValidationContext): void {
  const filter = object(value, context.issues, path)
  if (!filter) return
  exactKeys(filter, ['kind', 'matcher'], context.issues, path)
  literal(filter.kind, ['include', 'exclude'], context.issues, `${path}.kind`, 'filter kind must be include or exclude')
  validateFilterMatcher(filter.matcher, `${path}.matcher`, context)
}

function validateFilterMatcher(value: unknown, path: string, context: ValidationContext): void {
  const matcher = object(value, context.issues, path)
  if (!matcher) return
  if (matcher.kind === 'simple') {
    exactKeys(matcher, ['kind', 'op', 'text'], context.issues, path)
    literal(matcher.op, ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with'], context.issues, `${path}.op`, 'unsupported simple match operation')
    stringValue(matcher.text, context.issues, `${path}.text`)
  } else if (matcher.kind === 'regex') {
    exactKeys(matcher, ['kind', 'pattern'], context.issues, path, ['flags'])
    validateRegex(matcher.pattern, matcher.flags, path, context)
  } else add(context.issues, 'invalid_literal', `${path}.kind`, 'matcher kind must be simple or regex')
}

function validateSplit(value: unknown, path: string, context: ValidationContext): void {
  const split = object(value, context.issues, path)
  if (!split) return
  if (split.kind === 'lines') {
    exactKeys(split, ['kind', 'keepEmpty'], context.issues, path)
    booleanValue(split.keepEmpty, context.issues, `${path}.keepEmpty`)
  } else if (split.kind === 'regex') {
    exactKeys(split, ['kind', 'pattern', 'keepEmpty'], context.issues, path, ['flags'])
    validateRegex(split.pattern, split.flags, path, context)
    booleanValue(split.keepEmpty, context.issues, `${path}.keepEmpty`)
  } else add(context.issues, 'invalid_literal', `${path}.kind`, 'split kind must be lines or regex')
}

function validateSelect(value: unknown, path: string, context: ValidationContext): void {
  const select = object(value, context.issues, path)
  if (!select) return
  if (select.mode === 'all') exactKeys(select, ['mode'], context.issues, path)
  else if (select.mode === 'index') {
    exactKeys(select, ['mode', 'index'], context.issues, path)
    integerValue(select.index, context.issues, `${path}.index`)
  } else if (select.mode === 'range') {
    exactKeys(select, ['mode', 'start'], context.issues, path, ['end'])
    integerValue(select.start, context.issues, `${path}.start`)
    if (select.end !== undefined) integerValue(select.end, context.issues, `${path}.end`)
  } else add(context.issues, 'invalid_literal', `${path}.mode`, 'select mode must be all, index or range')
}

function validateExtractSpec(value: unknown, path: string, context: ValidationContext): void {
  const extract = object(value, context.issues, path)
  if (!extract) return
  if (extract.kind === 'none') exactKeys(extract, ['kind'], context.issues, path)
  else if (extract.kind === 'regex') {
    exactKeys(extract, ['kind', 'pattern', 'group'], context.issues, path, ['flags'])
    validateRegex(extract.pattern, extract.flags, path, context)
    if (!((typeof extract.group === 'string' && extract.group.length > 0) || Number.isInteger(extract.group))) add(context.issues, 'invalid_literal', `${path}.group`, 'regex group must be an integer or non-empty string')
  } else add(context.issues, 'invalid_literal', `${path}.kind`, 'extract kind must be none or regex')
}

function validateRegex(pattern: unknown, flags: unknown, path: string, context: ValidationContext): void {
  const patternValue = stringValue(pattern, context.issues, `${path}.pattern`)
  const flagsValue = flags === undefined ? '' : stringValue(flags, context.issues, `${path}.flags`)
  if (flagsValue !== undefined && !REGEX_FLAGS.test(flagsValue)) add(context.issues, 'invalid_regex', `${path}.flags`, 'regex flags may only contain i, m or s')
  if (patternValue !== undefined && flagsValue !== undefined) {
    try { new RegExp(patternValue, flagsValue) }
    catch { add(context.issues, 'invalid_regex', `${path}.pattern`, 'invalid regular expression') }
  }
}

function validateTerminalUse(value: unknown, capability: 'send' | 'input' | 'terminal-quiet' | 'terminal-buffer' | 'text-box' | 'agent-event' | 'parallel', path: string, context: ValidationContext): number | undefined {
  const index = positiveInteger(value, context.issues, path)
  if (index === undefined) return undefined
  const type = context.layout.get(index)
  if (!type) {
    add(context.issues, 'terminal_reference_missing', path, 'terminalIndex must exist in terminalLayout')
    return index
  }
  const allowed = type === 'shell'
    ? capability !== 'text-box'
    : capability === 'send' || capability === 'input' || capability === 'text-box' || capability === 'parallel'
  if (!allowed) add(context.issues, 'terminal_capability_mismatch', path, `${capability} is not supported by ${type} terminal`)
  return index
}

function validateIdentifier(value: unknown, issues: MacroDefinitionIssue[], path: string, seen: Set<string>): void {
  const identifier = stringValue(value, issues, path, { nonEmpty: true })
  if (!identifier) return
  if (!IDENTIFIER.test(identifier)) add(issues, 'invalid_identifier', path, 'identifier must start with a letter or digit and contain at most 64 letters, digits, underscores or hyphens')
  if (seen.has(identifier)) add(issues, 'duplicate_identifier', path, 'identifier must be unique')
  seen.add(identifier)
}

function validatePublicIdentifier(value: unknown, issues: MacroDefinitionIssue[], path: string): void {
  const identifier = stringValue(value, issues, path, { nonEmpty: true })
  if (identifier !== undefined && !IDENTIFIER.test(identifier)) {
    add(issues, 'invalid_identifier', path, 'identifier must start with a letter or digit and contain at most 64 letters, digits, underscores or hyphens')
  }
}

function registerArtifact(context: ValidationContext, stepId: string, artifact: string): void {
  const existing = context.artifactOutputs.get(stepId) ?? new Set<string>()
  existing.add(artifact)
  context.artifactOutputs.set(stepId, existing)
}

function childContext(context: ValidationContext, changes: Partial<Pick<ValidationContext, 'loopDepth' | 'templateScopeDepth'>> = {}): ValidationContext {
  return {
    ...context,
    ...changes,
    artifactOutputs: new Map([...context.artifactOutputs.entries()].map(([stepId, artifacts]) => [stepId, new Set(artifacts)])),
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: InvalidJsonError } {
  const syntaxOffset = jsonSyntaxErrorOffset(text)
  if (syntaxOffset !== null) {
    const offset = syntaxOffset
    const position = lineAndColumn(text, offset)
    return { ok: false, error: { code: 'invalid_json', offset, ...position, message: `Invalid JSON at line ${position.line}, column ${position.column}` } }
  }
  return { ok: true, value: JSON.parse(text) as unknown }
}

function jsonSyntaxErrorOffset(text: string): number | null {
  let index = 0
  const whitespace = () => { while (index < text.length && (text[index] === ' ' || text[index] === '\t' || text[index] === '\r' || text[index] === '\n')) index += 1 }
  const literal = (expected: string): number | null => {
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (text[index + offset] !== expected[offset]) return Math.min(text.length, index + offset)
    }
    index += expected.length
    return null
  }
  const string = (): number | null => {
    if (text[index] !== '"') return index
    index += 1
    while (index < text.length) {
      const code = text.charCodeAt(index)
      if (text[index] === '"') { index += 1; return null }
      if (code < 0x20) return index
      if (text[index] !== '\\') { index += 1; continue }
      index += 1
      if (index >= text.length) return text.length
      if ('"\\/bfnrt'.includes(text[index])) { index += 1; continue }
      if (text[index] !== 'u') return index
      index += 1
      for (let count = 0; count < 4; count += 1) {
        if (index >= text.length || !/[0-9A-Fa-f]/.test(text[index])) return Math.min(index, text.length)
        index += 1
      }
    }
    return text.length
  }
  const number = (): number | null => {
    if (text[index] === '-') index += 1
    if (text[index] === '0') index += 1
    else {
      if (!/[1-9]/.test(text[index] ?? '')) return index
      while (/[0-9]/.test(text[index] ?? '')) index += 1
    }
    if (text[index] === '.') {
      index += 1
      if (!/[0-9]/.test(text[index] ?? '')) return index
      while (/[0-9]/.test(text[index] ?? '')) index += 1
    }
    if (text[index] === 'e' || text[index] === 'E') {
      index += 1
      if (text[index] === '+' || text[index] === '-') index += 1
      if (!/[0-9]/.test(text[index] ?? '')) return index
      while (/[0-9]/.test(text[index] ?? '')) index += 1
    }
    return null
  }
  const value = (): number | null => {
    whitespace()
    const token = text[index]
    if (token === '"') return string()
    if (token === '{') return object()
    if (token === '[') return array()
    if (token === 't') return literal('true')
    if (token === 'f') return literal('false')
    if (token === 'n') return literal('null')
    if (token === '-' || /[0-9]/.test(token ?? '')) return number()
    return index
  }
  const object = (): number | null => {
    index += 1
    whitespace()
    if (text[index] === '}') { index += 1; return null }
    while (index < text.length) {
      const keyIssue = string()
      if (keyIssue !== null) return keyIssue
      whitespace()
      if (text[index] !== ':') return index
      index += 1
      const valueIssue = value()
      if (valueIssue !== null) return valueIssue
      whitespace()
      if (text[index] === '}') { index += 1; return null }
      if (text[index] !== ',') return index
      index += 1
      whitespace()
    }
    return text.length
  }
  const array = (): number | null => {
    index += 1
    whitespace()
    if (text[index] === ']') { index += 1; return null }
    while (index < text.length) {
      const valueIssue = value()
      if (valueIssue !== null) return valueIssue
      whitespace()
      if (text[index] === ']') { index += 1; return null }
      if (text[index] !== ',') return index
      index += 1
      whitespace()
    }
    return text.length
  }
  whitespace()
  const issue = value()
  if (issue !== null) return issue
  whitespace()
  return index === text.length ? null : index
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let column = 1
  let index = 0
  while (index < offset) {
    const code = text.charCodeAt(index)
    if (code === 13) {
      if (index + 1 < offset && text.charCodeAt(index + 1) === 10) index += 1
      line += 1
      column = 1
    } else if (code === 10) {
      line += 1
      column = 1
    } else column += 1
    index += 1
  }
  return { line, column }
}

function object(value: unknown, issues: MacroDefinitionIssue[], path: string): RecordValue | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    add(issues, 'expected_object', path, 'value must be an object')
    return undefined
  }
  return value as RecordValue
}

function exactKeys(value: RecordValue, required: readonly string[], issues: MacroDefinitionIssue[], path: string, optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) if (!allowed.has(key)) add(issues, 'unknown_field', childPath(path, key), `unknown field: ${key}`)
  for (const key of required) if (!Object.hasOwn(value, key)) add(issues, 'missing_field', childPath(path, key), `${key} is required`)
}

function childPath(path: string, key: string): string { return path ? `${path}.${key}` : key }

function stringValue(value: unknown, issues: MacroDefinitionIssue[], path: string, options: { nonEmpty?: boolean } = {}): string | undefined {
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

function booleanValue(value: unknown, issues: MacroDefinitionIssue[], path: string): boolean | undefined {
  if (typeof value !== 'boolean') {
    add(issues, 'expected_boolean', path, 'value must be boolean')
    return undefined
  }
  return value
}

function positiveInteger(value: unknown, issues: MacroDefinitionIssue[], path: string): number | undefined {
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

function integerValue(value: unknown, issues: MacroDefinitionIssue[], path: string): number | undefined {
  if (!Number.isInteger(value)) {
    add(issues, 'expected_integer', path, 'value must be an integer')
    return undefined
  }
  return value as number
}

function literal<T extends string>(value: unknown, values: readonly T[], issues: MacroDefinitionIssue[], path: string, message: string): T | undefined {
  if (!values.includes(value as T)) {
    add(issues, 'invalid_literal', path, message)
    return undefined
  }
  return value as T
}

function add(issues: MacroDefinitionIssue[], code: MacroDefinitionIssueCode, path: string, message: string): void {
  issues.push({ code, path, message })
}

function finishIssues(issues: MacroDefinitionIssue[]): MacroDefinitionIssue[] {
  const unique = new Map<string, MacroDefinitionIssue>()
  for (const issue of issues) unique.set(`${issue.path}\u0000${issue.code}`, issue)
  return [...unique.values()].sort((left, right) => {
    const path = compareCodePoints(left.path, right.path)
    return path === 0 ? compareCodePoints(left.code, right.code) : path
  })
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map((value) => value.codePointAt(0)!)
  const rightPoints = [...right].map((value) => value.codePointAt(0)!)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index]
  return leftPoints.length - rightPoints.length
}
