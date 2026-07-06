import { assertValidPublicId } from "../identifier"
import type { TerminalIndexMapItem } from "../protocol"
import { validateTerminalTarget } from "./terminalRef"
import type {
  CaptureSourceConfig,
  FlowV2ArtifactSource,
  FlowV2Node,
  MacroTemplate,
  ParallelSendCaptureItem,
  TextMatchCondition,
  ValidationIssue,
  ValidationResult,
} from "./templateTypes"

export const FLOW_V2_ACTION_TYPES = ["send_line", "input_line", "wait", "capture-source", "extract_text", "parallel_send_capture"] as const
export const FLOW_V2_CONTROL_TYPES = ["if", "for", "break", "continue", "finish"] as const
export const FLOW_V2_FORBIDDEN_TYPES = ["sleep", "parse", "send_artifact", "parallel_all", "merge_parallel_results", "pause", "stop", "return", "goto", "branch", "complete", "fail"] as const

const ACTION_TYPES = new Set<string>(FLOW_V2_ACTION_TYPES)
const CONTROL_TYPES = new Set<string>(FLOW_V2_CONTROL_TYPES)
const FORBIDDEN_TYPES = new Set<string>(FLOW_V2_FORBIDDEN_TYPES)
const TEMPLATE_KEYS = new Set(["schemaVersion", "id", "name", "description", "configId", "body", "createdAt", "updatedAt"])
const LEGACY_FIELD_KEYS = new Set(["steps", "next", "loopGuard", "goto", "branch", "complete", "pause", "stop", "fail", "parser", "parse", "captureStep", "fromParseStep", "conditions", "lanes"])
const ARTIFACT_SOURCE_KEYS = new Set(["kind", "stepId", "artifact"])
const MESSAGE_KEYS = new Set(["parts"])
const TEXT_PART_KEYS = new Set(["kind", "text"])
const ARTIFACT_PART_KEYS = new Set(["kind", "source"])
const SEND_LINE_KEYS = new Set(["id", "type", "terminal", "message"])
const INPUT_LINE_KEYS = new Set(["id", "type", "terminal", "prompt", "allowEmpty", "defaultSource"])
const WAIT_DURATION_KEYS = new Set(["id", "type", "mode", "durationMs"])
const WAIT_TERMINAL_QUIET_KEYS = new Set(["id", "type", "mode", "terminal", "quietMs", "maxMs", "onTimeout"])
const WAIT_USER_CONTINUE_KEYS = new Set(["id", "type", "mode", "prompt"])
const WAIT_ANY_KEYS = new Set(["id", "type", "mode", "durationMs", "terminal", "quietMs", "maxMs", "onTimeout", "prompt"])
const CAPTURE_SOURCE_KEYS = new Set(["id", "type", "capture"])
const CAPTURE_TERMINAL_BUFFER_KEYS = new Set(["kind", "terminal", "mode", "maxChars"])
const CAPTURE_TEXT_BOX_KEYS = new Set(["kind", "terminal"])
const CAPTURE_AGENT_EVENT_KEYS = new Set(["kind", "agent", "terminal", "eventKind", "field"])
const AGENT_KEYS = new Set(["kind"])
const EXTRACT_TEXT_KEYS = new Set(["id", "type", "source", "split", "filters", "select", "extract", "trim", "onEmpty"])
const TEXT_SPLIT_LINES_KEYS = new Set(["kind", "keepEmpty"])
const TEXT_SPLIT_REGEX_KEYS = new Set(["kind", "pattern", "flags", "keepEmpty"])
const TEXT_FILTER_KEYS = new Set(["kind", "matcher"])
const TEXT_SELECT_ALL_KEYS = new Set(["mode"])
const TEXT_SELECT_INDEX_KEYS = new Set(["mode", "index"])
const TEXT_SELECT_RANGE_KEYS = new Set(["mode", "start", "end"])
const TEXT_EXTRACT_NONE_KEYS = new Set(["kind"])
const TEXT_EXTRACT_REGEX_KEYS = new Set(["kind", "pattern", "flags", "group"])
const PARALLEL_SEND_CAPTURE_KEYS = new Set(["id", "type", "items", "merge", "onItemFail"])
const PARALLEL_ITEM_KEYS = new Set(["id", "terminal", "send", "wait", "capture"])
const PARALLEL_MERGE_KEYS = new Set(["kind", "separator", "order", "includeEmptyCaptures"])
const IF_KEYS = new Set(["id", "type", "branches", "else"])
const IF_BRANCH_KEYS = new Set(["kind", "condition", "body"])
const CONDITION_KEYS = new Set(["kind", "source", "matcher", "scope"])
const SIMPLE_MATCHER_KEYS = new Set(["kind", "op", "text"])
const REGEX_MATCHER_KEYS = new Set(["kind", "pattern", "flags"])
const WHOLE_SCOPE_KEYS = new Set(["kind"])
const LINES_SCOPE_KEYS = new Set(["kind", "mode", "includeEmptyLines"])
const FOR_KEYS = new Set(["id", "type", "range", "body"])
const RANGE_COUNT_KEYS = new Set(["kind", "count"])
const RANGE_FOREVER_KEYS = new Set(["kind"])
const CONTROL_TERMINAL_KEYS = new Set(["id", "type", "reason", "body"])
const SIMPLE_OPS = new Set(["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with"])
const LINE_MODES = new Set(["first", "last", "any", "all"])
const REGEX_FLAGS_RE = /^[ims]*$/

