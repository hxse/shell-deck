import { assertValidPublicId, isValidPublicId } from '../identifier'
import type { TerminalIndexMapItem } from '../protocol'
import type { ProfileCatalogSummary, ProfileSummary, SignalSummary } from './profileCatalogSummary'
import { PROFILE_CATALOG_SUMMARY, profileById } from './profileCatalogSummary'
import { validateTerminalTarget } from './terminalRef'
import type {
  BooleanNullRegexRule,
  BranchOperator,
  CaptureSourceConfig,
  MacroStep,
  MacroTemplate,
  ParserConfig,
  ValidationIssue,
  ValidationResult,
} from './templateTypes'

const REGEX_FLAGS_RE = /^[imsu]*$/
const CONTROL_STEP_TYPES = new Set(['pause', 'complete', 'fail', 'stop'])
const BRANCH_OPERATORS: BranchOperator[] = ['==', '!=', 'is_null']
const PROFILE_BUNDLE_KEYS = ['prompt', 'schema', 'jsonSchema', 'checkSet', 'fixtures', 'model', 'replicas']
const BRANCH_CONDITION_KEYS = new Set(['signal', 'op', 'value', 'goto'])

type ValidateOptions = {
  indexMap?: TerminalIndexMapItem[]
  profileCatalog?: ProfileCatalogSummary
}

type ParseOutput = {
  signals: SignalSummary[]
  operators: BranchOperator[]
}

export function validateProfileCatalogSummary(catalog: ProfileCatalogSummary = PROFILE_CATALOG_SUMMARY): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!catalog || typeof catalog !== 'object') return invalid('catalog', 'profile catalog must be an object')
  if (catalog.schemaVersion !== 1) issues.push({ path: 'schemaVersion', message: 'profile catalog schemaVersion must be 1' })
  if (!Array.isArray(catalog.profiles)) {
    issues.push({ path: 'profiles', message: 'profiles must be an array' })
    return { ok: false, issues }
  }
  const profileIds = new Set<string>()
  for (const [profileIndex, profile] of catalog.profiles.entries()) {
    const path = 'profiles[' + profileIndex + ']'
    if (!isPublicId(profile.profileId)) issues.push({ path: path + '.profileId', message: 'profileId must be a public id' })
    if (profileIds.has(profile.profileId)) issues.push({ path: path + '.profileId', message: 'duplicate profileId' })
    profileIds.add(profile.profileId)
    rejectDisallowedProfileSummaryKeys(issues, profile as unknown as Record<string, unknown>, path)
    if (profile.parserKind !== 'ai-json') issues.push({ path: path + '.parserKind', message: 'V0 built-in profiles must use ai-json' })
    validateString(issues, path + '.name', profile.name, 1)
    validateString(issues, path + '.description', profile.description, 1)
    validateOperators(issues, path + '.branchOperators', profile.branchOperators)
    validateSignals(issues, path + '.signals', profile.signals)
  }
  return { ok: issues.length === 0, issues }
}

export function validateMacroTemplate(value: unknown, options: ValidateOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!isObject(value)) return invalid('template', 'macro template must be an object')

  const template = value as MacroTemplate
  if (template.schemaVersion !== 1) issues.push({ path: 'schemaVersion', message: 'schemaVersion must be 1' })
  validatePublicId(issues, 'id', template.id, 'genericId')
  validatePublicId(issues, 'configId', template.configId, 'configId')
  validateString(issues, 'name', template.name, 1)
  validateString(issues, 'description', template.description, 0)
  validateIsoString(issues, 'createdAt', template.createdAt)
  validateIsoString(issues, 'updatedAt', template.updatedAt)
  rejectDisallowedTemplateKeys(issues, value, '')
  if ('terminalAliases' in value) issues.push({ path: 'terminalAliases', message: 'macro-local terminalAliases are not allowed; rename terminal tabs instead' })
  if ('captureSources' in value) issues.push({ path: 'captureSources', message: 'capture source config must live in capture-source steps' })

  if (!Array.isArray(template.steps)) {
    issues.push({ path: 'steps', message: 'steps must be an array' })
    return { ok: false, issues }
  }

  const stepIds = new Set<string>()
  const stepIndex = new Map<string, number>()
  for (const [index, step] of template.steps.entries()) {
    const path = 'steps[' + index + ']'
    if (!isObject(step)) {
      issues.push({ path, message: 'step must be an object' })
      continue
    }
    validatePublicId(issues, path + '.id', step.id, 'genericId')
    if (stepIds.has(step.id)) issues.push({ path: path + '.id', message: 'duplicate step id' })
    stepIds.add(step.id)
    stepIndex.set(step.id, index)
  }

  for (const [index, step] of template.steps.entries()) {
    if (!isObject(step)) continue
    validateStep(issues, step as MacroStep, index, template, options)
  }

  validateGraphEdges(issues, template.steps, stepIndex)
  return { ok: issues.length === 0, issues }
}

