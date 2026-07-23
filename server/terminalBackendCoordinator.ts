import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { assertGeneratedId } from '../src/lib/generatedId'
import type { RoomSnapshot, ServerMessage, TerminalBackendKind, TerminalSnapshot } from '../src/lib/protocol'
import { normalizeTerminalRef, type TerminalRef } from '../src/lib/terminalIdentity'
import { FakeTerminalBackend } from './fakeTerminalBackend'
import { RealPtyBackend } from './realPtyBackend'
import {
  beginRoomBackendClose,
  type RoomOperationTicket,
  type RoomRuntime,
} from './roomLifecycleCoordinator'
import { TextBoxBackend } from './textBoxBackend'
import type { TerminalBackend, TerminalBackendFactory } from './terminalBackend'
import {
  assertTerminalStructureMutable,
  commitTerminalClose,
  commitTerminalCreate,
  commitTerminalRestart,
} from './terminalMutationCoordinator'
import {
  appendTerminalReplay,
  replaceTerminalReplay,
} from './terminalReplayBuffer'
import {
  advanceTerminalRuntimeRevision,
  createTerminalRuntimeState,
  markTerminalRuntimeClosed,
  markTerminalRuntimeFailed,
  restartTerminalRuntimeState,
  type TerminalSlot,
} from './terminalRuntimeState'
import {
  projectRoomSnapshot,
  projectTerminalIndexMapMessage,
  projectTerminalSnapshot,
  projectTerminalStateMessage,
  terminalRevisionFields,
} from './terminalSnapshotProjection'

const CWD_REFRESH_DEBOUNCE_MS = 60

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
  insertAtIndex?: number
}

type TerminalBackendCoordinatorOptions = {
  rooms: Map<string, RoomRuntime>
  replayByteLimit: number
  backendFactory: TerminalBackendFactory
  serverInstanceId: string
  homeDirectory: string
  terminalIdFactory: () => string
  launchIdFactory: () => string
  admit(roomId: string): RoomOperationTicket
  activeRoomOrThrow(roomId: string): RoomRuntime
  roomOrThrow(roomId: string): RoomRuntime
  broadcast(room: RoomRuntime, message: ServerMessage): void
}

export class TerminalBackendCoordinator {
  private terminalEnvProvider: (context: TerminalRuntimeContext) => Record<string, string | undefined> = () => ({})

  constructor(private readonly options: TerminalBackendCoordinatorOptions) {}

  setTerminalEnvProvider(provider: (context: TerminalRuntimeContext) => Record<string, string | undefined>): void {
    this.terminalEnvProvider = provider
  }

  createTerminal(roomId: string, options: CreateTerminalOptions = {}): TerminalSnapshot {
    const ticket = this.options.admit(roomId)
    let room: RoomRuntime | undefined
    let backend: TerminalBackend | undefined
    try {
      room = this.options.activeRoomOrThrow(roomId)
      assertTerminalStructureMutable(room)
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
        serverInstanceId: this.options.serverInstanceId,
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        terminalId,
        launchId,
      }
      backend = this.options.backendFactory(backendKind, { cols, rows, cwd: cwd ?? undefined, ...context, env: this.terminalEnvProvider(context) })
      const terminal = createTerminalRuntimeState({
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        terminalId,
        launchId,
        backend,
        backendKind,
        cwd,
        cols,
        rows,
      })
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
      if (pendingError) throw pendingError
      commitTerminalCreate(room, terminal, options.insertAtIndex)
      committed = true
      terminal.status = 'running'
      this.options.broadcast(room, this.terminalSnapshot(terminal))
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
    const ticket = this.options.admit(roomId)
    try {
      const terminal = this.resolveTerminal(roomId, ref)
      if (terminal.status !== 'running') {
        const room = this.options.roomOrThrow(roomId)
        this.options.broadcast(room, { type: 'input_rejected', roomId: room.roomId, roomGeneration: room.roomGeneration, terminalId: terminal.terminalId, reason: 'not_running' })
        return { ok: false as const, reason: 'not_running' }
      }
      terminal.backend.write(data)
      return { ok: true as const }
    } finally {
      ticket.finish()
    }
  }

  setTextContent(roomId: string, ref: TerminalRef | string | number, content: string) {
    const ticket = this.options.admit(roomId)
    try {
      const room = this.options.roomOrThrow(roomId)
      const terminal = this.resolveTerminal(roomId, ref)
      if (terminal.backendKind !== 'text') throw new Error('terminal_not_text_box:' + terminal.terminalId)
      replaceTerminalReplay(terminal, content)
      this.advanceTerminalRevision(room, terminal, { text: true, outputActivity: true })
      this.options.broadcast(room, this.terminalSnapshot(terminal))
      return { ok: true as const }
    } finally {
      ticket.finish()
    }
  }

