import { assertValidPublicId } from '../identifier'
import type { TerminalIndexMapItem } from '../protocol'
import type { ProfileCatalogSummary, SignalSummary } from './profileCatalogSummary'
import { PROFILE_CATALOG_SUMMARY, profileById } from './profileCatalogSummary'
import { validateTerminalTarget } from './terminalRef'
import type { BooleanNullRegexRule, BranchOperator, CaptureSourceConfig, MacroTemplate, ParserConfig, ValidationIssue, ValidationResult } from './templateTypes'
import { validateMacroTemplate } from './templateSchema'
import type { FlowV2Template } from './flowV2Types'

export const FLOW_V2_ACTION_TYPES = ['send_line', 'input_line', 'sleep', 'wait', 'capture-source', 'parse', 'parallel_all'] as const
export const FLOW_V2_CONTROL_TYPES = ['if', 'for', 'break', 'continue', 'return'] as const
export const FLOW_V2_LEGACY_TYPES = ['pause', 'stop', 'goto', 'branch', 'complete', 'fail'] as const

const ACTION_TYPES = new Set<string>(FLOW_V2_ACTION_TYPES)
const CONTROL_TYPES = new Set<string>(FLOW_V2_CONTROL_TYPES)
const LEGACY_TYPES = new Set<string>(FLOW_V2_LEGACY_TYPES)
const BRANCH_OPERATORS: BranchOperator[] = ['==', '!=', 'is_null']
const CONDITION_KEYS = new Set(['fromParseStep', 'signal', 'op', 'value'])
const SEND_LINE_KEYS = new Set(['id', 'type', 'terminal', 'text'])
const INPUT_LINE_KEYS = new Set(['id', 'type', 'terminal', 'prompt', 'allowEmpty'])
const SLEEP_DURATION_KEYS = new Set(['id', 'type', 'mode', 'durationMs'])
const SLEEP_UNTIL_RESUME_KEYS = new Set(['id', 'type', 'mode', 'reason'])
const SLEEP_ANY_KEYS = new Set(['id', 'type', 'mode', 'durationMs', 'reason'])
const WAIT_DURATION_KEYS = new Set(['id', 'type', 'mode', 'durationMs'])
const WAIT_CAPTURE_READY_KEYS = new Set(['id', 'type', 'mode', 'captureStep', 'timeoutMs', 'onTimeout'])
const WAIT_TERMINAL_QUIET_KEYS = new Set(['id', 'type', 'mode', 'terminal', 'quietMs', 'maxMs', 'onTimeout'])
const WAIT_USER_CONTINUE_KEYS = new Set(['id', 'type', 'mode', 'prompt'])
const WAIT_ANY_KEYS = new Set(['id', 'type', 'mode', 'durationMs', 'captureStep', 'timeoutMs', 'onTimeout', 'terminal', 'quietMs', 'maxMs', 'prompt'])
const CAPTURE_SOURCE_KEYS = new Set(['id', 'type', 'capture'])
const PARSE_KEYS = new Set(['id', 'type', 'captureStep', 'parser'])
const PARALLEL_ALL_KEYS = new Set(['id', 'type', 'lanes', 'join'])
const IF_KEYS = new Set(['id', 'type', 'branches', 'else'])
const IF_BRANCH_KEYS = new Set(['kind', 'condition', 'body'])
const FOR_KEYS = new Set(['id', 'type', 'range', 'body'])
const CONTROL_TERMINAL_KEYS = new Set(['id', 'type', 'reason'])

type ValidateOptions = {
  indexMap?: TerminalIndexMapItem[]
  profileCatalog?: ProfileCatalogSummary
}

type ParseOutput = {
  signals: SignalSummary[]
  operators: BranchOperator[]
}

type ValidationContext = {
  indexMap?: TerminalIndexMapItem[]
  profileCatalog: ProfileCatalogSummary
  nodeIds: Set<string>
  captureSteps: Set<string>
  parseOutputs: Map<string, ParseOutput>
  loopDepth: number
}

