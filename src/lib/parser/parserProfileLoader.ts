import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertValidPublicId } from '../identifier'
import type { BranchOperator, ParserCheckSet, ParserFixture, ParserProfile, ParserProfileManifest, ParserValidationIssue, ParserValidationResult } from './parserProfileTypes'

const BRANCH_OPERATORS: BranchOperator[] = ['==', '!=', 'is_null']

export function parserProfileRoot(root = resolve(import.meta.dir, '..', '..', '..')): string {
  return join(root, 'parser-profiles')
}

export function loadParserProfiles(root = parserProfileRoot()): ParserProfile[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadParserProfile(entry.name, root))
    .sort((a, b) => a.profileId.localeCompare(b.profileId))
}

export function loadParserProfile(profileId: string, root = parserProfileRoot()): ParserProfile {
  assertValidPublicId(profileId, 'genericId')
  const dir = join(root, profileId)
  const manifest = readJson(join(dir, 'profile.json')) as ParserProfileManifest
  const prompt = readFileSync(join(dir, 'prompt.md'), 'utf8')
  const outputSchemaPath = resolve(join(dir, 'schema.json'))
  const outputSchema = readJson(outputSchemaPath) as Record<string, unknown>
  const checkSet = readJson(join(dir, 'checkset.json')) as ParserCheckSet
  const fixtureRecords = manifest.fixtures.map((fixture) => readJson(join(dir, 'fixtures', fixture)) as ParserFixture)
  const profile: ParserProfile = { ...manifest, prompt, outputSchema, outputSchemaPath, checkSet, fixtureRecords }
  const validation = validateParserProfile(profile)
  if (!validation.ok) throw new Error('invalid_parser_profile:' + validation.issues.map((issue) => issue.path + ':' + issue.message).join('; '))
  return profile
}

export function validateParserProfile(profile: ParserProfile): ParserValidationResult {
  const issues: ParserValidationIssue[] = []
  validatePublicId(issues, 'profileId', profile.profileId)
  if (!Number.isInteger(profile.profileVersion) || profile.profileVersion < 1) issues.push({ path: 'profileVersion', message: 'profileVersion must be a positive integer' })
  if (profile.parserKind !== 'ai-json') issues.push({ path: 'parserKind', message: 'V0 full parser profiles must use ai-json' })
  if (typeof profile.model !== 'string' || profile.model.length === 0) issues.push({ path: 'model', message: 'model must be a non-empty string' })
  if (profile.invocation !== 'codex-exec-one-shot') issues.push({ path: 'invocation', message: 'invocation must be codex-exec-one-shot' })
  validatePublicId(issues, 'promptId', profile.promptId)
  validatePublicId(issues, 'schemaId', profile.schemaId)
  validatePublicId(issues, 'checkSetId', profile.checkSetId)
  if (!Number.isInteger(profile.promptVersion) || profile.promptVersion < 1) issues.push({ path: 'promptVersion', message: 'promptVersion must be a positive integer' })
  if (!Number.isInteger(profile.schemaVersion) || profile.schemaVersion < 1) issues.push({ path: 'schemaVersion', message: 'schemaVersion must be a positive integer' })
  if (!Array.isArray(profile.branchOperators) || profile.branchOperators.some((operator) => !BRANCH_OPERATORS.includes(operator))) issues.push({ path: 'branchOperators', message: 'branchOperators must use V0 branch operators' })
  validateSignals(issues, profile)
  validateSchema(issues, profile)
  validateCheckSet(issues, profile)
  validateFixtures(issues, profile)
  if (profile.replicas !== undefined && profile.replicas !== 1 && profile.replicas !== 2) issues.push({ path: 'replicas', message: 'replicas must be 1 or 2' })
  if (profile.replicas === 2 && profile.replicaStrategy !== 'agree_or_pause') issues.push({ path: 'replicaStrategy', message: 'replicas=2 requires agree_or_pause' })
  if (profile.replicas !== 2 && profile.replicaStrategy !== undefined) issues.push({ path: 'replicaStrategy', message: 'replicaStrategy is only allowed with replicas=2' })
  return { ok: issues.length === 0, issues }
}

function validateSignals(issues: ParserValidationIssue[], profile: ParserProfile): void {
  if (!Array.isArray(profile.signals) || profile.signals.length === 0) {
    issues.push({ path: 'signals', message: 'signals must be a non-empty array' })
    return
  }
  const seen = new Set<string>()
  for (const [index, signal] of profile.signals.entries()) {
    const path = 'signals[' + index + ']'
    validatePublicId(issues, path + '.id', signal.id)
    if (seen.has(signal.id)) issues.push({ path: path + '.id', message: 'duplicate signal id' })
    seen.add(signal.id)
    if (signal.type !== 'boolean-null') issues.push({ path: path + '.type', message: 'V0 signal type must be boolean-null' })
  }
}

