import { assertGeneratedId, createGeneratedId } from '../src/lib/generatedId'
import type { RoomSnapshot, ServerMessage, TerminalBackendKind, TerminalRuntimePosition, TerminalSnapshot } from '../src/lib/protocol'
import type { RoomControlBearer, RoomControlContext, RoomControlGrant, RoomControlView } from '../src/lib/roomControl'
import { createTerminalId, createTerminalLaunchId, type TerminalRef } from '../src/lib/terminalIdentity'
import type { TextTerminalMutation } from '../src/lib/textTerminalMutation'
import type { RoomClient, RoomLifecycle, RoomOperationTicket, RoomRuntime } from './roomLifecycleCoordinator'
import { RoomBroadcastCoordinator } from './roomBroadcastCoordinator'
import { RoomControlCoordinator, type RoomControlledOperationTicket } from './roomControlCoordinator'
import type { TerminalBackendFactory } from './terminalBackend'
import {
  defaultBackendFactory,
  resolveShellCwd,
  TerminalBackendCoordinator,
  type CreateTerminalOptions,
  type TerminalRuntimeContext,
} from './terminalBackendCoordinator'
import {
  acquireTerminalStructureLock,
  assertTerminalStructureMutable,
  commitTerminalMove,
  releaseTerminalStructureLock,
  runSerializedTerminalStructureMutation,
  runSerializedTerminalStructureOperation,
} from './terminalMutationCoordinator'
import { DEFAULT_REPLAY_BYTE_LIMIT } from './terminalReplayBuffer'
import type { TerminalSlot } from './terminalRuntimeState'
import { projectTerminalPositions, projectTerminalReplayMessage } from './terminalSnapshotProjection'
import { RoomRegistryLifecycleCoordinator, type RoomSummary } from './roomRegistryLifecycleCoordinator'

export { DEFAULT_REPLAY_BYTE_LIMIT } from './terminalReplayBuffer'
export { defaultBackendFactory, resolveShellCwd } from './terminalBackendCoordinator'
export type { CreateTerminalOptions, TerminalRuntimeContext } from './terminalBackendCoordinator'
export type { RoomClient, RoomLifecycle, RoomOperationTicket } from './roomLifecycleCoordinator'
export type { RoomSummary } from './roomRegistryLifecycleCoordinator'
export { ROOM_CONTROL_HEARTBEAT_MS, ROOM_CONTROL_TTL_MS } from './roomControlCoordinator'
export type { RoomControlledOperationTicket } from './roomControlCoordinator'
export const MAX_LIVE_ROOMS = 32

type TerminalRoomManagerOptions = {
  replayByteLimit?: number
  backendFactory?: TerminalBackendFactory
  roomIdFactory?: () => string
  roomGenerationFactory?: () => string
  clientIdFactory?: () => string
  terminalIdFactory?: () => string
  launchIdFactory?: () => string
  serverInstanceIdFactory?: () => string
  homeDirectory?: string
  now?: () => number
  controlLeaseIdFactory?: () => string
}

export class TerminalRoomManager {
  readonly rooms = new Map<string, RoomRuntime>()
  readonly clients = new Map<string, RoomClient>()
  readonly replayByteLimit: number
  readonly backendFactory: TerminalBackendFactory
  readonly serverInstanceId: string
  readonly maxLiveRooms = MAX_LIVE_ROOMS
  readonly homeDirectory: string
  private readonly registryCoordinator: RoomRegistryLifecycleCoordinator
  private readonly controlCoordinator: RoomControlCoordinator
  private readonly backendCoordinator: TerminalBackendCoordinator
  private readonly broadcasts: RoomBroadcastCoordinator

