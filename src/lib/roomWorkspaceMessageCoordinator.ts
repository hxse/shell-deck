import type {
  ContentEditLeaseChangedMessage,
  ContentRecordChangedMessage,
  RoomSnapshot,
  ServerMessage,
  TerminalSnapshot,
} from './protocol'
import type { RoomControlView } from './roomControl'

type RoomWorkspaceMessagePorts = {
  roomGeneration(): string
  setRoomGeneration(value: string): void
  setControlView(value: RoomControlView | null): void
  acceptControlView(value: RoomControlView): void
  acceptControlLost(): void
  setActiveTerminalId(value: string): void
  resetRoomRevision(): void
  applyRoomSnapshot(snapshot: RoomSnapshot): void
  observeRoomRevision(revision: number): void
  upsertTerminal(snapshot: TerminalSnapshot): void
  appendTerminalReplay(message: Extract<ServerMessage, { type: 'pty_output' }>): void
  replaceTerminalReplay(message: Extract<ServerMessage, { type: 'terminal_replay' }>): void
  applyTerminalTextMutation(message: Extract<ServerMessage, { type: 'terminal_text_mutation' }>): void
  applyTerminalTextSnapshot(message: Extract<ServerMessage, { type: 'terminal_text_snapshot' }>): void
  requestTerminalTextRepair(message: Extract<ServerMessage, { type: 'terminal_text_resync_required' }>): void
  applyTerminalIndexMap(message: Extract<ServerMessage, { type: 'terminal_index_map' }>): void
  applyTerminalState(message: Extract<ServerMessage, { type: 'terminal_state' }>): void
  applyTerminalCwd(message: Extract<ServerMessage, { type: 'terminal_cwd' }>): void
  appendContentRecordChange(message: ContentRecordChangedMessage, sequence: number): void
  appendContentEditLeaseChange(message: ContentEditLeaseChangedMessage, sequence: number): void
  mutationNotice(reason: string, prefix?: string): void
  runnerRepairPending(): boolean
  runnerRepairRoomGeneration(): string
  clearRunnerRepair(): void
  resumeRunnerRepair(): void
  installRunnerSnapshot(message: Extract<ServerMessage, { type: 'runner_snapshot' }>): void
  applyRunnerDelta(message: Extract<ServerMessage, { type: 'runner_delta' }>): void
  deliverNotification(message: Extract<ServerMessage, { type: 'macro_notification' }>): void
  enterHome(): void
}

export class RoomWorkspaceMessageCoordinator {
  readonly #ports: RoomWorkspaceMessagePorts
  #contentChangeSequence = 0
  #contentLeaseChangeSequence = 0

  constructor(ports: RoomWorkspaceMessagePorts) {
    this.#ports = ports
  }

  handle(message: ServerMessage): void {
    const ports = this.#ports
    if (message.type === 'client_registered') {
      if (ports.runnerRepairPending() && ports.runnerRepairRoomGeneration() !== message.roomGeneration) {
        ports.clearRunnerRepair()
      }
      ports.setRoomGeneration(message.roomGeneration)
      ports.resetRoomRevision()
      ports.resumeRunnerRepair()
    }
    const roomGeneration = ports.roomGeneration()
    if ('roomGeneration' in message && roomGeneration && message.roomGeneration !== roomGeneration) return
    if (message.type === 'room_control') {
      ports.setControlView(message.view)
      ports.acceptControlView(message.view)
    }
    if (message.type === 'room_control_lost') {
      ports.acceptControlLost()
      ports.setControlView({
        mode: 'observer',
        controlEpoch: message.controlEpoch,
        expiresAt: new Date().toISOString(),
      })
      ports.mutationNotice('room_control_lost')
    }
    if (message.type === 'room_snapshot') ports.applyRoomSnapshot(message)
    if (message.type === 'terminal_snapshot') {
      ports.observeRoomRevision(message.roomRevision)
      ports.upsertTerminal(message)
    }
    if (message.type === 'terminal_created') ports.setActiveTerminalId(message.terminalId)
    if (message.type === 'pty_output') {
      ports.observeRoomRevision(message.roomRevision)
      ports.appendTerminalReplay(message)
    }
    if (message.type === 'terminal_replay') {
      ports.observeRoomRevision(message.roomRevision)
      ports.replaceTerminalReplay(message)
    }
    if (message.type === 'terminal_text_mutation') ports.applyTerminalTextMutation(message)
    if (message.type === 'terminal_text_snapshot') ports.applyTerminalTextSnapshot(message)
    if (message.type === 'terminal_text_resync_required') ports.requestTerminalTextRepair(message)
    if (message.type === 'terminal_index_map') ports.applyTerminalIndexMap(message)
    if (message.type === 'terminal_error') {
      ports.mutationNotice(message.reason, message.terminalId ? message.terminalId + ': ' : '')
    }
    if (message.type === 'input_rejected') ports.mutationNotice(message.reason, message.terminalId + ': ')
    if (message.type === 'runner_snapshot' && (!roomGeneration || message.snapshot.roomGeneration === roomGeneration)) {
      ports.installRunnerSnapshot(message)
      if (ports.runnerRepairPending()) ports.resumeRunnerRepair()
    }
    if (message.type === 'runner_delta' && (!roomGeneration || message.delta.roomGeneration === roomGeneration)) {
      ports.applyRunnerDelta(message)
    }
    if (message.type === 'content_record_changed') {
      ports.appendContentRecordChange(message, ++this.#contentChangeSequence)
    }
    if (message.type === 'content_edit_lease_changed') {
      ports.appendContentEditLeaseChange(message, ++this.#contentLeaseChangeSequence)
    }
    if (message.type === 'macro_notification') ports.deliverNotification(message)
    if (message.type === 'terminal_state') ports.applyTerminalState(message)
    if (message.type === 'terminal_cwd') ports.applyTerminalCwd(message)
    if (message.type === 'room_destroyed') ports.enterHome()
  }
}
