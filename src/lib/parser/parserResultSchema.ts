import type { SignalSummary } from './profileCatalogSummary'
import type { ParserSignals, ParserValidationIssue, ParserValidationResult } from './parserProfileTypes'

export type NormalizeOptions = {
  allowStringBooleans?: boolean
}

export function normalizeParserOutput(raw: unknown, signals: SignalSummary[], options: NormalizeOptions = {}): ParserValidationResult & { signals?: ParserSignals } {
  const issues: ParserValidationIssue[] = []
  if (!isRecord(raw)) {
    return { ok: false, issues: [{ path: '$', message: 'parser output must be a JSON object' }] }
  }

  const declared = new Map(signals.map((signal) => [signal.id, signal]))
  const normalized: ParserSignals = {}

  for (const signal of signals) {
    if (!Object.prototype.hasOwnProperty.call(raw, signal.id)) {
      issues.push({ path: signal.id, message: 'declared signal is missing' })
      continue
    }
    if (signal.type !== 'boolean-null') {
      issues.push({ path: signal.id, message: 'unsupported signal type: ' + signal.type })
      continue
    }
    const value = normalizeBooleanNull(raw[signal.id], { allowStringBooleans: options.allowStringBooleans ?? true })
    if (value.ok) normalized[signal.id] = value.value
    else issues.push({ path: signal.id, message: value.message })
  }

  for (const key of Object.keys(raw)) {
    if (!declared.has(key)) issues.push({ path: key, message: 'unknown signal is not declared by selected parser profile/rule' })
  }

  return { ok: issues.length === 0, issues, ...(issues.length === 0 ? { signals: normalized } : {}) }
}

export function normalizeBooleanNull(value: unknown, options: NormalizeOptions = {}): { ok: true; value: boolean | null } | { ok: false; message: string } {
  if (typeof value === 'boolean' || value === null) return { ok: true, value }
  if (options.allowStringBooleans ?? true) {
    if (value === 'true') return { ok: true, value: true }
    if (value === 'false') return { ok: true, value: false }
    if (value === 'null') return { ok: true, value: null }
  }
  return { ok: false, message: 'value must normalize to typed true, false or null' }
}

export function assertNormalizedParserOutput(raw: unknown, signals: SignalSummary[], options: NormalizeOptions = {}): ParserSignals {
  const result = normalizeParserOutput(raw, signals, options)
  if (!result.ok || !result.signals) throw new Error('invalid_parser_output:' + result.issues.map((issue) => issue.path + ':' + issue.message).join('; '))
  return result.signals
}

export function serializeNormalizedSignals(signals: ParserSignals): string {
  return JSON.stringify({ signals }, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
