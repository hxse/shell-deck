import { expect, test } from 'bun:test'
import { resolveTerminalTargetInConfig } from '../../src/lib/macro/terminalRefResolver'
import type { TerminalIndexMapItem } from '../../src/lib/protocol'

const indexMap: TerminalIndexMapItem[] = [
  { index: 1, terminalId: 'term_main', terminalAlias: 'main' },
  { index: 2, terminalId: 'term_review', terminalAlias: 'reviewer' },
]

test('terminal ref resolver resolves by index, id and alias', () => {
  expect(resolveTerminalTargetInConfig({ kind: 'index', value: 2 }, indexMap).terminalId).toBe('term_review')
  expect(resolveTerminalTargetInConfig({ kind: 'id', value: 'term_main' }, indexMap).terminalAlias).toBe('main')
  expect(resolveTerminalTargetInConfig({ kind: 'alias', value: 'reviewer' }, indexMap).terminalIndex).toBe(2)
})

test('terminal index follows current mapping while id stays stable after reorder', () => {
  const reordered: TerminalIndexMapItem[] = [
    { index: 1, terminalId: 'term_review', terminalAlias: 'reviewer' },
    { index: 2, terminalId: 'term_main', terminalAlias: 'main' },
  ]
  expect(resolveTerminalTargetInConfig({ kind: 'index', value: 1 }, reordered).terminalId).toBe('term_review')
  expect(resolveTerminalTargetInConfig({ kind: 'id', value: 'term_main' }, reordered).terminalIndex).toBe(2)
})
