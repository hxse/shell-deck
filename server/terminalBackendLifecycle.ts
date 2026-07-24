import type { ServerMessage } from '../src/lib/protocol'
import {
  beginRoomBackendClose,
  type RoomRuntime,
} from './roomLifecycleCoordinator'
import type { TerminalBackend } from './terminalBackend'
import { appendTerminalReplay, replaceTerminalReplay } from './terminalReplayBuffer'
import {
  markTerminalRuntimeClosed,
  markTerminalRuntimeFailed,
  type TerminalSlot,
} from './terminalRuntimeState'
import {
  projectTerminalStateMessage,
  terminalRevisionFields,
} from './terminalSnapshotProjection'
import { textTerminalHash } from './textTerminalHash'

export type TerminalBackendCandidate = {
  terminal: TerminalSlot
  committed: boolean
  pendingData: string[]
  pendingExit: { exitCode: number | null; signal: string | null } | undefined
  pendingError: Error | undefined
}

type TerminalBackendLifecycleOptions = {
  rooms: Map<string, RoomRuntime>
  replayByteLimit: number
  broadcast(room: RoomRuntime, message: ServerMessage): void
  advanceTerminalRevision(
    room: RoomRuntime,
    terminal: TerminalSlot,
    options?: { text?: boolean; outputActivity?: boolean },
  ): void
  scheduleCwdRefresh(terminal: TerminalSlot): void
  cancelCwdRefresh(terminal: TerminalSlot): void
}

export class TerminalBackendLifecycle {
  constructor(private readonly options: TerminalBackendLifecycleOptions) {}

  startCandidate(terminal: TerminalSlot): TerminalBackendCandidate {
    const candidate: TerminalBackendCandidate = {
      terminal,
      committed: false,
      pendingData: [],
      pendingExit: undefined,
      pendingError: undefined,
    }
    terminal.backend.start({
      onData: (data) => candidate.committed ? this.emitOutput(terminal, data) : candidate.pendingData.push(data),
      onExit: (exitCode, signal) => candidate.committed
        ? this.markClosed(terminal, exitCode, signal)
        : candidate.pendingExit = { exitCode, signal },
      onError: (error) => candidate.committed ? this.markFailed(terminal, error) : candidate.pendingError = error,
    })
    return candidate
  }

  assertCandidateReady(candidate: TerminalBackendCandidate): void {
    if (candidate.pendingError) throw candidate.pendingError
  }

  commitCandidate(candidate: TerminalBackendCandidate): void {
    candidate.committed = true
  }

  flushCandidate(candidate: TerminalBackendCandidate): void {
    for (const data of candidate.pendingData) this.emitOutput(candidate.terminal, data)
    if (candidate.pendingError) this.markFailed(candidate.terminal, candidate.pendingError)
    if (candidate.pendingExit) {
      this.markClosed(candidate.terminal, candidate.pendingExit.exitCode, candidate.pendingExit.signal)
    }
  }

  beginBackendClose(room: RoomRuntime | undefined, backend: TerminalBackend): Promise<void> {
    return beginRoomBackendClose(room, backend)
  }

  private emitOutput(terminal: TerminalSlot, data: string): void {
    if (!isCurrentTerminal(this.options.rooms, terminal)) return
    const room = this.options.rooms.get(terminal.roomId)!
    if (terminal.backendKind === 'text') {
      const base = terminal.replay.join('')
      const content = base + data
      replaceTerminalReplay(terminal, content)
      terminal.contentHash = textTerminalHash(content)
      this.options.advanceTerminalRevision(room, terminal, { text: true, outputActivity: true })
      this.options.broadcast(room, {
        type: 'terminal_text_mutation',
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        terminalId: terminal.terminalId,
        launchId: terminal.launchId,
        mutation: { kind: 'patch', start: base.length, deleteCount: 0, insert: data },
        resultHash: terminal.contentHash,
        ...terminalRevisionFields(room, terminal),
      })
      return
    }
    appendTerminalReplay(terminal, data, this.options.replayByteLimit)
    this.options.advanceTerminalRevision(room, terminal, { outputActivity: true })
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
    this.options.scheduleCwdRefresh(terminal)
  }

  private markClosed(terminal: TerminalSlot, exitCode: number | null, signal: string | null): void {
    if (!isCurrentTerminal(this.options.rooms, terminal)) return
    this.options.cancelCwdRefresh(terminal)
    markTerminalRuntimeClosed(terminal, exitCode, signal)
    const room = this.options.rooms.get(terminal.roomId)!
    this.options.advanceTerminalRevision(room, terminal)
    this.options.broadcast(room, projectTerminalStateMessage(room, terminal))
  }

  private markFailed(terminal: TerminalSlot, error: Error): void {
    if (!isCurrentTerminal(this.options.rooms, terminal)) return
    this.options.cancelCwdRefresh(terminal)
    markTerminalRuntimeFailed(terminal)
    const room = this.options.rooms.get(terminal.roomId)!
    this.options.broadcast(room, {
      type: 'terminal_error',
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      terminalId: terminal.terminalId,
      reason: error.message,
    })
    this.options.advanceTerminalRevision(room, terminal)
    this.options.broadcast(room, projectTerminalStateMessage(room, terminal))
  }
}

export function isCurrentTerminal(rooms: Map<string, RoomRuntime>, terminal: TerminalSlot): boolean {
  const room = rooms.get(terminal.roomId)
  return room?.lifecycle === 'active'
    && room.roomGeneration === terminal.roomGeneration
    && room.terminals.get(terminal.terminalId) === terminal
}
