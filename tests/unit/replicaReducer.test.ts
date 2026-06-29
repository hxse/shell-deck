import { expect, test } from 'bun:test'
import { reduceParserReplicas } from '../../src/lib/parser/replicaReducer'
import type { ParserInvocationOutput } from '../../src/lib/parser/parserProfileTypes'

test('replica reducer accepts identical normalized signals', () => {
  const a = output({ ready: true })
  const b = output({ ready: true })
  expect(reduceParserReplicas('review-routing-v1', [a, b])).toBe(a)
})

test('replica reducer returns disagreement instead of guessing', () => {
  const result = reduceParserReplicas('review-routing-v1', [output({ ready: true }), output({ ready: null })])
  expect(result).toMatchObject({ status: 'disagreement', profileId: 'review-routing-v1', strategy: 'agree_or_pause' })
})

function output(signals: Record<string, boolean | null>): ParserInvocationOutput {
  return {
    parserKind: 'ai-json',
    profileId: 'review-routing-v1',
    signals,
    rawArtifactRef: 'artifacts/raw.json',
    normalizedArtifactRef: 'artifacts/normalized.json',
    metadata: {},
  }
}
