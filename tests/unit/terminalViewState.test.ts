import { expect, test } from 'bun:test'
import type { TerminalSnapshot } from '../../src/lib/protocol'
import {
  BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT,
  TerminalViewStateStore,
} from '../../src/lib/terminalViewState'

test('terminal view emits append deltas with monotonic revisions and keeps a bounded remount tail', () => {
  const store = new TerminalViewStateStore()
  const initial = store.mergeSnapshot(snapshot(['initial']))
  const data = 'x'.repeat(BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT + 32) + '😀FINAL'
  const appended = store.append(initial, data)

  expect(initial.renderUpdate).toEqual({ revision: 1, kind: 'replace', data: 'initial' })
  expect(appended.renderUpdate).toEqual({ revision: 2, kind: 'append', data })
  expect(appended.replay.join('').length).toBeLessThanOrEqual(BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT)
  expect(appended.replay.join('')).toEndWith('😀FINAL')
  expect(appended.replay.join('').charCodeAt(0)).not.toBeGreaterThanOrEqual(0xDC00)
})

test('exact replay metadata preserves the render revision while suffix-only replay establishes a replacement generation', () => {
  const store = new TerminalViewStateStore()
  const initial = store.mergeSnapshot(snapshot(['old']))
  const appended = store.append(initial, 'NEW')
  const metadataOnly = store.mergeSnapshot(snapshot(['oldNEW'], { terminalAlias: 'renamed' }), appended)
  const suffixReset = store.mergeSnapshot(snapshot(['NEW']), metadataOnly)

  expect(metadataOnly.terminalAlias).toBe('renamed')
  expect(metadataOnly.renderUpdate).toEqual(appended.renderUpdate)
  expect(suffixReset.renderUpdate).toEqual({ revision: appended.renderUpdate.revision + 1, kind: 'replace', data: 'NEW' })
})

test('same replay on a different launch establishes a replacement generation', () => {
  const store = new TerminalViewStateStore()
  const initial = store.mergeSnapshot(snapshot(['same'], { launchId: 'launch_a' }))
  const nextLaunch = store.mergeSnapshot(snapshot(['same'], { launchId: 'launch_b' }), initial)

  expect(nextLaunch.launchId).toBe('launch_b')
  expect(nextLaunch.renderUpdate).toEqual({
    revision: initial.renderUpdate.revision + 1,
    kind: 'replace',
    data: 'same',
  })
})

test('explicit replay replacement advances revision and text tabs are not browser-tail truncated', () => {
  const store = new TerminalViewStateStore()
  const initial = store.mergeSnapshot(snapshot(['before']))
  const replaced = store.replaceReplay(initial, ['after'])
  expect(replaced.renderUpdate).toEqual({ revision: 2, kind: 'replace', data: 'after' })

  const text = 't'.repeat(BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT + 1)
  const textView = store.mergeSnapshot(snapshot([text], { terminalId: 'term_text', backend: 'text' }))
  expect(textView.replay.join('')).toHaveLength(text.length)
  expect(textView.renderUpdate.data).toBe(text)
})

function snapshot(replay: string[], overrides: Partial<TerminalSnapshot> = {}): TerminalSnapshot {
  return {
    type: 'terminal_snapshot',
    configId: 'local',
    terminalId: 'term_a',
    launchId: 'launch_a',
    terminalAlias: 'shell_1',
    terminalIndex: 1,
    visualOrder: 1,
    status: 'running',
    cols: 80,
    rows: 24,
    backend: 'real',
    replay,
    exitCode: null,
    signal: null,
    ...overrides,
  }
}