  resize(roomId: string, ref: TerminalRef | string | number, cols: number, rows: number) {
    const ticket = this.options.admit(roomId)
    try {
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) throw new Error('invalid_terminal_size')
      const room = this.options.roomOrThrow(roomId)
      const terminal = this.resolveTerminal(roomId, ref)
      terminal.cols = cols
      terminal.rows = rows
      terminal.backend.resize(cols, rows)
      this.advanceTerminalRevision(room, terminal)
      this.options.broadcast(room, projectTerminalStateMessage(room, terminal))
      return { ok: true as const }
    } finally {
      ticket.finish()
    }
  }

  resetTerminal(roomId: string, ref: TerminalRef | string | number, backendKind?: TerminalBackendKind, fail = false) {
    const ticket = this.options.admit(roomId)
    let room: RoomRuntime | undefined
    let backend: TerminalBackend | undefined
    try {
      room = this.options.roomOrThrow(roomId)
      assertTerminalStructureMutable(room)
      const oldTerminal = this.resolveTerminal(roomId, ref)
      if (fail) return { ok: false as const, reason: 'backend_unavailable' }
      const nextBackendKind = backendKind ?? oldTerminal.backendKind
      const cwd = nextBackendKind === 'text' ? null : oldTerminal.cwd ?? this.options.homeDirectory
      const launchId = this.nextLaunchId(room)
      const context: TerminalRuntimeContext = {
        serverInstanceId: this.options.serverInstanceId,
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        terminalId: oldTerminal.terminalId,
        launchId,
      }
      backend = this.options.backendFactory(nextBackendKind, { cols: oldTerminal.cols, rows: oldTerminal.rows, cwd: cwd ?? undefined, ...context, env: this.terminalEnvProvider(context) })
      const nextTerminal = restartTerminalRuntimeState(oldTerminal, {
        launchId,
        backend,
        backendKind: nextBackendKind,
        cwd,
      })
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
      if (pendingError) throw pendingError
      this.cancelCwdRefresh(oldTerminal)
      this.beginBackendClose(room, oldTerminal.backend)
      commitTerminalRestart(room, nextTerminal)
      committed = true
      nextTerminal.status = 'running'
      this.options.broadcast(room, this.terminalSnapshot(nextTerminal))
      this.broadcastIndexMap(room)
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

  closeTerminal(roomId: string, ref: TerminalRef | string | number) {
    const ticket = this.options.admit(roomId)
    try {
      const room = this.options.roomOrThrow(roomId)
      assertTerminalStructureMutable(room)
      const terminal = this.resolveTerminal(roomId, ref)
      this.cancelCwdRefresh(terminal)
      this.beginBackendClose(room, terminal.backend)
      commitTerminalClose(room, terminal.terminalId)
      this.broadcastIndexMap(room)
      this.options.broadcast(room, this.roomSnapshot(room))
      return { ok: true as const }
    } finally {
      ticket.finish()
    }
  }

  resolveTerminal(roomId: string, ref: TerminalRef | string | number): TerminalSlot {
    const normalized = normalizeTerminalRef(ref)
    const room = this.options.activeRoomOrThrow(roomId)
    const terminalId = normalized.kind === 'id'
      ? normalized.value
      : room.store.terminalIdAt(normalized.value)
    return this.terminalOrThrow(room, terminalId)
  }

  terminalOrThrow(room: RoomRuntime, terminalId: string): TerminalSlot {
    const normalized = assertGeneratedId(terminalId, 'terminal')
    const terminal = room.terminals.get(normalized)
    if (!terminal) throw new Error('terminal_not_found:' + room.roomId + ':' + normalized)
    return terminal
  }

  terminalSnapshot(terminal: TerminalSlot): TerminalSnapshot {
    const room = this.options.roomOrThrow(terminal.roomId)
    return projectTerminalSnapshot(room, terminal)
  }

  roomSnapshot(room: RoomRuntime): RoomSnapshot {
    for (const terminalId of room.store.terminalOrder) {
      this.refreshTerminalCwd(this.terminalOrThrow(room, terminalId), true)
    }
    return projectRoomSnapshot(room)
  }

  broadcastIndexMap(room: RoomRuntime): void {
    this.options.broadcast(room, projectTerminalIndexMapMessage(room))
  }

  cancelCwdRefresh(terminal: TerminalSlot): void {
    if (terminal.cwdRefreshTimer === null) return
    clearTimeout(terminal.cwdRefreshTimer)
    terminal.cwdRefreshTimer = null
  }

  beginBackendClose(room: RoomRuntime | undefined, backend: TerminalBackend): Promise<void> {
    return beginRoomBackendClose(room, backend)
  }

  private nextTerminalId(room: RoomRuntime): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = assertGeneratedId(this.options.terminalIdFactory(), 'terminal')
      if (!room.terminals.has(id)) return id
    }
    throw new Error('terminal_id_collision')
  }

  private nextLaunchId(room: RoomRuntime): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = assertGeneratedId(this.options.launchIdFactory(), 'terminalLaunch')
      if (![...room.terminals.values()].some((terminal) => terminal.launchId === id)) return id
    }
    throw new Error('terminal_launch_id_collision')
  }

  private emitOutput(terminal: TerminalSlot, data: string): void {
    if (!this.isCurrentTerminal(terminal)) return
    const room = this.options.rooms.get(terminal.roomId)!
    appendTerminalReplay(terminal, data, this.options.replayByteLimit)
    this.advanceTerminalRevision(room, terminal, { outputActivity: true })
    this.options.broadcast(room, {
      type: 'pty_output',
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      terminalId: terminal.terminalId,
      launchId: terminal.launchId,
      data,
      source: 'pty',
      ...terminalRevisionFields(room, terminal),
    })
    this.scheduleCwdRefresh(terminal)
  }

  private markClosed(terminal: TerminalSlot, exitCode: number | null, signal: string | null): void {
    if (!this.isCurrentTerminal(terminal)) return
    this.cancelCwdRefresh(terminal)
    markTerminalRuntimeClosed(terminal, exitCode, signal)
    const room = this.options.rooms.get(terminal.roomId)!
    this.advanceTerminalRevision(room, terminal)
    this.options.broadcast(room, projectTerminalStateMessage(room, terminal))
  }

  private markFailed(terminal: TerminalSlot, error: Error): void {
    if (!this.isCurrentTerminal(terminal)) return
    this.cancelCwdRefresh(terminal)
    markTerminalRuntimeFailed(terminal)
    const room = this.options.rooms.get(terminal.roomId)!
    this.options.broadcast(room, { type: 'terminal_error', roomId: room.roomId, roomGeneration: room.roomGeneration, terminalId: terminal.terminalId, reason: error.message })
    this.advanceTerminalRevision(room, terminal)
    this.options.broadcast(room, projectTerminalStateMessage(room, terminal))
  }

  private resolveCreateCwd(room: RoomRuntime, options: CreateTerminalOptions): string {
    if (options.cwdSource === undefined) return resolveShellCwd(options.cwd ?? this.options.homeDirectory)
    if (options.cwdSource !== 'last-shell') throw new Error('invalid_terminal_cwd_source')
    for (let index = room.store.terminalOrder.length - 1; index >= 0; index -= 1) {
      const terminal = this.terminalOrThrow(room, room.store.terminalOrder[index])
      if (terminal.backendKind === 'text' || terminal.status !== 'running') continue
      return this.refreshTerminalCwd(terminal, true) ?? this.options.homeDirectory
    }
    return this.options.homeDirectory
  }

  private scheduleCwdRefresh(terminal: TerminalSlot): void {
    if (!terminal.backend.currentCwd || terminal.backendKind === 'text') return
    this.cancelCwdRefresh(terminal)
    terminal.cwdRefreshTimer = setTimeout(() => {
      terminal.cwdRefreshTimer = null
      if (this.isCurrentTerminal(terminal)) this.refreshTerminalCwd(terminal, true)
    }, CWD_REFRESH_DEBOUNCE_MS)
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
      const room = this.options.rooms.get(terminal.roomId)!
      this.advanceTerminalRevision(room, terminal)
      if (publish) {
        this.options.broadcast(room, {
          type: 'terminal_cwd',
          roomId: room.roomId,
          roomGeneration: room.roomGeneration,
          terminalId: terminal.terminalId,
          launchId: terminal.launchId,
          cwd,
          ...terminalRevisionFields(room, terminal),
        })
      }
    }
    return cwd
  }

  private advanceTerminalRevision(
    room: RoomRuntime,
    terminal: TerminalSlot,
    options: { text?: boolean; outputActivity?: boolean } = {},
  ): void {
    room.roomRevision += 1
    advanceTerminalRuntimeRevision(terminal, options)
  }

  private isCurrentTerminal(terminal: TerminalSlot): boolean {
    const room = this.options.rooms.get(terminal.roomId)
    return room?.lifecycle === 'active' && room.roomGeneration === terminal.roomGeneration && room.terminals.get(terminal.terminalId) === terminal
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

export function defaultBackendFactory(kind: TerminalBackendKind, options: Parameters<TerminalBackendFactory>[1]): TerminalBackend {
  if (kind === 'fake') return new FakeTerminalBackend(options)
  if (kind === 'text') return new TextBoxBackend(options)
  return new RealPtyBackend(options)
}
