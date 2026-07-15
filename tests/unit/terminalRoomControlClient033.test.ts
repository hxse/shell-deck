import { expect, test } from 'bun:test'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { ServerMessage } from '../../src/lib/protocol'
import { TerminalRoomClient } from '../../src/lib/terminalRoomClient'

test('browser client keeps owner grant in memory, sends takeover identity, and clears it on observer projection', async () => {
  const roomId = createGeneratedId('room')
  const roomGeneration = createGeneratedId('roomGeneration')
  const clientId = createGeneratedId('client')
  const controlLeaseId = createGeneratedId('roomControlLease')
  const socket = new FakeWebSocket()
  const requests: Array<{ input: string; init?: RequestInit }> = []
  const messages: ServerMessage[] = []
  const client = new TerminalRoomClient({
    roomId,
    url: 'ws://example.test/ws/rooms/' + roomId,
    createWebSocket: () => socket as unknown as WebSocket,
    onMessage: (message) => messages.push(message),
    fetcher: (async (input, init) => {
      requests.push({ input: String(input), init })
      return new Response(JSON.stringify({
        ok: true,
        view: { mode: 'controller', controlEpoch: 2, expiresAt: '2026-01-01T00:00:30.000Z' },
        grant: { clientId, controlLeaseId, controlEpoch: 2, expiresAt: '2026-01-01T00:00:30.000Z' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  })

  socket.emit('message', JSON.stringify({ type: 'client_registered', clientId, roomId, roomGeneration, serverInstanceId: createGeneratedId('serverInstance') } satisfies ServerMessage))
  socket.emit('message', JSON.stringify({
    type: 'room_control',
    roomId,
    roomGeneration,
    view: { mode: 'available', controlEpoch: 1 },
  } satisfies ServerMessage))
  expect(client.canMutateShared).toBe(false)

  await client.acquireControl(1)
  expect(requests[0].input).toBe('/api/rooms/' + encodeURIComponent(roomId) + '/control/acquire')
  expect(JSON.parse(String(requests[0].init?.body))).toEqual({ expectedControlEpoch: 1 })

  socket.emit('message', JSON.stringify({
    type: 'room_control',
    roomId,
    roomGeneration,
    view: { mode: 'observer', controlEpoch: 1, expiresAt: '2026-01-01T00:00:30.000Z' },
  } satisfies ServerMessage))
  expect(client.canMutateShared).toBe(false)

  await client.takeOverControl(1)
  expect(client.canMutateShared).toBe(true)
  expect(requests).toHaveLength(2)
  expect(requests[1].input).toBe('/api/rooms/' + encodeURIComponent(roomId) + '/control/take-over')
  expect(new Headers(requests[1].init?.headers).get('x-shell-deck-client-id')).toBe(clientId)
  expect(JSON.parse(String(requests[1].init?.body))).toEqual({ expectedControlEpoch: 1, confirmed: true })

  socket.emit('message', JSON.stringify({
    type: 'room_control',
    roomId,
    roomGeneration,
    view: { mode: 'controller', controlEpoch: 2, expiresAt: '2026-01-01T00:00:40.000Z' },
  } satisfies ServerMessage))
  expect(client.canMutateShared).toBe(true)
  expect(client.controlGrant?.expiresAt).toBe('2026-01-01T00:00:40.000Z')

  socket.emit('message', JSON.stringify({
    type: 'room_control',
    roomId,
    roomGeneration,
    view: { mode: 'observer', controlEpoch: 3, expiresAt: '2026-01-01T00:01:00.000Z' },
  } satisfies ServerMessage))
  expect(client.canMutateShared).toBe(false)
  expect(messages.filter((message) => message.type === 'room_control')).toHaveLength(4)
  client.close()
})

class FakeWebSocket {
  readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()
  readyState = WebSocket.OPEN

  addEventListener(type: string, callback: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(callback)
    this.listeners.set(type, listeners)
  }

  send(): void {}
  close(): void {}

  emit(type: string, data?: unknown): void {
    for (const callback of this.listeners.get(type) ?? []) callback({ data })
  }
}