type ValidateOptions = {
  indexMap?: TerminalIndexMapItem[]
}

type ValidationContext = {
  indexMap?: TerminalIndexMapItem[]
  nodeIds: Set<string>
  artifactOutputs: Map<string, Set<string>>
  loopDepth: number
}

export function validateFlowV2Template(value: unknown, options: ValidateOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!isObject(value)) return invalid("template", "Flow V2 template must be an object")
  rejectUnknownKeys(issues, "template", value, TEMPLATE_KEYS)
  rejectStringExpressionFields(issues, "template", value)
  rejectLegacyFields(issues, value, "")
  rejectSessionFields(issues, value, "")

  const template = value as MacroTemplate
  if (template.schemaVersion !== 2) issues.push({ path: "schemaVersion", message: "Flow V2 template schemaVersion must be 2" })
  validatePublicId(issues, "id", template.id)
  validatePublicId(issues, "configId", template.configId)
  validateString(issues, "name", template.name, 1)
  validateString(issues, "description", template.description, 0)
  validateIsoString(issues, "createdAt", template.createdAt)
  validateIsoString(issues, "updatedAt", template.updatedAt)
  const context: ValidationContext = { indexMap: options.indexMap, nodeIds: new Set(), artifactOutputs: new Map(), loopDepth: 0 }
  validateNodeList(issues, "body", template.body, context, false)
  return { ok: issues.length === 0, issues }
}

function validateNodeList(issues: ValidationIssue[], path: string, nodes: unknown, context: ValidationContext, requireNonEmpty: boolean) {
  if (!Array.isArray(nodes)) {
    issues.push({ path, message: "node body must be an array" })
    return
  }
  if (requireNonEmpty && nodes.length === 0) issues.push({ path, message: "node body must not be empty" })
  for (const [index, node] of nodes.entries()) validateNode(issues, path + "[" + index + "]", node, context)
}

function validateNode(issues: ValidationIssue[], path: string, node: unknown, context: ValidationContext) {
  if (!isObject(node)) {
    issues.push({ path, message: "node must be an object" })
    return
  }
  validateNodeId(issues, path + ".id", node.id, context)
  if (typeof node.type !== "string") {
    issues.push({ path: path + ".type", message: "node type must be a string" })
    return
  }
  if (FORBIDDEN_TYPES.has(node.type)) {
    issues.push({ path: path + ".type", message: node.type === "return" ? "return is unsupported in Flow V2; use finish" : "legacy Flow V1 node type is unsupported in Flow V2: " + node.type })
    return
  }
  if (ACTION_TYPES.has(node.type)) {
    validateActionNode(issues, path, node, context)
    return
  }
  if (CONTROL_TYPES.has(node.type)) {
    validateControlNode(issues, path, node, context)
    return
  }
  issues.push({ path: path + ".type", message: "unsupported Flow V2 node type" })
}

function validateActionOnlyNodeList(issues: ValidationIssue[], path: string, nodes: unknown, context: ValidationContext, requireNonEmpty: boolean) {
  if (!Array.isArray(nodes)) {
    issues.push({ path, message: "control action body must be an array" })
    return
  }
  if (requireNonEmpty && nodes.length === 0) issues.push({ path, message: "control action body must not be empty" })
  for (const [index, node] of nodes.entries()) {
    const nodePath = path + "[" + index + "]"
    if (!isObject(node)) {
      issues.push({ path: nodePath, message: "node must be an object" })
      continue
    }
    validateNodeId(issues, nodePath + ".id", node.id, context)
    if (typeof node.type !== "string") {
      issues.push({ path: nodePath + ".type", message: "node type must be a string" })
      continue
    }
    if (FORBIDDEN_TYPES.has(node.type)) {
      issues.push({ path: nodePath + ".type", message: node.type === "return" ? "return is unsupported in Flow V2; use finish" : "legacy Flow V1 node type is unsupported in Flow V2: " + node.type })
      continue
    }
    if (ACTION_TYPES.has(node.type)) {
      validateActionNode(issues, nodePath, node, context)
      continue
    }
    if (CONTROL_TYPES.has(node.type)) {
      issues.push({ path: nodePath + ".type", message: "finish/break/continue action body only supports action nodes" })
      continue
    }
    issues.push({ path: nodePath + ".type", message: "unsupported Flow V2 node type" })
  }
}

function validateActionNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  if (node.type === "send_line") {
    rejectUnknownKeys(issues, path, node, SEND_LINE_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", node.terminal, context.indexMap))
    validateMessageSpec(issues, path + ".message", node.message, context)
    return
  }
  if (node.type === "input_line") {
    rejectUnknownKeys(issues, path, node, INPUT_LINE_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", node.terminal, context.indexMap))
    validateString(issues, path + ".prompt", node.prompt, 1)
    if (typeof node.allowEmpty !== "boolean") issues.push({ path: path + ".allowEmpty", message: "allowEmpty must be boolean" })
    if (node.defaultSource !== undefined) validateArtifactSource(issues, path + ".defaultSource", node.defaultSource, context)
    return
  }
  if (node.type === "wait") {
    validateWaitNode(issues, path, node, context)
    return
  }
  if (node.type === "capture-source") {
    rejectUnknownKeys(issues, path, node, CAPTURE_SOURCE_KEYS)
    validateCaptureNodeConfig(issues, path + ".capture", node.capture, context)
    if (typeof node.id === "string") registerArtifactOutput(context, node.id, "captured_text")
    return
  }
  if (node.type === "extract_text") {
    validateExtractTextNode(issues, path, node, context)
    return
  }
  validateParallelSendCaptureNode(issues, path, node, context)
}

function validateWaitNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  if (node.mode === "duration") {
    rejectUnknownKeys(issues, path, node, WAIT_DURATION_KEYS)
    validatePositiveInt(issues, path + ".durationMs", node.durationMs)
    return
  }
  if (node.mode === "terminal-quiet") {
    rejectUnknownKeys(issues, path, node, WAIT_TERMINAL_QUIET_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", node.terminal, context.indexMap))
    validatePositiveInt(issues, path + ".quietMs", node.quietMs)
    validatePositiveInt(issues, path + ".maxMs", node.maxMs)
    if (Number.isInteger(node.quietMs) && Number.isInteger(node.maxMs) && Number(node.maxMs) < Number(node.quietMs)) issues.push({ path: path + ".maxMs", message: "maxMs must be greater than or equal to quietMs" })
    validateTimeoutAction(issues, path + ".onTimeout", node.onTimeout, new Set(["pause", "finish"]))
    return
  }
  if (node.mode === "user-continue") {
    rejectUnknownKeys(issues, path, node, WAIT_USER_CONTINUE_KEYS)
    validateString(issues, path + ".prompt", node.prompt, 1)
    return
  }
  rejectUnknownKeys(issues, path, node, WAIT_ANY_KEYS)
  issues.push({ path: path + ".mode", message: "wait mode must be duration, terminal-quiet or user-continue" })
}

function validateCaptureNodeConfig(issues: ValidationIssue[], path: string, capture: unknown, context: ValidationContext) {
  if (!isObject(capture)) {
    issues.push({ path, message: "capture config must be an object" })
    return
  }
  if (capture.kind === "terminal-buffer") {
    rejectUnknownKeys(issues, path, capture, CAPTURE_TERMINAL_BUFFER_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", capture.terminal, context.indexMap))
    if (capture.mode !== "scrollback-tail" && capture.mode !== "raw-stream-tail") issues.push({ path: path + ".mode", message: "terminal-buffer mode must be scrollback-tail or raw-stream-tail" })
    validatePositiveInt(issues, path + ".maxChars", capture.maxChars)
    return
  }
  if (capture.kind === "text-box") {
    rejectUnknownKeys(issues, path, capture, CAPTURE_TEXT_BOX_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", capture.terminal, context.indexMap))
    return
  }
  if (capture.kind === "agent-event") {
    rejectUnknownKeys(issues, path, capture, CAPTURE_AGENT_EVENT_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", capture.terminal, context.indexMap))
    if (!isObject(capture.agent)) {
      issues.push({ path: path + ".agent", message: "agent must be an object" })
    } else {
      rejectUnknownKeys(issues, path + ".agent", capture.agent, AGENT_KEYS)
      if (capture.agent.kind !== "codex") issues.push({ path: path + ".agent.kind", message: "V0 agent-event agent kind must be codex" })
    }
    if (capture.eventKind !== "stop") issues.push({ path: path + ".eventKind", message: "V0 agent-event eventKind must be stop" })
    if (capture.field !== "last_assistant_message") issues.push({ path: path + ".field", message: "V0 agent-event field must be last_assistant_message" })
    return
  }
  issues.push({ path: path + ".kind", message: "capture kind must be terminal-buffer, text-box or agent-event" })
}

function validateExtractTextNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  rejectUnknownKeys(issues, path, node, EXTRACT_TEXT_KEYS)
  validateArtifactSource(issues, path + ".source", node.source, context)
  validateTextSplitSpec(issues, path + ".split", node.split)
  validateTextFilters(issues, path + ".filters", node.filters)
  validateTextSelectSpec(issues, path + ".select", node.select)
  validateTextExtractSpec(issues, path + ".extract", node.extract)
  if (node.trim !== "none" && node.trim !== "left" && node.trim !== "right" && node.trim !== "both") issues.push({ path: path + ".trim", message: "trim must be none, left, right or both" })
  validateTimeoutAction(issues, path + ".onEmpty", node.onEmpty, new Set(["pause", "fail", "finish", "continue"]))
  if (typeof node.id === "string") registerArtifactOutput(context, node.id, "extracted_text")
}

function validateTextSplitSpec(issues: ValidationIssue[], path: string, split: unknown) {
  if (!isObject(split)) {
    issues.push({ path, message: "split must be an object" })
    return
  }
  if (split.kind === "lines") {
    rejectUnknownKeys(issues, path, split, TEXT_SPLIT_LINES_KEYS)
    if (typeof split.keepEmpty !== "boolean") issues.push({ path: path + ".keepEmpty", message: "keepEmpty must be boolean" })
    return
  }
  if (split.kind === "regex") {
    rejectUnknownKeys(issues, path, split, TEXT_SPLIT_REGEX_KEYS)
    validateRegexPattern(issues, path + ".pattern", split.pattern, split.flags)
    validateRegexFlags(issues, path + ".flags", split.flags)
    if (typeof split.keepEmpty !== "boolean") issues.push({ path: path + ".keepEmpty", message: "keepEmpty must be boolean" })
    return
  }
  issues.push({ path: path + ".kind", message: "split kind must be lines or regex" })
}

function validateTextFilters(issues: ValidationIssue[], path: string, filters: unknown) {
  if (!Array.isArray(filters)) {
    issues.push({ path, message: "filters must be an array" })
    return
  }
  for (const [index, filter] of filters.entries()) {
    const filterPath = path + "[" + index + "]"
    if (!isObject(filter)) {
      issues.push({ path: filterPath, message: "filter must be an object" })
      continue
    }
    rejectUnknownKeys(issues, filterPath, filter, TEXT_FILTER_KEYS)
    if (filter.kind !== "include" && filter.kind !== "exclude") issues.push({ path: filterPath + ".kind", message: "filter kind must be include or exclude" })
    validateTextMatcher(issues, filterPath + ".matcher", filter.matcher)
  }
}

function validateTextMatcher(issues: ValidationIssue[], path: string, matcher: unknown) {
  if (!isObject(matcher)) {
    issues.push({ path, message: "matcher must be an object" })
    return
  }
  if (matcher.kind === "simple") {
    rejectUnknownKeys(issues, path, matcher, SIMPLE_MATCHER_KEYS)
    if (!SIMPLE_OPS.has(String(matcher.op))) issues.push({ path: path + ".op", message: "simple matcher op is not supported" })
    validateString(issues, path + ".text", matcher.text, 0)
    return
  }
  if (matcher.kind === "regex") {
    rejectUnknownKeys(issues, path, matcher, REGEX_MATCHER_KEYS)
    validateRegexPattern(issues, path + ".pattern", matcher.pattern, matcher.flags)
    validateRegexFlags(issues, path + ".flags", matcher.flags)
    return
  }
  issues.push({ path: path + ".kind", message: "matcher kind must be simple or regex" })
}

function validateTextSelectSpec(issues: ValidationIssue[], path: string, select: unknown) {
  if (!isObject(select)) {
    issues.push({ path, message: "select must be an object" })
    return
  }
  if (select.mode === "all") {
    rejectUnknownKeys(issues, path, select, TEXT_SELECT_ALL_KEYS)
    return
  }
  if (select.mode === "index") {
    rejectUnknownKeys(issues, path, select, TEXT_SELECT_INDEX_KEYS)
    validateInt(issues, path + ".index", select.index)
    return
  }
  if (select.mode === "range") {
    rejectUnknownKeys(issues, path, select, TEXT_SELECT_RANGE_KEYS)
    validateInt(issues, path + ".start", select.start)
    if (select.end !== undefined) validateInt(issues, path + ".end", select.end)
    return
  }
  issues.push({ path: path + ".mode", message: "select mode must be all, index or range" })
}

function validateTextExtractSpec(issues: ValidationIssue[], path: string, extract: unknown) {
  if (!isObject(extract)) {
    issues.push({ path, message: "extract must be an object" })
    return
  }
  if (extract.kind === "none") {
    rejectUnknownKeys(issues, path, extract, TEXT_EXTRACT_NONE_KEYS)
    return
  }
  if (extract.kind === "regex") {
    rejectUnknownKeys(issues, path, extract, TEXT_EXTRACT_REGEX_KEYS)
    validateRegexPattern(issues, path + ".pattern", extract.pattern, extract.flags)
    validateRegexFlags(issues, path + ".flags", extract.flags)
    if (!(typeof extract.group === "string" && extract.group.length > 0) && !Number.isInteger(extract.group)) issues.push({ path: path + ".group", message: "group must be an integer or non-empty named group" })
    return
  }
  issues.push({ path: path + ".kind", message: "extract kind must be none or regex" })
}

function validateParallelSendCaptureNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  rejectUnknownKeys(issues, path, node, PARALLEL_SEND_CAPTURE_KEYS)
  if (!Array.isArray(node.items) || node.items.length === 0) {
    issues.push({ path: path + ".items", message: "parallel_send_capture must declare items" })
  } else {
    validateParallelItems(issues, path + ".items", node.items, context)
  }
  if (!isObject(node.merge)) {
    issues.push({ path: path + ".merge", message: "parallel_send_capture merge must be an object" })
  } else {
    rejectUnknownKeys(issues, path + ".merge", node.merge, PARALLEL_MERGE_KEYS)
    if (node.merge.kind !== "sectioned_text") issues.push({ path: path + ".merge.kind", message: "merge kind must be sectioned_text" })
    validateString(issues, path + ".merge.separator", node.merge.separator, 1)
    if (node.merge.order !== "item_order") issues.push({ path: path + ".merge.order", message: "merge order must be item_order" })
    if (typeof node.merge.includeEmptyCaptures !== "boolean") issues.push({ path: path + ".merge.includeEmptyCaptures", message: "includeEmptyCaptures must be boolean" })
  }
  if (node.onItemFail !== "pause" && node.onItemFail !== "fail") issues.push({ path: path + ".onItemFail", message: "onItemFail must be pause or fail" })
  if (typeof node.id === "string") registerArtifactOutput(context, node.id, "merged_text")
}

function validateParallelItems(issues: ValidationIssue[], path: string, items: unknown[], context: ValidationContext) {
  const itemIds = new Set<string>()
  const terminalKeys = new Map<string, string>()
  for (const [index, item] of items.entries()) {
    const itemPath = path + "[" + index + "]"
    if (!isObject(item)) {
      issues.push({ path: itemPath, message: "parallel item must be an object" })
      continue
    }
    rejectUnknownKeys(issues, itemPath, item, PARALLEL_ITEM_KEYS)
    validatePublicId(issues, itemPath + ".id", item.id)
    if (typeof item.id === "string") {
      if (itemIds.has(item.id)) issues.push({ path: itemPath + ".id", message: "duplicate parallel item id" })
      itemIds.add(item.id)
    }
    issues.push(...validateTerminalTarget(itemPath + ".terminal", item.terminal, context.indexMap))
    const itemKey = terminalIdentityKey(item.terminal, context.indexMap)
    if (itemKey && typeof item.id === "string") {
      const existing = terminalKeys.get(itemKey)
      if (existing) issues.push({ path: itemPath + ".terminal", message: "duplicate parallel item terminal: " + itemKey + " already used by " + existing })
      terminalKeys.set(itemKey, item.id)
    }
    validateParallelSend(issues, itemPath + ".send", item.send, item as ParallelSendCaptureItem, context)
    if (item.wait !== undefined) validateParallelWait(issues, itemPath + ".wait", item.wait, item as ParallelSendCaptureItem, context)
    validateParallelCapture(issues, itemPath + ".capture", item.capture, item as ParallelSendCaptureItem, context)
  }
}

function validateParallelSend(issues: ValidationIssue[], path: string, send: unknown, item: ParallelSendCaptureItem, context: ValidationContext) {
  if (!isObject(send)) {
    issues.push({ path, message: "parallel item send must be a send_line object" })
    return
  }
  if (send.type !== "send_line") issues.push({ path: path + ".type", message: "parallel item send must reuse send_line" })
  rejectUnknownKeys(issues, path, send, SEND_LINE_KEYS)
  issues.push(...validateTerminalTarget(path + ".terminal", send.terminal, context.indexMap))
  validateSameTerminal(issues, path + ".terminal", item.terminal, send.terminal, context.indexMap, "parallel item send terminal must match item terminal")
  validateMessageSpec(issues, path + ".message", send.message, context)
}

function validateParallelWait(issues: ValidationIssue[], path: string, wait: unknown, item: ParallelSendCaptureItem, context: ValidationContext) {
  if (!isObject(wait)) {
    issues.push({ path, message: "parallel item wait must be an object" })
    return
  }
  if (wait.type !== "wait") issues.push({ path: path + ".type", message: "parallel item wait must reuse wait" })
  if (wait.mode === "user-continue") issues.push({ path: path + ".mode", message: "parallel item wait must not use user-continue" })
  validateWaitNode(issues, path, wait, context)
  if (wait.mode === "terminal-quiet") {
    if (wait.onTimeout !== "pause") issues.push({ path: path + ".onTimeout", message: "parallel item wait onTimeout must be pause" })
    validateSameTerminal(issues, path + ".terminal", item.terminal, wait.terminal, context.indexMap, "parallel item wait terminal must match item terminal")
  }
}

function validateParallelCapture(issues: ValidationIssue[], path: string, captureNode: unknown, item: ParallelSendCaptureItem, context: ValidationContext) {
  if (!isObject(captureNode)) {
    issues.push({ path, message: "parallel item capture must be a capture-source object" })
    return
  }
  if (captureNode.type !== "capture-source") issues.push({ path: path + ".type", message: "parallel item capture must reuse capture-source" })
  rejectUnknownKeys(issues, path, captureNode, CAPTURE_SOURCE_KEYS)
  validateCaptureNodeConfig(issues, path + ".capture", captureNode.capture, context)
  if (isObject(captureNode.capture)) validateSameTerminal(issues, path + ".capture.terminal", item.terminal, captureNode.capture.terminal, context.indexMap, "parallel item capture terminal must match item terminal")
}

function validateControlNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  if (node.type === "if") {
    rejectUnknownKeys(issues, path, node, IF_KEYS)
    validateIfNode(issues, path, node, context)
    return
  }
  if (node.type === "for") {
    rejectUnknownKeys(issues, path, node, FOR_KEYS)
    validateForRange(issues, path + ".range", node.range)
    validateNodeList(issues, path + ".body", node.body, childContext(context, context.loopDepth + 1), true)
    return
  }
  if (node.type === "break" || node.type === "continue") {
    rejectUnknownKeys(issues, path, node, CONTROL_TERMINAL_KEYS)
    if (context.loopDepth < 1) issues.push({ path: path + ".type", message: node.type + " can only be used inside for body" })
    validateControlTerminalFields(issues, path, node, context)
    return
  }
  rejectUnknownKeys(issues, path, node, CONTROL_TERMINAL_KEYS)
  validateControlTerminalFields(issues, path, node, context)
}

function validateForRange(issues: ValidationIssue[], path: string, range: unknown) {
  if (!isObject(range)) {
    issues.push({ path, message: "for node must declare range object" })
    return
  }
  if (range.kind === undefined || range.kind === "count") {
    rejectUnknownKeys(issues, path, range, RANGE_COUNT_KEYS)
    validatePositiveInt(issues, path + ".count", range.count)
    return
  }
  if (range.kind === "forever") {
    rejectUnknownKeys(issues, path, range, RANGE_FOREVER_KEYS)
    return
  }
  issues.push({ path: path + ".kind", message: "for range kind must be count or forever" })
}

function validateControlTerminalFields(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  if (node.reason !== undefined) validateString(issues, path + ".reason", node.reason, 1)
  if (node.body !== undefined) validateActionOnlyNodeList(issues, path + ".body", node.body, childContext(context, context.loopDepth), false)
}

function validateIfNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  rejectStringExpressionFields(issues, path, node)
  if (!Array.isArray(node.branches) || node.branches.length === 0) {
    issues.push({ path: path + ".branches", message: "if node must declare at least one if branch" })
    return
  }
  for (const [index, branch] of node.branches.entries()) {
    const branchPath = path + ".branches[" + index + "]"
    if (!isObject(branch)) {
      issues.push({ path: branchPath, message: "if branch must be an object" })
      continue
    }
    rejectUnknownKeys(issues, branchPath, branch, IF_BRANCH_KEYS)
    rejectStringExpressionFields(issues, branchPath, branch)
    if (index === 0 && branch.kind !== "if") issues.push({ path: branchPath + ".kind", message: "first branch kind must be if" })
    if (index > 0 && branch.kind !== "elif") issues.push({ path: branchPath + ".kind", message: "later branch kind must be elif" })
    validateTextMatchCondition(issues, branchPath + ".condition", branch.condition, context)
    validateNodeList(issues, branchPath + ".body", branch.body, childContext(context, context.loopDepth), true)
  }
  if ("else" in node) validateNodeList(issues, path + ".else", node.else, childContext(context, context.loopDepth), true)
}