export function assertValidMacroTemplate(value: unknown, options: ValidateOptions = {}): MacroTemplate {
  const result = validateMacroTemplate(value, options)
  if (!result.ok) {
    throw new Error('invalid_macro_template:' + result.issues.map((issue) => issue.path + ':' + issue.message).join('; '))
  }
  return value as MacroTemplate
}

function validateStep(issues: ValidationIssue[], step: MacroStep, index: number, template: MacroTemplate, options: ValidateOptions) {
  const path = 'steps[' + index + ']'
  validateLoopGuard(issues, path, step.loopGuard)
  if ('next' in step && step.next !== undefined) validatePublicId(issues, path + '.next', step.next, 'genericId')

  if (step.type === 'send_line') {
    issues.push(...validateTerminalTarget(path + '.terminal', step.terminal, options.indexMap))
    validateString(issues, path + '.text', step.text, 1)
    return
  }
  if (step.type === 'sleep') {
    validatePositiveInt(issues, path + '.durationMs', step.durationMs)
    return
  }
  if (step.type === 'input_line') {
    issues.push(...validateTerminalTarget(path + '.terminal', step.terminal, options.indexMap))
    validateString(issues, path + '.prompt', step.prompt, 1)
    if (typeof step.allowEmpty !== 'boolean') issues.push({ path: path + '.allowEmpty', message: 'allowEmpty must be boolean' })
    return
  }
  if (step.type === 'wait') {
    validateWaitStep(issues, path, step, template, options.indexMap)
    return
  }
  if (step.type === 'capture-source') {
    validateCaptureConfig(issues, path + '.capture', step.capture, options.indexMap)
    return
  }
  if (step.type === 'parse') {
    validateCaptureStepRef(issues, path + '.captureStep', step.captureStep, template)
    validateParserConfig(issues, path + '.parser', step.parser, options.profileCatalog)
    return
  }
  if (step.type === 'branch') {
    validateBranchStep(issues, path, step, template, options.profileCatalog)
    return
  }
  if (step.type === 'goto') {
    validatePublicId(issues, path + '.goto', step.goto, 'genericId')
    return
  }
  if (CONTROL_STEP_TYPES.has(step.type)) {
    if (step.reason !== undefined) validateString(issues, path + '.reason', step.reason, 1)
    return
  }
  issues.push({ path: path + '.type', message: 'unsupported step type' })
}

function validateCaptureConfig(issues: ValidationIssue[], path: string, capture: CaptureSourceConfig, indexMap?: TerminalIndexMapItem[]) {
  if (!isObject(capture)) {
    issues.push({ path, message: 'capture config must be an object' })
    return
  }
  if (capture.kind === 'terminal-buffer') {
    issues.push(...validateTerminalTarget(path + '.terminal', capture.terminal, indexMap))
    if (capture.mode !== 'scrollback-tail') issues.push({ path: path + '.mode', message: 'terminal-buffer mode must be scrollback-tail' })
    validatePositiveInt(issues, path + '.maxChars', capture.maxChars)
    return
  }
  if (capture.kind === 'agent-event') {
    issues.push(...validateTerminalTarget(path + '.terminal', capture.terminal, indexMap))
    if (capture.agentKind !== 'codex') issues.push({ path: path + '.agentKind', message: 'V0 agent-event agentKind must be codex' })
    if (capture.eventKind !== 'agent.output') issues.push({ path: path + '.eventKind', message: 'V0 agent-event eventKind must be agent.output' })
    if (capture.adapter !== 'codex-stop-hook') issues.push({ path: path + '.adapter', message: 'V0 agent-event adapter must be codex-stop-hook' })
    return
  }
  issues.push({ path: path + '.kind', message: 'capture kind must be terminal-buffer or agent-event' })
}

