import { normalizeParserOutput } from './parserResultSchema'
import type { ParserProfile } from './parserProfileTypes'

export type ParserFixtureEvalResult = {
  profileId: string
  fixtureId: string
  ok: boolean
  message: string
}

export function evaluateParserProfileFixtures(profile: ParserProfile): ParserFixtureEvalResult[] {
  return profile.fixtureRecords.map((fixture) => {
    const normalized = normalizeParserOutput(fixture.rawOutput, profile.signals, { allowStringBooleans: true })
    if (!normalized.ok || !normalized.signals) {
      return { profileId: profile.profileId, fixtureId: fixture.fixtureId, ok: false, message: normalized.issues.map((issue) => issue.path + ':' + issue.message).join('; ') }
    }
    const actual = stable(normalized.signals)
    const expected = stable(fixture.expectedSignals)
    return {
      profileId: profile.profileId,
      fixtureId: fixture.fixtureId,
      ok: actual === expected,
      message: actual === expected ? 'ok' : 'expected ' + expected + ' got ' + actual,
    }
  })
}

function stable(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]))
}
