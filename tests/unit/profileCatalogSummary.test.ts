import { expect, test } from 'bun:test'
import { PROFILE_CATALOG_SUMMARY, validateProfileCatalogSummary } from '../../src/lib/parser/profileCatalogSummary'

test('built-in profile catalog summary is the .003 thin stub', () => {
  const result = validateProfileCatalogSummary(PROFILE_CATALOG_SUMMARY)
  expect(result.ok).toBe(true)
  expect(PROFILE_CATALOG_SUMMARY.profiles.map((profile) => profile.profileId)).toEqual([
    'review-routing-v1',
    'review-full-v1',
    'claims-safety-v1',
  ])
  expect(PROFILE_CATALOG_SUMMARY.profiles.every((profile) => profile.parserKind === 'ai-json')).toBe(true)
  expect(JSON.stringify(PROFILE_CATALOG_SUMMARY)).not.toContain('prompt')
  expect(JSON.stringify(PROFILE_CATALOG_SUMMARY)).not.toContain('fixtures')
})


test('profile catalog summary rejects full parser profile fields', () => {
  const catalog = structuredClone(PROFILE_CATALOG_SUMMARY) as typeof PROFILE_CATALOG_SUMMARY & { profiles: Array<Record<string, unknown>> }
  catalog.profiles[0].prompt = 'parse this'
  catalog.profiles[0].fixtures = []
  catalog.profiles[0].model = 'spark'

  const result = validateProfileCatalogSummary(catalog)
  expect(result.ok).toBe(false)
  expect(result.issues.map((issue) => issue.message).join('\n')).toContain('full parser profile fields are out of scope')
})


test('profile catalog summary reports malformed catalog instead of throwing', () => {
  const result = validateProfileCatalogSummary({ schemaVersion: 1 } as never)
  expect(result.ok).toBe(false)
  expect(result.issues).toContainEqual({ path: 'profiles', message: 'profiles must be an array' })
})

test('profile catalog summary rejects unknown current-schema fields', () => {
  const catalog = structuredClone(PROFILE_CATALOG_SUMMARY) as unknown as { schemaVersion: number; profiles: Array<Record<string, unknown>>; old?: boolean }
  catalog.old = true
  catalog.profiles[0].legacy = 'x'
  ;(catalog.profiles[0].signals as Array<Record<string, unknown>>)[0].alias = 'x'
  const result = validateProfileCatalogSummary(catalog)
  expect(result.issues.filter((issue) => issue.message === 'unknown field').map((issue) => issue.path)).toEqual([
    'catalog.old',
    'profiles[0].legacy',
    'profiles[0].signals[0].alias',
  ])
})
