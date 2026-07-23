import { assertGeneratedId, assertRoomRouteToken } from '../src/lib/generatedId'
import type { ServerMessage } from '../src/lib/protocol'
import {
  assertControlEpoch,
  assertRoomControlBearer,
  type RoomControlBearer,
  type RoomControlContext,
  type RoomControlGrant,
  type RoomControlView,
} from '../src/lib/roomControl'
import type {
  RoomClient,
  RoomControlOwner,
  RoomOperationTicket,
  RoomRuntime,
} from './roomLifecycleCoordinator'

export const ROOM_CONTROL_TTL_MS = 30_000

export type RoomControlledOperationTicket = RoomOperationTicket & {
  readonly context: RoomControlContext
  assertAuthorized(): void
}

type RoomControllerLeaseCoordinatorOptions = {
  clients: Map<string, RoomClient>
  serverInstanceId: string
  controlLeaseIdFactory: () => string
  now: () => number
  activeRoomOrThrow(roomId: string): RoomRuntime
  admit(roomId: string): RoomOperationTicket
  disconnectClient(clientId: string): void
}

class RoomControlledOperationTicketImpl implements RoomControlledOperationTicket {
  constructor(
    readonly coordinator: RoomControllerLeaseCoordinator,
    readonly lifecycleTicket: RoomOperationTicket,
    readonly context: RoomControlContext,
  ) {}

  get roomId(): string { return this.lifecycleTicket.roomId }
  get roomGeneration(): string { return this.lifecycleTicket.roomGeneration }
  get signal(): AbortSignal { return this.lifecycleTicket.signal }

  assertActive(): void { this.lifecycleTicket.assertActive() }

  assertAuthorized(): void {
    this.lifecycleTicket.assertActive()
    this.coordinator.assertRoomControlContext(this.context)
  }

  finish(): void { this.lifecycleTicket.finish() }
}

export class RoomControllerLeaseCoordinator {
  private controlLostHook: (context: RoomControlContext) => Promise<void> | void = () => {}
  private controlHeartbeatHook: (context: RoomControlContext) => Promise<void> | void = () => {}

  constructor(private readonly options: RoomControllerLeaseCoordinatorOptions) {}

  setControlLostHook(hook: (context: RoomControlContext) => Promise<void> | void): void {
    this.controlLostHook = hook
  }

  setControlHeartbeatHook(hook: (context: RoomControlContext) => Promise<void> | void): void {
    this.controlHeartbeatHook = hook
  }

  connectClient(room: RoomRuntime, client: RoomClient, now: number): void {
    this.expireControllerIfNeeded(room, now)
    if (room.controller === null && room.controlEpoch === 0) this.assignController(room, client, now)
    else this.sendControlState(room, client)
  }

  disconnectClient(room: RoomRuntime | undefined, clientId: string): void {
    if (room?.controller?.clientId === clientId) this.releaseControllerInternal(room, false)
  }

  noteClientPong(room: RoomRuntime, client: RoomClient, now: number): void {
    this.expireControllerIfNeeded(room, now)
    if (room.controller?.clientId !== client.clientId) return
    room.controller.expiresAtMs = now + ROOM_CONTROL_TTL_MS
    const context = this.ownerContext(room.controller)
    this.broadcastControlState(room)
    void Promise.resolve(this.controlHeartbeatHook(context)).catch(() => {})
  }

  expireControllerIfNeeded(room: RoomRuntime, now: number): void {
    if (room.controller && room.controller.expiresAtMs <= now) this.releaseControllerInternal(room, true)
  }

  roomControlView(roomId: string, clientId: string): RoomControlView {
    const room = this.options.activeRoomOrThrow(roomId)
    const client = this.clientOrThrow(clientId)
    if (client.roomId !== room.roomId || client.roomGeneration !== room.roomGeneration) throw new Error('room_control_lost')
    this.expireControllerIfNeeded(room, this.options.now())
    return this.controlViewForClient(room, client.clientId)
  }

  acquireRoomControl(clientId: string, expectedControlEpoch: number): RoomControlGrant {
    const client = this.clientOrThrow(clientId)
    const room = this.options.activeRoomOrThrow(client.roomId)
    const expected = assertControlEpoch(expectedControlEpoch, 'room_control_epoch_conflict')
    const now = this.options.now()
    this.expireControllerIfNeeded(room, now)
    if (room.controlEpoch !== expected) throw new Error('room_control_epoch_conflict')
    if (room.controller !== null) throw new Error('room_control_held')
    return this.assignController(room, client, now)
  }

