import { assertValidPublicId } from "../identifier"
import type { TerminalIndexMapItem, TerminalSnapshot } from "../protocol"
import { isCaptureKindAllowed, tabInfoForTarget } from "./tabCapabilities"
import { validateTerminalTarget } from "./terminalRef"
import { isScopedTemplateText, scopedTemplateSyntaxIssue } from "./scopedTextTemplate"
import { isTerminalEnding } from "./terminalEnding"
import { isTerminalInputDelivery } from "./terminalInputDelivery"
import type {
  CaptureSourceConfig,
  FlowV2ArtifactSource,
  FlowV2Node,
  MacroTemplate,
  ParallelLane,
  TerminalTarget,
  TextMatchCondition,
  ValidationIssue,
  ValidationResult,
} from "./templateTypes"

export const FLOW_V2_ACTION_TYPES = ["send", "notify", "input", "wait", "capture-source", "extract_text", "parallel"] as const
export const FLOW_V2_CONTROL_TYPES = ["if", "for", "break", "continue", "finish"] as const

const ACTION_TYPES = new Set<string>(FLOW_V2_ACTION_TYPES)
const CONTROL_TYPES = new Set<string>(FLOW_V2_CONTROL_TYPES)
const TEMPLATE_KEYS = new Set(["schemaVersion", "id", "name", "description", "configId", "body", "createdAt", "updatedAt"])
const ARTIFACT_SOURCE_KEYS = new Set(["kind", "stepId", "artifact"])
const MESSAGE_KEYS = new Set(["parts"])
const TEXT_PART_KEYS = new Set(["kind", "text"])
const TEMPLATE_PART_KEYS = new Set(["kind", "template"])
const ARTIFACT_PART_KEYS = new Set(["kind", "source"])
const SEND_KEYS = new Set(["id", "type", "terminal", "message", "delivery", "ending"])
const NOTIFY_KEYS = new Set(["id", "type", "level", "title", "message", "channels", "onFailure"])
const NOTIFY_APP_CHANNEL_KEYS = new Set(["kind", "toast", "sound"])
const NOTIFY_SYSTEM_CHANNEL_KEYS = new Set(["kind"])
const NOTIFY_TELEGRAM_CHANNEL_KEYS = new Set(["kind", "profileId"])
const NOTIFICATION_SOUND_VALUES = new Set(["none", "bell", "chime", "ping", "pulse", "success", "warning", "alert"])
const INPUT_KEYS = new Set(["id", "type", "terminal", "prompt", "allowEmpty", "defaultSource", "delivery", "ending"])
const WAIT_DURATION_KEYS = new Set(["id", "type", "mode", "durationMs"])
const WAIT_TERMINAL_QUIET_KEYS = new Set(["id", "type", "mode", "terminal", "quietMs", "maxMs", "onTimeout"])
const WAIT_USER_CONTINUE_KEYS = new Set(["id", "type", "mode", "prompt"])
const WAIT_ANY_KEYS = new Set(["id", "type", "mode", "durationMs", "terminal", "quietMs", "maxMs", "onTimeout", "prompt"])
const CAPTURE_SOURCE_KEYS = new Set(["id", "type", "capture"])
const CAPTURE_TERMINAL_BUFFER_KEYS = new Set(["kind", "terminal", "mode", "maxChars"])
const CAPTURE_TEXT_BOX_KEYS = new Set(["kind", "terminal"])
const CAPTURE_AGENT_EVENT_KEYS = new Set(["kind", "agent", "terminal", "captureMode"])
const AGENT_KEYS = new Set(["kind"])
const AGENT_EVENT_CAPTURE_MODES = new Set(["result_only", "prompt_only", "prompt_and_result"])
const EXTRACT_TEXT_KEYS = new Set(["id", "type", "source", "split", "filters", "select", "extract", "trim", "onEmpty"])
const TEXT_SPLIT_LINES_KEYS = new Set(["kind", "keepEmpty"])
const TEXT_SPLIT_REGEX_KEYS = new Set(["kind", "pattern", "flags", "keepEmpty"])
const TEXT_FILTER_KEYS = new Set(["kind", "matcher"])
const TEXT_SELECT_ALL_KEYS = new Set(["mode"])
const TEXT_SELECT_INDEX_KEYS = new Set(["mode", "index"])
const TEXT_SELECT_RANGE_KEYS = new Set(["mode", "start", "end"])
const TEXT_EXTRACT_NONE_KEYS = new Set(["kind"])
const TEXT_EXTRACT_REGEX_KEYS = new Set(["kind", "pattern", "flags", "group"])
const PARALLEL_KEYS = new Set(["id", "type", "lanes", "merge", "onLaneFail"])
const PARALLEL_LANE_KEYS = new Set(["id", "label", "terminal", "body"])
const PARALLEL_OUTPUT_KEYS = new Set(["id", "type", "source"])
const PARALLEL_OUTPUT_NONE_KEYS = new Set(["kind"])
const PARALLEL_MERGE_KEYS = new Set(["kind", "separator", "includeEmptyOutputs"])
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
const RANGE_TEXT_LIST_KEYS = new Set(["kind", "items"])
const TEXT_LIST_ITEM_KEYS = new Set(["key", "value"])
const CONTROL_TERMINAL_KEYS = new Set(["id", "type", "reason", "body"])
const SIMPLE_OPS = new Set(["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with"])
const LINE_MODES = new Set(["first", "last", "any", "all"])
const REGEX_FLAGS_RE = /^[ims]*$/

