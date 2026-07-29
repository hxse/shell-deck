import type { ParallelNode } from './macroDefinitionTypes'
import { add, childContext, type ValidationContext } from './macroValidationContext'
import {
  booleanValue,
  exactKeys,
  literal,
  object,
  positiveInteger,
  stringValue,
  validateIdentifier,
  type RecordValue,
} from './macroValidationPrimitives'
import { buildParallelTerminalUsage } from './parallelTerminalUsage'
import { validateArtifactReference } from './macroReferenceValidation'
import { validateFilterMatcher } from './macroTextMatchValidation'
import { validateJsonPointer } from './structuredJson'

type NodeValidator = (
  value: unknown,
  path: string,
  context: ValidationContext,
  actionOnly: boolean,
  inheritedTerminalIndex: number | null | undefined,
) => void

type NodeListValidator = (
  value: unknown,
  path: string,
  context: ValidationContext,
  requireNonEmpty: boolean,
  actionOnly: boolean,
) => void

export function validateParallel(
  node: RecordValue,
  path: string,
  context: ValidationContext,
  validateNode: NodeValidator,
): void {
  exactKeys(node, ['id', 'type', 'lanes', 'sharedTextOrder', 'onLaneFail'], context.issues, path)
  if (!Array.isArray(node.lanes)) add(context.issues, 'expected_array', `${path}.lanes`, 'lanes must be an array')
  else {
    if (node.lanes.length === 0) add(context.issues, 'invalid_range', `${path}.lanes`, 'parallel must declare at least one lane')
    const laneIds = new Set<string>()
    const laneLabels = new Set<string>()
    node.lanes.forEach((value, index) => {
      const lanePath = `${path}.lanes[${index}]`
      const lane = object(value, context.issues, lanePath)
      if (!lane) return
      exactKeys(lane, ['id', 'label', 'body'], context.issues, lanePath)
      validateIdentifier(lane.id, context.issues, `${lanePath}.id`, laneIds)
      const label = stringValue(lane.label, context.issues, `${lanePath}.label`)
      if (label?.trim()) {
        const normalized = label.trim()
        if (laneLabels.has(normalized)) add(context.issues, 'semantic_conflict', `${lanePath}.label`, 'parallel lane labels must be unique')
        laneLabels.add(normalized)
      }
      validateParallelLaneBody(lane.body, `${lanePath}.body`, context, validateNode)
    })
    validateParallelTerminalUsage(node as unknown as ParallelNode, path, context)
  }
  literal(node.sharedTextOrder, ['pane_order', 'completion_order'], context.issues, `${path}.sharedTextOrder`, 'sharedTextOrder must be pane_order or completion_order')
  literal(node.onLaneFail, ['pause', 'fail'], context.issues, `${path}.onLaneFail`, 'onLaneFail must be pause or fail')
}

function validateParallelLaneBody(
  value: unknown,
  path: string,
  context: ValidationContext,
  validateNode: NodeValidator,
): void {
  if (!Array.isArray(value)) {
    add(context.issues, 'expected_array', path, 'parallel lane body must be an array')
    return
  }
  const laneContext = childContext(context)
  value.forEach((child, childIndex) => {
    const childPath = `${path}[${childIndex}]`
    const childRecord = object(child, context.issues, childPath)
    if (!childRecord) return
    if (typeof childRecord.type !== 'string') {
      validateIdentifier(childRecord.id, context.issues, `${childPath}.id`, context.nodeIds)
      add(context.issues, 'expected_string', `${childPath}.type`, 'parallel lane node type must be a string')
      return
    }
    if (!['send', 'notify', 'wait', 'capture-source', 'extract_text'].includes(childRecord.type)) {
      validateIdentifier(childRecord.id, context.issues, `${childPath}.id`, context.nodeIds)
      add(context.issues, 'semantic_conflict', `${childPath}.type`, 'parallel pane only supports send, notify, wait, capture-source and extract_text')
      return
    }
    validateNode(child, childPath, laneContext, false, undefined)
    if (childRecord.type === 'wait' && childRecord.mode === 'user-continue') {
      add(context.issues, 'semantic_conflict', `${childPath}.mode`, 'parallel pane wait must not use user-continue')
    }
    if (
      childRecord.type === 'capture-source'
      && childRecord.capture
      && typeof childRecord.capture === 'object'
      && (childRecord.capture as { kind?: unknown }).kind === 'structured-json'
    ) {
      add(context.issues, 'semantic_conflict', `${childPath}.capture.kind`, 'structured-json capture is only supported in root flow')
    }
  })
}