function validateSchema(issues: ParserValidationIssue[], profile: ParserProfile): void {
  if (!isRecord(profile.outputSchema)) {
    issues.push({ path: 'outputSchema', message: 'schema must be an object' })
    return
  }
  if (profile.outputSchema.type !== 'object') issues.push({ path: 'outputSchema.type', message: 'schema type must be object' })
  const required = Array.isArray(profile.outputSchema.required) ? profile.outputSchema.required : []
  const declared = profile.signals.map((signal) => signal.id).sort()
  if (JSON.stringify(required.slice().sort()) !== JSON.stringify(declared)) issues.push({ path: 'outputSchema.required', message: 'schema required signals must match profile signals' })
  if (profile.outputSchema.additionalProperties !== false) issues.push({ path: 'outputSchema.additionalProperties', message: 'schema must reject unknown signals' })
  if (!isRecord(profile.outputSchema.properties)) {
    issues.push({ path: 'outputSchema.properties', message: 'schema properties must be an object' })
    return
  }
  const propertyKeys = Object.keys(profile.outputSchema.properties).sort()
  if (JSON.stringify(propertyKeys) !== JSON.stringify(declared)) issues.push({ path: 'outputSchema.properties', message: 'schema properties must exactly match profile signals' })
  for (const signal of profile.signals) {
    const property = profile.outputSchema.properties[signal.id]
    if (!Object.prototype.hasOwnProperty.call(profile.outputSchema.properties, signal.id)) {
      issues.push({ path: 'outputSchema.properties.' + signal.id, message: 'schema missing signal property' })
    } else if (!isBooleanNullSignalSchema(property)) {
      issues.push({ path: 'outputSchema.properties.' + signal.id, message: 'signal schema must allow only boolean, null, or string enum true/false/null' })
    }
  }
}

function isBooleanNullSignalSchema(value: unknown): boolean {
  if (!isRecord(value)) return false
  const variants = Array.isArray(value.oneOf) ? value.oneOf : Array.isArray(value.anyOf) ? value.anyOf : undefined
  if (!variants) return false
  let hasBoolean = false
  let hasNull = false
  let hasAllowedString = false
  for (const variant of variants) {
    if (!isRecord(variant)) return false
    if (variant.type === 'boolean' && Object.keys(variant).length === 1) hasBoolean = true
    else if (variant.type === 'null' && Object.keys(variant).length === 1) hasNull = true
    else if (variant.type === 'string' && Array.isArray(variant.enum) && JSON.stringify(variant.enum.slice().sort()) === JSON.stringify(['false', 'null', 'true'])) hasAllowedString = true
    else return false
  }
  return hasBoolean && hasNull && (hasAllowedString || variants.length === 2)
}

function validateCheckSet(issues: ParserValidationIssue[], profile: ParserProfile): void {
  if (!isRecord(profile.checkSet)) {
    issues.push({ path: 'checkSet', message: 'checkSet must be an object' })
    return
  }
  if (profile.checkSet.checkSetId !== profile.checkSetId) issues.push({ path: 'checkSet.checkSetId', message: 'checkSetId must match manifest' })
  if (!Array.isArray(profile.checkSet.checks) || profile.checkSet.checks.length === 0) issues.push({ path: 'checkSet.checks', message: 'checkSet must declare checks' })
}

function validateFixtures(issues: ParserValidationIssue[], profile: ParserProfile): void {
  if (!Array.isArray(profile.fixtureRecords)) {
    issues.push({ path: 'fixtures', message: 'fixtures must load as an array' })
    return
  }
  const declared = profile.signals.map((signal) => signal.id).sort()
  for (const [index, fixture] of profile.fixtureRecords.entries()) {
    const path = 'fixtures[' + index + ']'
    validatePublicId(issues, path + '.fixtureId', fixture.fixtureId)
    if (typeof fixture.input !== 'string' || fixture.input.length === 0) issues.push({ path: path + '.input', message: 'fixture input must be a non-empty string' })
    if (!isRecord(fixture.rawOutput)) issues.push({ path: path + '.rawOutput', message: 'fixture rawOutput must be an object' })
    if (!isRecord(fixture.expectedSignals)) {
      issues.push({ path: path + '.expectedSignals', message: 'expectedSignals must be an object' })
    } else if (JSON.stringify(Object.keys(fixture.expectedSignals).sort()) !== JSON.stringify(declared)) {
      issues.push({ path: path + '.expectedSignals', message: 'expectedSignals keys must match profile signals' })
    }
  }
}

function validatePublicId(issues: ParserValidationIssue[], path: string, value: unknown): void {
  if (typeof value !== 'string') {
    issues.push({ path, message: 'value must be a public id string' })
    return
  }
  try {
    assertValidPublicId(value)
  } catch {
    issues.push({ path, message: 'value must match Identifier Contract' })
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
