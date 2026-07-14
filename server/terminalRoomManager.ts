import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { assertGeneratedId, assertRoomRouteToken, createGeneratedId } from '../src/lib/generatedId'
import type { RoomSnapshot, ServerMessage, TerminalBackendKind, TerminalSnapshot } from '../src/lib/protocol'
import { createTerminalId, createTerminalLaunchId, normalizeTerminalRef, type TerminalRef } from '../src/lib/terminalIdentity'
import { FakeTerminalBackend } from './fakeTerminalBackend'
import { RealPtyBackend } from './realPtyBackend'
import { RoomTerminalStore } from './roomTerminalStore'
import { TextBoxBackend } from './textBoxBackend'
import type { TerminalBackend, TerminalBackendFactory } from './terminalBackend'

export const DEFAULT_REPLAY_BYTE_LIMIT = 2 * 1024 * 1024
export const MAX_LIVE_ROOMS = 32
const REPLAY_COMPACT_THRESHOLD = 1024
const CWD_REFRESH_DEBOUNCE_MS = 60

export type RoomLifecycle = 'active' | 'destroying' | 'destroyed'

export type RoomSummary = {
  roomId: string
  roomGeneration: string
  terminalCount: number
  connectedClientCount: number
  hasActiveRun: boolean
}

export type RoomClient = {
  clientId: string
  roomId: string
  roomGeneration: string
  send(message: ServerMessage): void
  close?(code: number, reason: string): void
}

export type TerminalRuntimeContext = {
  serverInstanceId: string
  roomId: string
  roomGeneration: string
  terminalId: string
  launchId: string
}

export type CreateTerminalOptions = {
  backend?: TerminalBackendKind
  cols?: number
  rows?: number
  cwd?: string
  cwdSource?: 'last-shell'
}

export type RoomOperationTicket = {
  readonly roomId: string
  readonly roomGeneration: string
  readonly signal: AbortSignal
  assertActive(): void
  finish(): void
}

type TerminalSlot = {
  roomId: string
  roomGeneration: string
  terminalId: string
  launchId: string
  backend: TerminalBackend
  backendKind: TerminalBackendKind
  cwd: string | null
  cwdRefreshTimer: ReturnType<typeof setTimeout> | null
  status: 'starting' | 'running' | 'closed' | 'failed'
  cols: number
  rows: number
  replay: string[]
  replayStart: number
  replayBytes: number
  replayDiscardedBytes: number
  exitCode: number | null
  signal: string | null
  terminalRevision: number
  textRevision: number
  outputActivityRevision: number
}

type RoomRuntime = {
  roomId: string
  roomGeneration: string
  lifecycle: RoomLifecycle
  roomRevision: number
  store: RoomTerminalStore
  terminals: Map<string, TerminalSlot>
  clients: Map<string, RoomClient>
  abortController: AbortController
  tickets: Set<RoomOperationTicketImpl>
  closingBackends: Set<Promise<void>>
}

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
}

class RoomOperationTicketImpl implements RoomOperationTicket {
  #finished = false

  constructor(readonly manager: TerminalRoomManager, readonly room: RoomRuntime) {}

  get roomId(): string { return this.room.roomId }
  get roomGeneration(): string { return this.room.roomGeneration }
  get signal(): AbortSignal { return this.room.abortController.signal }

