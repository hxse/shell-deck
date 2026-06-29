import { expect, test } from 'bun:test'
import { normalizeParserOutput } from '../../src/lib/parser/parserResultSchema'

const signals = [
  { id: 'ready', type: 'boolean-null' as const },
  { id: 'unknown', type: 'boolean-null' as const },
]

test('parser result normalizes typed boolean/null and allowed strings', () => {
  const result = normalizeParserOutput({ ready: 'true', unknown: 'null' }, signals)
  expect(result).toMatchObject({ ok: true, signals: { ready: true, unknown: null } })
  expect(result.signals?.ready).not.toBe('true')
})

test('parser result fails closed on missing and unknown fields', () => {
  const result = normalizeParserOutput({ ready: true, extra: false }, signals)
  expect(result.ok).toBe(false)
  const text = result.issues.map((issue) => issue.path + ':' + issue.message).join('\n')
  expect(text).toContain('unknown:declared signal is missing')
  expect(text).toContain('extra:unknown signal is not declared')
})

test('parser result does not coerce arbitrary strings', () => {
  const result = normalizeParserOutput({ ready: 'TRUE', unknown: null }, signals)
  expect(result.ok).toBe(false)
  expect(result.issues[0].message).toContain('typed true, false or null')
})
