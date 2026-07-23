import { isTerminalEnding } from './terminalEnding'
import { isTerminalInputDelivery } from './terminalInputDelivery'
import { add, registerArtifact, type ValidationContext } from './macroValidationContext'
import {
  booleanValue,
  exactKeys,
  integerValue,
  literal,
  object,
  positiveInteger,
  stringValue,
  validatePublicIdentifier,
  validateRegex,
  validateTemplateString,
  type RecordValue,
} from './macroValidationPrimitives'
import {
  validateArtifactReference,
  validateAssignedArtifact,
  validateTerminalSlot,
} from './macroReferenceValidation'
import { validateFilterMatcher } from './macroTextMatchValidation'

export function validateSend(node: RecordValue, path: string, context: ValidationContext, inherited: number | null | undefined): void {
  exactKeys(node, inherited === undefined ? ['id', 'type', 'terminal', 'message', 'delivery', 'ending'] : ['id', 'type', 'message', 'delivery', 'ending'], context.issues, path)
  validateTerminalSlot(node.terminal, inherited, 'send', `${path}.terminal`, context)
  validateMessage(node.message, `${path}.message`, context)
  if (!isTerminalInputDelivery(node.delivery)) add(context.issues, 'invalid_literal', `${path}.delivery`, 'delivery must be auto, direct-bytes or bracketed-paste')
  if (!isTerminalEnding(node.ending)) add(context.issues, 'invalid_literal', `${path}.ending`, 'ending must be none, lf, cr or crlf')
}

export function validateInput(node: RecordValue, path: string, context: ValidationContext, inherited: number | null | undefined): void {
  exactKeys(node, inherited === undefined ? ['id', 'type', 'terminal', 'prompt', 'allowEmpty', 'delivery', 'ending'] : ['id', 'type', 'prompt', 'allowEmpty', 'delivery', 'ending'], context.issues, path, ['defaultSource'])
  validateTerminalSlot(node.terminal, inherited, 'input', `${path}.terminal`, context)
  validateTemplatable(node.prompt, `${path}.prompt`, context, true)
  booleanValue(node.allowEmpty, context.issues, `${path}.allowEmpty`)
  if (!isTerminalInputDelivery(node.delivery)) add(context.issues, 'invalid_literal', `${path}.delivery`, 'delivery must be auto, direct-bytes or bracketed-paste')
  if (!isTerminalEnding(node.ending)) add(context.issues, 'invalid_literal', `${path}.ending`, 'ending must be none, lf, cr or crlf')
  if (node.defaultSource !== undefined) validateAssignedArtifact(node.defaultSource, `${path}.defaultSource`, context)
}

export function validateNotify(node: RecordValue, path: string, context: ValidationContext): void {
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

export function validateWait(node: RecordValue, path: string, context: ValidationContext, inherited: number | null | undefined): void {
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

export function validateCaptureNode(node: RecordValue, path: string, context: ValidationContext, inherited: number | null | undefined): void {
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

export function validateExtract(node: RecordValue, path: string, context: ValidationContext): void {
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

function validateFilter(value: unknown, path: string, context: ValidationContext): void {
  const filter = object(value, context.issues, path)
  if (!filter) return
  exactKeys(filter, ['kind', 'matcher'], context.issues, path)
  literal(filter.kind, ['include', 'exclude'], context.issues, `${path}.kind`, 'filter kind must be include or exclude')
  validateFilterMatcher(filter.matcher, `${path}.matcher`, context)
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
