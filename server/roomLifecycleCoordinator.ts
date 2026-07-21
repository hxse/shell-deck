import type { ServerMessage } from '../src/lib/protocol'
import type { RoomControlContext } from '../src/lib/roomControl'
import type { TerminalBackend } from './terminalBackend'
import type { TerminalSlot } from './terminalRuntimeState'
import { RoomTerminalStore } from './roomTerminalStore'

export type RoomLifecycle = 'active' | 'destroying' | 'destroyed'

export type RoomClient = {
  clientId: string
  roomId: string
  roomGeneration: string
  send(message: ServerMessage): void
  close?(code: number, reason: string): void
  ping?(): void
  lastPongAtMs: number
  awaitingPong: boolean
  lostControlEpoch: number | null
}

export type RoomControlOwner = RoomControlContext & {
  acquiredAtMs: number
  expiresAtMs: number
}

export type RoomOperationTicket = {
  readonly roomId: string
  readonly roomGeneration: string
  readonly signal: AbortSignal
  assertActive(): void
  finish(): void
}

export type RoomRuntime = {
  roomId: string
  roomGeneration: string
  lifecycle: RoomLifecycle
  roomRevision: number
  terminalStructureRevision: number
  structureLockRunId: string | null
  structureQueue: Promise<void>
  store: RoomTerminalStore
  terminals: Map<string, TerminalSlot>
  clients: Map<string, RoomClient>
  controlEpoch: number
  controller: RoomControlOwner | null
  abortController: AbortController
  tickets: Set<RoomOperationTicketImpl>
  closingBackends: Set<Promise<void>>
}

export class RoomOperationTicketImpl implements RoomOperationTicket {
  #finished = false

  constructor(
    readonly room: RoomRuntime,
    private readonly isCurrentRoom: () => boolean,
  ) {}

  get roomId(): string { return this.room.roomId }
  get roomGeneration(): string { return this.room.roomGeneration }
  get signal(): AbortSignal { return this.room.abortController.signal }

  assertActive(): void {
    if (this.#finished) throw new Error('room_operation_finished')
    if (this.signal.aborted || this.room.lifecycle !== 'active' || !this.isCurrentRoom()) {
      throw new Error(this.room.lifecycle === 'destroying' ? 'room_destroying' : 'room_not_found')
    }
  }

  finish(): void {
    if (this.#finished) return
    this.#finished = true
    this.room.tickets.delete(this)
  }
}

export function createRoomRuntime(roomId: string, roomGeneration: string): RoomRuntime {
  return {
    roomId,
    roomGeneration,
    lifecycle: 'active',
    roomRevision: 0,
    terminalStructureRevision: 0,
    structureLockRunId: null,
    structureQueue: Promise.resolve(),
    store: new RoomTerminalStore(),
    terminals: new Map(),
    clients: new Map(),
    controlEpoch: 0,
    controller: null,
    abortController: new AbortController(),
    tickets: new Set(),
    closingBackends: new Set(),
  }
}

export function admitRoomOperation(room: RoomRuntime, isCurrentRoom: () => boolean): RoomOperationTicket {
  const ticket = new RoomOperationTicketImpl(room, isCurrentRoom)
  room.tickets.add(ticket)
  return ticket
}

export function beginRoomDestruction(room: RoomRuntime): void {
  room.controller = null
  room.lifecycle = 'destroying'
  room.abortController.abort(new Error('room_destroying'))
}

export async function finishRoomDestruction(
  room: RoomRuntime,
  previousController: RoomControlContext | null,
  context: {
    controlLost: (owner: RoomControlContext) => Promise<void> | void
    destroyHooks: () => ReadonlyArray<(roomId: string, roomGeneration: string, signal: AbortSignal) => Promise<void> | void>
    closeTerminalResource: (room: RoomRuntime, terminal: TerminalSlot) => void
    removeClient: (clientId: string) => void
    removeRoom: (roomId: string) => void
  },
): Promise<void> {
  if (previousController) await Promise.resolve(context.controlLost(previousController)).catch(() => {})
  await Promise.allSettled(context.destroyHooks().map(async (hook) => {
    await hook(room.roomId, room.roomGeneration, room.abortController.signal)
  }))
  while (room.tickets.size > 0) await new Promise((resolveWait) => setTimeout(resolveWait, 0))
  for (const terminal of room.terminals.values()) context.closeTerminalResource(room, terminal)
  await Promise.allSettled([...room.closingBackends])
  room.terminals.clear()
  room.store.terminalOrder.splice(0)
  const message: ServerMessage = { type: 'room_destroyed', roomId: room.roomId, roomGeneration: room.roomGeneration }
  for (const client of [...room.clients.values()]) {
    try { client.send(message) } catch {}
    try { client.close?.(4001, 'room_destroyed') } catch {}
    context.removeClient(client.clientId)
  }
  room.clients.clear()
  room.lifecycle = 'destroyed'
  context.removeRoom(room.roomId)
}

export function beginRoomBackendClose(room: RoomRuntime | undefined, backend: TerminalBackend): Promise<void> {
  let closing: Promise<void>
  try { closing = Promise.resolve(backend.close()) }
  catch (error) { closing = Promise.reject(error) }
  if (!room) {
    void closing.catch(() => {})
    return closing
  }
  room.closingBackends.add(closing)
  void closing.catch(() => {}).finally(() => room.closingBackends.delete(closing))
  return closing
}