  constructor(options: TerminalRoomManagerOptions = {}) {
    const replayByteLimit = options.replayByteLimit ?? DEFAULT_REPLAY_BYTE_LIMIT
    if (!Number.isInteger(replayByteLimit) || replayByteLimit <= 0) throw new Error('invalid_replay_byte_limit')
    this.replayByteLimit = replayByteLimit
    this.backendFactory = options.backendFactory ?? defaultBackendFactory
    this.serverInstanceId = assertGeneratedId((options.serverInstanceIdFactory ?? (() => createGeneratedId('serverInstance')))(), 'serverInstance')
    this.homeDirectory = resolveShellCwd(options.homeDirectory)
    this.broadcasts = new RoomBroadcastCoordinator((clientId) => this.disconnectClient(clientId))
    this.registryCoordinator = new RoomRegistryLifecycleCoordinator({
      rooms: this.rooms,
      clients: this.clients,
      maxLiveRooms: this.maxLiveRooms,
      roomIdFactory: options.roomIdFactory ?? (() => createGeneratedId('room')),
      roomGenerationFactory: options.roomGenerationFactory ?? (() => createGeneratedId('roomGeneration')),
      ownerContext: (owner) => this.controlCoordinator.ownerContext(owner),
      invokeControlLost: (context) => this.controlCoordinator.invokeControlLost(context),
      closeTerminalResource: (room, terminal) => {
        this.backendCoordinator.cancelCwdRefresh(terminal)
        this.backendCoordinator.beginBackendClose(room, terminal.backend)
      },
    })
    this.backendCoordinator = new TerminalBackendCoordinator({
      rooms: this.rooms,
      replayByteLimit: this.replayByteLimit,
      backendFactory: this.backendFactory,
      serverInstanceId: this.serverInstanceId,
      homeDirectory: this.homeDirectory,
      terminalIdFactory: options.terminalIdFactory ?? createTerminalId,
      launchIdFactory: options.launchIdFactory ?? createTerminalLaunchId,
      admit: (roomId) => this.admit(roomId),
      activeRoomOrThrow: (roomId) => this.activeRoomOrThrow(roomId),
      roomOrThrow: (roomId) => this.roomOrThrow(roomId),
      broadcast: (room, message) => this.broadcasts.broadcast(room, message),
    })
    this.controlCoordinator = new RoomControlCoordinator({
      rooms: this.rooms,
      clients: this.clients,
      serverInstanceId: this.serverInstanceId,
      clientIdFactory: options.clientIdFactory ?? (() => createGeneratedId('client')),
      controlLeaseIdFactory: options.controlLeaseIdFactory ?? (() => createGeneratedId('roomControlLease')),
      now: options.now ?? Date.now,
      activeRoomOrThrow: (roomId) => this.activeRoomOrThrow(roomId),
      admit: (roomId) => this.admit(roomId),
      roomSnapshot: (roomId) => this.roomSnapshot(roomId),
    })
  }

  setTerminalEnvProvider(provider: (context: TerminalRuntimeContext) => Record<string, string | undefined>): void {
    this.backendCoordinator.setTerminalEnvProvider(provider)
  }

  setActiveRunProvider(provider: (roomId: string, roomGeneration: string) => boolean): void {
    this.registryCoordinator.setActiveRunProvider(provider)
  }

  setDestroyHook(hook: (roomId: string, roomGeneration: string, signal: AbortSignal) => Promise<void> | void): void {
    this.registryCoordinator.setDestroyHook(hook)
  }

  addDestroyHook(hook: (roomId: string, roomGeneration: string, signal: AbortSignal) => Promise<void> | void): void {
    this.registryCoordinator.addDestroyHook(hook)
  }

  setControlLostHook(hook: (context: RoomControlContext) => Promise<void> | void): void {
    this.controlCoordinator.setControlLostHook(hook)
  }

  setControlHeartbeatHook(hook: (context: RoomControlContext) => Promise<void> | void): void {
    this.controlCoordinator.setControlHeartbeatHook(hook)
  }

  ensureRootRoom(): { kind: 'created'; room: RoomSummary } | { kind: 'home'; rooms: RoomSummary[] } {
    return this.registryCoordinator.ensureRootRoom()
  }

  createRoom(): RoomSummary {
    return this.registryCoordinator.createRoom()
  }

  ensureRoomFromRoute(roomId: string): { room: RoomSummary; created: boolean } {
    return this.registryCoordinator.ensureRoomFromRoute(roomId)
  }

  listRooms(): RoomSummary[] {
    return this.registryCoordinator.listRooms()
  }

  roomSummaryById(roomId: string): RoomSummary {
    return this.registryCoordinator.roomSummaryById(roomId)
  }

  connectClient(
    roomId: string,
    send: (message: ServerMessage) => void,
    close?: (code: number, reason: string) => void,
    ping?: () => void,
    sendSerialized?: (payload: string) => void,
  ): RoomClient {
    return this.controlCoordinator.connectClient(roomId, send, close, ping, sendSerialized)
  }

  disconnectClient(clientId: string): void {
    this.controlCoordinator.disconnectClient(clientId)
  }

  noteClientPong(clientId: string): void {
    this.controlCoordinator.noteClientPong(clientId)
  }

  heartbeatSweep(): void {
    this.controlCoordinator.heartbeatSweep()
  }

