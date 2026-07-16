import { expect, test } from 'bun:test'
import type { TerminalSnapshot } from '../../src/lib/protocol'
import { createGeneratedId } from '../../src/lib/generatedId'
import {
  applyTerminalStateProjection,
  BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT,
  TerminalViewStateStore,
} from '../../src/lib/terminalViewState'

const ROOM_ID = createGeneratedId('room')
const ROOM_GENERATION = createGeneratedId('roomGeneration')
const TERMINAL_ID = createGeneratedId('terminal')
const LAUNCH_ID = createGeneratedId('terminalLaunch')

test('terminal view emits append deltas with monotonic revisions and keeps a bounded remount tail', () => {
  const store = new TerminalViewStateStore()
  const initial = store.mergeSnapshot(snapshot(['initial']))
  const data = 'x'.repeat(BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT + 32) + '😀FINAL'
  const appended = store.append(initial, data, stamp(2))

  expect(initial.renderUpdate).toEqual({ revision: 1, kind: 'replace', data: 'initial' })
  expect(appended.renderUpdate).toEqual({ revision: 2, kind: 'append', data })
  expect(appended.replay.join('').length).toBeLessThanOrEqual(BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT)
  expect(appended.replay.join('')).toEndWith('😀FINAL')
  expect(appended.replay.join('').charCodeAt(0)).not.toBeGreaterThanOrEqual(0xDC00)
})

test('exact replay metadata preserves the render revision while suffix-only replay establishes a replacement generation', () => {
  const store = new TerminalViewStateStore()
  const initial = store.mergeSnapshot(snapshot(['old']))
  const appended = store.append(initial, 'NEW', stamp(2))
  const metadataOnly = store.mergeSnapshot(snapshot(['oldNEW'], { status: 'closed', roomRevision: 3, terminalRevision: 3, outputActivityRevision: 2 }), appended)
  const suffixReset = store.mergeSnapshot(snapshot(['NEW'], { roomRevision: 4, terminalRevision: 4, outputActivityRevision: 3 }), metadataOnly)

  expect(metadataOnly.status).toBe('closed')
  expect(metadataOnly.renderUpdate).toEqual(appended.renderUpdate)
  expect(suffixReset.renderUpdate).toEqual({ revision: appended.renderUpdate.revision + 1, kind: 'replace', data: 'NEW' })
})

test('same replay on a different launch establishes a replacement generation', () => {
  const store = new TerminalViewStateStore()
  const initial = store.mergeSnapshot(snapshot(['same']))
  const nextLaunchId = createGeneratedId('terminalLaunch')
  const nextLaunch = store.mergeSnapshot(snapshot(['same'], { launchId: nextLaunchId, roomRevision: 2, terminalRevision: 2 }), initial)

  expect(nextLaunch.launchId).toBe(nextLaunchId)
  expect(nextLaunch.renderUpdate).toEqual({
    revision: initial.renderUpdate.revision + 1,
    kind: 'replace',
    data: 'same',
  })
})

test('explicit replay replacement advances revision and text tabs are not browser-tail truncated', () => {
  const store = new TerminalViewStateStore()
  const initial = store.mergeSnapshot(snapshot(['before']))
  const replaced = store.replaceReplay(initial, ['after'], stamp(2))
  expect(replaced.renderUpdate).toEqual({ revision: 2, kind: 'replace', data: 'after' })

  const text = 't'.repeat(BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT + 1)
  const textView = store.mergeSnapshot(snapshot([text], { terminalId: createGeneratedId('terminal'), backend: 'text' }))
  expect(textView.replay.join('')).toHaveLength(text.length)
  expect(textView.renderUpdate.data).toBe(text)
})

test('older terminal snapshots and deltas cannot roll back newer server truth', () => {
  const store = new TerminalViewStateStore()
  const initial = store.mergeSnapshot(snapshot(['old']))
  const newest = store.append(initial, '-new', stamp(3))
  const staleSnapshot = store.mergeSnapshot(snapshot(['old'], { roomRevision: 2, terminalRevision: 2 }), newest)
  const staleReplay = store.replaceReplay(newest, ['old'], stamp(2))

  expect(staleSnapshot).toBe(newest)
  expect(staleReplay).toBe(newest)
  expect(newest.replay.join('')).toBe('old-new')
})

test('a rejected stale terminal state cannot roll back projected readiness', () => {
  const store = new TerminalViewStateStore()
  const current = store.mergeSnapshot(snapshot(['ready'], { terminalRevision: 3, roomRevision: 3 }))
  const positions = [{ index: 1, type: 'shell' as const, terminalId: TERMINAL_ID, launchId: LAUNCH_ID, readiness: 'ready' as const }]
  const stale = applyTerminalStateProjection(store, [current], positions, {
    type: 'terminal_state',
    roomId: ROOM_ID,
    roomGeneration: ROOM_GENERATION,
    terminalId: TERMINAL_ID,
    launchId: LAUNCH_ID,
    status: 'failed',
    cols: 80,
    rows: 24,
    exitCode: null,
    signal: null,
    roomRevision: 2,
    terminalRevision: 2,
    textRevision: 0,
    outputActivityRevision: 0,
  })

  expect(stale.accepted).toBe(false)
  expect(stale.terminals[0]).toBe(current)
  expect(stale.positions).toEqual(positions)
})

function snapshot(replay: string[], overrides: Partial<TerminalSnapshot> = {}): TerminalSnapshot {
  return {
    type: 'terminal_snapshot',
    roomId: ROOM_ID,
    roomGeneration: ROOM_GENERATION,
    terminalId: TERMINAL_ID,
    launchId: LAUNCH_ID,
    terminalIndex: 1,
    visualOrder: 1,
    status: 'running',
    cols: 80,
    rows: 24,
    backend: 'real',
    cwd: '/tmp',
    replay,
    exitCode: null,
    signal: null,
    roomRevision: 1,
    terminalRevision: 1,
    textRevision: 0,
    outputActivityRevision: 0,
    ...overrides,
  }
}

function stamp(revision: number) {
  return {
    launchId: LAUNCH_ID,
    roomRevision: revision,
    terminalRevision: revision,
    textRevision: 0,
    outputActivityRevision: revision,
  }
}
