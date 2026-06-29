import { normalizeParserOutput, serializeNormalizedSignals } from './parserResultSchema'
import type { ParserInvocationContext, ParserInvocationOutput, ParserProfile } from './parserProfileTypes'

export async function runMockAiJsonParser(profile: ParserProfile, text: string, context: ParserInvocationContext, rawOverride?: Record<string, unknown>): Promise<ParserInvocationOutput> {
  const rawOutput = rawOverride ?? mockRawOutput(profile, text)
  const normalized = normalizeParserOutput(rawOutput, profile.signals, { allowStringBooleans: true })
  if (!normalized.ok || !normalized.signals) throw new Error('invalid_mock_parser_output:' + normalized.issues.map((issue) => issue.path + ':' + issue.message).join('; '))
  const rawArtifactRef = await context.writeArtifact('parser-ai-json-raw', JSON.stringify(rawOutput, null, 2), 'json')
  const normalizedArtifactRef = await context.writeArtifact('parser-normalized', serializeNormalizedSignals(normalized.signals), 'json')
  return {
    parserKind: 'ai-json',
    profileId: profile.profileId,
    signals: normalized.signals,
    rawArtifactRef,
    normalizedArtifactRef,
    metadata: { adapter: 'mock-ai-json', profileId: profile.profileId, replicaIndex: context.replicaIndex ?? 0 },
  }
}

export function mockRawOutput(profile: ParserProfile, text: string): Record<string, unknown> {
  const lower = text.toLowerCase()
  const output: Record<string, unknown> = {}
  for (const signal of profile.signals) {
    if (signal.id === 'hasAiFixable') output[signal.id] = triState(lower, [/ai[- ]?fixable/, /ai directly fix/, /ai can directly fix/, /fix these/, /ready/, /done/], [/no ai[- ]?fixable/, /not fixable/])
    else if (signal.id === 'needsUserDecision') output[signal.id] = triState(lower, [/needs user/, /user decision/, /manual/, /decision/, /\u62cd\u677f/], [/no user decision/, /no manual/])
    else if (signal.id === 'onlyP3OrClean') output[signal.id] = triState(lower, [/only p3/, /clean/, /no issue/, /no issues/, /\u65e0\u95ee\u9898/], [/p1/, /p2/, /ai[- ]?fixable/])
    else if (signal.id === 'hasP1') output[signal.id] = triState(lower, [/\bp1\b/], [/no p1/])
    else if (signal.id === 'hasP2') output[signal.id] = triState(lower, [/\bp2\b/], [/no p2/])
    else if (signal.id === 'hasP3') output[signal.id] = triState(lower, [/\bp3\b/], [/no p3/])
    else if (signal.id === 'claimsFileWritten') output[signal.id] = triState(lower, [/wrote/, /written/, /modified/, /created file/, /edited file/], [/did not write/, /no file written/])
    else if (signal.id === 'claimsNonReadonlyJj') output[signal.id] = triState(lower, [/jj (edit|new|commit|squash|describe|abandon|bookmark)/], [/only read[- ]?only jj/, /jj status only/])
    else if (signal.id === 'claimsTestsRun') output[signal.id] = triState(lower, [/test/, /passed/, /failed/], [/tests not run/, /did not run tests/])
    else output[signal.id] = null
  }
  return output
}

function triState(text: string, positive: RegExp[], negative: RegExp[]): boolean | null {
  if (positive.some((regex) => regex.test(text))) return true
  if (negative.some((regex) => regex.test(text))) return false
  return null
}