  async takeOverRoomControl(clientId: string, expectedControlEpoch: number, confirmed: boolean): Promise<RoomControlGrant> {
    if (confirmed !== true) throw new Error('room_control_takeover_confirmation_required')
    const client = this.clientOrThrow(clientId)
    const lifecycle = this.options.admit(client.roomId)
    try {
      const room = this.options.activeRoomOrThrow(client.roomId)
      const expected = assertControlEpoch(expectedControlEpoch, 'room_control_epoch_conflict')
      const now = this.options.now()
      this.expireControllerIfNeeded(room, now)
      if (room.controlEpoch !== expected) throw new Error('room_control_epoch_conflict')
      if (room.controller === null) throw new Error('room_control_required')
      if (room.controller.clientId === client.clientId) throw new Error('room_control_held')

      const previous = this.ownerContext(room.controller)
      const previousClient = room.clients.get(previous.clientId)
      const grant = this.assignControllerState(room, client, now)
      const nextContext = this.ownerContext(room.controller!)
      if (previousClient) previousClient.lostControlEpoch = previous.controlEpoch
      await Promise.resolve(this.controlLostHook(previous)).catch(() => {})
      lifecycle.assertActive()
      this.assertRoomControlContext(nextContext)
      if (previousClient) {
        try {
          previousClient.send({
            type: 'room_control_lost',
            roomId: room.roomId,
            roomGeneration: room.roomGeneration,
            controlEpoch: room.controlEpoch,
          })
        } catch { this.options.disconnectClient(previousClient.clientId) }
      }
      this.broadcastControlState(room, true)
      return grant
    } finally {
      lifecycle.finish()
    }
  }

  async releaseRoomControl(bearer: RoomControlBearer, expectedRoomId?: string): Promise<void> {
    const ticket = this.admitControlledBearer(bearer, expectedRoomId)
    const context = ticket.context
    try {
      ticket.assertAuthorized()
      const room = this.options.activeRoomOrThrow(context.roomId)
      room.controller = null
      this.broadcastControlState(room)
    } finally {
      ticket.finish()
    }
    await Promise.resolve(this.controlLostHook(context)).catch(() => {})
  }

  admitControlledClient(clientId: string): RoomControlledOperationTicket {
    const client = this.clientOrThrow(clientId)
    const lifecycle = this.options.admit(client.roomId)
    try {
      const context = this.controlContextForClient(client)
      const ticket = new RoomControlledOperationTicketImpl(this, lifecycle, context)
      ticket.assertAuthorized()
      return ticket
    } catch (error) {
      lifecycle.finish()
      throw error
    }
  }

  admitControlledBearer(bearer: RoomControlBearer, expectedRoomId?: string): RoomControlledOperationTicket {
    const normalized = assertRoomControlBearer(bearer)
    const client = this.clientOrThrow(normalized.clientId)
    if (expectedRoomId !== undefined && client.roomId !== assertRoomRouteToken(expectedRoomId)) throw new Error('room_control_lost')
    const lifecycle = this.options.admit(client.roomId)
    try {
      const context: RoomControlContext = {
        serverInstanceId: this.options.serverInstanceId,
        roomId: client.roomId,
        roomGeneration: client.roomGeneration,
        ...normalized,
      }
      const ticket = new RoomControlledOperationTicketImpl(this, lifecycle, context)
      ticket.assertAuthorized()
      return ticket
    } catch (error) {
      lifecycle.finish()
      throw error
    }
  }

  runControlledClientMutation<T>(clientId: string, operation: (ticket: RoomControlledOperationTicket) => T): T {
    const ticket = this.admitControlledClient(clientId)
    try {
      ticket.assertAuthorized()
      const result = operation(ticket)
      ticket.assertAuthorized()
      return result
    } finally {
      ticket.finish()
    }
  }

  async runControlledClientOperation<T>(clientId: string, operation: (ticket: RoomControlledOperationTicket) => Promise<T> | T): Promise<T> {
    const ticket = this.admitControlledClient(clientId)
    try {
      ticket.assertAuthorized()
      const result = await operation(ticket)
      ticket.assertAuthorized()
      return result
    } finally {
      ticket.finish()
    }
  }

  async runControlledBearerOperation<T>(
    bearer: RoomControlBearer,
    operation: (ticket: RoomControlledOperationTicket) => Promise<T> | T,
    expectedRoomId?: string,
  ): Promise<T> {
    const ticket = this.admitControlledBearer(bearer, expectedRoomId)
    try {
      ticket.assertAuthorized()
      const result = await operation(ticket)
      ticket.assertAuthorized()
      return result
    } finally {
      ticket.finish()
    }
  }

  async runControlledBearerPublishedOperation<T>(
    bearer: RoomControlBearer,
    operation: (ticket: RoomControlledOperationTicket) => Promise<T> | T,
    expectedRoomId?: string,
  ): Promise<T> {
    const ticket = this.admitControlledBearer(bearer, expectedRoomId)
    try {
      ticket.assertAuthorized()
      return await operation(ticket)
    } finally {
      ticket.finish()
    }
  }