function validateWaitStep(issues: ValidationIssue[], path: string, step: MacroStep, template: MacroTemplate, indexMap?: TerminalIndexMapItem[]) {
  if (step.type !== 'wait') return
  if (step.mode === 'duration') {
    validatePositiveInt(issues, path + '.durationMs', step.durationMs)
    return
  }
  if (step.mode === 'capture-ready-or-user') {
    validateCaptureStepRef(issues, path + '.captureStep', step.captureStep, template)
    validatePositiveInt(issues, path + '.timeoutMs', step.timeoutMs)
    validateTimeoutAction(issues, path + '.onTimeout', step.onTimeout)
    return
  }
  if (step.mode === 'terminal-quiet') {
    issues.push(...validateTerminalTarget(path + '.terminal', step.terminal, indexMap))
    validatePositiveInt(issues, path + '.quietMs', step.quietMs)
    validatePositiveInt(issues, path + '.maxMs', step.maxMs)
    if (Number.isInteger(step.quietMs) && Number.isInteger(step.maxMs) && step.maxMs < step.quietMs) {
      issues.push({ path: path + '.maxMs', message: 'maxMs must be greater than or equal to quietMs' })
    }
    validateTimeoutAction(issues, path + '.onTimeout', step.onTimeout)
    return
  }
  if (step.mode === 'user-continue') {
    validateString(issues, path + '.prompt', step.prompt, 1)
    return
  }
  issues.push({ path: path + '.mode', message: 'unsupported wait mode' })
}

function validateParserConfig(issues: ValidationIssue[], path: string, parser: ParserConfig, catalog = PROFILE_CATALOG_SUMMARY) {
  if (!isObject(parser)) {
    issues.push({ path, message: 'parser must be an object' })
    return
  }
  rejectDisallowedParserKeys(issues, parser, path)
  if (parser.kind === 'ai-json') {
    validatePublicId(issues, path + '.profileId', parser.profileId, 'genericId')
    if (!profileFromCatalog(parser.profileId, catalog)) issues.push({ path: path + '.profileId', message: 'unknown parserProfileId' })
    return
  }
  if (parser.kind === 'regex') {
    if (!Array.isArray(parser.rules) || parser.rules.length === 0) {
      issues.push({ path: path + '.rules', message: 'regex parser must declare at least one rule' })
      return
    }
    const signals = new Set<string>()
    for (const [ruleIndex, rule] of parser.rules.entries()) validateRegexRule(issues, path + '.rules[' + ruleIndex + ']', rule, signals)
    return
  }
  issues.push({ path: path + '.kind', message: 'parser.kind must be ai-json or regex' })
}

function validateRegexRule(issues: ValidationIssue[], path: string, rule: BooleanNullRegexRule, signals: Set<string>) {
  if (!isObject(rule)) {
    issues.push({ path, message: 'regex rule must be an object' })
    return
  }
  validatePublicId(issues, path + '.signal', rule.signal, 'genericId')
  if (signals.has(rule.signal)) issues.push({ path: path + '.signal', message: 'duplicate regex signal' })
  signals.add(rule.signal)
  if (rule.type !== 'boolean-null') issues.push({ path: path + '.type', message: 'V0 regex rule type must be boolean-null' })
  validateString(issues, path + '.pattern', rule.pattern, 1)
  if (typeof rule.flags === 'string') {
    if (!REGEX_FLAGS_RE.test(rule.flags)) {
      issues.push({ path: path + '.flags', message: 'regex flags may only include i, m, s, u' })
    } else {
      try { new RegExp(rule.pattern, rule.flags) } catch (error) { issues.push({ path: path + '.pattern', message: error instanceof Error ? error.message : 'invalid regex pattern' }) }
    }
  } else if (rule.flags !== undefined) {
    issues.push({ path: path + '.flags', message: 'regex flags must be a string when present' })
  } else {
    try { new RegExp(rule.pattern) } catch (error) { issues.push({ path: path + '.pattern', message: error instanceof Error ? error.message : 'invalid regex pattern' }) }
  }
  if (!isBooleanOrNull(rule.onMatch)) issues.push({ path: path + '.onMatch', message: 'onMatch must be true, false or null' })
  if (!isBooleanOrNull(rule.onNoMatch)) issues.push({ path: path + '.onNoMatch', message: 'onNoMatch must be true, false or null' })
}

