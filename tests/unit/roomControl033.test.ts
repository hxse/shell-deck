import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import { createGeneratedId } from '../../src/lib/generatedId'
import { TerminalRoomManager } from '../../server/terminalRoomManager'

test('Room controller is personalized, takeover is epoch-bound, and available never auto-promotes observers', async () => {
  let now = 1_000
  const manager = new TerminalRoomManager({ now: () => now })
  const room = manager.createRoom()
  const firstMessages: ServerMessage[] = []
  const secondMessages: ServerMessage[] = []
  const first = manager.connectClient(room.roomId, (message) => firstMessages.push(message))
  const second = manager.connectClient(room.roomId, (message) => secondMessages.push(message))

  const firstControl = latestControl(firstMessages)
  const secondControl = latestControl(secondMessages)
  expect(firstControl.view.mode).toBe('controller')
  expect(firstControl.grant).toBeDefined()
  expect(secondControl.view.mode).toBe('observer')
  expect(secondControl.grant).toBeUndefined()
  expect(JSON.stringify(secondMessages)).not.toContain('controlLeaseId')

  const otherRoom = manager.createRoom()
  expect(() => manager.admitControlledBearer(firstControl.grant!, otherRoom.roomId)).toThrow('room_control_lost')
  expect(() => manager.admitControlledBearer({
    clientId: firstControl.grant!.clientId,
    controlLeaseId: createGeneratedId('roomControlLease'),
    controlEpoch: firstControl.grant!.controlEpoch,
  }, room.roomId)).toThrow('room_control_lost')

  expect(() => manager.runControlledClientMutation(second.clientId, () => 'forbidden')).toThrow('room_control_required')
  expect(manager.runControlledClientMutation(first.clientId, () => 'allowed')).toBe('allowed')

  await expect(manager.takeOverRoomControl(second.clientId, 1, false)).rejects.toThrow('room_control_takeover_confirmation_required')
  const secondGrant = await manager.takeOverRoomControl(second.clientId, 1, true)
  expect(secondGrant.controlEpoch).toBe(2)
  expect(firstMessages.some((message) => message.type === 'room_control_lost')).toBe(true)
  expect(() => manager.runControlledClientMutation(first.clientId, () => 'stale')).toThrow('room_control_lost')
  expect(manager.runControlledClientMutation(second.clientId, () => 'new-owner')).toBe('new-owner')
  await expect(manager.takeOverRoomControl(first.clientId, 1, true)).rejects.toThrow('room_control_epoch_conflict')

  await manager.releaseRoomControl(secondGrant, room.roomId)
  expect(manager.roomControlView(room.roomId, first.clientId)).toEqual({ mode: 'available', controlEpoch: 2 })
  expect(manager.roomControlView(room.roomId, second.clientId)).toEqual({ mode: 'available', controlEpoch: 2 })

  const thirdMessages: ServerMessage[] = []
  const third = manager.connectClient(room.roomId, (message) => thirdMessages.push(message))
  expect(latestControl(thirdMessages)).toEqual({
    type: 'room_control',
    roomId: room.roomId,
    roomGeneration: room.roomGeneration,
    view: { mode: 'available', controlEpoch: 2 },
  })
  const thirdGrant = manager.acquireRoomControl(third.clientId, 2)
  expect(thirdGrant.controlEpoch).toBe(3)
  expect(() => manager.acquireRoomControl(first.clientId, 2)).toThrow('room_control_epoch_conflict')

  now += 1
})

test('server pong renews control, TTL expiry releases it, and stale owner fails loudly', () => {
  let now = 0
  const manager = new TerminalRoomManager({ now: () => now })
  const room = manager.createRoom()
  const messages: ServerMessage[] = []
  const client = manager.connectClient(room.roomId, (message) => messages.push(message))
  const initial = latestControl(messages)
  expect(initial.view).toMatchObject({ mode: 'controller', controlEpoch: 1, expiresAt: new Date(30_000).toISOString() })

  now = 10_000
  manager.noteClientPong(client.clientId)
  expect(latestControl(messages).view).toMatchObject({ mode: 'controller', expiresAt: new Date(40_000).toISOString() })
  expect(latestControl(messages).grant).toBeUndefined()
  now = 39_999
  expect(manager.roomControlView(room.roomId, client.clientId).mode).toBe('controller')
  now = 40_000
  manager.heartbeatSweep()
  expect(manager.roomControlView(room.roomId, client.clientId)).toEqual({ mode: 'available', controlEpoch: 1 })
  expect(() => manager.runControlledClientMutation(client.clientId, () => {})).toThrow('room_control_lost')
})

test('destroying aborts a previously admitted controlled ticket before commit', async () => {
  const manager = new TerminalRoomManager()
  const room = manager.createRoom()
  const client = manager.connectClient(room.roomId, () => {})
  const ticket = manager.admitControlledClient(client.clientId)
  const destroying = manager.destroyRoom(room.roomId, room.roomGeneration)
  expect(() => ticket.assertAuthorized()).toThrow('room_destroying')
  ticket.finish()
  await destroying
  expect(manager.listRooms()).toEqual([])
})

test('published controlled operation does not turn an authorized durable commit into a false failure', async () => {
  const manager = new TerminalRoomManager()
  const room = manager.createRoom()
  const firstMessages: ServerMessage[] = []
  const first = manager.connectClient(room.roomId, (message) => firstMessages.push(message))
  const second = manager.connectClient(room.roomId, () => {})
  const firstGrant = latestControl(firstMessages).grant!

  let published = false
  const result = await manager.runControlledBearerPublishedOperation(firstGrant, async (ticket) => {
    ticket.assertAuthorized()
    published = true
    await manager.takeOverRoomControl(second.clientId, 1, true)
    return 'published-result'
  }, room.roomId)

  expect(published).toBe(true)
  expect(result).toBe('published-result')
})

test('takeover rechecks Room lifecycle after asynchronous old-owner lease cleanup', async () => {
  const manager = new TerminalRoomManager()
  const room = manager.createRoom()
  const first = manager.connectClient(room.roomId, () => {})
  const second = manager.connectClient(room.roomId, () => {})
  let cleanupStarted!: () => void
  let finishCleanup!: () => void
  const started = new Promise<void>((resolve) => { cleanupStarted = resolve })
  const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve })
  manager.setControlLostHook(async (context) => {
    if (context.clientId === first.clientId) cleanupStarted()
    await cleanup
  })

  const takeover = manager.takeOverRoomControl(second.clientId, 1, true)
  await started
  const destroying = manager.destroyRoom(room.roomId, room.roomGeneration)
  finishCleanup()
  await expect(takeover).rejects.toThrow('room_destroying')
  await destroying
  expect(manager.listRooms()).toEqual([])
})

function latestControl(messages: ServerMessage[]): Extract<ServerMessage, { type: 'room_control' }> {
  const message = messages.filter((candidate): candidate is Extract<ServerMessage, { type: 'room_control' }> => candidate.type === 'room_control').at(-1)
  if (!message) throw new Error('missing_room_control_message')
  return message
}
