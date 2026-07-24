import { expect, test } from 'bun:test'
import { createGeneratedId } from '../../src/lib/generatedId'
import {
  beginLatestTextWrite,
  createTextTerminalWriteState,
  editTextTerminal,
  observeTextTerminalTruth,
} from '../../src/lib/textTerminalWriteState'
import type { TextTerminalMutation } from '../../src/lib/textTerminalMutation'

const terminalId = createGeneratedId('terminal')
const launchId = createGeneratedId('terminalLaunch')
const emptyHash = 'sha256:' + '0'.repeat(64)
const aHash = 'sha256:' + 'a'.repeat(64)
const mutation: TextTerminalMutation = { kind: 'patch', start: 0, deleteCount: 0, insert: 'a' }

test('an acknowledged mutation preserves a newer local edit and schedules its coalesced successor', () => {
  let state = createTextTerminalWriteState({
    terminalId,
    launchId,
    content: '',
    contentHash: emptyHash,
    textRevision: 0,
    repairGeneration: 0,
  })
  state = editTextTerminal(state, 'a')
  const first = beginLatestTextWrite(state, {
    candidate: 'a',
    mutation,
    resultHash: aHash,
    editGeneration: state.localEditGeneration,
  })
  if (!first) throw new Error('first write missing')

  state = editTextTerminal(first.state, 'ab')
  const acknowledged = observeTextTerminalTruth(state, {
    terminalId,
    launchId,
    content: 'a',
    contentHash: aHash,
    textRevision: 1,
    repairGeneration: 0,
  })
  expect(acknowledged.needsWrite).toBe(true)
  expect(acknowledged.state).toMatchObject({
    localContent: 'ab',
    syncedContent: 'a',
    observedTextRevision: 1,
    inFlight: null,
  })
})

test('an intervening server mutation rebases rather than drops an in-flight local edit', () => {
  let state = editTextTerminal(createTextTerminalWriteState({
    terminalId,
    launchId,
    content: '',
    contentHash: emptyHash,
    textRevision: 0,
    repairGeneration: 0,
  }), 'a')
  const started = beginLatestTextWrite(state, {
    candidate: 'a',
    mutation,
    resultHash: aHash,
    editGeneration: state.localEditGeneration,
  })
  if (!started) throw new Error('write missing')
  const remoteHash = 'sha256:' + 'b'.repeat(64)
  const remote = observeTextTerminalTruth(started.state, {
    terminalId,
    launchId,
    content: 'remote',
    contentHash: remoteHash,
    textRevision: 1,
    repairGeneration: 0,
  })
  expect(remote.needsWrite).toBe(true)
  expect(remote.state).toMatchObject({
    localContent: 'a',
    syncedContent: 'remote',
    syncedHash: remoteHash,
    inFlight: null,
  })
})

test('an intervening server mutation also rebases a local edit before its hash is sent', () => {
  const state = editTextTerminal(createTextTerminalWriteState({
    terminalId,
    launchId,
    content: '',
    contentHash: emptyHash,
    textRevision: 0,
    repairGeneration: 0,
  }), 'local')
  const remoteHash = 'sha256:' + 'b'.repeat(64)
  const remote = observeTextTerminalTruth(state, {
    terminalId,
    launchId,
    content: 'remote',
    contentHash: remoteHash,
    textRevision: 1,
    repairGeneration: 0,
  })
  expect(remote.needsWrite).toBe(true)
  expect(remote.state).toMatchObject({
    localContent: 'local',
    syncedContent: 'remote',
    observedTextRevision: 1,
  })
})

test('a repair snapshot rebases an in-flight local edit even when server revision did not advance', () => {
  let state = editTextTerminal(createTextTerminalWriteState({
    terminalId,
    launchId,
    content: '',
    contentHash: emptyHash,
    textRevision: 0,
    repairGeneration: 0,
  }), 'a')
  const started = beginLatestTextWrite(state, {
    candidate: 'a',
    mutation,
    resultHash: aHash,
    editGeneration: state.localEditGeneration,
  })
  if (!started) throw new Error('write missing')
  const repaired = observeTextTerminalTruth(started.state, {
    terminalId,
    launchId,
    content: '',
    contentHash: emptyHash,
    textRevision: 0,
    repairGeneration: 1,
  })
  expect(repaired.needsWrite).toBe(true)
  expect(repaired.state).toMatchObject({
    localContent: 'a',
    syncedContent: '',
    observedTextRevision: 0,
    observedRepairGeneration: 1,
    inFlight: null,
  })
})

test('an identical observed truth is referentially stable for a reactive effect', () => {
  const state = createTextTerminalWriteState({
    terminalId,
    launchId,
    content: 'same',
    contentHash: aHash,
    textRevision: 4,
    repairGeneration: 0,
  })
  const observed = observeTextTerminalTruth(state, {
    terminalId,
    launchId,
    content: 'same',
    contentHash: aHash,
    textRevision: 4,
    repairGeneration: 0,
  })
  expect(observed.state).toBe(state)
})
