import { expect, test } from 'bun:test'
import { createGeneratedId } from '../../src/lib/generatedId'
import {
  beginLatestTextWrite,
  createTextTerminalWriteState,
  editTextTerminal,
  observeTextTerminalTruth,
} from '../../src/lib/textTerminalWriteState'

const terminalId = createGeneratedId('terminal')
const launchId = createGeneratedId('terminalLaunch')

test('delayed own echo cannot overwrite a newer local Text edit, including equal final content', () => {
  let state = createTextTerminalWriteState({ terminalId, launchId, content: '', textRevision: 0 })
  state = editTextTerminal(state, 'a')
  const first = beginLatestTextWrite(state, 0)
  if (!first) throw new Error('first write missing')
  state = first.state

  state = editTextTerminal(state, 'ab')
  state = editTextTerminal(state, 'a')
  const firstAck = observeTextTerminalTruth(state, { terminalId, launchId, content: 'a', textRevision: 1 })
  expect(firstAck.needsWrite).toBe(true)
  expect(firstAck.state.localContent).toBe('a')
  expect(firstAck.state.inFlight).toBeNull()

  const latest = beginLatestTextWrite(firstAck.state, 1)
  if (!latest) throw new Error('coalesced write missing')
  expect(latest.request).toMatchObject({ content: 'a', editGeneration: 3, baseTextRevision: 1 })

  const staleAck = observeTextTerminalTruth(latest.state, { terminalId, launchId, content: 'a', textRevision: 1 })
  expect(staleAck.state).toBe(latest.state)
  const latestAck = observeTextTerminalTruth(latest.state, { terminalId, launchId, content: 'a', textRevision: 2 })
  expect(latestAck.state.inFlight).toBeNull()
  expect(latestAck.state.localContent).toBe('a')
})

test('a different intermediate server value does not replace an in-flight local Text value', () => {
  let state = editTextTerminal(createTextTerminalWriteState({ terminalId, launchId, content: '', textRevision: 0 }), 'local')
  const started = beginLatestTextWrite(state, 0)
  if (!started) throw new Error('write missing')
  state = started.state
  const remote = observeTextTerminalTruth(state, { terminalId, launchId, content: 'remote', textRevision: 1 })
  expect(remote.state).toBe(state)
  expect(remote.state.localContent).toBe('local')
})

test('an identical observed truth is referentially stable for a reactive effect', () => {
  const state = createTextTerminalWriteState({ terminalId, launchId, content: 'same', textRevision: 4 })
  const observed = observeTextTerminalTruth(state, { terminalId, launchId, content: 'same', textRevision: 4 })
  expect(observed.state).toBe(state)
})