type ValidateOptions = {
  indexMap?: TerminalIndexMapItem[]
  terminals?: TerminalSnapshot[]
}

type ValidationContext = {
  indexMap?: TerminalIndexMapItem[]
  terminals?: TerminalSnapshot[]
  nodeIds: Set<string>
  artifactOutputs: Map<string, Set<string>>
  loopDepth: number
  textTemplateScopes: string[]
}

export function validateFlowV2Template(value: unknown, options: ValidateOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!isObject(value)) return invalid("template", "Flow V2 template must be an object")
  rejectUnknownKeys(issues, "template", value, TEMPLATE_KEYS)
  rejectStringExpressionFields(issues, "template", value)
  rejectSessionFields(issues, value, "")

  const template = value as MacroTemplate
  if (template.schemaVersion !== 2) issues.push({ path: "schemaVersion", message: "Flow V2 template schemaVersion must be 2" })
  validatePublicId(issues, "id", template.id)
  validatePublicId(issues, "configId", template.configId)
  validateString(issues, "name", template.name, 1)
  validateString(issues, "description", template.description, 0)
  validateIsoString(issues, "createdAt", template.createdAt)
  validateIsoString(issues, "updatedAt", template.updatedAt)
  const context: ValidationContext = { indexMap: options.indexMap, terminals: options.terminals, nodeIds: new Set(), artifactOutputs: new Map(), loopDepth: 0, textTemplateScopes: [] }
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
  if (node.type === "send") {
    rejectUnknownKeys(issues, path, node, SEND_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", node.terminal, context.indexMap))
    validateMessageSpec(issues, path + ".message", node.message, context)
    validateTerminalInputDelivery(issues, path, node)
    validateTerminalEnding(issues, path, node)
    return
  }
  if (node.type === "input") {
    rejectUnknownKeys(issues, path, node, INPUT_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", node.terminal, context.indexMap))
    validateTemplatableScalarText(issues, path + ".prompt", node.prompt, context, 1)
    if (typeof node.allowEmpty !== "boolean") issues.push({ path: path + ".allowEmpty", message: "allowEmpty must be boolean" })
    validateTerminalInputDelivery(issues, path, node)
    validateTerminalEnding(issues, path, node)
    if (node.defaultSource !== undefined) validateArtifactSource(issues, path + ".defaultSource", node.defaultSource, context)
    return
  }
  if (node.type === "notify") {
    validateNotifyNode(issues, path, node, context)
    return
  }
  if (node.type === "wait") {
    validateWaitNode(issues, path, node, context)
    return
  }
  if (node.type === "capture-source") {
    rejectUnknownKeys(issues, path, node, CAPTURE_SOURCE_KEYS)
    validateCaptureNodeConfig(issues, path + ".capture", node.capture, context, node.id)
    if (typeof node.id === "string") registerArtifactOutput(context, node.id, "captured_text")
    return
  }
  if (node.type === "extract_text") {
    validateExtractTextNode(issues, path, node, context)
    return
  }
  validateParallelNode(issues, path, node, context)
}

function validateNotifyNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  rejectUnknownKeys(issues, path, node, NOTIFY_KEYS)
  if (node.level !== "info" && node.level !== "success" && node.level !== "warning" && node.level !== "error") issues.push({ path: path + ".level", message: "level must be info, success, warning or error" })
  validateTemplatableScalarText(issues, path + ".title", node.title, context, 1)
  validateMessageSpec(issues, path + ".message", node.message, context)
  validateNotifyChannels(issues, path + ".channels", node.channels)
  if (node.onFailure !== "continue" && node.onFailure !== "pause" && node.onFailure !== "fail") issues.push({ path: path + ".onFailure", message: "onFailure must be continue, pause or fail" })
}