function validateBranchStep(issues: ValidationIssue[], path: string, step: MacroStep, template: MacroTemplate, catalog = PROFILE_CATALOG_SUMMARY) {
  if (step.type !== 'branch') return
  validatePublicId(issues, path + '.fromParseStep', step.fromParseStep, 'genericId')
  const parseStep = template.steps.find((candidate): candidate is Extract<MacroStep, { type: 'parse' }> => candidate.id === step.fromParseStep && candidate.type === 'parse')
  if (!parseStep) issues.push({ path: path + '.fromParseStep', message: 'fromParseStep must reference a parse step' })
  const output = parseStep ? parseOutputForStep(parseStep, catalog) : undefined
  if (step.else !== undefined) validatePublicId(issues, path + '.else', step.else, 'genericId')
  if (!Array.isArray(step.conditions) || step.conditions.length === 0) {
    issues.push({ path: path + '.conditions', message: 'branch must declare at least one structured condition' })
    return
  }
  for (const [conditionIndex, condition] of step.conditions.entries()) {
    const conditionPath = path + '.conditions[' + conditionIndex + ']'
    if (!isObject(condition)) {
      issues.push({ path: conditionPath, message: 'branch condition must be an object' })
      continue
    }
    rejectDisallowedBranchConditionKeys(issues, conditionPath, condition)
    validateBranchCondition(issues, conditionPath, condition, output)
  }
}

function validateBranchCondition(issues: ValidationIssue[], path: string, condition: Record<string, unknown>, output: ParseOutput | undefined) {
  validatePublicId(issues, path + '.signal', condition.signal, 'genericId')
  validatePublicId(issues, path + '.goto', condition.goto, 'genericId')
  if (!BRANCH_OPERATORS.includes(condition.op as BranchOperator)) {
    issues.push({ path: path + '.op', message: 'branch op must be ==, != or is_null' })
    return
  }
  const op = condition.op as BranchOperator
  if (output) {
    const signal = output.signals.find((item) => item.id === condition.signal)
    if (!signal) issues.push({ path: path + '.signal', message: 'signal is not declared by selected parse step' })
    if (!output.operators.includes(op)) issues.push({ path: path + '.op', message: 'operator is not allowed by selected parse step' })
    if (signal?.type !== 'boolean-null') issues.push({ path: path + '.signal', message: 'V0 branch only supports boolean-null signals' })
  }
  if (op === 'is_null') {
    if ('value' in condition) issues.push({ path: path + '.value', message: 'is_null must not include value' })
    return
  }
  if (typeof condition.value !== 'boolean') issues.push({ path: path + '.value', message: 'boolean-null ==/!= value must be typed true or false' })
}

function parseOutputForStep(step: Extract<MacroStep, { type: 'parse' }>, catalog: ProfileCatalogSummary): ParseOutput | undefined {
  if (step.parser.kind === 'ai-json') {
    const profile = profileFromCatalog(step.parser.profileId, catalog)
    return profile ? { signals: profile.signals, operators: profile.branchOperators } : undefined
  }
  return { signals: step.parser.rules.map((rule) => ({ id: rule.signal, type: rule.type })), operators: BRANCH_OPERATORS }
}

function validateCaptureStepRef(issues: ValidationIssue[], path: string, captureStep: unknown, template: MacroTemplate) {
  validatePublicId(issues, path, captureStep, 'genericId')
  if (typeof captureStep === 'string' && !template.steps.some((step) => step.id === captureStep && step.type === 'capture-source')) {
    issues.push({ path, message: 'captureStep must reference a capture-source step' })
  }
}

function validateGraphEdges(issues: ValidationIssue[], steps: MacroStep[], stepIndex: Map<string, number>) {
  for (const [index, step] of steps.entries()) {
    const path = 'steps[' + index + ']'
    for (const target of edgeTargets(step)) {
      if (!stepIndex.has(target.id)) {
        issues.push({ path: target.path, message: 'target step does not exist' })
        continue
      }
      const targetIndex = stepIndex.get(target.id) ?? 0
      if (targetIndex < index) validateLoopGuardOnBackEdge(issues, path, step)
    }
  }
}

function edgeTargets(step: MacroStep): Array<{ id: string; path: string }> {
  const targets: Array<{ id: string; path: string }> = []
  if ('next' in step && step.next) targets.push({ id: step.next, path: 'steps.' + step.id + '.next' })
  if (step.type === 'goto') targets.push({ id: step.goto, path: 'steps.' + step.id + '.goto' })
  if (step.type === 'branch') {
    for (const [index, condition] of step.conditions.entries()) targets.push({ id: condition.goto, path: 'steps.' + step.id + '.conditions[' + index + '].goto' })
    if (step.else) targets.push({ id: step.else, path: 'steps.' + step.id + '.else' })
  }
  return targets
}

function validateLoopGuardOnBackEdge(issues: ValidationIssue[], path: string, step: MacroStep) {
  if (!step.loopGuard) issues.push({ path: path + '.loopGuard', message: 'back edge requires loopGuard' })
}

