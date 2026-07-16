import { expect, test } from 'bun:test'
import { RoomRevisionGate } from '../../src/lib/roomRevisionGate'

test('Room projection channels are monotonic without rejecting same-revision companion messages', () => {
  const gate = new RoomRevisionGate()
  expect(gate.acceptRoomSnapshot(0)).toBe(true)
  expect(gate.acceptRoomSnapshot(0)).toBe(false)
  expect(gate.acceptIndexMap(0)).toBe(true)

  gate.observeTerminal(2)
  expect(gate.acceptRoomSnapshot(1)).toBe(false)
  expect(gate.acceptIndexMap(1)).toBe(false)
  expect(gate.acceptIndexMap(2)).toBe(true)
  expect(gate.acceptRoomSnapshot(2)).toBe(true)
  expect(gate.acceptRoomSnapshot(2)).toBe(false)

  gate.reset()
  expect(gate.acceptRoomSnapshot(0)).toBe(true)
})