function validateTerminalInputDelivery(issues: ValidationIssue[], path: string, node: Record<string, unknown>) {
  if (!hasOwnEnumerableField(node, "delivery")) {
    issues.push({ path: path + ".delivery", message: "delivery must be an own enumerable field" })
    return
  }
  if (!isTerminalInputDelivery(node.delivery)) {
    issues.push({ path: path + ".delivery", message: "delivery must be auto, direct or bracketed-paste" })
  }
}

function validateTerminalEnding(issues: ValidationIssue[], path: string, node: Record<string, unknown>) {
  if (!hasOwnEnumerableField(node, "ending")) {
    issues.push({ path: path + ".ending", message: "ending must be an own enumerable field" })
    return
  }
  if (!isTerminalEnding(node.ending)) {
    issues.push({ path: path + ".ending", message: "ending must be none, lf, cr or crlf" })
  }
}

function validateNotifyChannels(issues: ValidationIssue[], path: string, channels: unknown) {
  if (!Array.isArray(channels)) {
    issues.push({ path, message: "notify channels must be an array" })
    return
  }
  if (channels.length === 0) issues.push({ path, message: "notify channels must not be empty" })
  for (const [index, channel] of channels.entries()) {
    const channelPath = path + "[" + index + "]"
    if (!isObject(channel)) {
      issues.push({ path: channelPath, message: "notify channel must be an object" })
      continue
    }
    if (channel.kind === "app") {
      rejectUnknownKeys(issues, channelPath, channel, NOTIFY_APP_CHANNEL_KEYS)
      if (typeof channel.toast !== "boolean") issues.push({ path: channelPath + ".toast", message: "toast must be boolean" })
      if (typeof channel.sound !== "string" || !NOTIFICATION_SOUND_VALUES.has(channel.sound)) issues.push({ path: channelPath + ".sound", message: "sound must be none, bell, chime, ping, pulse, success, warning or alert" })
      continue
    }
    if (channel.kind === "system") {
      rejectUnknownKeys(issues, channelPath, channel, NOTIFY_SYSTEM_CHANNEL_KEYS)
      continue
    }
    if (channel.kind === "telegram") {
      rejectUnknownKeys(issues, channelPath, channel, NOTIFY_TELEGRAM_CHANNEL_KEYS)
      validatePublicId(issues, channelPath + ".profileId", channel.profileId)
      continue
    }
    issues.push({ path: channelPath + ".kind", message: "notify channel kind must be app, system or telegram" })
  }
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
    validateWaitQuietCapability(issues, path + ".terminal", node.terminal, context, node.id)
    validatePositiveInt(issues, path + ".quietMs", node.quietMs)
    validatePositiveInt(issues, path + ".maxMs", node.maxMs)
    if (Number.isInteger(node.quietMs) && Number.isInteger(node.maxMs) && Number(node.maxMs) < Number(node.quietMs)) issues.push({ path: path + ".maxMs", message: "maxMs must be greater than or equal to quietMs" })
    validateTimeoutAction(issues, path + ".onTimeout", node.onTimeout, new Set(["pause", "finish"]))
    return
  }
  if (node.mode === "user-continue") {
    rejectUnknownKeys(issues, path, node, WAIT_USER_CONTINUE_KEYS)
    validateTemplatableScalarText(issues, path + ".prompt", node.prompt, context, 1)
    return
  }
  rejectUnknownKeys(issues, path, node, WAIT_ANY_KEYS)
  issues.push({ path: path + ".mode", message: "wait mode must be duration, terminal-quiet or user-continue" })
}

