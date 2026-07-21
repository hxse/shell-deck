import { assertGeneratedId } from '../src/lib/generatedId'
import type {
  RoomSnapshot,
  ServerMessage,
  TerminalRevisionFields,
  TerminalRuntimePosition,
  TerminalSnapshot,
  TerminalType,
} from '../src/lib/protocol'
import type { RoomRuntime } from './roomLifecycleCoordinator'
import { terminalReplayChunks } from './terminalReplayBuffer'
import type { TerminalSlot } from './terminalRuntimeState'

export function projectTerminalSnapshot(room: RoomRuntime, terminal: TerminalSlot): TerminalSnapshot {
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
    replay: terminalReplayChunks(terminal),
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    ...terminalRevisionFields(room, terminal),
  }
}

export function projectTerminalPositions(room: RoomRuntime): TerminalRuntimePosition[] {
  return room.store.terminalOrder.map((terminalId, offset) => {
    const terminal = terminalForProjection(room, terminalId)
    const type: TerminalType = terminal.backendKind === 'text' ? 'text' : 'shell'
    const readiness = terminal.status === 'running' ? 'ready' : terminal.status === 'closed' ? 'exited' : terminal.status
    return {
      index: offset + 1,
      type,
      terminalId: terminal.terminalId,
      launchId: terminal.launchId,
      readiness,
      ...(terminal.cwd ? { cwd: terminal.cwd } : {}),
    }
  })
}

export function projectRoomSnapshot(room: RoomRuntime): RoomSnapshot {
  return {
    type: 'room_snapshot',
    roomId: room.roomId,
    roomGeneration: room.roomGeneration,
    roomRevision: room.roomRevision,
    terminalStructureRevision: room.terminalStructureRevision,
    terminals: room.store.terminalOrder.map((terminalId) => projectTerminalSnapshot(room, terminalForProjection(room, terminalId))),
    indexMap: room.store.indexMap(),
    terminalPositions: projectTerminalPositions(room),
    terminalStructureLocked: room.structureLockRunId !== null,
  }
}

export function projectTerminalReplayMessage(room: RoomRuntime, terminal: TerminalSlot): ServerMessage {
  return {
    type: 'terminal_replay',
    roomId: room.roomId,
    roomGeneration: room.roomGeneration,
    terminalId: terminal.terminalId,
    launchId: terminal.launchId,
    replay: terminalReplayChunks(terminal),
    ...terminalRevisionFields(room, terminal),
  }
}

export function projectTerminalStateMessage(room: RoomRuntime, terminal: TerminalSlot): ServerMessage {
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
    ...terminalRevisionFields(room, terminal),
  }
}

export function projectTerminalIndexMapMessage(room: RoomRuntime): ServerMessage {
  return {
    type: 'terminal_index_map',
    roomId: room.roomId,
    roomGeneration: room.roomGeneration,
    roomRevision: room.roomRevision,
    terminalStructureRevision: room.terminalStructureRevision,
    items: room.store.indexMap(),
    terminalPositions: projectTerminalPositions(room),
    terminalStructureLocked: room.structureLockRunId !== null,
  }
}

export function terminalRevisionFields(room: RoomRuntime, terminal: TerminalSlot): TerminalRevisionFields {
  return {
    roomRevision: room.roomRevision,
    terminalRevision: terminal.terminalRevision,
    textRevision: terminal.textRevision,
    outputActivityRevision: terminal.outputActivityRevision,
  }
}

function terminalForProjection(room: RoomRuntime, terminalId: string): TerminalSlot {
  const normalized = assertGeneratedId(terminalId, 'terminal')
  const terminal = room.terminals.get(normalized)
  if (!terminal) throw new Error('terminal_not_found:' + room.roomId + ':' + normalized)
  return terminal
}
