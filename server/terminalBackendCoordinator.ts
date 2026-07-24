import { assertGeneratedId } from '../src/lib/generatedId'
import type { RoomSnapshot, ServerMessage, TerminalBackendKind, TerminalSnapshot } from '../src/lib/protocol'
import { normalizeTerminalRef, type TerminalRef } from '../src/lib/terminalIdentity'
import {
  applyTextTerminalMutation,
  type TextTerminalMutation,
} from '../src/lib/textTerminalMutation'
import { FakeTerminalBackend } from './fakeTerminalBackend'
import { RealPtyBackend } from './realPtyBackend'
import type {
  RoomOperationTicket,
  RoomRuntime,
} from './roomLifecycleCoordinator'
import type { TerminalBackend, TerminalBackendFactory } from './terminalBackend'
import { TerminalBackendLifecycle } from './terminalBackendLifecycle'
import {
  resolveShellCwd,
  TerminalCwdCoordinator,
} from './terminalCwdCoordinator'
import { TextBoxBackend } from './textBoxBackend'
import {
  assertTerminalStructureMutable,
  commitTerminalClose,
  commitTerminalCreate,
  commitTerminalRestart,
} from './terminalMutationCoordinator'
import { replaceTerminalReplay } from './terminalReplayBuffer'
import {
  advanceTerminalRuntimeRevision,
  createTerminalRuntimeState,
  restartTerminalRuntimeState,
  type TerminalSlot,
} from './terminalRuntimeState'
import {
  projectRoomSnapshot,
  projectTerminalIndexMapMessage,
  projectTerminalSnapshot,
  projectTerminalStateMessage,
  projectTerminalTextSnapshotMessage,
} from './terminalSnapshotProjection'
import { textTerminalHash } from './textTerminalHash'