export function validateFlowV2Template(value: unknown, options: ValidateOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!isObject(value)) return invalid('template', 'Flow V2 template must be an object')

  const template = value as FlowV2Template
  if (template.schemaVersion !== 2) issues.push({ path: 'schemaVersion', message: 'Flow V2 template schemaVersion must be 2' })
  validatePublicId(issues, 'id', template.id)
  validatePublicId(issues, 'configId', template.configId)
  validateString(issues, 'name', template.name, 1)
  if (template.description !== undefined) validateString(issues, 'description', template.description, 0)
  if (template.createdAt !== undefined) validateIsoString(issues, 'createdAt', template.createdAt)
  if (template.updatedAt !== undefined) validateIsoString(issues, 'updatedAt', template.updatedAt)
  rejectTemplateOnlyV1Fields(issues, value)
  rejectSessionFields(issues, value, '')

  const context: ValidationContext = {
    indexMap: options.indexMap,
    profileCatalog: options.profileCatalog ?? PROFILE_CATALOG_SUMMARY,
    nodeIds: new Set(),
    captureSteps: new Set(),
    parseOutputs: new Map(),
    loopDepth: 0,
  }
  validateNodeList(issues, 'body', template.body, context, true)
  return { ok: issues.length === 0, issues }
}

function validateNodeList(issues: ValidationIssue[], path: string, nodes: unknown, context: ValidationContext, requireNonEmpty: boolean) {
  if (!Array.isArray(nodes)) {
    issues.push({ path, message: 'node body must be an array' })
    return
  }
  if (requireNonEmpty && nodes.length === 0) issues.push({ path, message: 'node body must not be empty' })
  for (const [index, node] of nodes.entries()) validateNode(issues, path + '[' + index + ']', node, context)
}

function validateNode(issues: ValidationIssue[], path: string, node: unknown, context: ValidationContext) {
  if (!isObject(node)) {
    issues.push({ path, message: 'node must be an object' })
    return
  }
  validateNodeId(issues, path + '.id', node.id, context)
  if (typeof node.type !== 'string') {
    issues.push({ path: path + '.type', message: 'node type must be a string' })
    return
  }
  if (LEGACY_TYPES.has(node.type)) {
    issues.push({ path: path + '.type', message: 'legacy flow node ' + node.type + ' is not allowed in Flow V2 primary body' })
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
  issues.push({ path: path + '.type', message: 'unsupported Flow V2 node type' })
}

function validateActionNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  if (node.type === 'send_line') {
    rejectUnknownKeys(issues, path, node, SEND_LINE_KEYS)
    issues.push(...validateTerminalTarget(path + '.terminal', node.terminal, context.indexMap))
    validateString(issues, path + '.text', node.text, 1)
    return
  }
  if (node.type === 'input_line') {
    rejectUnknownKeys(issues, path, node, INPUT_LINE_KEYS)
    issues.push(...validateTerminalTarget(path + '.terminal', node.terminal, context.indexMap))
    validateString(issues, path + '.prompt', node.prompt, 1)
    if (typeof node.allowEmpty !== 'boolean') issues.push({ path: path + '.allowEmpty', message: 'allowEmpty must be boolean' })
    return
  }
  if (node.type === 'sleep') {
    validateSleepNode(issues, path, node)
    return
  }
  if (node.type === 'wait') {
    validateWaitNode(issues, path, node, context)
    return
  }
  if (node.type === 'capture-source') {
    rejectUnknownKeys(issues, path, node, CAPTURE_SOURCE_KEYS)
    validateCaptureConfig(issues, path + '.capture', node.capture, context.indexMap)
    if (typeof node.id === 'string') context.captureSteps.add(node.id)
    return
  }
  if (node.type === 'parse') {
    rejectUnknownKeys(issues, path, node, PARSE_KEYS)
    validatePublicId(issues, path + '.captureStep', node.captureStep)
    if (typeof node.captureStep === 'string' && !context.captureSteps.has(node.captureStep)) {
      issues.push({ path: path + '.captureStep', message: 'parse captureStep must reference an earlier capture-source node in the same visible block path' })
    }
    validateParserConfig(issues, path + '.parser', node.parser, context.profileCatalog)
    if (typeof node.id === 'string' && isObject(node.parser)) {
      const output = parseOutputForParser(node.parser as ParserConfig, context.profileCatalog)
      if (output) context.parseOutputs.set(node.id, output)
    }
    return
  }
  validateParallelAllNode(issues, path, node, context)
}

function validateControlNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  if (node.type === 'if') {
    rejectUnknownKeys(issues, path, node, IF_KEYS)
    validateIfNode(issues, path, node, context)
    return
  }
  if (node.type === 'for') {
    rejectUnknownKeys(issues, path, node, FOR_KEYS)
    if (!isObject(node.range)) {
      issues.push({ path: path + '.range', message: 'for node must declare range object' })
    } else {
      validatePositiveInt(issues, path + '.range.count', node.range.count)
    }
    validateNodeList(issues, path + '.body', node.body, childContext(context, context.loopDepth + 1), true)
    return
  }
  if (node.type === 'break' || node.type === 'continue') {
    rejectUnknownKeys(issues, path, node, CONTROL_TERMINAL_KEYS)
    if (context.loopDepth < 1) issues.push({ path: path + '.type', message: node.type + ' can only be used inside for body' })
    if (node.reason !== undefined) validateString(issues, path + '.reason', node.reason, 1)
    return
  }
  if (node.type === 'return') {
    rejectUnknownKeys(issues, path, node, CONTROL_TERMINAL_KEYS)
    if (node.reason !== undefined) validateString(issues, path + '.reason', node.reason, 1)
  }
}

function validateIfNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  rejectStringExpressionFields(issues, path, node)
  if (!Array.isArray(node.branches) || node.branches.length === 0) {
    issues.push({ path: path + '.branches', message: 'if node must declare at least one if branch' })
    return
  }
  for (const [index, branch] of node.branches.entries()) {
    const branchPath = path + '.branches[' + index + ']'
    if (!isObject(branch)) {
      issues.push({ path: branchPath, message: 'if branch must be an object' })
      continue
    }
    rejectStringExpressionFields(issues, branchPath, branch)
    rejectUnknownKeys(issues, branchPath, branch, IF_BRANCH_KEYS)
    if (index === 0 && branch.kind !== 'if') issues.push({ path: branchPath + '.kind', message: 'first branch kind must be if' })
    if (index > 0 && branch.kind !== 'elif') issues.push({ path: branchPath + '.kind', message: 'later branch kind must be elif' })
    validateCondition(issues, branchPath + '.condition', branch.condition, context)
    validateNodeList(issues, branchPath + '.body', branch.body, childContext(context, context.loopDepth), true)
  }
  if ('else' in node) validateNodeList(issues, path + '.else', node.else, childContext(context, context.loopDepth), true)
}

function validateCondition(issues: ValidationIssue[], path: string, value: unknown, context: ValidationContext) {
  if (!isObject(value)) {
    issues.push({ path, message: 'condition must be an object' })
    return
  }
  rejectStringExpressionFields(issues, path, value)
  for (const key of Object.keys(value)) {
    if (!CONDITION_KEYS.has(key)) issues.push({ path: path + '.' + key, message: 'extra condition fields are not allowed; use fromParseStep/signal/op/value' })
  }
  validatePublicId(issues, path + '.fromParseStep', value.fromParseStep)
  validatePublicId(issues, path + '.signal', value.signal)
  if (!BRANCH_OPERATORS.includes(value.op as BranchOperator)) {
    issues.push({ path: path + '.op', message: 'condition op must be ==, != or is_null' })
    return
  }
  const op = value.op as BranchOperator
  const output = typeof value.fromParseStep === 'string' ? context.parseOutputs.get(value.fromParseStep) : undefined
  if (!output) {
    if (typeof value.fromParseStep === 'string') issues.push({ path: path + '.fromParseStep', message: 'condition must reference an earlier parse node' })
  } else {
    const signal = output.signals.find((candidate) => candidate.id === value.signal)
    if (!signal) issues.push({ path: path + '.signal', message: 'signal is not declared by selected parse node' })
    if (!output.operators.includes(op)) issues.push({ path: path + '.op', message: 'operator is not allowed by selected parse node' })
    if (signal?.type !== 'boolean-null') issues.push({ path: path + '.signal', message: 'Flow V2 conditions only support boolean-null signals in V0' })
  }
  if (op === 'is_null') {
    if ('value' in value) issues.push({ path: path + '.value', message: 'is_null must not include value' })
    return
  }
  if (typeof value.value !== 'boolean') issues.push({ path: path + '.value', message: 'boolean-null ==/!= value must be typed true or false' })
}

function validateSleepNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>) {
  if (node.mode === 'duration') {
    rejectUnknownKeys(issues, path, node, SLEEP_DURATION_KEYS)
    validatePositiveInt(issues, path + '.durationMs', node.durationMs)
    return
  }
  if (node.mode === 'until-resume') {
    rejectUnknownKeys(issues, path, node, SLEEP_UNTIL_RESUME_KEYS)
    if ('durationMs' in node) issues.push({ path: path + '.durationMs', message: 'sleep until-resume must not include durationMs' })
    if (node.reason !== undefined) validateString(issues, path + '.reason', node.reason, 1)
    return
  }
  rejectUnknownKeys(issues, path, node, SLEEP_ANY_KEYS)
  issues.push({ path: path + '.mode', message: 'sleep mode must be duration or until-resume' })
}

function validateWaitNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  if (node.mode === 'duration') {
    rejectUnknownKeys(issues, path, node, WAIT_DURATION_KEYS)
    validatePositiveInt(issues, path + '.durationMs', node.durationMs)
    return
  }
  if (node.mode === 'capture-ready-or-user') {
    rejectUnknownKeys(issues, path, node, WAIT_CAPTURE_READY_KEYS)
    validatePublicId(issues, path + '.captureStep', node.captureStep)
    if (typeof node.captureStep === 'string' && !context.captureSteps.has(node.captureStep)) issues.push({ path: path + '.captureStep', message: 'wait captureStep must reference an earlier capture-source node' })
    validatePositiveInt(issues, path + '.timeoutMs', node.timeoutMs)
    validateTimeoutAction(issues, path + '.onTimeout', node.onTimeout)
    return
  }
  if (node.mode === 'terminal-quiet') {
    rejectUnknownKeys(issues, path, node, WAIT_TERMINAL_QUIET_KEYS)
    issues.push(...validateTerminalTarget(path + '.terminal', node.terminal, context.indexMap))
    validatePositiveInt(issues, path + '.quietMs', node.quietMs)
    validatePositiveInt(issues, path + '.maxMs', node.maxMs)
    if (Number.isInteger(node.quietMs) && Number.isInteger(node.maxMs) && Number(node.maxMs) < Number(node.quietMs)) issues.push({ path: path + '.maxMs', message: 'maxMs must be greater than or equal to quietMs' })
    validateTimeoutAction(issues, path + '.onTimeout', node.onTimeout)
    return
  }
  if (node.mode === 'user-continue') {
    rejectUnknownKeys(issues, path, node, WAIT_USER_CONTINUE_KEYS)
    validateString(issues, path + '.prompt', node.prompt, 1)
    return
  }
  rejectUnknownKeys(issues, path, node, WAIT_ANY_KEYS)
  issues.push({ path: path + '.mode', message: 'unsupported wait mode' })
}

