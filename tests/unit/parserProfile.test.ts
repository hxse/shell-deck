import { expect, test } from 'bun:test'
import { PROFILE_CATALOG_SUMMARY } from '../../src/lib/macro/profileCatalogSummary'
import { validateProfileCatalogCompatibility } from '../../src/lib/parser/profileCatalogSummaryCompat'
import { loadParserProfile, loadParserProfiles, validateParserProfile } from '../../src/lib/parser/parserProfileLoader'

test('full parser profiles load and remain compatible with .003 summary stub', () => {
  const profiles = loadParserProfiles()
  expect(profiles.map((profile) => profile.profileId)).toEqual([
    'claims-safety-v1',
    'review-full-v1',
    'review-routing-v1',
  ])
  for (const profile of profiles) expect(validateParserProfile(profile).ok).toBe(true)
  expect(validateProfileCatalogCompatibility(profiles, PROFILE_CATALOG_SUMMARY)).toEqual({ ok: true, issues: [] })
})

test('compatibility check catches signal drift', () => {
  const profiles = loadParserProfiles()
  profiles[0] = { ...profiles[0], signals: profiles[0].signals.slice(1) }
  const result = validateProfileCatalogCompatibility(profiles, PROFILE_CATALOG_SUMMARY)
  expect(result.ok).toBe(false)
  expect(result.issues.map((issue) => issue.message).join('\n')).toContain('signals drifted from summary')
})

test('profile schema validation rejects extra properties and broad signal schema', () => {
  const profile = structuredClone(loadParserProfile('review-routing-v1'))
  const properties = profile.outputSchema.properties as Record<string, unknown>
  properties.extraSignal = { oneOf: [{ type: 'boolean' }, { type: 'null' }] }
  let result = validateParserProfile(profile)
  expect(result.ok).toBe(false)
  expect(result.issues.map((issue) => issue.message).join('\n')).toContain('schema properties must exactly match profile signals')

  delete properties.extraSignal
  properties.hasAiFixable = { type: 'string' }
  result = validateParserProfile(profile)
  expect(result.ok).toBe(false)
  expect(result.issues.map((issue) => issue.message).join('\n')).toContain('signal schema must allow only boolean, null, or string enum true/false/null')
})
