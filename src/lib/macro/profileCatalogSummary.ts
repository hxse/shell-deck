export type SignalType = 'boolean-null'

export type SignalSummary = {
  id: string
  type: SignalType
}

export type ParserKind = 'ai-json'

export type ProfileSummary = {
  profileId: string
  name: string
  description: string
  parserKind: ParserKind
  signals: SignalSummary[]
  branchOperators: Array<'==' | '!=' | 'is_null'>
}

export type ProfileCatalogSummary = {
  schemaVersion: 1
  profiles: ProfileSummary[]
}

export const PROFILE_CATALOG_SUMMARY: ProfileCatalogSummary = {
  schemaVersion: 1,
  profiles: [
    {
      profileId: 'review-routing-v1',
      name: 'Review Routing',
      description: 'Route review output into user decision, AI-fixable work, or clean/P3-only completion.',
      parserKind: 'ai-json',
      signals: [
        { id: 'hasAiFixable', type: 'boolean-null' },
        { id: 'needsUserDecision', type: 'boolean-null' },
        { id: 'onlyP3OrClean', type: 'boolean-null' },
      ],
      branchOperators: ['==', '!=', 'is_null'],
    },
    {
      profileId: 'review-full-v1',
      name: 'Full Review Summary',
      description: 'Summarize P1/P2/P3 review findings for macro routing.',
      parserKind: 'ai-json',
      signals: [
        { id: 'hasP1', type: 'boolean-null' },
        { id: 'hasP2', type: 'boolean-null' },
        { id: 'hasP3', type: 'boolean-null' },
        { id: 'hasAiFixable', type: 'boolean-null' },
        { id: 'needsUserDecision', type: 'boolean-null' },
        { id: 'onlyP3OrClean', type: 'boolean-null' },
      ],
      branchOperators: ['==', '!=', 'is_null'],
    },
    {
      profileId: 'claims-safety-v1',
      name: 'Claimed Safety Signals',
      description: 'Extract claims from agent text without treating them as system audit truth.',
      parserKind: 'ai-json',
      signals: [
        { id: 'claimsFileWritten', type: 'boolean-null' },
        { id: 'claimsNonReadonlyJj', type: 'boolean-null' },
        { id: 'claimsTestsRun', type: 'boolean-null' },
      ],
      branchOperators: ['==', '!=', 'is_null'],
    },
  ],
}

export function profileById(profileId: string): ProfileSummary | undefined {
  return PROFILE_CATALOG_SUMMARY.profiles.find((profile) => profile.profileId === profileId)
}
