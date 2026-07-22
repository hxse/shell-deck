import { isTerminalEnding } from './terminalEnding'
import { isTerminalInputDelivery } from './terminalInputDelivery'
import { add, childContext, registerArtifact, type ValidationContext } from './macroValidationContext'
import {
  booleanValue,
  exactKeys,
  integerValue,
  literal,
  object,
  positiveInteger,
  stringValue,
  validateIdentifier,
  validatePublicIdentifier,
  validateRegex,
  validateTemplateString,
  type RecordValue,
} from './macroValidationPrimitives'
import {
  validateArtifactReference,
  validateAssignedArtifact,
  validateTerminalReference,
  validateTerminalSlot,
} from './macroReferenceValidation'

export function validateNodeList(value: unknown, path: string, context: ValidationContext, requireNonEmpty: boolean, actionOnly: boolean): void {
  if (!Array.isArray(value)) {
    add(context.issues, 'expected_array', path, 'body must be an array')
    return
  }
  if (requireNonEmpty && value.length === 0) add(context.issues, 'invalid_range', path, 'body must not be empty')
  value.forEach((node, index) => validateNode(node, `${path}[${index}]`, context, actionOnly, undefined))
}

function validateNode(value: unknown, path: string, context: ValidationContext, actionOnly: boolean, inheritedTerminalIndex: number | null | undefined): void {
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

function validateSend(node: RecordValue, path: string, context: ValidationContext, inherited: number | null | undefined): void {
  exactKeys(node, inherited === undefined ? ['id', 'type', 'terminal', 'message', 'delivery', 'ending'] : ['id', 'type', 'message', 'delivery', 'ending'], context.issues, path)
  validateTerminalSlot(node.terminal, inherited, 'send', `${path}.terminal`, context)
  validateMessage(node.message, `${path}.message`, context)
  if (!isTerminalInputDelivery(node.delivery)) add(context.issues, 'invalid_literal', `${path}.delivery`, 'delivery must be auto, direct-bytes or bracketed-paste')
  if (!isTerminalEnding(node.ending)) add(context.issues, 'invalid_literal', `${path}.ending`, 'ending must be none, lf, cr or crlf')
}

function validateInput(node: RecordValue, path: string, context: ValidationContext, inherited: number | null | undefined): void {
  exactKeys(node, inherited === undefined ? ['id', 'type', 'terminal', 'prompt', 'allowEmpty', 'delivery', 'ending'] : ['id', 'type', 'prompt', 'allowEmpty', 'delivery', 'ending'], context.issues, path, ['defaultSource'])
  validateTerminalSlot(node.terminal, inherited, 'input', `${path}.terminal`, context)
  validateTemplatable(node.prompt, `${path}.prompt`, context, true)
  booleanValue(node.allowEmpty, context.issues, `${path}.allowEmpty`)
  if (!isTerminalInputDelivery(node.delivery)) add(context.issues, 'invalid_literal', `${path}.delivery`, 'delivery must be auto, direct-bytes or bracketed-paste')
  if (!isTerminalEnding(node.ending)) add(context.issues, 'invalid_literal', `${path}.ending`, 'ending must be none, lf, cr or crlf')
  if (node.defaultSource !== undefined) validateAssignedArtifact(node.defaultSource, `${path}.defaultSource`, context)
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
    exactKeys(channel, ['kind', 'toast', 'sound', 'repeatCount', 'repeatIntervalMs'], context.issues, path)
    booleanValue(channel.toast, context.issues, `${path}.toast`)
    literal(channel.sound, ['none', 'bell', 'chime', 'ping', 'pulse', 'success', 'warning', 'alert'], context.issues, `${path}.sound`, 'unsupported notification sound')
    const repeatCount = integerValue(channel.repeatCount, context.issues, `${path}.repeatCount`)
    if (repeatCount !== undefined && (repeatCount < 1 || repeatCount > 10)) {
      add(context.issues, 'invalid_range', `${path}.repeatCount`, 'repeatCount must be between 1 and 10')
    }
    const repeatIntervalMs = integerValue(channel.repeatIntervalMs, context.issues, `${path}.repeatIntervalMs`)
    if (repeatIntervalMs !== undefined && (repeatIntervalMs < 250 || repeatIntervalMs > 60000)) {
      add(context.issues, 'invalid_range', `${path}.repeatIntervalMs`, 'repeatIntervalMs must be between 250 and 60000')
    }
  } else if (channel.kind === 'system') exactKeys(channel, ['kind'], context.issues, path)
  else if (channel.kind === 'telegram') {
    exactKeys(channel, ['kind', 'profileId'], context.issues, path)
    validatePublicIdentifier(channel.profileId, context.issues, `${path}.profileId`)
  } else add(context.issues, 'invalid_literal', `${path}.kind`, 'channel kind must be app, system or telegram')
}