function validateParallelAllNode(issues: ValidationIssue[], path: string, node: Record<string, unknown>, context: ValidationContext) {
  rejectUnknownKeys(issues, path, node, PARALLEL_ALL_KEYS)
  const now = '2026-06-30T00:00:00.000Z'
  const synthetic: MacroTemplate = {
    schemaVersion: 1,
    id: 'flow_v2_parallel_probe',
    name: 'Flow V2 parallel probe',
    description: '',
    configId: 'local',
    steps: [node as never],
    createdAt: now,
    updatedAt: now,
  }
  const result = validateMacroTemplate(synthetic, { indexMap: context.indexMap, profileCatalog: context.profileCatalog })
  for (const issue of result.issues) {
    if (issue.path.startsWith('steps[0]')) {
      issues.push({ path: path + issue.path.slice('steps[0]'.length), message: issue.message })
    }
  }
}

function validateCaptureConfig(issues: ValidationIssue[], path: string, capture: unknown, indexMap?: TerminalIndexMapItem[]) {
  if (!isObject(capture)) {
    issues.push({ path, message: 'capture config must be an object' })
    return
  }
  const config = capture as CaptureSourceConfig
  if (config.kind === 'terminal-buffer') {
    issues.push(...validateTerminalTarget(path + '.terminal', config.terminal, indexMap))
    if (config.mode !== 'scrollback-tail') issues.push({ path: path + '.mode', message: 'terminal-buffer mode must be scrollback-tail' })
    validatePositiveInt(issues, path + '.maxChars', config.maxChars)
    return
  }
  if (config.kind === 'agent-event') {
    issues.push(...validateTerminalTarget(path + '.terminal', config.terminal, indexMap))
    if (config.agentKind !== 'codex') issues.push({ path: path + '.agentKind', message: 'V0 agent-event agentKind must be codex' })
    if (config.eventKind !== 'agent.output') issues.push({ path: path + '.eventKind', message: 'V0 agent-event eventKind must be agent.output' })
    if (config.adapter !== 'codex-stop-hook') issues.push({ path: path + '.adapter', message: 'V0 agent-event adapter must be codex-stop-hook' })
    return
  }
  issues.push({ path: path + '.kind', message: 'capture kind must be terminal-buffer or agent-event' })
}

function validateParserConfig(issues: ValidationIssue[], path: string, parser: unknown, catalog: ProfileCatalogSummary) {
  if (!isObject(parser)) {
    issues.push({ path, message: 'parser must be an object' })
    return
  }
  const config = parser as ParserConfig
  if (config.kind === 'ai-json') {
    validatePublicId(issues, path + '.profileId', config.profileId)
    if (!profileFromCatalog(config.profileId, catalog)) issues.push({ path: path + '.profileId', message: 'unknown parserProfileId' })
    return
  }
  if (config.kind === 'regex') {
    if (!Array.isArray(config.rules) || config.rules.length === 0) {
      issues.push({ path: path + '.rules', message: 'regex parser must declare at least one rule' })
      return
    }
    const seen = new Set<string>()
    for (const [index, rule] of config.rules.entries()) validateRegexRule(issues, path + '.rules[' + index + ']', rule, seen)
    return
  }
  issues.push({ path: path + '.kind', message: 'parser.kind must be ai-json or regex' })
}

function validateRegexRule(issues: ValidationIssue[], path: string, rule: BooleanNullRegexRule, seen: Set<string>) {
  if (!isObject(rule)) {
    issues.push({ path, message: 'regex rule must be an object' })
    return
  }
  validatePublicId(issues, path + '.signal', rule.signal)
  if (seen.has(String(rule.signal))) issues.push({ path: path + '.signal', message: 'duplicate regex signal' })
  seen.add(String(rule.signal))
  if (rule.type !== 'boolean-null') issues.push({ path: path + '.type', message: 'V0 regex rule type must be boolean-null' })
  validateString(issues, path + '.pattern', rule.pattern, 1)
  if (!isBooleanOrNull(rule.onMatch)) issues.push({ path: path + '.onMatch', message: 'onMatch must be true, false or null' })
  if (!isBooleanOrNull(rule.onNoMatch)) issues.push({ path: path + '.onNoMatch', message: 'onNoMatch must be true, false or null' })
}

