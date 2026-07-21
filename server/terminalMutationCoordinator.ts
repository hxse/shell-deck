import { assertGeneratedId } from '../src/lib/generatedId'
import type { RoomRuntime } from './roomLifecycleCoordinator'
import type { TerminalSlot } from './terminalRuntimeState'

type ControlledStructureTicket = {
  readonly roomId: string
  assertAuthorized(): void
}

export function assertTerminalStructureMutable(room: RoomRuntime): void {
  if (room.structureLockRunId !== null) throw new Error('room_structure_locked_by_run')
}

export async function runSerializedTerminalStructureOperation<T>(
  room: RoomRuntime,
  ticket: ControlledStructureTicket,
  expectedRevision: number,
  operation: () => Promise<T> | T,
): Promise<T> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('invalid_terminal_structure_revision')
  const previous = room.structureQueue
  let release!: () => void
  room.structureQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    ticket.assertAuthorized()
    assertTerminalStructureMutable(room)
    if (room.terminalStructureRevision !== expectedRevision) throw new Error('terminal_structure_revision_conflict')
    const result = await operation()
    ticket.assertAuthorized()
    return result
  } finally {
    release()
  }
}

export async function runSerializedTerminalStructureMutation<T>(
  room: RoomRuntime,
  ticket: ControlledStructureTicket,
  operation: () => Promise<T> | T,
): Promise<T> {
  const previous = room.structureQueue
  let release!: () => void
  room.structureQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    ticket.assertAuthorized()
    assertTerminalStructureMutable(room)
    const result = await operation()
    ticket.assertAuthorized()
    return result
  } finally {
    release()
  }
}

export function commitTerminalCreate(room: RoomRuntime, terminal: TerminalSlot, insertAtIndex?: number): void {
  room.store.addTerminal(terminal.terminalId, insertAtIndex)
  room.terminals.set(terminal.terminalId, terminal)
  advanceTerminalStructureRevision(room)
}

export function commitTerminalRestart(room: RoomRuntime, terminal: TerminalSlot): void {
  room.terminals.set(terminal.terminalId, terminal)
  advanceTerminalStructureRevision(room)
}

export function commitTerminalMove(room: RoomRuntime, terminalId: string, newIndex: number): boolean {
  if (room.store.indexOf(terminalId) === newIndex) return false
  room.store.moveTerminal(terminalId, newIndex)
  advanceTerminalStructureRevision(room)
  return true
}

export function commitTerminalClose(room: RoomRuntime, terminalId: string): void {
  room.terminals.delete(terminalId)
  room.store.removeTerminal(terminalId)
  advanceTerminalStructureRevision(room)
}

export function acquireTerminalStructureLock(room: RoomRuntime, runId: string): void {
  assertTerminalStructureMutable(room)
  room.structureLockRunId = assertGeneratedId(runId, 'run')
  room.roomRevision += 1
}

export function releaseTerminalStructureLock(room: RoomRuntime, runId: string): boolean {
  if (room.structureLockRunId !== runId) return false
  room.structureLockRunId = null
  room.roomRevision += 1
  return true
}

function advanceTerminalStructureRevision(room: RoomRuntime): void {
  room.roomRevision += 1
  room.terminalStructureRevision += 1
}