function validateParallelTerminalUsage(
  node: ParallelNode,
  path: string,
  context: ValidationContext,
): void {
  const usage = buildParallelTerminalUsage(node, context.layout)
  for (const conflict of usage.conflicts) {
    const issuePath = `${path}.${conflict.use.referencePath}`
    if (conflict.kind === 'shell_shared') {
      add(
        context.issues,
        'semantic_conflict',
        issuePath,
        `Shell ${conflict.use.terminalIndex} is owned by ${conflict.ownerLaneId} and cannot be shared across parallel panes`,
      )
    } else {
      add(
        context.issues,
        'semantic_conflict',
        issuePath,
        `shared Text ${conflict.use.terminalIndex} only supports Send append inside parallel panes`,
      )
    }
  }
}

export function validateIf(
  node: RecordValue,
  path: string,
  context: ValidationContext,
  validateNodeList: NodeListValidator,
): void {
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

export function validateFor(
  node: RecordValue,
  path: string,
  context: ValidationContext,
  validateNodeList: NodeListValidator,
): void {
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

export function validateTerminalControl(
  node: RecordValue,
  path: string,
  context: ValidationContext,
  validateNodeList: NodeListValidator,
): void {
  exactKeys(node, ['id', 'type'], context.issues, path, ['reason', 'body'])
  if ((node.type === 'break' || node.type === 'continue') && context.loopDepth === 0) add(context.issues, 'semantic_conflict', `${path}.type`, `${node.type} must be inside a for node`)
  if (node.reason !== undefined) stringValue(node.reason, context.issues, `${path}.reason`, { nonEmpty: true })
  if (node.body !== undefined) validateNodeList(node.body, `${path}.body`, childContext(context), false, true)
}

function validateCondition(value: unknown, path: string, context: ValidationContext): void {
  const condition = object(value, context.issues, path)
  if (!condition) return
  if (condition.kind === 'json_match') {
    exactKeys(condition, ['kind', 'source', 'pointer', 'matcher'], context.issues, path)
    validateArtifactReference(condition.source, `${path}.source`, context, 'json')
    const pointerIssue = validateJsonPointer(condition.pointer)
    if (pointerIssue) add(context.issues, 'invalid_json_pointer', `${path}.pointer`, pointerIssue)
    validateJsonMatcher(condition.matcher, `${path}.matcher`, context)
    return
  }
  exactKeys(condition, ['kind', 'source', 'matcher', 'scope'], context.issues, path)
  if (condition.kind !== 'text_match') add(context.issues, 'invalid_literal', `${path}.kind`, 'condition kind must be text_match or json_match')
  validateArtifactReference(condition.source, `${path}.source`, context, 'serializable')
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

function validateJsonMatcher(value: unknown, path: string, context: ValidationContext): void {
  const matcher = object(value, context.issues, path)
  if (!matcher) return
  if (matcher.kind === 'exists' || matcher.kind === 'not_exists') {
    exactKeys(matcher, ['kind'], context.issues, path)
    return
  }
  if (matcher.kind === 'equals' || matcher.kind === 'not_equals') {
    exactKeys(matcher, ['kind', 'value'], context.issues, path)
    if (!isJsonScalar(matcher.value)) add(context.issues, 'invalid_literal', `${path}.value`, 'JSON equality value must be a scalar')
    return
  }
  if (['less_than', 'less_than_or_equal', 'greater_than', 'greater_than_or_equal'].includes(String(matcher.kind))) {
    exactKeys(matcher, ['kind', 'value'], context.issues, path)
    if (typeof matcher.value !== 'number' || !Number.isFinite(matcher.value)) {
      add(context.issues, 'expected_number', `${path}.value`, 'JSON numeric matcher value must be a finite number')
    }
    return
  }
  add(context.issues, 'invalid_literal', `${path}.kind`, 'unsupported JSON match operation')
}

function isJsonScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}