function validateWait(node: RecordValue, path: string, context: ValidationContext, inherited: number | null | undefined): void {
  if (node.mode === 'duration') {
    exactKeys(node, ['id', 'type', 'mode', 'durationMs'], context.issues, path)
    positiveInteger(node.durationMs, context.issues, `${path}.durationMs`)
  } else if (node.mode === 'terminal-quiet') {
    exactKeys(node, inherited === undefined ? ['id', 'type', 'mode', 'terminal', 'quietMs', 'maxMs', 'onTimeout'] : ['id', 'type', 'mode', 'quietMs', 'maxMs', 'onTimeout'], context.issues, path)
    validateTerminalSlot(node.terminal, inherited, 'terminal-quiet', `${path}.terminal`, context)
    const quietMs = positiveInteger(node.quietMs, context.issues, `${path}.quietMs`)
    const maxMs = positiveInteger(node.maxMs, context.issues, `${path}.maxMs`)
    if (quietMs !== undefined && maxMs !== undefined && maxMs < quietMs) add(context.issues, 'invalid_range', `${path}.maxMs`, 'maxMs must be greater than or equal to quietMs')
    literal(node.onTimeout, ['pause', 'finish'], context.issues, `${path}.onTimeout`, 'onTimeout must be pause or finish')
  } else if (node.mode === 'user-continue') {
    exactKeys(node, ['id', 'type', 'mode', 'prompt'], context.issues, path)
    validateTemplatable(node.prompt, `${path}.prompt`, context, true)
  } else add(context.issues, 'invalid_literal', `${path}.mode`, 'wait mode must be duration, terminal-quiet or user-continue')
}

function validateCaptureNode(node: RecordValue, path: string, context: ValidationContext, inherited: number | null | undefined): void {
  exactKeys(node, ['id', 'type', 'capture'], context.issues, path)
  const capture = object(node.capture, context.issues, `${path}.capture`)
  if (!capture) return
  const inheritedKeys = inherited === undefined ? ['terminal'] : []
  if (capture.kind === 'terminal-buffer') {
    exactKeys(capture, ['kind', ...inheritedKeys, 'mode', 'maxChars'], context.issues, `${path}.capture`)
    validateTerminalSlot(capture.terminal, inherited, 'terminal-buffer', `${path}.capture.terminal`, context)
    literal(capture.mode, ['scrollback-tail', 'raw-stream-tail'], context.issues, `${path}.capture.mode`, 'unsupported terminal-buffer mode')
    positiveInteger(capture.maxChars, context.issues, `${path}.capture.maxChars`)
  } else if (capture.kind === 'text-box') {
    exactKeys(capture, ['kind', ...inheritedKeys], context.issues, `${path}.capture`)
    validateTerminalSlot(capture.terminal, inherited, 'text-box', `${path}.capture.terminal`, context)
  } else if (capture.kind === 'agent-event') {
    exactKeys(capture, ['kind', ...inheritedKeys, 'agent', 'captureMode', 'waitLimit'], context.issues, `${path}.capture`)
    validateTerminalSlot(capture.terminal, inherited, 'agent-event', `${path}.capture.terminal`, context)
    const agent = object(capture.agent, context.issues, `${path}.capture.agent`)
    if (agent) {
      exactKeys(agent, ['kind'], context.issues, `${path}.capture.agent`)
      if (agent.kind !== 'codex') add(context.issues, 'invalid_literal', `${path}.capture.agent.kind`, 'agent kind must be codex')
    }
    literal(capture.captureMode, ['result_only', 'prompt_only', 'prompt_and_result'], context.issues, `${path}.capture.captureMode`, 'unsupported agent capture mode')
    validateAgentEventWaitLimit(capture.waitLimit, `${path}.capture.waitLimit`, context)
  } else add(context.issues, 'invalid_literal', `${path}.capture.kind`, 'capture kind must be terminal-buffer, text-box or agent-event')
  if (typeof node.id === 'string') registerArtifact(context, node.id, 'captured_text')
}

function validateAgentEventWaitLimit(value: unknown, path: string, context: ValidationContext): void {
  const waitLimit = object(value, context.issues, path)
  if (!waitLimit) return
  if (waitLimit.kind === 'unbounded') exactKeys(waitLimit, ['kind'], context.issues, path)
  else if (waitLimit.kind === 'timeout') {
    exactKeys(waitLimit, ['kind', 'timeoutMs'], context.issues, path)
    positiveInteger(waitLimit.timeoutMs, context.issues, `${path}.timeoutMs`)
  } else add(context.issues, 'invalid_literal', `${path}.kind`, 'waitLimit kind must be unbounded or timeout')
}

function validateExtract(node: RecordValue, path: string, context: ValidationContext): void {
  exactKeys(node, ['id', 'type', 'source', 'split', 'filters', 'select', 'extract', 'trim', 'onEmpty'], context.issues, path)
  validateArtifactReference(node.source, `${path}.source`, context)
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

function validateParallelLaneBody(value: unknown, path: string, context: ValidationContext, terminalIndex: number | null | undefined): void {
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
      exactKeys(part, ['kind', 'source'], context.issues, partPath)
      validateArtifactReference(part.source, `${partPath}.source`, context)
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
