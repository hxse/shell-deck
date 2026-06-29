import type { ProfileCatalogSummary } from './profileCatalogSummary'
import type { ParserConfig } from './templateTypes'

export type MockParserResult = {
  signals: Record<string, boolean | null>
}

export function parseMockSignals(parser: ParserConfig, text: string, catalog: ProfileCatalogSummary): MockParserResult {
  if (parser.kind === 'regex') {
    const signals: Record<string, boolean | null> = {}
    for (const rule of parser.rules) {
      const regex = new RegExp(rule.pattern, rule.flags ?? '')
      signals[rule.signal] = regex.test(text) ? rule.onMatch : rule.onNoMatch
    }
    return { signals }
  }

  const profile = catalog.profiles.find((item) => item.profileId === parser.profileId)
  if (!profile) throw new Error('unknown_parser_profile:' + parser.profileId)
  const lower = text.toLowerCase()
  const signals: Record<string, boolean | null> = {}
  for (const signal of profile.signals) {
    if (signal.id === 'hasAiFixable') signals[signal.id] = /ai[- ]?fixable|fix|ready|done/.test(lower)
    else if (signal.id === 'needsUserDecision') signals[signal.id] = /decision|user|manual|\u62CD\u677F/.test(lower)
    else if (signal.id === 'onlyP3OrClean') signals[signal.id] = /only p3|clean|no issue|\u65E0\u95EE\u9898/.test(lower)
    else if (signal.id === 'hasP1') signals[signal.id] = /p1/.test(lower)
    else if (signal.id === 'hasP2') signals[signal.id] = /p2/.test(lower)
    else if (signal.id === 'hasP3') signals[signal.id] = /p3/.test(lower)
    else if (signal.id === 'claimsFileWritten') signals[signal.id] = /wrote|written|modified/.test(lower)
    else if (signal.id === 'claimsNonReadonlyJj') signals[signal.id] = /jj (edit|new|commit|squash|describe)/.test(lower)
    else if (signal.id === 'claimsTestsRun') signals[signal.id] = /test|passed|failed/.test(lower)
    else signals[signal.id] = null
  }
  return { signals }
}