export { resolveShellCwd }

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
  private readonly backendLifecycle: TerminalBackendLifecycle
  private readonly cwdCoordinator: TerminalCwdCoordinator

  constructor(private readonly options: TerminalBackendCoordinatorOptions) {
    this.cwdCoordinator = new TerminalCwdCoordinator({
      rooms: options.rooms,
      homeDirectory: options.homeDirectory,
      terminalOrThrow: (room, terminalId) => this.terminalOrThrow(room, terminalId),
      advanceTerminalRevision: (room, terminal) => this.advanceTerminalRevision(room, terminal),
      broadcast: options.broadcast,
    })
    this.backendLifecycle = new TerminalBackendLifecycle({
      rooms: options.rooms,
      replayByteLimit: options.replayByteLimit,
      broadcast: options.broadcast,
      advanceTerminalRevision: (room, terminal, revisionOptions) => {
        this.advanceTerminalRevision(room, terminal, revisionOptions)
      },
      scheduleCwdRefresh: (terminal) => this.cwdCoordinator.scheduleCwdRefresh(terminal),
      cancelCwdRefresh: (terminal) => this.cwdCoordinator.cancelCwdRefresh(terminal),
    })
  }

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
      const cwd = backendKind === 'text' ? null : this.cwdCoordinator.resolveCreateCwd(room, options)
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
      backend = this.options.backendFactory(backendKind, {
        cols,
        rows,
        cwd: cwd ?? undefined,
        ...context,
        env: this.terminalEnvProvider(context),
      })
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
      const candidate = this.backendLifecycle.startCandidate(terminal)
      ticket.assertActive()
      this.backendLifecycle.assertCandidateReady(candidate)
      commitTerminalCreate(room, terminal, options.insertAtIndex)
      this.backendLifecycle.commitCandidate(candidate)
      terminal.status = 'running'
      this.options.broadcast(room, this.terminalSnapshot(terminal))
      this.broadcastIndexMap(room)
      this.backendLifecycle.flushCandidate(candidate)
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

  mutateTextContent(
    roomId: string,
    ref: TerminalRef | string | number,
    expectedTextRevision: number,
    mutation: TextTerminalMutation,
    resultHash: string,
  ) {
    const ticket = this.options.admit(roomId)
    try {
      const room = this.options.roomOrThrow(roomId)
      const terminal = this.resolveTerminal(roomId, ref)
      if (terminal.backendKind !== 'text') throw new Error('terminal_not_text_box:' + terminal.terminalId)
      if (terminal.textRevision !== expectedTextRevision) {
        return { ok: false as const, reason: 'text_revision_conflict' as const, terminal }
      }
      let content: string
      try {
        content = applyTextTerminalMutation(terminal.replay.join(''), mutation)
      } catch {
        return { ok: false as const, reason: 'invalid_text_patch' as const, terminal }
      }
      const verifiedHash = textTerminalHash(content)
      if (verifiedHash !== resultHash) {
        return { ok: false as const, reason: 'text_result_hash_mismatch' as const, terminal }
      }
      replaceTerminalReplay(terminal, content)
      terminal.contentHash = verifiedHash
      this.advanceTerminalRevision(room, terminal, { text: true, outputActivity: true })
      this.options.broadcast(room, {
        type: 'terminal_text_mutation',
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        terminalId: terminal.terminalId,
        launchId: terminal.launchId,
        mutation,
        resultHash: verifiedHash,
        roomRevision: room.roomRevision,
        terminalRevision: terminal.terminalRevision,
        textRevision: terminal.textRevision,
        outputActivityRevision: terminal.outputActivityRevision,
      })
      return { ok: true as const, terminal }
    } finally {
      ticket.finish()
    }
  }

  textSnapshot(roomId: string, ref: TerminalRef | string | number): ServerMessage {
    const room = this.options.activeRoomOrThrow(roomId)
    return projectTerminalTextSnapshotMessage(room, this.resolveTerminal(roomId, ref))
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
      backend = this.options.backendFactory(nextBackendKind, {
        cols: oldTerminal.cols,
        rows: oldTerminal.rows,
        cwd: cwd ?? undefined,
        ...context,
        env: this.terminalEnvProvider(context),
      })
      const nextTerminal = restartTerminalRuntimeState(oldTerminal, {
        launchId,
        backend,
        backendKind: nextBackendKind,
        cwd,
      })
      const candidate = this.backendLifecycle.startCandidate(nextTerminal)
      ticket.assertActive()
      this.backendLifecycle.assertCandidateReady(candidate)
      this.cancelCwdRefresh(oldTerminal)
      this.beginBackendClose(room, oldTerminal.backend)
      commitTerminalRestart(room, nextTerminal)
      this.backendLifecycle.commitCandidate(candidate)
      nextTerminal.status = 'running'
      this.options.broadcast(room, this.terminalSnapshot(nextTerminal))
      this.broadcastIndexMap(room)
      this.backendLifecycle.flushCandidate(candidate)
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
      this.cwdCoordinator.refreshTerminalCwd(this.terminalOrThrow(room, terminalId), true)
    }
    return projectRoomSnapshot(room)
  }

  broadcastIndexMap(room: RoomRuntime): void {
    this.options.broadcast(room, projectTerminalIndexMapMessage(room))
  }

  cancelCwdRefresh(terminal: TerminalSlot): void {
    this.cwdCoordinator.cancelCwdRefresh(terminal)
  }

  beginBackendClose(room: RoomRuntime | undefined, backend: TerminalBackend): Promise<void> {
    return this.backendLifecycle.beginBackendClose(room, backend)
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

  private advanceTerminalRevision(
    room: RoomRuntime,
    terminal: TerminalSlot,
    options: { text?: boolean; outputActivity?: boolean } = {},
  ): void {
    room.roomRevision += 1
    advanceTerminalRuntimeRevision(terminal, options)
  }
}

export function defaultBackendFactory(kind: TerminalBackendKind, options: Parameters<TerminalBackendFactory>[1]): TerminalBackend {
  if (kind === 'fake') return new FakeTerminalBackend(options)
  if (kind === 'text') return new TextBoxBackend(options)
  return new RealPtyBackend(options)
}