function validateTextMatchCondition(issues: ValidationIssue[], path: string, condition: unknown, context: ValidationContext) {
  if (!isObject(condition)) {
    issues.push({ path, message: "condition must be an object" })
    return
  }
  rejectUnknownKeys(issues, path, condition, CONDITION_KEYS)
  rejectStringExpressionFields(issues, path, condition)
  if (condition.kind !== "text_match") issues.push({ path: path + ".kind", message: "condition kind must be text_match" })
  validateArtifactSource(issues, path + ".source", condition.source, context)
  if (!isObject(condition.matcher)) {
    issues.push({ path: path + ".matcher", message: "matcher must be an object" })
  } else if (condition.matcher.kind === "simple") {
    rejectUnknownKeys(issues, path + ".matcher", condition.matcher, SIMPLE_MATCHER_KEYS)
    if (!SIMPLE_OPS.has(String(condition.matcher.op))) issues.push({ path: path + ".matcher.op", message: "simple matcher op is not supported" })
    validateString(issues, path + ".matcher.text", condition.matcher.text, 0)
  } else if (condition.matcher.kind === "regex") {
    rejectUnknownKeys(issues, path + ".matcher", condition.matcher, REGEX_MATCHER_KEYS)
    validateRegexPattern(issues, path + ".matcher.pattern", condition.matcher.pattern, condition.matcher.flags)
    validateRegexFlags(issues, path + ".matcher.flags", condition.matcher.flags)
  } else {
    issues.push({ path: path + ".matcher.kind", message: "matcher kind must be simple or regex" })
  }
  if (!isObject(condition.scope)) {
    issues.push({ path: path + ".scope", message: "scope must be an object" })
  } else if (condition.scope.kind === "whole") {
    rejectUnknownKeys(issues, path + ".scope", condition.scope, WHOLE_SCOPE_KEYS)
  } else if (condition.scope.kind === "lines") {
    rejectUnknownKeys(issues, path + ".scope", condition.scope, LINES_SCOPE_KEYS)
    if (!LINE_MODES.has(String(condition.scope.mode))) issues.push({ path: path + ".scope.mode", message: "line match mode must be first, last, any or all" })
    if (condition.scope.includeEmptyLines !== undefined && typeof condition.scope.includeEmptyLines !== "boolean") issues.push({ path: path + ".scope.includeEmptyLines", message: "includeEmptyLines must be boolean" })
  } else {
    issues.push({ path: path + ".scope.kind", message: "scope kind must be whole or lines" })
  }
}

