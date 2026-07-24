import { assertGeneratedId } from '../src/lib/generatedId'
import type { RoomSnapshot, ServerMessage } from '../src/lib/protocol'
import type { RoomClient, RoomRuntime } from './roomLifecycleCoordinator'
import {
  ROOM_CONTROL_TTL_MS,
  type RoomControllerLeaseCoordinator,
} from './roomControllerLeaseCoordinator'

export const ROOM_CONTROL_HEARTBEAT_MS = 10_000

type RoomClientPresenceCoordinatorOptions = {
  rooms: Map<string, RoomRuntime>
  clients: Map<string, RoomClient>
  serverInstanceId: string
  clientIdFactory: () => string
  now: () => number
  activeRoomOrThrow(roomId: string): RoomRuntime
  roomSnapshot(roomId: string): RoomSnapshot
}

export class RoomClientPresenceCoordinator {
  constructor(
    private readonly options: RoomClientPresenceCoordinatorOptions,
    private readonly controller: RoomControllerLeaseCoordinator,
  ) {}

  connectClient(
    roomId: string,
    send: (message: ServerMessage) => void,
    close?: (code: number, reason: string) => void,
    ping?: () => void,
    sendSerialized?: (payload: string) => void,
  ): RoomClient {
    const room = this.options.activeRoomOrThrow(roomId)
    let clientId: string | undefined
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = assertGeneratedId(this.options.clientIdFactory(), 'client')
      if (!this.options.clients.has(candidate)) {
        clientId = candidate
        break
      }
    }
    if (!clientId) throw new Error('client_id_collision')
    const now = this.options.now()
    const client: RoomClient = {
      clientId,
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      send,
      sendSerialized,
      close,
      ping,
      lastPongAtMs: now,
      awaitingPong: false,
      lostControlEpoch: null,
    }
    room.clients.set(clientId, client)
    this.options.clients.set(clientId, client)
    try {
      send({ type: 'client_registered', clientId, roomId: room.roomId, roomGeneration: room.roomGeneration, serverInstanceId: this.options.serverInstanceId })
      this.controller.connectClient(room, client, now)
      send(this.options.roomSnapshot(room.roomId))
    } catch (error) {
      room.clients.delete(clientId)
      this.options.clients.delete(clientId)
      throw error
    }
    return client
  }

  disconnectClient(clientId: string): void {
    const client = this.options.clients.get(clientId)
    if (!client) return
    this.options.clients.delete(clientId)
    const room = this.options.rooms.get(client.roomId)
    room?.clients.delete(clientId)
    this.controller.disconnectClient(room, clientId)
  }

  noteClientPong(clientId: string): void {
    const client = this.options.clients.get(clientId)
    if (!client) return
    const room = this.options.rooms.get(client.roomId)
    if (!room || room.lifecycle !== 'active' || room.roomGeneration !== client.roomGeneration) return
    const now = this.options.now()
    client.awaitingPong = false
    client.lastPongAtMs = now
    this.controller.noteClientPong(room, client, now)
  }

  heartbeatSweep(): void {
    const now = this.options.now()
    for (const room of this.options.rooms.values()) {
      if (room.lifecycle === 'active') this.controller.expireControllerIfNeeded(room, now)
    }
    for (const client of [...this.options.clients.values()]) {
      if (!client.ping) continue
      if (client.awaitingPong && now - client.lastPongAtMs >= ROOM_CONTROL_TTL_MS) {
        this.disconnectClient(client.clientId)
        try { client.close?.(4002, 'room_control_heartbeat_timeout') } catch {}
        continue
      }
      client.awaitingPong = true
      try { client.ping() }
      catch {
        this.disconnectClient(client.clientId)
        try { client.close?.(4002, 'room_control_heartbeat_failed') } catch {}
      }
    }
  }
}