function validateLoopGuard(issues: ValidationIssue[], path: string, loopGuard: unknown) {
  if (loopGuard === undefined) return
  if (!isObject(loopGuard)) {
    issues.push({ path: path + '.loopGuard', message: 'loopGuard must be an object' })
    return
  }
  validatePositiveInt(issues, path + '.loopGuard.maxIterations', loopGuard.maxIterations)
  if (Number.isInteger(loopGuard.maxIterations) && (Number(loopGuard.maxIterations) < 1 || Number(loopGuard.maxIterations) > 100)) {
    issues.push({ path: path + '.loopGuard.maxIterations', message: 'maxIterations must be between 1 and 100' })
  }
  validateTimeoutAction(issues, path + '.loopGuard.onLimit', loopGuard.onLimit)
}

function validateOperators(issues: ValidationIssue[], path: string, operators: unknown) {
  if (!Array.isArray(operators) || operators.length === 0) {
    issues.push({ path, message: 'branchOperators must be a non-empty array' })
    return
  }
  for (const [index, operator] of operators.entries()) {
    if (!BRANCH_OPERATORS.includes(operator)) issues.push({ path: path + '[' + index + ']', message: 'unsupported branch operator' })
  }
}

function validateSignals(issues: ValidationIssue[], path: string, signals: unknown) {
  if (!Array.isArray(signals) || signals.length === 0) {
    issues.push({ path, message: 'signals must be a non-empty array' })
    return
  }
  const seen = new Set<string>()
  for (const [index, signal] of signals.entries()) {
    const signalPath = path + '[' + index + ']'
    if (!isObject(signal)) {
      issues.push({ path: signalPath, message: 'signal must be an object' })
      continue
    }
    validatePublicId(issues, signalPath + '.id', signal.id, 'genericId')
    if (seen.has(String(signal.id))) issues.push({ path: signalPath + '.id', message: 'duplicate signal id' })
    seen.add(String(signal.id))
    if (signal.type !== 'boolean-null') issues.push({ path: signalPath + '.type', message: 'V0 signal type must be boolean-null' })
  }
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

function validatePublicId(issues: ValidationIssue[], path: string, value: unknown, kind: Parameters<typeof assertValidPublicId>[1]) {
  if (typeof value !== 'string') {
    issues.push({ path, message: 'value must be a public id string' })
    return
  }
  try { assertValidPublicId(value, kind) } catch { issues.push({ path, message: 'value must match Identifier Contract' }) }
}

function rejectDisallowedTemplateKeys(issues: ValidationIssue[], value: unknown, path: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectDisallowedTemplateKeys(issues, item, path + '[' + index + ']'))
    return
  }
  if (!isObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? path + '.' + key : key
    if (key === 'session_id' || key === 'codexSessionId') issues.push({ path: childPath, message: 'macro template must not persist Codex session fields' })
    rejectDisallowedTemplateKeys(issues, child, childPath)
  }
}

function rejectDisallowedParserKeys(issues: ValidationIssue[], parser: Record<string, unknown>, path: string) {
  for (const key of PROFILE_BUNDLE_KEYS) {
    if (key in parser) issues.push({ path: path + '.' + key, message: 'parser bundle fields are out of scope for .003' })
  }
}

function rejectDisallowedProfileSummaryKeys(issues: ValidationIssue[], profile: Record<string, unknown>, path: string) {
  for (const key of PROFILE_BUNDLE_KEYS) {
    if (key in profile) issues.push({ path: path + '.' + key, message: 'full parser profile fields are out of scope for .003 summary' })
  }
}

function rejectDisallowedBranchConditionKeys(issues: ValidationIssue[], path: string, condition: Record<string, unknown>) {
  for (const key of Object.keys(condition)) {
    if (!BRANCH_CONDITION_KEYS.has(key)) {
      issues.push({ path: path + '.' + key, message: 'string expressions are not allowed; extra branch condition fields are not allowed; use signal/op/value/goto' })
    }
  }
}

function profileFromCatalog(profileId: string, catalog: ProfileCatalogSummary): ProfileSummary | undefined {
  if (catalog === PROFILE_CATALOG_SUMMARY) return profileById(profileId)
  return catalog.profiles.find((profile) => profile.profileId === profileId)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return typeof value === 'boolean' || value === null
}

function isPublicId(value: unknown): value is string {
  return typeof value === 'string' && isValidPublicId(value)
}

function invalid(path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ path, message }] }
}