function validateMessageSpec(issues: ValidationIssue[], path: string, message: unknown, context: ValidationContext) {
  if (!isObject(message)) {
    issues.push({ path, message: "message must be an object" })
    return
  }
  rejectUnknownKeys(issues, path, message, MESSAGE_KEYS)
  if (!Array.isArray(message.parts)) {
    issues.push({ path: path + ".parts", message: "message.parts must be an array" })
    return
  }
  for (const [index, part] of message.parts.entries()) {
    const partPath = path + ".parts[" + index + "]"
    if (!isObject(part)) {
      issues.push({ path: partPath, message: "message part must be an object" })
      continue
    }
    if (part.kind === "text") {
      rejectUnknownKeys(issues, partPath, part, TEXT_PART_KEYS)
      validateString(issues, partPath + ".text", part.text, 0)
    } else if (part.kind === "artifact") {
      rejectUnknownKeys(issues, partPath, part, ARTIFACT_PART_KEYS)
      if (part.source !== undefined) validateArtifactSource(issues, partPath + ".source", part.source, context)
    } else {
      issues.push({ path: partPath + ".kind", message: "message part kind must be text or artifact" })
    }
  }
}


function validateArtifactSource(issues: ValidationIssue[], path: string, source: unknown, context: ValidationContext) {
  if (!isObject(source)) {
    issues.push({ path, message: "artifact source must be an object" })
    return
  }
  rejectUnknownKeys(issues, path, source, ARTIFACT_SOURCE_KEYS)
  if (source.kind !== "step_artifact") issues.push({ path: path + ".kind", message: "artifact source kind must be step_artifact" })
  validatePublicId(issues, path + ".stepId", source.stepId)
  if (source.artifact !== "captured_text" && source.artifact !== "merged_text" && source.artifact !== "extracted_text") issues.push({ path: path + ".artifact", message: "artifact must be captured_text, merged_text or extracted_text" })
  if (typeof source.stepId !== "string" || typeof source.artifact !== "string") return
  const artifacts = context.artifactOutputs.get(source.stepId)
  if (!artifacts) {
    issues.push({ path: path + ".stepId", message: "artifact source must reference an earlier artifact-producing step in the visible predecessor scope" })
    return
  }
  if (!artifacts.has(source.artifact)) issues.push({ path: path + ".artifact", message: "artifact is not produced by source step" })
}

