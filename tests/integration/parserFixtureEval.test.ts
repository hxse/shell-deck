import { expect, test } from 'bun:test'
import { evaluateParserProfileFixtures } from '../../src/lib/parser/fixtureEval'
import { loadParserProfiles } from '../../src/lib/parser/parserProfileLoader'

test('built-in parser profile fixtures evaluate without regression', () => {
  const results = loadParserProfiles().flatMap((profile) => evaluateParserProfileFixtures(profile))
  expect(results.length).toBeGreaterThan(0)
  expect(results.filter((result) => !result.ok)).toEqual([])
})
