import { assertGeneratedId, assertRoomRouteToken } from '../src/lib/generatedId'
import type { RoomControlContext } from '../src/lib/roomControl'
import {
  admitRoomOperation,
  beginRoomDestruction,
  createRoomRuntime,
  finishRoomDestruction,
  type RoomClient,
  type RoomControlOwner,
  type RoomOperationTicket,
  type RoomRuntime,
} from './roomLifecycleCoordinator'
import type { TerminalSlot } from './terminalRuntimeState'

export type RoomSummary = {
  roomId: string
  roomGeneration: string
  terminalCount: number
  connectedClientCount: number
  hasActiveRun: boolean
}

type RoomRegistryLifecycleCoordinatorOptions = {
  rooms: Map<string, RoomRuntime>
  clients: Map<string, RoomClient>
  maxLiveRooms: number
  roomIdFactory: () => string
  roomGenerationFactory: () => string
  ownerContext(owner: RoomControlOwner): RoomControlContext
  invokeControlLost(context: RoomControlContext): Promise<void> | void
  closeTerminalResource(room: RoomRuntime, terminal: TerminalSlot): void
}

export class RoomRegistryLifecycleCoordinator {
  private activeRunProvider: (roomId: string, roomGeneration: string) => boolean = () => false
  private destroyHooks: Array<(roomId: string, roomGeneration: string, signal: AbortSignal) => Promise<void> | void> = []
  private readonly destroying = new Map<string, Promise<void>>()

  constructor(private readonly options: RoomRegistryLifecycleCoordinatorOptions) {}

  setActiveRunProvider(provider: (roomId: string, roomGeneration: string) => boolean): void {
    this.activeRunProvider = provider
  }

  setDestroyHook(hook: (roomId: string, roomGeneration: string, signal: AbortSignal) => Promise<void> | void): void {
    this.destroyHooks = [hook]
  }

  addDestroyHook(hook: (roomId: string, roomGeneration: string, signal: AbortSignal) => Promise<void> | void): void {
    this.destroyHooks.push(hook)
  }

  ensureRootRoom(): { kind: 'created'; room: RoomSummary } | { kind: 'home'; rooms: RoomSummary[] } {
    if (this.options.rooms.size > 0) return { kind: 'home', rooms: this.listRooms() }
    return { kind: 'created', room: this.createRoom() }
  }

  createRoom(): RoomSummary {
    this.assertCapacity()
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const roomId = assertGeneratedId(this.options.roomIdFactory(), 'room')
      if (this.options.rooms.has(roomId)) continue
      return this.createRoomWithToken(roomId)
    }
    throw new Error('room_id_collision')
  }

  ensureRoomFromRoute(roomId: string): { room: RoomSummary; created: boolean } {
    const token = assertRoomRouteToken(roomId)
    const existing = this.options.rooms.get(token)
    if (existing) {
      if (existing.lifecycle !== 'active') throw new Error('room_destroying')
      return { room: this.roomSummary(existing), created: false }
    }
    this.assertCapacity()
    return { room: this.createRoomWithToken(token), created: true }
  }

  listRooms(): RoomSummary[] {
    return [...this.options.rooms.values()]
      .filter((room) => room.lifecycle !== 'destroyed')
      .map((room) => this.roomSummary(room))
      .sort((left, right) => left.roomId.localeCompare(right.roomId))
  }

  roomSummaryById(roomId: string): RoomSummary {
    return this.roomSummary(this.activeRoomOrThrow(roomId))
  }

  activeRoomOrThrow(roomId: string): RoomRuntime {
    const room = this.roomOrThrow(roomId)
    if (room.lifecycle === 'destroying') throw new Error('room_destroying')
    if (room.lifecycle !== 'active') throw new Error('room_not_found')
    return room
  }

  roomOrThrow(roomId: string): RoomRuntime {
    const room = this.options.rooms.get(assertRoomRouteToken(roomId))
    if (!room || room.lifecycle === 'destroyed') throw new Error('room_not_found')
    return room
  }

  admit(roomId: string): RoomOperationTicket {
    const room = this.activeRoomOrThrow(roomId)
    return admitRoomOperation(room, () => this.options.rooms.get(room.roomId) === room)
  }

  async destroyRoom(roomId: string, expectedRoomGeneration: string): Promise<void> {
    const token = assertRoomRouteToken(roomId)
    const generation = assertGeneratedId(expectedRoomGeneration, 'roomGeneration')
    const room = this.options.rooms.get(token)
    if (!room) throw new Error('room_not_found')
    if (room.roomGeneration !== generation) throw new Error('room_generation_conflict')
    if (room.lifecycle !== 'active') throw new Error('room_destroying')

    const previousController = room.controller ? this.options.ownerContext(room.controller) : null
    beginRoomDestruction(room)
    const operation = finishRoomDestruction(room, previousController, {
      controlLost: (owner) => this.options.invokeControlLost(owner),
      destroyHooks: () => this.destroyHooks,
      closeTerminalResource: (activeRoom, terminal) => this.options.closeTerminalResource(activeRoom, terminal),
      removeClient: (clientId) => { this.options.clients.delete(clientId) },
      removeRoom: (activeRoomId) => { this.options.rooms.delete(activeRoomId) },
    })
    this.destroying.set(room.roomId, operation)
    try { await operation } finally { this.destroying.delete(room.roomId) }
  }

  async destroyAllRooms(): Promise<void> {
    const targets = [...this.options.rooms.values()].filter((room) => room.lifecycle === 'active')
    const started = targets.map(async (room) => await this.destroyRoom(room.roomId, room.roomGeneration))
    await Promise.allSettled([...started, ...this.destroying.values()])
  }

  private createRoomWithToken(roomId: string): RoomSummary {
    if (this.options.rooms.has(roomId)) throw new Error('room_id_conflict')
    const roomGeneration = this.nextRoomGeneration()
    const room = createRoomRuntime(roomId, roomGeneration)
    this.options.rooms.set(roomId, room)
    return this.roomSummary(room)
  }

  private assertCapacity(): void {
    if (this.options.rooms.size >= this.options.maxLiveRooms) throw new Error('room_capacity_reached')
  }

  private roomSummary(room: RoomRuntime): RoomSummary {
    return {
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      terminalCount: room.terminals.size,
      connectedClientCount: room.clients.size,
      hasActiveRun: this.activeRunProvider(room.roomId, room.roomGeneration),
    }
  }

  private nextRoomGeneration(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = assertGeneratedId(this.options.roomGenerationFactory(), 'roomGeneration')
      if (![...this.options.rooms.values()].some((room) => room.roomGeneration === id)) return id
    }
    throw new Error('room_generation_id_collision')
  }
}
