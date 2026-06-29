import type { BooleanNullRegexRule } from '../macro/templateTypes'
import { normalizeParserOutput, serializeNormalizedSignals } from './parserResultSchema'
import type { ParserInvocationContext, ParserInvocationOutput, ParserValidationIssue } from './parserProfileTypes'

const REGEX_FLAGS_RE = /^[imsu]*$/

export function validateRegexRules(rules: unknown): { ok: boolean; issues: ParserValidationIssue[] } {
  const issues: ParserValidationIssue[] = []
  if (!Array.isArray(rules) || rules.length === 0) {
    return { ok: false, issues: [{ path: 'rules', message: 'regex parser must declare at least one rule' }] }
  }
  const signals = new Set<string>()
  for (const [index, rule] of rules.entries()) {
    const path = 'rules[' + index + ']'
    if (!isRecord(rule)) {
      issues.push({ path, message: 'regex rule must be an object' })
      continue
    }
    if (typeof rule.signal !== 'string' || rule.signal.length === 0) issues.push({ path: path + '.signal', message: 'signal must be a non-empty string' })
    else if (signals.has(rule.signal)) issues.push({ path: path + '.signal', message: 'duplicate regex signal' })
    else signals.add(rule.signal)
    if (rule.type !== 'boolean-null') issues.push({ path: path + '.type', message: 'V0 regex rule type must be boolean-null' })
    if (typeof rule.pattern !== 'string' || rule.pattern.length === 0) issues.push({ path: path + '.pattern', message: 'pattern must be a non-empty string' })
    const flags = rule.flags ?? ''
    if (typeof flags !== 'string') {
      issues.push({ path: path + '.flags', message: 'flags must be a string' })
    } else if (!REGEX_FLAGS_RE.test(flags)) {
      issues.push({ path: path + '.flags', message: 'regex flags may only include i, m, s, u' })
    } else if (typeof rule.pattern === 'string') {
      try {
        new RegExp(rule.pattern, flags)
      } catch (error) {
        issues.push({ path: path + '.pattern', message: error instanceof Error ? error.message : 'invalid regex pattern' })
      }
    }
    if (!isBooleanOrNull(rule.onMatch)) issues.push({ path: path + '.onMatch', message: 'onMatch must be true, false or null' })
    if (!isBooleanOrNull(rule.onNoMatch)) issues.push({ path: path + '.onNoMatch', message: 'onNoMatch must be true, false or null' })
  }
  return { ok: issues.length === 0, issues }
}

export async function runRegexParser(rules: BooleanNullRegexRule[], text: string, context: ParserInvocationContext): Promise<ParserInvocationOutput> {
  const validation = validateRegexRules(rules)
  if (!validation.ok) throw new Error('invalid_regex_rules:' + validation.issues.map((issue) => issue.path + ':' + issue.message).join('; '))

  const rawSignals: Record<string, boolean | null> = {}
  const matches = rules.map((rule) => {
    const regex = new RegExp(rule.pattern, rule.flags ?? '')
    const match = regex.exec(text)
    rawSignals[rule.signal] = match ? rule.onMatch : rule.onNoMatch
    return {
      signal: rule.signal,
      pattern: rule.pattern,
      flags: rule.flags ?? '',
      matched: Boolean(match),
      match: match ? { text: match[0], index: match.index, groups: match.groups ?? null } : null,
    }
  })
  const signals = rules.map((rule) => ({ id: rule.signal, type: rule.type }))
  const normalized = normalizeParserOutput(rawSignals, signals, { allowStringBooleans: false })
  if (!normalized.ok || !normalized.signals) throw new Error('invalid_regex_output:' + normalized.issues.map((issue) => issue.path + ':' + issue.message).join('; '))

  const rawArtifactRef = await context.writeArtifact('parser-regex-raw', JSON.stringify({ parserKind: 'regex', matches }, null, 2), 'json')
  const normalizedArtifactRef = await context.writeArtifact('parser-normalized', serializeNormalizedSignals(normalized.signals), 'json')
  return {
    parserKind: 'regex',
    signals: normalized.signals,
    rawArtifactRef,
    normalizedArtifactRef,
    metadata: { ruleCount: rules.length },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return typeof value === 'boolean' || value === null
}