  roomControlView(roomId: string, clientId: string): RoomControlView {
    return this.controlCoordinator.roomControlView(roomId, clientId)
  }

  acquireRoomControl(clientId: string, expectedControlEpoch: number): RoomControlGrant {
    return this.controlCoordinator.acquireRoomControl(clientId, expectedControlEpoch)
  }

  async takeOverRoomControl(clientId: string, expectedControlEpoch: number, confirmed: boolean): Promise<RoomControlGrant> {
    return await this.controlCoordinator.takeOverRoomControl(clientId, expectedControlEpoch, confirmed)
  }

  async releaseRoomControl(bearer: RoomControlBearer, expectedRoomId?: string): Promise<void> {
    await this.controlCoordinator.releaseRoomControl(bearer, expectedRoomId)
  }

  admitControlledClient(clientId: string): RoomControlledOperationTicket {
    return this.controlCoordinator.admitControlledClient(clientId)
  }

  admitControlledBearer(bearer: RoomControlBearer, expectedRoomId?: string): RoomControlledOperationTicket {
    return this.controlCoordinator.admitControlledBearer(bearer, expectedRoomId)
  }

  runControlledClientMutation<T>(clientId: string, operation: (ticket: RoomControlledOperationTicket) => T): T {
    return this.controlCoordinator.runControlledClientMutation(clientId, operation)
  }

  async runControlledClientOperation<T>(clientId: string, operation: (ticket: RoomControlledOperationTicket) => Promise<T> | T): Promise<T> {
    return await this.controlCoordinator.runControlledClientOperation(clientId, operation)
  }

  async runControlledBearerOperation<T>(
    bearer: RoomControlBearer,
    operation: (ticket: RoomControlledOperationTicket) => Promise<T> | T,
    expectedRoomId?: string,
  ): Promise<T> {
    return await this.controlCoordinator.runControlledBearerOperation(bearer, operation, expectedRoomId)
  }

  async runControlledBearerPublishedOperation<T>(
    bearer: RoomControlBearer,
    operation: (ticket: RoomControlledOperationTicket) => Promise<T> | T,
    expectedRoomId?: string,
  ): Promise<T> {
    return await this.controlCoordinator.runControlledBearerPublishedOperation(bearer, operation, expectedRoomId)
  }

  assertRoomControlContext(context: RoomControlContext): void {
    this.controlCoordinator.assertRoomControlContext(context)
  }

  admit(roomId: string): RoomOperationTicket {
    return this.registryCoordinator.admit(roomId)
  }

  async runOperation<T>(roomId: string, operation: (ticket: RoomOperationTicket) => Promise<T> | T): Promise<T> {
    const ticket = this.admit(roomId)
    try {
      ticket.assertActive()
      const value = await operation(ticket)
      ticket.assertActive()
      return value
    } finally {
      ticket.finish()
    }
  }

  createTerminal(roomId: string, options: CreateTerminalOptions = {}): TerminalSnapshot {
    return this.backendCoordinator.createTerminal(roomId, options)
  }

  input(roomId: string, ref: TerminalRef | string | number, data: string) {
    return this.backendCoordinator.input(roomId, ref, data)
  }

  mutateTextContent(
    roomId: string,
    ref: TerminalRef | string | number,
    expectedTextRevision: number,
    mutation: TextTerminalMutation,
    resultHash: string,
  ) {
    return this.backendCoordinator.mutateTextContent(roomId, ref, expectedTextRevision, mutation, resultHash)
  }

  resize(roomId: string, ref: TerminalRef | string | number, cols: number, rows: number) {
    return this.backendCoordinator.resize(roomId, ref, cols, rows)
  }

  resetTerminal(roomId: string, ref: TerminalRef | string | number, backendKind?: TerminalBackendKind, fail = false) {
    return this.backendCoordinator.resetTerminal(roomId, ref, backendKind, fail)
  }

  moveTerminal(roomId: string, terminalId: string, newIndex: number) {
    const ticket = this.admit(roomId)
    try {
      const room = this.roomOrThrow(roomId)
      assertTerminalStructureMutable(room)
      this.backendCoordinator.terminalOrThrow(room, terminalId)
      if (!commitTerminalMove(room, terminalId, newIndex)) return
      this.backendCoordinator.broadcastIndexMap(room)
    } finally {
      ticket.finish()
    }
  }

  closeTerminal(roomId: string, ref: TerminalRef | string | number) {
    return this.backendCoordinator.closeTerminal(roomId, ref)
  }

