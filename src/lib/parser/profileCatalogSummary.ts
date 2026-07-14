export type SignalType = 'boolean-null'

export type SignalSummary = { id: string; type: SignalType }
export type ParserKind = 'ai-json'
export type ProfileSummary = {
  profileId: string
  name: string
  description: string
  parserKind: ParserKind
  signals: SignalSummary[]
  branchOperators: Array<'==' | '!=' | 'is_null'>
}
export type ProfileCatalogSummary = { schemaVersion: 1; profiles: ProfileSummary[] }

export type ProfileCatalogValidationIssue = { path: string; message: string }
export type ProfileCatalogValidationResult = { ok: boolean; issues: ProfileCatalogValidationIssue[] }

const PROFILE_BUNDLE_KEYS = ['prompt', 'schema', 'jsonSchema', 'checkSet', 'fixtures', 'model', 'replicas'] as const
const BRANCH_OPERATORS = ['==', '!=', 'is_null'] as const

export const PROFILE_CATALOG_SUMMARY: ProfileCatalogSummary = {
  schemaVersion: 1,
  profiles: [
    {
      profileId: 'review-routing-v1', name: 'Review Routing',
      description: 'Route review output into user decision, AI-fixable work, or clean/P3-only completion.', parserKind: 'ai-json',
      signals: [{ id: 'hasAiFixable', type: 'boolean-null' }, { id: 'needsUserDecision', type: 'boolean-null' }, { id: 'onlyP3OrClean', type: 'boolean-null' }],
      branchOperators: ['==', '!=', 'is_null'],
    },
    {
      profileId: 'review-full-v1', name: 'Full Review Summary',
      description: 'Summarize P1/P2/P3 review findings for macro routing.', parserKind: 'ai-json',
      signals: [{ id: 'hasP1', type: 'boolean-null' }, { id: 'hasP2', type: 'boolean-null' }, { id: 'hasP3', type: 'boolean-null' }, { id: 'hasAiFixable', type: 'boolean-null' }, { id: 'needsUserDecision', type: 'boolean-null' }, { id: 'onlyP3OrClean', type: 'boolean-null' }],
      branchOperators: ['==', '!=', 'is_null'],
    },
    {
      profileId: 'claims-safety-v1', name: 'Claimed Safety Signals',
      description: 'Extract claims from agent text without treating them as system audit truth.', parserKind: 'ai-json',
      signals: [{ id: 'claimsFileWritten', type: 'boolean-null' }, { id: 'claimsNonReadonlyJj', type: 'boolean-null' }, { id: 'claimsTestsRun', type: 'boolean-null' }],
      branchOperators: ['==', '!=', 'is_null'],
    },
  ],
}

export function profileById(profileId: string): ProfileSummary | undefined {
  return PROFILE_CATALOG_SUMMARY.profiles.find((profile) => profile.profileId === profileId)
}

export function validateProfileCatalogSummary(catalog: unknown = PROFILE_CATALOG_SUMMARY): ProfileCatalogValidationResult {
  const issues: ProfileCatalogValidationIssue[] = []
  if (!isRecord(catalog)) return invalid('catalog', 'profile catalog must be an object')
  rejectUnknownKeys(issues, catalog, ['schemaVersion', 'profiles'], 'catalog')
  if (catalog.schemaVersion !== 1) issues.push({ path: 'schemaVersion', message: 'profile catalog schemaVersion must be 1' })
  if (!Array.isArray(catalog.profiles)) {
    issues.push({ path: 'profiles', message: 'profiles must be an array' })
    return { ok: false, issues }
  }
  const profileIds = new Set<string>()
  for (const [profileIndex, value] of catalog.profiles.entries()) {
    const path = 'profiles[' + profileIndex + ']'
    if (!isRecord(value)) {
      issues.push({ path, message: 'profile must be an object' })
      continue
    }
    rejectUnknownKeys(issues, value, ['profileId', 'name', 'description', 'parserKind', 'signals', 'branchOperators'], path)
    if (!isPublicId(value.profileId)) issues.push({ path: path + '.profileId', message: 'profileId must be a public id' })
    const profileId = String(value.profileId)
    if (profileIds.has(profileId)) issues.push({ path: path + '.profileId', message: 'duplicate profileId' })
    profileIds.add(profileId)
    for (const key of PROFILE_BUNDLE_KEYS) {
      if (key in value) issues.push({ path: path + '.' + key, message: 'full parser profile fields are out of scope for summary catalog' })
    }
    if (value.parserKind !== 'ai-json') issues.push({ path: path + '.parserKind', message: 'V0 built-in profiles must use ai-json' })
    validateString(issues, path + '.name', value.name)
    validateString(issues, path + '.description', value.description)
    validateOperators(issues, path + '.branchOperators', value.branchOperators)
    validateSignals(issues, path + '.signals', value.signals)
  }
  return { ok: issues.length === 0, issues }
}

function validateSignals(issues: ProfileCatalogValidationIssue[], path: string, signals: unknown): void {
  if (!Array.isArray(signals) || signals.length === 0) {
    issues.push({ path, message: 'signals must be a non-empty array' })
    return
  }
  const signalIds = new Set<string>()
  for (const [index, value] of signals.entries()) {
    const signalPath = path + '[' + index + ']'
    if (!isRecord(value)) {
      issues.push({ path: signalPath, message: 'signal must be an object' })
      continue
    }
    rejectUnknownKeys(issues, value, ['id', 'type'], signalPath)
    if (!isPublicId(value.id)) issues.push({ path: signalPath + '.id', message: 'signal id must be a public id' })
    const id = String(value.id)
    if (signalIds.has(id)) issues.push({ path: signalPath + '.id', message: 'duplicate signal id' })
    signalIds.add(id)
    if (value.type !== 'boolean-null') issues.push({ path: signalPath + '.type', message: 'unsupported signal type' })
  }
}

function validateOperators(issues: ProfileCatalogValidationIssue[], path: string, operators: unknown): void {
  if (!Array.isArray(operators) || operators.length === 0) {
    issues.push({ path, message: 'branchOperators must be a non-empty array' })
    return
  }
  for (const [index, operator] of operators.entries()) {
    if (!BRANCH_OPERATORS.includes(operator as typeof BRANCH_OPERATORS[number])) issues.push({ path: path + '[' + index + ']', message: 'unsupported branch operator' })
  }
}

function validateString(issues: ProfileCatalogValidationIssue[], path: string, value: unknown): void {
  if (typeof value !== 'string' || value.length < 1) issues.push({ path, message: 'value must be a string with length >= 1' })
}

function isPublicId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function rejectUnknownKeys(issues: ProfileCatalogValidationIssue[], value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key) || PROFILE_BUNDLE_KEYS.includes(key as typeof PROFILE_BUNDLE_KEYS[number])) continue
    issues.push({ path: path + '.' + key, message: 'unknown field' })
  }
}

function invalid(path: string, message: string): ProfileCatalogValidationResult {
  return { ok: false, issues: [{ path, message }] }
}