  assertRoomControlContext(context: RoomControlContext): void {
    if (context.serverInstanceId !== this.options.serverInstanceId) throw new Error('room_control_lost')
    const room = this.options.activeRoomOrThrow(context.roomId)
    this.expireControllerIfNeeded(room, this.options.now())
    const client = this.options.clients.get(context.clientId)
    const owner = room.controller
    if (!client || client.roomGeneration !== room.roomGeneration || context.roomGeneration !== room.roomGeneration || !owner) {
      throw new Error('room_control_lost')
    }
    if (
      owner.clientId !== context.clientId
      || owner.controlLeaseId !== context.controlLeaseId
      || owner.controlEpoch !== context.controlEpoch
    ) throw new Error('room_control_lost')
  }

  ownerContext(owner: RoomControlOwner): RoomControlContext {
    return {
      serverInstanceId: owner.serverInstanceId,
      roomId: owner.roomId,
      roomGeneration: owner.roomGeneration,
      clientId: owner.clientId,
      controlLeaseId: owner.controlLeaseId,
      controlEpoch: owner.controlEpoch,
    }
  }

  invokeControlLost(context: RoomControlContext): Promise<void> | void {
    return this.controlLostHook(context)
  }

  private clientOrThrow(clientId: string): RoomClient {
    let normalized: string
    try { normalized = assertGeneratedId(clientId, 'client') }
    catch { throw new Error('room_control_required') }
    const client = this.options.clients.get(normalized)
    if (!client) throw new Error('room_control_required')
    return client
  }

  private controlContextForClient(client: RoomClient): RoomControlContext {
    const room = this.options.activeRoomOrThrow(client.roomId)
    this.expireControllerIfNeeded(room, this.options.now())
    const owner = room.controller
    if (!owner || owner.clientId !== client.clientId) {
      throw new Error(client.lostControlEpoch === null ? 'room_control_required' : 'room_control_lost')
    }
    return this.ownerContext(owner)
  }

  private assignController(room: RoomRuntime, client: RoomClient, now: number): RoomControlGrant {
    const grant = this.assignControllerState(room, client, now)
    this.broadcastControlState(room, true)
    return grant
  }

  private assignControllerState(room: RoomRuntime, client: RoomClient, now: number): RoomControlGrant {
    if (room.lifecycle !== 'active' || client.roomGeneration !== room.roomGeneration || !room.clients.has(client.clientId)) {
      throw new Error('room_control_lost')
    }
    room.controlEpoch += 1
    client.lostControlEpoch = null
    const controlLeaseId = assertGeneratedId(this.options.controlLeaseIdFactory(), 'roomControlLease')
    room.controller = {
      serverInstanceId: this.options.serverInstanceId,
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      clientId: client.clientId,
      controlLeaseId,
      controlEpoch: room.controlEpoch,
      acquiredAtMs: now,
      expiresAtMs: now + ROOM_CONTROL_TTL_MS,
    }
    return this.controlGrant(room.controller)
  }

  private releaseControllerInternal(room: RoomRuntime, markLost: boolean): void {
    const owner = room.controller
    if (!owner) return
    const context = this.ownerContext(owner)
    room.controller = null
    if (markLost) {
      const client = room.clients.get(context.clientId)
      if (client) client.lostControlEpoch = context.controlEpoch
    }
    if (room.lifecycle === 'active') this.broadcastControlState(room)
    void Promise.resolve(this.controlLostHook(context)).catch(() => {})
  }

  private controlViewForClient(room: RoomRuntime, clientId: string): RoomControlView {
    const owner = room.controller
    if (!owner) return { mode: 'available', controlEpoch: room.controlEpoch }
    const expiresAt = new Date(owner.expiresAtMs).toISOString()
    return owner.clientId === clientId
      ? { mode: 'controller', controlEpoch: owner.controlEpoch, expiresAt }
      : { mode: 'observer', controlEpoch: owner.controlEpoch, expiresAt }
  }

  private controlGrant(owner: RoomControlOwner): RoomControlGrant {
    return {
      clientId: owner.clientId,
      controlLeaseId: owner.controlLeaseId,
      controlEpoch: owner.controlEpoch,
      expiresAt: new Date(owner.expiresAtMs).toISOString(),
    }
  }

  private sendControlState(room: RoomRuntime, client: RoomClient, includeOwnerGrant = false): void {
    const owner = room.controller
    const message: Extract<ServerMessage, { type: 'room_control' }> = {
      type: 'room_control',
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      view: this.controlViewForClient(room, client.clientId),
      ...(includeOwnerGrant && owner?.clientId === client.clientId ? { grant: this.controlGrant(owner) } : {}),
    }
    client.send(message)
  }

  private broadcastControlState(room: RoomRuntime, includeOwnerGrant = false): void {
    if (room.lifecycle !== 'active') return
    for (const client of [...room.clients.values()]) {
      try { this.sendControlState(room, client, includeOwnerGrant) }
      catch { this.options.disconnectClient(client.clientId) }
    }
  }
}
