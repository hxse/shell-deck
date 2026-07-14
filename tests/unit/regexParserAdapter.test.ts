import { expect, test } from 'bun:test'
import { runRegexParser, validateRegexRules } from '../../src/lib/parser/regexParserAdapter'
import type { ParserInvocationContext } from '../../src/lib/parser/parserProfileTypes'
import { createGeneratedId } from '../../src/lib/generatedId'

test('regex parser validates flags and output type', () => {
  const result = validateRegexRules([{ signal: 'ready', type: 'boolean-null', pattern: 'ready', flags: 'gi', onMatch: true, onNoMatch: false }])
  expect(result.ok).toBe(false)
  expect(result.issues.map((issue) => issue.message).join('\n')).toContain('regex flags may only include i, m, s, u')
})

test('regex parser writes raw match and normalized output artifacts', async () => {
  const artifacts = new Map<string, string>()
  const context: ParserInvocationContext = {
    runId: createGeneratedId('run'),
    stepId: 'parse',
    captureArtifactRef: 'artifacts/capture.txt',
    writeArtifact: async (prefix, content, extension = 'txt') => {
      const ref = 'artifacts/' + prefix + '.' + extension
      artifacts.set(ref, content)
      return ref
    },
  }

  const result = await runRegexParser([
    { signal: 'ready', type: 'boolean-null', pattern: 'ready|done', flags: 'i', onMatch: true, onNoMatch: false },
    { signal: 'blocked', type: 'boolean-null', pattern: 'blocked', flags: 'i', onMatch: true, onNoMatch: null },
  ], 'READY for next step', context)

  expect(result.signals).toEqual({ ready: true, blocked: null })
  expect(artifacts.get(result.rawArtifactRef)).toContain('"matched": true')
  expect(artifacts.get(result.normalizedArtifactRef)).toContain('"ready": true')
})
