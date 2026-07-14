import { expect, test } from 'bun:test'
import { terminalDisplayLabel } from '../../src/lib/terminalDisplay'

test('Shell tab and pane share one canonical single-line label', () => {
  expect(terminalDisplayLabel({
    terminalIndex: 2,
    terminalId: 'term_3tCQF9G3RdD3Vxj13UAUNf',
    cwd: '/home/hxse/temp',
    backend: 'real',
    status: 'running',
  })).toBe('2 · term_3tCQF9G3RdD3Vxj13UAUNf · /home/hxse/temp · real · running')
})

test('Text label omits cwd without leaving an empty separator', () => {
  expect(terminalDisplayLabel({
    terminalIndex: 3,
    terminalId: 'term_3tCQF9G3RdD3Vxj13UAUNf',
    cwd: null,
    backend: 'text',
    status: 'running',
  })).toBe('3 · term_3tCQF9G3RdD3Vxj13UAUNf · text · running')
})