function validateSameTerminal(issues: ValidationIssue[], path: string, left: unknown, right: unknown, indexMap: TerminalIndexMapItem[] | undefined, message: string) {
  const leftKey = terminalIdentityKey(left, indexMap)
  const rightKey = terminalIdentityKey(right, indexMap)
  if (!leftKey || !rightKey || leftKey !== rightKey) issues.push({ path, message })
}

function terminalIdentityKey(target: unknown, indexMap?: TerminalIndexMapItem[]): string | undefined {
  if (!isObject(target)) return undefined
  if (indexMap) {
    if (target.kind === "id" && typeof target.value === "string") return "resolved:" + target.value
    if (target.kind === "alias" && typeof target.value === "string") {
      const match = indexMap.find((item) => item.terminalAlias === target.value)
      return match ? "resolved:" + match.terminalId : undefined
    }
    if (target.kind === "index" && Number.isInteger(target.value)) {
      const match = indexMap.find((item) => item.index === target.value)
      return match ? "resolved:" + match.terminalId : undefined
    }
  }
  if (typeof target.kind === "string" && (typeof target.value === "string" || typeof target.value === "number")) return "direct:" + target.kind + ":" + target.value
  return undefined
}

function childContext(context: ValidationContext, loopDepth: number): ValidationContext {
  return { ...context, loopDepth, artifactOutputs: cloneArtifactOutputs(context.artifactOutputs) }
}

