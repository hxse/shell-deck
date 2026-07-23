import { add, childContext, registerArtifact, type ValidationContext } from './macroValidationContext'
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
import {
  validateArtifactReference,
  validateAssignedArtifact,
  validateTerminalReference,
} from './macroReferenceValidation'
import { validateFilterMatcher } from './macroTextMatchValidation'

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
      exactKeys(lane, ['id', 'label', 'terminal', 'body'], context.issues, lanePath)
      validateIdentifier(lane.id, context.issues, `${lanePath}.id`, laneIds)
      const label = stringValue(lane.label, context.issues, `${lanePath}.label`)
      if (label?.trim()) {
        const normalized = label.trim()
        if (laneLabels.has(normalized)) add(context.issues, 'semantic_conflict', `${lanePath}.label`, 'parallel lane labels must be unique')
        laneLabels.add(normalized)
      }
      const terminalIndex = validateTerminalReference(lane.terminal, 'parallel', `${lanePath}.terminal`, context)
      if (typeof terminalIndex === 'number') {
        if (terminalIndexes.has(terminalIndex)) add(context.issues, 'semantic_conflict', `${lanePath}.terminal`, 'parallel lanes must use distinct assigned terminal indexes')
        terminalIndexes.add(terminalIndex)
      }
      validateParallelLaneBody(lane.body, `${lanePath}.body`, context, terminalIndex, validateNode)
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

function validateParallelLaneBody(
  value: unknown,
  path: string,
  context: ValidationContext,
  terminalIndex: number | null | undefined,
  validateNode: NodeValidator,
): void {
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
      else validateAssignedArtifact(childRecord.source, `${childPath}.source`, outputContext)
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
  exactKeys(condition, ['kind', 'source', 'matcher', 'scope'], context.issues, path)
  if (condition.kind !== 'text_match') add(context.issues, 'invalid_literal', `${path}.kind`, 'condition kind must be text_match')
  validateArtifactReference(condition.source, `${path}.source`, context)
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