function parseOutputForParser(parser: ParserConfig, catalog: ProfileCatalogSummary): ParseOutput | undefined {
  if (parser.kind === 'ai-json') {
    const profile = profileFromCatalog(parser.profileId, catalog)
    return profile ? { signals: profile.signals, operators: profile.branchOperators } : undefined
  }
  if (parser.kind === 'regex' && Array.isArray(parser.rules)) return { signals: parser.rules.map((rule) => ({ id: rule.signal, type: rule.type })), operators: BRANCH_OPERATORS }
  return undefined
}

function profileFromCatalog(profileId: string, catalog: ProfileCatalogSummary) {
  if (catalog === PROFILE_CATALOG_SUMMARY) return profileById(profileId)
  return catalog.profiles.find((profile) => profile.profileId === profileId)
}

function childContext(context: ValidationContext, loopDepth: number): ValidationContext {
  return {
    ...context,
    loopDepth,
    captureSteps: new Set(context.captureSteps),
    parseOutputs: new Map(context.parseOutputs),
  }
}

function validateNodeId(issues: ValidationIssue[], path: string, value: unknown, context: ValidationContext) {
  validatePublicId(issues, path, value)
  if (typeof value !== 'string') return
  if (context.nodeIds.has(value)) issues.push({ path, message: 'duplicate Flow V2 node id' })
  context.nodeIds.add(value)
}

function validatePublicId(issues: ValidationIssue[], path: string, value: unknown) {
  if (typeof value !== 'string') {
    issues.push({ path, message: 'value must be a public id string' })
    return
  }
  try { assertValidPublicId(value, 'genericId') } catch { issues.push({ path, message: 'value must match Identifier Contract' }) }
}

function validatePositiveInt(issues: ValidationIssue[], path: string, value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1) issues.push({ path, message: 'value must be a positive integer' })
}

function validateTimeoutAction(issues: ValidationIssue[], path: string, value: unknown) {
  if (value !== 'pause' && value !== 'fail') issues.push({ path, message: 'value must be pause or fail' })
}

function validateString(issues: ValidationIssue[], path: string, value: unknown, minLength: number) {
  if (typeof value !== 'string' || value.length < minLength) issues.push({ path, message: 'value must be a string with length >= ' + minLength })
}

function validateIsoString(issues: ValidationIssue[], path: string, value: unknown) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) issues.push({ path, message: 'value must be an ISO timestamp string' })
}

function rejectUnknownKeys(issues: ValidationIssue[], path: string, value: Record<string, unknown>, allowed: Set<string>) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push({ path: path + '.' + key, message: 'extra Flow V2 node field is not allowed' })
  }
}

function rejectTemplateOnlyV1Fields(issues: ValidationIssue[], value: Record<string, unknown>) {
  if ('steps' in value) issues.push({ path: 'steps', message: 'Flow V2 template must use body, not v1 steps' })
  if ('terminalAliases' in value) issues.push({ path: 'terminalAliases', message: 'macro-local terminalAliases are not allowed; rename terminal tabs instead' })
  if ('captureSources' in value) issues.push({ path: 'captureSources', message: 'capture source config must live in capture-source nodes' })
}

function rejectSessionFields(issues: ValidationIssue[], value: unknown, path: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSessionFields(issues, item, path + '[' + index + ']'))
    return
  }
  if (!isObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? path + '.' + key : key
    if (key === 'session_id' || key === 'codexSessionId') issues.push({ path: childPath, message: 'macro template must not persist Codex session fields' })
    rejectSessionFields(issues, child, childPath)
  }
}

function rejectStringExpressionFields(issues: ValidationIssue[], path: string, value: Record<string, unknown>) {
  if (typeof value.if === 'string') issues.push({ path: path + '.if', message: 'string expressions are not allowed in Flow V2; use structured condition fields' })
  if (typeof value.expression === 'string') issues.push({ path: path + '.expression', message: 'string expressions are not allowed in Flow V2; use structured condition fields' })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return typeof value === 'boolean' || value === null
}

function invalid(path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ path, message }] }
}