function cloneArtifactOutputs(outputs: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map([...outputs.entries()].map(([stepId, artifacts]) => [stepId, new Set(artifacts)]))
}

function registerArtifactOutput(context: ValidationContext, stepId: string, artifact: string) {
  const existing = context.artifactOutputs.get(stepId) ?? new Set<string>()
  existing.add(artifact)
  context.artifactOutputs.set(stepId, existing)
}

function validateNodeId(issues: ValidationIssue[], path: string, value: unknown, context: ValidationContext) {
  validatePublicId(issues, path, value)
  if (typeof value !== "string") return
  if (context.nodeIds.has(value)) issues.push({ path, message: "duplicate Flow V2 node id" })
  context.nodeIds.add(value)
}

function validatePublicId(issues: ValidationIssue[], path: string, value: unknown) {
  if (typeof value !== "string") {
    issues.push({ path, message: "value must be a public id string" })
    return
  }
  try { assertValidPublicId(value, "genericId") } catch { issues.push({ path, message: "value must match Identifier Contract" }) }
}

function validatePositiveInt(issues: ValidationIssue[], path: string, value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1) issues.push({ path, message: "value must be a positive integer" })
}

function validateNonNegativeInt(issues: ValidationIssue[], path: string, value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 0) issues.push({ path, message: "value must be a non-negative integer" })
}

