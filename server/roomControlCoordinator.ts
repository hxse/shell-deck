import type { RoomSnapshot, ServerMessage } from '../src/lib/protocol'
import type {
  RoomControlBearer,
  RoomControlContext,
  RoomControlGrant,
  RoomControlView,
} from '../src/lib/roomControl'
import {
  ROOM_CONTROL_HEARTBEAT_MS,
  RoomClientPresenceCoordinator,
} from './roomClientPresenceCoordinator'
import {
  ROOM_CONTROL_TTL_MS,
  RoomControllerLeaseCoordinator,
  type RoomControlledOperationTicket,
} from './roomControllerLeaseCoordinator'
import type {
  RoomClient,
  RoomControlOwner,
  RoomOperationTicket,
  RoomRuntime,
} from './roomLifecycleCoordinator'

export { ROOM_CONTROL_HEARTBEAT_MS, ROOM_CONTROL_TTL_MS }
export type { RoomControlledOperationTicket }

type RoomControlCoordinatorOptions = {
  rooms: Map<string, RoomRuntime>
  clients: Map<string, RoomClient>
  serverInstanceId: string
  clientIdFactory: () => string
  controlLeaseIdFactory: () => string
  now: () => number
  activeRoomOrThrow(roomId: string): RoomRuntime
  admit(roomId: string): RoomOperationTicket
  roomSnapshot(roomId: string): RoomSnapshot
}

export class RoomControlCoordinator {
  private readonly presenceCoordinator: RoomClientPresenceCoordinator
  private readonly leaseCoordinator: RoomControllerLeaseCoordinator

  constructor(options: RoomControlCoordinatorOptions) {
    this.leaseCoordinator = new RoomControllerLeaseCoordinator({
      clients: options.clients,
      serverInstanceId: options.serverInstanceId,
      controlLeaseIdFactory: options.controlLeaseIdFactory,
      now: options.now,
      activeRoomOrThrow: options.activeRoomOrThrow,
      admit: options.admit,
      disconnectClient: (clientId) => this.presenceCoordinator.disconnectClient(clientId),
    })
    this.presenceCoordinator = new RoomClientPresenceCoordinator({
      rooms: options.rooms,
      clients: options.clients,
      serverInstanceId: options.serverInstanceId,
      clientIdFactory: options.clientIdFactory,
      now: options.now,
      activeRoomOrThrow: options.activeRoomOrThrow,
      roomSnapshot: options.roomSnapshot,
    }, this.leaseCoordinator)
  }

  setControlLostHook(hook: (context: RoomControlContext) => Promise<void> | void): void {
    this.leaseCoordinator.setControlLostHook(hook)
  }

  setControlHeartbeatHook(hook: (context: RoomControlContext) => Promise<void> | void): void {
    this.leaseCoordinator.setControlHeartbeatHook(hook)
  }

  connectClient(
    roomId: string,
    send: (message: ServerMessage) => void,
    close?: (code: number, reason: string) => void,
    ping?: () => void,
    sendSerialized?: (payload: string) => void,
    expectedRoomGeneration?: string,
  ): RoomClient {
    return this.presenceCoordinator.connectClient(roomId, send, close, ping, sendSerialized, expectedRoomGeneration)
  }

  disconnectClient(clientId: string): void {
    this.presenceCoordinator.disconnectClient(clientId)
  }

  noteClientPong(clientId: string): void {
    this.presenceCoordinator.noteClientPong(clientId)
  }

  heartbeatSweep(): void {
    this.presenceCoordinator.heartbeatSweep()
  }

  roomControlView(roomId: string, clientId: string): RoomControlView {
    return this.leaseCoordinator.roomControlView(roomId, clientId)
  }

  acquireRoomControl(clientId: string, expectedControlEpoch: number): RoomControlGrant {
    return this.leaseCoordinator.acquireRoomControl(clientId, expectedControlEpoch)
  }

  async takeOverRoomControl(clientId: string, expectedControlEpoch: number, confirmed: boolean): Promise<RoomControlGrant> {
    return await this.leaseCoordinator.takeOverRoomControl(clientId, expectedControlEpoch, confirmed)
  }

  async releaseRoomControl(bearer: RoomControlBearer, expectedRoomId?: string): Promise<void> {
    await this.leaseCoordinator.releaseRoomControl(bearer, expectedRoomId)
  }

  admitControlledClient(clientId: string): RoomControlledOperationTicket {
    return this.leaseCoordinator.admitControlledClient(clientId)
  }

  admitControlledBearer(bearer: RoomControlBearer, expectedRoomId?: string): RoomControlledOperationTicket {
    return this.leaseCoordinator.admitControlledBearer(bearer, expectedRoomId)
  }

  runControlledClientMutation<T>(clientId: string, operation: (ticket: RoomControlledOperationTicket) => T): T {
    return this.leaseCoordinator.runControlledClientMutation(clientId, operation)
  }

  async runControlledClientOperation<T>(
    clientId: string,
    operation: (ticket: RoomControlledOperationTicket) => Promise<T> | T,
  ): Promise<T> {
    return await this.leaseCoordinator.runControlledClientOperation(clientId, operation)
  }

  async runControlledBearerOperation<T>(
    bearer: RoomControlBearer,
    operation: (ticket: RoomControlledOperationTicket) => Promise<T> | T,
    expectedRoomId?: string,
  ): Promise<T> {
    return await this.leaseCoordinator.runControlledBearerOperation(bearer, operation, expectedRoomId)
  }

  async runControlledBearerPublishedOperation<T>(
    bearer: RoomControlBearer,
    operation: (ticket: RoomControlledOperationTicket) => Promise<T> | T,
    expectedRoomId?: string,
  ): Promise<T> {
    return await this.leaseCoordinator.runControlledBearerPublishedOperation(bearer, operation, expectedRoomId)
  }

  assertRoomControlContext(context: RoomControlContext): void {
    this.leaseCoordinator.assertRoomControlContext(context)
  }

  ownerContext(owner: RoomControlOwner): RoomControlContext {
    return this.leaseCoordinator.ownerContext(owner)
  }

  invokeControlLost(context: RoomControlContext): Promise<void> | void {
    return this.leaseCoordinator.invokeControlLost(context)
  }
}
