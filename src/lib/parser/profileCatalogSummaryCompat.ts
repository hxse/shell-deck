import type { ProfileCatalogSummary } from '../macro/profileCatalogSummary'
import type { ParserProfile, ParserValidationIssue, ParserValidationResult } from './parserProfileTypes'

export function validateProfileCatalogCompatibility(profiles: ParserProfile[], summary: ProfileCatalogSummary): ParserValidationResult {
  const issues: ParserValidationIssue[] = []
  const fullById = new Map(profiles.map((profile) => [profile.profileId, profile]))
  const summaryIds = new Set(summary.profiles.map((profile) => profile.profileId))

  for (const summaryProfile of summary.profiles) {
    const full = fullById.get(summaryProfile.profileId)
    const path = summaryProfile.profileId
    if (!full) {
      issues.push({ path, message: 'full parser profile missing for summary profile' })
      continue
    }
    if (full.parserKind !== summaryProfile.parserKind) issues.push({ path: path + '.parserKind', message: 'parserKind drifted from summary' })
    if (JSON.stringify(full.signals) !== JSON.stringify(summaryProfile.signals)) issues.push({ path: path + '.signals', message: 'signals drifted from summary' })
    if (JSON.stringify(full.branchOperators) !== JSON.stringify(summaryProfile.branchOperators)) issues.push({ path: path + '.branchOperators', message: 'branchOperators drifted from summary' })
  }

  for (const profile of profiles) {
    if (!summaryIds.has(profile.profileId)) issues.push({ path: profile.profileId, message: 'full parser profile is not present in summary catalog' })
  }

  return { ok: issues.length === 0, issues }
}