  assertActive(): void {
    if (this.#finished) throw new Error('room_operation_finished')
    if (this.signal.aborted || this.room.lifecycle !== 'active' || this.manager.rooms.get(this.roomId) !== this.room) {
      throw new Error(this.room.lifecycle === 'destroying' ? 'room_destroying' : 'room_not_found')
    }
  }

  finish(): void {
    if (this.#finished) return
    this.#finished = true
    this.room.tickets.delete(this)
  }
}

export class TerminalRoomManager {
  readonly rooms = new Map<string, RoomRuntime>()
  readonly clients = new Map<string, RoomClient>()
  readonly replayByteLimit: number
  readonly backendFactory: TerminalBackendFactory
  readonly serverInstanceId: string
  readonly maxLiveRooms = MAX_LIVE_ROOMS
  readonly homeDirectory: string
  private readonly roomIdFactory: () => string
  private readonly roomGenerationFactory: () => string
  private readonly clientIdFactory: () => string
  private readonly terminalIdFactory: () => string
  private readonly launchIdFactory: () => string
  private terminalEnvProvider: (context: TerminalRuntimeContext) => Record<string, string | undefined> = () => ({})
  private activeRunProvider: (roomId: string, roomGeneration: string) => boolean = () => false
  private destroyHook: (roomId: string, roomGeneration: string, signal: AbortSignal) => Promise<void> | void = () => {}
  private readonly destroying = new Map<string, Promise<void>>()

  constructor(options: TerminalRoomManagerOptions = {}) {
    const replayByteLimit = options.replayByteLimit ?? DEFAULT_REPLAY_BYTE_LIMIT
    if (!Number.isInteger(replayByteLimit) || replayByteLimit <= 0) throw new Error('invalid_replay_byte_limit')
    this.replayByteLimit = replayByteLimit
    this.backendFactory = options.backendFactory ?? defaultBackendFactory
    this.roomIdFactory = options.roomIdFactory ?? (() => createGeneratedId('room'))
    this.roomGenerationFactory = options.roomGenerationFactory ?? (() => createGeneratedId('roomGeneration'))
    this.clientIdFactory = options.clientIdFactory ?? (() => createGeneratedId('client'))
    this.terminalIdFactory = options.terminalIdFactory ?? createTerminalId
    this.launchIdFactory = options.launchIdFactory ?? createTerminalLaunchId
    this.serverInstanceId = assertGeneratedId((options.serverInstanceIdFactory ?? (() => createGeneratedId('serverInstance')))(), 'serverInstance')
    this.homeDirectory = resolveShellCwd(options.homeDirectory)
  }

  setTerminalEnvProvider(provider: (context: TerminalRuntimeContext) => Record<string, string | undefined>): void {
    this.terminalEnvProvider = provider
  }

  setActiveRunProvider(provider: (roomId: string, roomGeneration: string) => boolean): void {
    this.activeRunProvider = provider
  }

  setDestroyHook(hook: (roomId: string, roomGeneration: string, signal: AbortSignal) => Promise<void> | void): void {
    this.destroyHook = hook
  }

  ensureRootRoom(): { kind: 'created'; room: RoomSummary } | { kind: 'home'; rooms: RoomSummary[] } {
    if (this.rooms.size > 0) return { kind: 'home', rooms: this.listRooms() }
    return { kind: 'created', room: this.createRoom() }
  }

  createRoom(): RoomSummary {
    this.assertCapacity()
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const roomId = assertGeneratedId(this.roomIdFactory(), 'room')
      if (this.rooms.has(roomId)) continue
      return this.createRoomWithToken(roomId)
    }
    throw new Error('room_id_collision')
  }

  ensureRoomFromRoute(roomId: string): { room: RoomSummary; created: boolean } {
    const token = assertRoomRouteToken(roomId)
    const existing = this.rooms.get(token)
    if (existing) {
      if (existing.lifecycle !== 'active') throw new Error('room_destroying')
      return { room: this.roomSummary(existing), created: false }
    }
    this.assertCapacity()
    return { room: this.createRoomWithToken(token), created: true }
  }

  listRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.lifecycle !== 'destroyed')
      .map((room) => this.roomSummary(room))
      .sort((left, right) => left.roomId.localeCompare(right.roomId))
  }

  roomSummaryById(roomId: string): RoomSummary {
    return this.roomSummary(this.activeRoomOrThrow(roomId))
  }

  connectClient(roomId: string, send: (message: ServerMessage) => void, close?: (code: number, reason: string) => void): RoomClient {
    const room = this.activeRoomOrThrow(roomId)
    let clientId: string | undefined
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = assertGeneratedId(this.clientIdFactory(), 'client')
      if (!this.clients.has(candidate)) {
        clientId = candidate
        break
      }
    }
    if (!clientId) throw new Error('client_id_collision')
    const client: RoomClient = { clientId, roomId: room.roomId, roomGeneration: room.roomGeneration, send, close }
    room.clients.set(clientId, client)
    this.clients.set(clientId, client)
    try {
      send({ type: 'client_registered', clientId, roomId: room.roomId, roomGeneration: room.roomGeneration, serverInstanceId: this.serverInstanceId })
      send(this.roomSnapshot(room.roomId))
    } catch (error) {
      room.clients.delete(clientId)
      this.clients.delete(clientId)
      throw error
    }
    return client
  }

  disconnectClient(clientId: string): void {
    const client = this.clients.get(clientId)
    if (!client) return
    this.clients.delete(clientId)
    this.rooms.get(client.roomId)?.clients.delete(clientId)
  }

  admit(roomId: string): RoomOperationTicket {
    const room = this.activeRoomOrThrow(roomId)
    const ticket = new RoomOperationTicketImpl(this, room)
    room.tickets.add(ticket)
    return ticket
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
    const ticket = this.admit(roomId)
    let room: RoomRuntime | undefined
    let backend: TerminalBackend | undefined
    try {
      room = this.activeRoomOrThrow(roomId)
      const backendKind = options.backend ?? 'real'
      if (options.cwd !== undefined && options.cwdSource !== undefined) throw new Error('terminal_cwd_source_conflict')
      if (backendKind === 'text' && (options.cwd !== undefined || options.cwdSource !== undefined)) throw new Error('text_terminal_cwd_not_supported')
      const cwd = backendKind === 'text' ? null : this.resolveCreateCwd(room, options)
      const terminalId = this.nextTerminalId(room)
      const launchId = this.nextLaunchId(room)
      const cols = options.cols ?? 80
      const rows = options.rows ?? 24
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) throw new Error('invalid_terminal_size')
      const context: TerminalRuntimeContext = {
        serverInstanceId: this.serverInstanceId,
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        terminalId,
        launchId,
      }
      backend = this.backendFactory(backendKind, { cols, rows, cwd: cwd ?? undefined, ...context, env: this.terminalEnvProvider(context) })
      const terminal: TerminalSlot = {
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        terminalId,
        launchId,
        backend,
        backendKind,
        cwd,
        cwdRefreshTimer: null,
        status: 'starting',
        cols,
        rows,
        replay: [],
        replayStart: 0,
        replayBytes: 0,
        replayDiscardedBytes: 0,
        exitCode: null,
        signal: null,
        terminalRevision: 1,
        textRevision: 0,
        outputActivityRevision: 0,
      }
      const pendingData: string[] = []
      let pendingExit: { exitCode: number | null; signal: string | null } | undefined
      let pendingError: Error | undefined
      let committed = false
      backend.start({
        onData: (data) => committed ? this.emitOutput(terminal, data) : pendingData.push(data),
        onExit: (exitCode, signal) => committed ? this.markClosed(terminal, exitCode, signal) : pendingExit = { exitCode, signal },
        onError: (error) => committed ? this.markFailed(terminal, error) : pendingError = error,
      })
      ticket.assertActive()
      room.store.addTerminal(terminalId)
      room.terminals.set(terminalId, terminal)
      room.roomRevision += 1
      committed = true
      terminal.status = 'running'
      this.broadcast(room, this.terminalSnapshot(terminal))
      this.broadcastIndexMap(room)
      for (const data of pendingData) this.emitOutput(terminal, data)
      if (pendingError) this.markFailed(terminal, pendingError)
      if (pendingExit) this.markClosed(terminal, pendingExit.exitCode, pendingExit.signal)
      return this.terminalSnapshot(terminal)
    } catch (error) {
      if (backend) this.beginBackendClose(room, backend)
      throw error
    } finally {
      ticket.finish()
    }
  }

  input(roomId: string, ref: TerminalRef | string | number, data: string) {
    const ticket = this.admit(roomId)
    try {
      const terminal = this.resolveTerminal(roomId, ref)
      if (terminal.status !== 'running') {
        const room = this.roomOrThrow(roomId)
        this.broadcast(room, { type: 'input_rejected', roomId: room.roomId, roomGeneration: room.roomGeneration, terminalId: terminal.terminalId, reason: 'not_running' })
        return { ok: false as const, reason: 'not_running' }
      }
      terminal.backend.write(data)
      return { ok: true as const }
    } finally {
      ticket.finish()
    }
  }

  setTextContent(roomId: string, ref: TerminalRef | string | number, content: string) {
    const ticket = this.admit(roomId)
    try {
      const room = this.roomOrThrow(roomId)
      const terminal = this.resolveTerminal(roomId, ref)
      if (terminal.backendKind !== 'text') throw new Error('terminal_not_text_box:' + terminal.terminalId)
      terminal.replay = [content]
      terminal.replayStart = 0
      terminal.replayBytes = Buffer.byteLength(content)
      terminal.replayDiscardedBytes = 0
      this.advanceTerminalRevision(room, terminal, { text: true, outputActivity: true })
      this.broadcast(room, this.terminalSnapshot(terminal))
      return { ok: true as const }
    } finally {
      ticket.finish()
    }
  }

  resize(roomId: string, ref: TerminalRef | string | number, cols: number, rows: number) {
    const ticket = this.admit(roomId)
    try {
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) throw new Error('invalid_terminal_size')
      const room = this.roomOrThrow(roomId)
      const terminal = this.resolveTerminal(roomId, ref)
      terminal.cols = cols
      terminal.rows = rows
      terminal.backend.resize(cols, rows)
      this.advanceTerminalRevision(room, terminal)
      this.broadcast(room, this.stateMessage(terminal))
      return { ok: true as const }
    } finally {
      ticket.finish()
    }
  }

  resetTerminal(roomId: string, ref: TerminalRef | string | number, backendKind?: TerminalBackendKind, fail = false) {
    const ticket = this.admit(roomId)
    let room: RoomRuntime | undefined
    let backend: TerminalBackend | undefined
    try {
      room = this.roomOrThrow(roomId)
      const oldTerminal = this.resolveTerminal(roomId, ref)
      if (fail) return { ok: false as const, reason: 'backend_unavailable' }
      const nextBackendKind = backendKind ?? oldTerminal.backendKind
      const cwd = nextBackendKind === 'text' ? null : oldTerminal.cwd ?? this.homeDirectory
      const launchId = this.nextLaunchId(room)
      const context: TerminalRuntimeContext = {
        serverInstanceId: this.serverInstanceId,
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        terminalId: oldTerminal.terminalId,
        launchId,
      }
      backend = this.backendFactory(nextBackendKind, { cols: oldTerminal.cols, rows: oldTerminal.rows, cwd: cwd ?? undefined, ...context, env: this.terminalEnvProvider(context) })
      const nextTerminal: TerminalSlot = {
        ...oldTerminal,
        launchId,
        backend,
        backendKind: nextBackendKind,
        cwd,
        cwdRefreshTimer: null,
        status: 'starting',
        replay: [],
        replayStart: 0,
        replayBytes: 0,
        replayDiscardedBytes: 0,
        exitCode: null,
        signal: null,
        terminalRevision: oldTerminal.terminalRevision + 1,
        textRevision: oldTerminal.textRevision + 1,
        outputActivityRevision: oldTerminal.outputActivityRevision + 1,
      }
      const pendingData: string[] = []
      let pendingExit: { exitCode: number | null; signal: string | null } | undefined
      let pendingError: Error | undefined
      let committed = false
      backend.start({
        onData: (data) => committed ? this.emitOutput(nextTerminal, data) : pendingData.push(data),
        onExit: (exitCode, signal) => committed ? this.markClosed(nextTerminal, exitCode, signal) : pendingExit = { exitCode, signal },
        onError: (error) => committed ? this.markFailed(nextTerminal, error) : pendingError = error,
      })
      ticket.assertActive()
      this.cancelCwdRefresh(oldTerminal)
      this.beginBackendClose(room, oldTerminal.backend)
      room.terminals.set(nextTerminal.terminalId, nextTerminal)
      room.roomRevision += 1
      committed = true
      nextTerminal.status = 'running'
      this.broadcast(room, this.terminalSnapshot(nextTerminal))
      for (const data of pendingData) this.emitOutput(nextTerminal, data)
      if (pendingError) this.markFailed(nextTerminal, pendingError)
      if (pendingExit) this.markClosed(nextTerminal, pendingExit.exitCode, pendingExit.signal)
      return { ok: true as const }
    } catch {
      if (backend) this.beginBackendClose(room, backend)
      return { ok: false as const, reason: 'backend_unavailable' }
    } finally {
      ticket.finish()
    }
  }

  moveTerminal(roomId: string, terminalId: string, newIndex: number) {
    const ticket = this.admit(roomId)
    try {
      const room = this.roomOrThrow(roomId)
      this.terminalOrThrow(room, terminalId)
      room.store.moveTerminal(terminalId, newIndex)
      room.roomRevision += 1
      this.broadcastIndexMap(room)
      this.broadcast(room, this.roomSnapshot(roomId))
    } finally {
      ticket.finish()
    }
  }

  closeTerminal(roomId: string, ref: TerminalRef | string | number) {
    const ticket = this.admit(roomId)
    try {
      const room = this.roomOrThrow(roomId)
      const terminal = this.resolveTerminal(roomId, ref)
      this.cancelCwdRefresh(terminal)
      this.beginBackendClose(room, terminal.backend)
      room.terminals.delete(terminal.terminalId)
      room.store.removeTerminal(terminal.terminalId)
      room.roomRevision += 1
      this.broadcastIndexMap(room)
      this.broadcast(room, this.roomSnapshot(roomId))
      return { ok: true as const }
    } finally {
      ticket.finish()
    }
  }

  requestReplay(roomId: string, ref: TerminalRef | string | number): ServerMessage {
    const room = this.activeRoomOrThrow(roomId)
    const terminal = this.resolveTerminal(roomId, ref)
    return {
      type: 'terminal_replay',
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      terminalId: terminal.terminalId,
      launchId: terminal.launchId,
      replay: this.replayChunks(terminal),
      ...this.revisionFields(room, terminal),
    }
  }

  roomSnapshot(roomId: string): RoomSnapshot {
    const room = this.activeRoomOrThrow(roomId)
    for (const terminalId of room.store.terminalOrder) {
      this.refreshTerminalCwd(this.terminalOrThrow(room, terminalId), true)
    }
    const terminals = room.store.terminalOrder.map((terminalId) => this.terminalSnapshot(this.terminalOrThrow(room, terminalId)))
    return { type: 'room_snapshot', roomId: room.roomId, roomGeneration: room.roomGeneration, roomRevision: room.roomRevision, terminals, indexMap: room.store.indexMap() }
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
    const terminal = this.terminalOrThrow(room, terminalId)
    if (terminal.launchId !== launchId) throw new Error('terminal_launch_conflict')
    return terminal.outputActivityRevision
  }

  resolveTerminal(roomId: string, ref: TerminalRef | string | number): TerminalSlot {
    const normalized = normalizeTerminalRef(ref)
    const room = this.activeRoomOrThrow(roomId)
    const terminalId = normalized.kind === 'id'
      ? normalized.value
      : room.store.terminalIdAt(normalized.value)
    return this.terminalOrThrow(room, terminalId)
  }

  terminalSnapshot(terminal: TerminalSlot): TerminalSnapshot {
    const room = this.roomOrThrow(terminal.roomId)
    const terminalIndex = room.store.indexOf(terminal.terminalId)
    return {
      type: 'terminal_snapshot',
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      terminalId: terminal.terminalId,
      launchId: terminal.launchId,
      terminalIndex,
      visualOrder: terminalIndex,
      status: terminal.status,
      cols: terminal.cols,
      rows: terminal.rows,
      backend: terminal.backendKind,
      cwd: terminal.cwd,
      replay: this.replayChunks(terminal),
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      ...this.revisionFields(room, terminal),
    }
  }

  broadcastRoomMessage(roomId: string, message: ServerMessage): void {
    this.broadcast(this.activeRoomOrThrow(roomId), message)
  }

  broadcastAllClients(createMessage: (roomId: string, roomGeneration: string) => ServerMessage): void {
    for (const client of [...this.clients.values()]) {
      try { client.send(createMessage(client.roomId, client.roomGeneration)) }
      catch { this.disconnectClient(client.clientId) }
    }
  }

  async destroyRoom(roomId: string, expectedRoomGeneration: string): Promise<void> {
    const token = assertRoomRouteToken(roomId)
    const generation = assertGeneratedId(expectedRoomGeneration, 'roomGeneration')
    const room = this.rooms.get(token)
    if (!room) throw new Error('room_not_found')
    if (room.roomGeneration !== generation) throw new Error('room_generation_conflict')
    if (room.lifecycle !== 'active') throw new Error('room_destroying')

    room.lifecycle = 'destroying'
    room.abortController.abort(new Error('room_destroying'))
    const operation = this.finishDestroy(room)
    this.destroying.set(room.roomId, operation)
    try { await operation } finally { this.destroying.delete(room.roomId) }
  }

  private async finishDestroy(room: RoomRuntime): Promise<void> {
    try {
      await this.destroyHook(room.roomId, room.roomGeneration, room.abortController.signal)
    } catch {
      // Room destruction must continue even if best-effort provenance cleanup fails.
    }
    while (room.tickets.size > 0) await new Promise((resolveWait) => setTimeout(resolveWait, 0))
    for (const terminal of room.terminals.values()) {
      this.cancelCwdRefresh(terminal)
      this.beginBackendClose(room, terminal.backend)
    }
    await Promise.allSettled([...room.closingBackends])
    room.terminals.clear()
    room.store.terminalOrder.splice(0)
    const message: ServerMessage = { type: 'room_destroyed', roomId: room.roomId, roomGeneration: room.roomGeneration }
    for (const client of [...room.clients.values()]) {
      try { client.send(message) } catch {}
      try { client.close?.(4001, 'room_destroyed') } catch {}
      this.clients.delete(client.clientId)
    }
    room.clients.clear()
    room.lifecycle = 'destroyed'
    this.rooms.delete(room.roomId)
  }

  async destroyAllRooms(): Promise<void> {
    const targets = [...this.rooms.values()].filter((room) => room.lifecycle === 'active')
    const started = targets.map(async (room) => await this.destroyRoom(room.roomId, room.roomGeneration))
    await Promise.allSettled([...started, ...this.destroying.values()])
  }

  private createRoomWithToken(roomId: string): RoomSummary {
    if (this.rooms.has(roomId)) throw new Error('room_id_conflict')
    const roomGeneration = this.nextRoomGeneration()
    const room: RoomRuntime = {
      roomId,
      roomGeneration,
      lifecycle: 'active',
      roomRevision: 0,
      store: new RoomTerminalStore(),
      terminals: new Map(),
      clients: new Map(),
      abortController: new AbortController(),
      tickets: new Set(),
      closingBackends: new Set(),
    }
    this.rooms.set(roomId, room)
    return this.roomSummary(room)
  }

  private assertCapacity(): void {
    if (this.rooms.size >= MAX_LIVE_ROOMS) throw new Error('room_capacity_reached')
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

  private activeRoomOrThrow(roomId: string): RoomRuntime {
    const room = this.roomOrThrow(roomId)
    if (room.lifecycle === 'destroying') throw new Error('room_destroying')
    if (room.lifecycle !== 'active') throw new Error('room_not_found')
    return room
  }

  private roomOrThrow(roomId: string): RoomRuntime {
    const room = this.rooms.get(assertRoomRouteToken(roomId))
    if (!room || room.lifecycle === 'destroyed') throw new Error('room_not_found')
    return room
  }

  private terminalOrThrow(room: RoomRuntime, terminalId: string): TerminalSlot {
    const normalized = assertGeneratedId(terminalId, 'terminal')
    const terminal = room.terminals.get(normalized)
    if (!terminal) throw new Error('terminal_not_found:' + room.roomId + ':' + normalized)
    return terminal
  }

  private nextTerminalId(room: RoomRuntime): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = assertGeneratedId(this.terminalIdFactory(), 'terminal')
      if (!room.terminals.has(id)) return id
    }
    throw new Error('terminal_id_collision')
  }

  private nextLaunchId(room: RoomRuntime): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = assertGeneratedId(this.launchIdFactory(), 'terminalLaunch')
      if (![...room.terminals.values()].some((terminal) => terminal.launchId === id)) return id
    }
    throw new Error('terminal_launch_id_collision')
  }

  private nextRoomGeneration(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = assertGeneratedId(this.roomGenerationFactory(), 'roomGeneration')
      if (![...this.rooms.values()].some((room) => room.roomGeneration === id)) return id
    }
    throw new Error('room_generation_id_collision')
  }

  private emitOutput(terminal: TerminalSlot, data: string): void {
    if (!this.isCurrentTerminal(terminal)) return
    const room = this.rooms.get(terminal.roomId)!
    this.appendReplay(terminal, data)
    this.advanceTerminalRevision(room, terminal, { outputActivity: true })
    this.broadcast(room, {
      type: 'pty_output',
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      terminalId: terminal.terminalId,
      launchId: terminal.launchId,
      data,
      source: 'pty',
      ...this.revisionFields(room, terminal),
    })
    this.scheduleCwdRefresh(terminal)
  }

  private appendReplay(terminal: TerminalSlot, data: string): void {
    const dataBytes = Buffer.byteLength(data)
    if (terminal.backendKind === 'text') {
      terminal.replay.push(data)
      terminal.replayBytes += dataBytes
      return
    }
    if (dataBytes > this.replayByteLimit) {
      const tail = utf8Tail(data, this.replayByteLimit)
      terminal.replay = tail.length > 0 ? [tail] : []
      terminal.replayStart = 0
      terminal.replayBytes = Buffer.byteLength(tail)
      terminal.replayDiscardedBytes = 0
      return
    }
    terminal.replay.push(data)
    terminal.replayBytes += dataBytes
    while (terminal.replayBytes > this.replayByteLimit && terminal.replayStart < terminal.replay.length) {
      const discardedBytes = Buffer.byteLength(terminal.replay[terminal.replayStart])
      terminal.replayBytes -= discardedBytes
      terminal.replayDiscardedBytes += discardedBytes
      terminal.replayStart += 1
    }
    this.compactReplay(terminal)
  }

  private replayChunks(terminal: TerminalSlot): string[] {
    return terminal.replay.slice(terminal.replayStart)
  }

  private compactReplay(terminal: TerminalSlot): void {
    if (terminal.replayStart === 0) return
    const bounded = terminal.replayDiscardedBytes < this.replayByteLimit
    const sparse = terminal.replayStart < REPLAY_COMPACT_THRESHOLD || terminal.replayStart * 2 < terminal.replay.length
    if (bounded && sparse) return
    terminal.replay = terminal.replay.slice(terminal.replayStart)
    terminal.replayStart = 0
    terminal.replayDiscardedBytes = 0
  }

  private markClosed(terminal: TerminalSlot, exitCode: number | null, signal: string | null): void {
    if (!this.isCurrentTerminal(terminal)) return
    this.cancelCwdRefresh(terminal)
    terminal.status = 'closed'
    terminal.exitCode = exitCode
    terminal.signal = signal
    const room = this.rooms.get(terminal.roomId)!
    this.advanceTerminalRevision(room, terminal)
    this.broadcast(room, this.stateMessage(terminal))
  }

  private markFailed(terminal: TerminalSlot, error: Error): void {
    if (!this.isCurrentTerminal(terminal)) return
    this.cancelCwdRefresh(terminal)
    terminal.status = 'failed'
    const room = this.rooms.get(terminal.roomId)!
    this.broadcast(room, { type: 'terminal_error', roomId: room.roomId, roomGeneration: room.roomGeneration, terminalId: terminal.terminalId, reason: error.message })
    this.advanceTerminalRevision(room, terminal)
    this.broadcast(room, this.stateMessage(terminal))
  }

  private stateMessage(terminal: TerminalSlot): ServerMessage {
    return {
      type: 'terminal_state',
      roomId: terminal.roomId,
      roomGeneration: terminal.roomGeneration,
      terminalId: terminal.terminalId,
      launchId: terminal.launchId,
      status: terminal.status,
      cols: terminal.cols,
      rows: terminal.rows,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      ...this.revisionFields(this.rooms.get(terminal.roomId)!, terminal),
    }
  }

  private resolveCreateCwd(room: RoomRuntime, options: CreateTerminalOptions): string {
    if (options.cwdSource === undefined) return resolveShellCwd(options.cwd ?? this.homeDirectory)
    if (options.cwdSource !== 'last-shell') throw new Error('invalid_terminal_cwd_source')
    for (let index = room.store.terminalOrder.length - 1; index >= 0; index -= 1) {
      const terminal = this.terminalOrThrow(room, room.store.terminalOrder[index])
      if (terminal.backendKind === 'text' || terminal.status !== 'running') continue
      return this.refreshTerminalCwd(terminal, true) ?? this.homeDirectory
    }
    return this.homeDirectory
  }

  private scheduleCwdRefresh(terminal: TerminalSlot): void {
    if (!terminal.backend.currentCwd || terminal.backendKind === 'text') return
    this.cancelCwdRefresh(terminal)
    terminal.cwdRefreshTimer = setTimeout(() => {
      terminal.cwdRefreshTimer = null
      if (this.isCurrentTerminal(terminal)) this.refreshTerminalCwd(terminal, true)
    }, CWD_REFRESH_DEBOUNCE_MS)
  }

  private cancelCwdRefresh(terminal: TerminalSlot): void {
    if (terminal.cwdRefreshTimer === null) return
    clearTimeout(terminal.cwdRefreshTimer)
    terminal.cwdRefreshTimer = null
  }

  private refreshTerminalCwd(terminal: TerminalSlot, publish: boolean): string | null {
    if (terminal.backendKind === 'text' || !terminal.backend.currentCwd) return null
    let observed: string | null
    try { observed = terminal.backend.currentCwd() }
    catch { return null }
    if (observed === null) return null
    let cwd: string
    try { cwd = resolveShellCwd(observed) }
    catch { return null }
    if (terminal.cwd === cwd) return cwd
    terminal.cwd = cwd
    if (this.isCurrentTerminal(terminal)) {
      const room = this.rooms.get(terminal.roomId)!
      this.advanceTerminalRevision(room, terminal)
      if (publish) {
        this.broadcast(room, {
          type: 'terminal_cwd',
          roomId: room.roomId,
          roomGeneration: room.roomGeneration,
          terminalId: terminal.terminalId,
          launchId: terminal.launchId,
          cwd,
          ...this.revisionFields(room, terminal),
        })
      }
    }
    return cwd
  }

  private broadcastIndexMap(room: RoomRuntime): void {
    this.broadcast(room, { type: 'terminal_index_map', roomId: room.roomId, roomGeneration: room.roomGeneration, roomRevision: room.roomRevision, items: room.store.indexMap() })
  }

  private advanceTerminalRevision(
    room: RoomRuntime,
    terminal: TerminalSlot,
    options: { text?: boolean; outputActivity?: boolean } = {},
  ): void {
    room.roomRevision += 1
    terminal.terminalRevision += 1
    if (options.text) terminal.textRevision += 1
    if (options.outputActivity) terminal.outputActivityRevision += 1
  }

  private revisionFields(room: RoomRuntime, terminal: TerminalSlot) {
    return {
      roomRevision: room.roomRevision,
      terminalRevision: terminal.terminalRevision,
      textRevision: terminal.textRevision,
      outputActivityRevision: terminal.outputActivityRevision,
    }
  }

  private broadcast(room: RoomRuntime, message: ServerMessage): void {
    if (room.lifecycle !== 'active') return
    for (const client of [...room.clients.values()]) {
      try { client.send(message) }
      catch { this.disconnectClient(client.clientId) }
    }
  }

  private isCurrentTerminal(terminal: TerminalSlot): boolean {
    const room = this.rooms.get(terminal.roomId)
    return room?.lifecycle === 'active' && room.roomGeneration === terminal.roomGeneration && room.terminals.get(terminal.terminalId) === terminal
  }

  private beginBackendClose(room: RoomRuntime | undefined, backend: TerminalBackend): Promise<void> {
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
}

export function resolveShellCwd(value = process.env.HOME): string {
  if (!value || !isAbsolute(value)) throw new Error('shell_cwd_must_be_absolute')
  const cwd = resolve(value)
  let info
  try {
    info = statSync(cwd)
    accessSync(cwd, fsConstants.R_OK | fsConstants.X_OK)
  } catch {
    throw new Error('shell_cwd_not_accessible:' + cwd)
  }
  if (!info.isDirectory()) throw new Error('shell_cwd_not_directory:' + cwd)
  return cwd
}

function utf8Tail(data: string, maxBytes: number): string {
  const encoded = Buffer.from(data)
  let start = Math.max(0, encoded.length - maxBytes)
  while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) start += 1
  return encoded.subarray(start).toString('utf8')
}

export function defaultBackendFactory(kind: TerminalBackendKind, options: Parameters<TerminalBackendFactory>[1]): TerminalBackend {
  if (kind === 'fake') return new FakeTerminalBackend(options)
  if (kind === 'text') return new TextBoxBackend(options)
  return new RealPtyBackend(options)
}