function validateCaptureNodeConfig(issues: ValidationIssue[], path: string, capture: unknown, context: ValidationContext, actionId?: unknown) {
  if (!isObject(capture)) {
    issues.push({ path, message: "capture config must be an object" })
    return
  }
  if (capture.kind === "terminal-buffer") {
    rejectUnknownKeys(issues, path, capture, CAPTURE_TERMINAL_BUFFER_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", capture.terminal, context.indexMap))
    validateCaptureCapability(issues, path + ".terminal", capture.kind, capture.terminal, context, actionId)
    if (capture.mode !== "scrollback-tail" && capture.mode !== "raw-stream-tail") issues.push({ path: path + ".mode", message: "terminal-buffer mode must be scrollback-tail or raw-stream-tail" })
    validatePositiveInt(issues, path + ".maxChars", capture.maxChars)
    return
  }
  if (capture.kind === "text-box") {
    rejectUnknownKeys(issues, path, capture, CAPTURE_TEXT_BOX_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", capture.terminal, context.indexMap))
    validateCaptureCapability(issues, path + ".terminal", capture.kind, capture.terminal, context, actionId)
    return
  }
  if (capture.kind === "agent-event") {
    rejectUnknownKeys(issues, path, capture, CAPTURE_AGENT_EVENT_KEYS)
    issues.push(...validateTerminalTarget(path + ".terminal", capture.terminal, context.indexMap))
    validateCaptureCapability(issues, path + ".terminal", capture.kind, capture.terminal, context, actionId)
    if (!isObject(capture.agent)) {
      issues.push({ path: path + ".agent", message: "agent must be an object" })
    } else {
      rejectUnknownKeys(issues, path + ".agent", capture.agent, AGENT_KEYS)
      if (capture.agent.kind !== "codex") issues.push({ path: path + ".agent.kind", message: "V0 agent-event agent kind must be codex" })
    }
    if (!AGENT_EVENT_CAPTURE_MODES.has(String(capture.captureMode))) issues.push({ path: path + ".captureMode", message: "agent-event captureMode must be result_only, prompt_only or prompt_and_result" })
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

function validateParallelNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  rejectUnknownKeys(issues, path, node, PARALLEL_KEYS)
  if (!Array.isArray(node.lanes) || node.lanes.length === 0) {
    issues.push({ path: path + ".lanes", message: "parallel must declare lanes" })
  } else {
    validateParallelLanes(issues, path + ".lanes", node.lanes, context)
  }
  if (!isObject(node.merge)) {
    issues.push({ path: path + ".merge", message: "parallel merge must be an object" })
  } else {
    rejectUnknownKeys(issues, path + ".merge", node.merge, PARALLEL_MERGE_KEYS)
    if (node.merge.kind !== "sectioned_text") issues.push({ path: path + ".merge.kind", message: "merge kind must be sectioned_text" })
    validateString(issues, path + ".merge.separator", node.merge.separator, 1)
    if (typeof node.merge.includeEmptyOutputs !== "boolean") issues.push({ path: path + ".merge.includeEmptyOutputs", message: "includeEmptyOutputs must be boolean" })
  }
  if (node.onLaneFail !== "pause" && node.onLaneFail !== "fail") issues.push({ path: path + ".onLaneFail", message: "onLaneFail must be pause or fail" })
  if (typeof node.id === "string") registerArtifactOutput(context, node.id, "merged_text")
}

function validateParallelLanes(issues: ValidationIssue[], path: string, lanes: unknown[], context: ValidationContext) {
  const laneIds = new Set<string>()
  const laneLabels = new Set<string>()
  const terminalKeys = new Map<string, string>()
  for (const [index, lane] of lanes.entries()) {
    const lanePath = path + "[" + index + "]"
    if (!isObject(lane)) {
      issues.push({ path: lanePath, message: "parallel lane must be an object" })
      continue
    }
    rejectUnknownKeys(issues, lanePath, lane, PARALLEL_LANE_KEYS)
    validatePublicId(issues, lanePath + ".id", lane.id)
    if (typeof lane.id === "string") {
      if (laneIds.has(lane.id)) issues.push({ path: lanePath + ".id", message: "duplicate parallel lane id" })
      laneIds.add(lane.id)
    }
    validateString(issues, lanePath + ".label", lane.label, 0)
    if (typeof lane.label === "string" && lane.label.trim()) {
      const normalizedLabel = lane.label.trim()
      if (laneLabels.has(normalizedLabel)) issues.push({ path: lanePath + ".label", message: "duplicate parallel lane label" })
      laneLabels.add(normalizedLabel)
    }
    issues.push(...validateTerminalTarget(lanePath + ".terminal", lane.terminal, context.indexMap))
    const laneKey = terminalIdentityKey(lane.terminal, context.indexMap)
    if (laneKey && typeof lane.id === "string") {
      const existing = terminalKeys.get(laneKey)
      if (existing) issues.push({ path: lanePath + ".terminal", message: "duplicate parallel lane terminal: " + laneKey + " already used by " + existing })
      terminalKeys.set(laneKey, lane.id)
    }
    validateParallelLaneBody(issues, lanePath + ".body", lane.body, lane as ParallelLane, context)
  }
}

function validateParallelLaneBody(issues: ValidationIssue[], path: string, body: unknown, lane: ParallelLane, context: ValidationContext) {
  if (!Array.isArray(body)) {
    issues.push({ path, message: "parallel lane body must be an array" })
    return
  }
  if (body.length === 0) {
    issues.push({ path, message: "parallel lane body must end with output" })
    return
  }
  const laneContext = childContext(context, context.loopDepth)
  const laneOutputContext: ValidationContext = { ...context, artifactOutputs: new Map(), loopDepth: context.loopDepth }
  let outputCount = 0
  for (const [index, item] of body.entries()) {
    const itemPath = path + "[" + index + "]"
    if (!isObject(item)) {
      issues.push({ path: itemPath, message: "parallel lane node must be an object" })
      continue
    }
    validateNodeId(issues, itemPath + ".id", item.id, context)
    if (typeof item.type !== "string") {
      issues.push({ path: itemPath + ".type", message: "parallel lane node type must be a string" })
      continue
    }
    if (item.type === "output") {
      outputCount += 1
      validateParallelOutputNode(issues, itemPath, item, laneOutputContext)
      if (index !== body.length - 1) issues.push({ path: itemPath + ".type", message: "parallel lane output must be the final node" })
      continue
    }
    if (index === body.length - 1) issues.push({ path: itemPath + ".type", message: "parallel lane must end with output" })
    if (item.type === "send" || item.type === "wait" || item.type === "capture-source" || item.type === "extract_text") {
      validateParallelLaneAction(issues, itemPath, item, lane, laneContext)
      if (typeof item.id === "string") {
        if (item.type === "capture-source") registerArtifactOutput(laneOutputContext, item.id, "captured_text")
        if (item.type === "extract_text") registerArtifactOutput(laneOutputContext, item.id, "extracted_text")
      }
      continue
    }
    issues.push({ path: itemPath + ".type", message: "parallel lane only supports send, wait, capture-source, extract_text, and final output" })
  }
  if (outputCount === 0) issues.push({ path, message: "parallel lane must declare final output" })
  if (outputCount > 1) issues.push({ path, message: "parallel lane must declare exactly one output" })
}

function validateParallelLaneAction(issues: ValidationIssue[], path: string, node: Record<string, unknown>, lane: ParallelLane, context: ValidationContext) {
  validateActionNode(issues, path, node, context)
  const laneInfo = context.terminals ? tabInfoForTarget(lane.terminal, context.indexMap, context.terminals) : undefined
  if (node.type === "wait" && laneInfo?.capabilities && !laneInfo.capabilities.canWaitQuiet) {
    const label = laneInfo.item?.terminalAlias ?? laneInfo.terminal?.terminalAlias ?? "target tab"
    issues.push({ path: path + ".type", message: String(node.id ?? "parallel lane wait") + ": target tab " + label + " does not support wait; required shell tab" })
  }
  if (node.type === "send") validateSameTerminal(issues, path + ".terminal", lane.terminal, node.terminal, context.indexMap, "parallel lane send terminal must match lane terminal")
  if (node.type === "wait") {
    if (node.mode === "user-continue") issues.push({ path: path + ".mode", message: "parallel lane wait must not use user-continue" })
    if (node.mode === "terminal-quiet") {
      if (node.onTimeout !== "pause") issues.push({ path: path + ".onTimeout", message: "parallel lane wait onTimeout must be pause" })
      validateSameTerminal(issues, path + ".terminal", lane.terminal, node.terminal, context.indexMap, "parallel lane wait terminal must match lane terminal")
    }
  }
  if (node.type === "capture-source" && isObject(node.capture)) validateSameTerminal(issues, path + ".capture.terminal", lane.terminal, node.capture.terminal, context.indexMap, "parallel lane capture terminal must match lane terminal")
  if (node.type === "extract_text" && (node.onEmpty === "continue" || node.onEmpty === "finish")) issues.push({ path: path + ".onEmpty", message: "parallel lane extract onEmpty must be pause or fail" })
}

function validateParallelOutputNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, laneOutputContext: ValidationContext) {
  rejectUnknownKeys(issues, path, node, PARALLEL_OUTPUT_KEYS)
  if (!isObject(node.source)) {
    issues.push({ path: path + ".source", message: "parallel output source must be an object" })
    return
  }
  if (node.source.kind === "none") {
    rejectUnknownKeys(issues, path + ".source", node.source, PARALLEL_OUTPUT_NONE_KEYS)
    return
  }
  validateArtifactSource(issues, path + ".source", node.source, laneOutputContext)
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
    const bodyContext = childContext(context, context.loopDepth + 1)
    if (isObject(node.range) && node.range.kind === "text-list" && typeof node.id === "string") {
      bodyContext.textTemplateScopes = [...context.textTemplateScopes, node.id]
    }
    validateNodeList(issues, path + ".body", node.body, bodyContext, true)
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
  if (!hasOwnEnumerableField(range, "kind")) {
    issues.push({ path: path + ".kind", message: "for range kind must be count, forever or text-list" })
    return
  }
  if (range.kind === "count") {
    rejectUnknownKeys(issues, path, range, RANGE_COUNT_KEYS)
    if (hasOwnEnumerableField(range, "count")) validatePositiveInt(issues, path + ".count", range.count)
    else issues.push({ path: path + ".count", message: "count range must own an enumerable count field" })
    return
  }
  if (range.kind === "forever") {
    rejectUnknownKeys(issues, path, range, RANGE_FOREVER_KEYS)
    return
  }
  if (range.kind === "text-list") {
    rejectUnknownKeys(issues, path, range, RANGE_TEXT_LIST_KEYS)
    if (!hasOwnEnumerableField(range, "items")) {
      issues.push({ path: path + ".items", message: "text-list range must own an enumerable items field" })
      return
    }
    if (!Array.isArray(range.items)) { issues.push({ path: path + ".items", message: "text-list items must be an array" }); return }
    if (range.items.length === 0) issues.push({ path: path + ".items", message: "text-list items must not be empty" })
    range.items.forEach((item, index) => {
      const itemPath = path + ".items[" + index + "]"
      if (!isObject(item)) {
        issues.push({ path: itemPath, message: "text-list item must be an object" })
        return
      }
      rejectUnknownKeys(issues, itemPath, item, TEXT_LIST_ITEM_KEYS)
      const key = hasOwnEnumerableField(item, "key") ? item.key : undefined
      const value = hasOwnEnumerableField(item, "value") ? item.value : undefined
      validateString(issues, itemPath + ".key", key, 0)
      if (typeof key === "string" && /[\r\n]/.test(key)) {
        issues.push({ path: itemPath + ".key", message: "text-list item key must not contain CR or LF" })
      }
      validateString(issues, itemPath + ".value", value, 0)
    })
    return
  }
  issues.push({ path: path + ".kind", message: "for range kind must be count, forever or text-list" })
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
    } else if (part.kind === "template") {
      rejectUnknownKeys(issues, partPath, part, TEMPLATE_PART_KEYS)
      validateScopedTemplateValue(issues, partPath + ".template", part.template, context)
    } else if (part.kind === "artifact") {
      rejectUnknownKeys(issues, partPath, part, ARTIFACT_PART_KEYS)
      if (part.source !== undefined) validateArtifactSource(issues, partPath + ".source", part.source, context)
    } else {
      issues.push({ path: partPath + ".kind", message: "message part kind must be text, template or artifact" })
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

function validateWaitQuietCapability(issues: ValidationIssue[], path: string, target: unknown, context: ValidationContext, actionId: unknown) {
  if (!context.terminals || !isObject(target)) return
  const info = tabInfoForTarget(target as TerminalTarget, context.indexMap, context.terminals)
  if (!info.terminal || !info.capabilities || info.capabilities.canWaitQuiet) return
  const label = info.item?.terminalAlias ?? info.terminal.terminalAlias ?? info.terminal.terminalId
  const prefix = typeof actionId === "string" ? actionId + ": " : ""
  issues.push({ path, message: prefix + "target tab " + label + " does not support terminal-quiet; required shell tab" })
}

function validateCaptureCapability(issues: ValidationIssue[], path: string, kind: unknown, target: unknown, context: ValidationContext, actionId: unknown) {
  if (!context.terminals || !isObject(target) || typeof kind !== "string") return
  const info = tabInfoForTarget(target as TerminalTarget, context.indexMap, context.terminals)
  if (!info.terminal || !info.capabilities || isCaptureKindAllowed(info.capabilities, kind as CaptureSourceConfig["kind"])) return
  const label = info.item?.terminalAlias ?? info.terminal.terminalAlias ?? info.terminal.terminalId
  const prefix = typeof actionId === "string" ? actionId + ": " : ""
  issues.push({ path, message: prefix + "target tab " + label + " does not support " + kind + " capture; allowed capture kinds: " + info.capabilities.captureKinds.join(", ") })
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
  return { ...context, loopDepth, artifactOutputs: cloneArtifactOutputs(context.artifactOutputs), textTemplateScopes: [...context.textTemplateScopes] }
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

function validateTemplatableScalarText(issues: ValidationIssue[], path: string, value: unknown, context: ValidationContext, minLength: number) {
  if (typeof value === "string") { validateString(issues, path, value, minLength); return }
  if (!isScopedTemplateText(value)) {
    issues.push({ path, message: "value must be a literal string or scoped template object" })
    return
  }
  rejectUnknownKeys(issues, path, value as unknown as Record<string, unknown>, TEMPLATE_PART_KEYS)
  validateScopedTemplateValue(issues, path + ".template", value.template, context)
}

function validateScopedTemplateValue(issues: ValidationIssue[], path: string, value: unknown, context: ValidationContext) {
  if (typeof value !== "string") {
    issues.push({ path, message: "template must be a string" })
    return
  }
  const syntaxIssue = scopedTemplateSyntaxIssue(value)
  if (syntaxIssue) issues.push({ path, message: syntaxIssue })
  if (context.textTemplateScopes.length === 0) issues.push({ path, message: "template requires an enclosing text-list for" })
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

function hasOwnEnumerableField(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.propertyIsEnumerable.call(value, key)
}
