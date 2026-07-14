import { expect, test } from 'bun:test'
import { assertTerminalId, createTerminalId, normalizeTerminalRef, reindexTerminalOrder } from '../../src/lib/terminalIdentity'

test('terminal ids are generated with term_ prefix and public-id safe characters', () => {
  const id = createTerminalId()
  expect(id.startsWith('term_')).toBe(true)
  expect(assertTerminalId(id)).toBe(id)
})

test('terminal refs normalize only current id or index selectors', () => {
  const id = createTerminalId()
  expect(normalizeTerminalRef(2)).toEqual({ kind: 'index', value: 2 })
  expect(normalizeTerminalRef('3')).toEqual({ kind: 'index', value: 3 })
  expect(normalizeTerminalRef(id)).toEqual({ kind: 'id', value: id })
  expect(() => normalizeTerminalRef('reviewer')).toThrow('invalid_terminal_id')
})

test('terminal order reindexes from visual order', () => {
  const first = createTerminalId()
  const second = createTerminalId()
  expect(reindexTerminalOrder([second, first])).toEqual([
    { index: 1, terminalId: second },
    { index: 2, terminalId: first },
  ])
})