  requestReplay(roomId: string, ref: TerminalRef | string | number): ServerMessage {
    const room = this.activeRoomOrThrow(roomId)
    const terminal = this.resolveTerminal(roomId, ref)
    return projectTerminalReplayMessage(room, terminal)
  }

  requestTextSnapshot(roomId: string, ref: TerminalRef | string | number): ServerMessage { return this.backendCoordinator.textSnapshot(roomId, ref) }

  roomSnapshot(roomId: string): RoomSnapshot {
    const room = this.activeRoomOrThrow(roomId)
    return this.backendCoordinator.roomSnapshot(room)
  }

  terminalPositions(roomId: string): TerminalRuntimePosition[] {
    const room = this.activeRoomOrThrow(roomId)
    return projectTerminalPositions(room)
  }

  terminalStructureRevision(roomId: string): number {
    return this.activeRoomOrThrow(roomId).terminalStructureRevision
  }

  async runTerminalStructureOperation<T>(
    ticket: RoomControlledOperationTicket,
    expectedRevision: number,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('invalid_terminal_structure_revision')
    const room = this.activeRoomOrThrow(ticket.roomId)
    return await runSerializedTerminalStructureOperation(room, ticket, expectedRevision, operation)
  }

  async runTerminalStructureMutation<T>(ticket: RoomControlledOperationTicket, operation: () => Promise<T> | T): Promise<T> {
    const room = this.activeRoomOrThrow(ticket.roomId)
    return await runSerializedTerminalStructureMutation(room, ticket, operation)
  }

  async batchTerminalIndexMaps<T>(roomId: string, operation: () => Promise<T> | T): Promise<T> {
    return await this.broadcasts.batchIndexMaps(this.activeRoomOrThrow(roomId), operation)
  }

  acquireRunStructureLock(roomId: string, runId: string): void {
    const room = this.activeRoomOrThrow(roomId)
    acquireTerminalStructureLock(room, runId)
    this.backendCoordinator.broadcastIndexMap(room)
  }

  releaseRunStructureLock(roomId: string, runId: string): void {
    const room = this.rooms.get(roomId)
    if (!room || !releaseTerminalStructureLock(room, runId)) return
    if (room.lifecycle === 'active') this.backendCoordinator.broadcastIndexMap(room)
  }

  indexMap(roomId: string) {
    return this.activeRoomOrThrow(roomId).store.indexMap()
  }

  hasTerminalLaunch(roomId: string, roomGeneration: string, terminalId: string, launchId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room || room.lifecycle !== 'active' || room.roomGeneration !== roomGeneration) return false
    const terminal = room.terminals.get(terminalId)
    return terminal?.launchId === launchId
  }

  terminalOutputActivityRevision(roomId: string, roomGeneration: string, terminalId: string, launchId: string): number {
    const room = this.activeRoomOrThrow(roomId)
    if (room.roomGeneration !== roomGeneration) throw new Error('room_generation_conflict')
    const terminal = this.backendCoordinator.terminalOrThrow(room, terminalId)
    if (terminal.launchId !== launchId) throw new Error('terminal_launch_conflict')
    return terminal.outputActivityRevision
  }

  resolveTerminal(roomId: string, ref: TerminalRef | string | number): TerminalSlot {
    return this.backendCoordinator.resolveTerminal(roomId, ref)
  }

  terminalSnapshot(terminal: TerminalSlot): TerminalSnapshot {
    return this.backendCoordinator.terminalSnapshot(terminal)
  }

  broadcastRoomMessage(roomId: string, message: ServerMessage): void {
    this.broadcasts.broadcast(this.activeRoomOrThrow(roomId), message)
  }

  broadcastAllClients(createMessage: (roomId: string, roomGeneration: string) => ServerMessage): void {
    for (const client of [...this.clients.values()]) {
      try { client.send(createMessage(client.roomId, client.roomGeneration)) }
      catch { this.disconnectClient(client.clientId) }
    }
  }

  async destroyRoom(roomId: string, expectedRoomGeneration: string): Promise<void> {
    await this.registryCoordinator.destroyRoom(roomId, expectedRoomGeneration)
  }

  async destroyAllRooms(): Promise<void> {
    await this.registryCoordinator.destroyAllRooms()
  }

  private activeRoomOrThrow(roomId: string): RoomRuntime {
    return this.registryCoordinator.activeRoomOrThrow(roomId)
  }

  private roomOrThrow(roomId: string): RoomRuntime {
    return this.registryCoordinator.roomOrThrow(roomId)
  }

}
