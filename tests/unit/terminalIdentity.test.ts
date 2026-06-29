import { expect, test } from 'bun:test'
import { assertTerminalId, createTerminalId, normalizeTerminalRef, reindexTerminalOrder } from '../../src/lib/terminalIdentity'
import { assertValidPublicId } from '../../src/lib/identifier'

test('terminal ids are generated with term_ prefix and public-id safe characters', () => {
  const id = createTerminalId()
  expect(id.startsWith('term_')).toBe(true)
  expect(assertTerminalId(id)).toBe(id)
})

test('identifier contract rejects path-like config ids', () => {
  expect(() => assertValidPublicId('../bad', 'configId')).toThrow()
  expect(() => assertValidPublicId('bad/id', 'configId')).toThrow()
  expect(assertValidPublicId('local_1', 'configId')).toBe('local_1')
})

test('terminal refs normalize by id, index or alias', () => {
  expect(normalizeTerminalRef(2)).toEqual({ kind: 'index', value: 2 })
  expect(normalizeTerminalRef('3')).toEqual({ kind: 'index', value: 3 })
  expect(normalizeTerminalRef('term_abc')).toEqual({ kind: 'id', value: 'term_abc' })
  expect(normalizeTerminalRef('reviewer')).toEqual({ kind: 'alias', value: 'reviewer' })
})

test('terminal order reindexes from visual order', () => {
  expect(reindexTerminalOrder(['term_b', 'term_a'])).toEqual([
    { index: 1, terminalId: 'term_b' },
    { index: 2, terminalId: 'term_a' },
  ])
})