function validateInt(issues: ValidationIssue[], path: string, value: unknown) {
  if (!Number.isInteger(value)) issues.push({ path, message: "value must be an integer" })
}

function validateTimeoutAction(issues: ValidationIssue[], path: string, value: unknown, allowed: Set<string>) {
  if (typeof value !== "string" || !allowed.has(value)) issues.push({ path, message: "value must be one of " + [...allowed].join(", ") })
}

function validateString(issues: ValidationIssue[], path: string, value: unknown, minLength: number) {
  if (typeof value !== "string" || value.length < minLength) issues.push({ path, message: "value must be a string with length >= " + minLength })
}

function validateIsoString(issues: ValidationIssue[], path: string, value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) issues.push({ path, message: "value must be an ISO timestamp string" })
}

function validateRegexPattern(issues: ValidationIssue[], path: string, value: unknown, flags: unknown) {
  validateString(issues, path, value, 1)
  if (typeof value !== "string") return
  if (flags !== undefined && (typeof flags !== "string" || !REGEX_FLAGS_RE.test(flags) || new Set(flags.split("")).size !== flags.length)) return
  try { new RegExp(value, typeof flags === "string" ? flags : "") } catch { issues.push({ path, message: "regex pattern must compile" }) }
}

function validateRegexFlags(issues: ValidationIssue[], path: string, value: unknown) {
  if (value === undefined) return
  if (typeof value !== "string" || !REGEX_FLAGS_RE.test(value)) {
    issues.push({ path, message: "regex flags must only contain i, m or s" })
    return
  }
  if (new Set(value.split("")).size !== value.length) issues.push({ path, message: "regex flags must not repeat" })
}

function rejectUnknownKeys(issues: ValidationIssue[], path: string, value: Record<string, unknown>, allowed: Set<string>) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push({ path: path + "." + key, message: "extra Flow V2 field is not allowed" })
}

function rejectLegacyFields(issues: ValidationIssue[], value: unknown, path: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectLegacyFields(issues, item, path + "[" + index + "]"))
    return
  }
  if (!isObject(value)) return
  if (typeof value.type === "string" && FORBIDDEN_TYPES.has(value.type)) issues.push({ path: path ? path + ".type" : "type", message: "legacy Flow V1 node type is unsupported in Flow V2: " + value.type })
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? path + "." + key : key
    if (LEGACY_FIELD_KEYS.has(key)) issues.push({ path: childPath, message: "legacy control/parser fields are not allowed in Flow V2" })
    if (key === "kind" && child === "ai-json") issues.push({ path: childPath, message: "legacy parser kind is not allowed in Flow V2" })
    if (key === "mode" && child === "capture-ready-or-user") issues.push({ path: childPath, message: "legacy wait mode is not allowed in Flow V2" })
    rejectLegacyFields(issues, child, childPath)
  }
}

function rejectSessionFields(issues: ValidationIssue[], value: unknown, path: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSessionFields(issues, item, path + "[" + index + "]"))
    return
  }
  if (!isObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? path + "." + key : key
    if (key === "session_id" || key === "codexSessionId") issues.push({ path: childPath, message: "macro template must not persist Codex session fields" })
    rejectSessionFields(issues, child, childPath)
  }
}

function rejectStringExpressionFields(issues: ValidationIssue[], path: string, value: Record<string, unknown>) {
  if (typeof value.if === "string") issues.push({ path: path + ".if", message: "string expressions are not allowed in Flow V2; use structured condition fields" })
  if (typeof value.expression === "string") issues.push({ path: path + ".expression", message: "string expressions are not allowed in Flow V2; use structured condition fields" })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function invalid(path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ path, message }] }
}
