import type { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import type { MacroDefinitionV5 } from '../src/lib/macro/macroDefinitionTypes'
import type { MacroRunnerSnapshot, MacroRunTrace } from '../src/lib/macro/runnerTypes'
import { MacroRunnerLifecycle } from './macroRunnerLifecycle'
import type { MacroStartPreflight } from './macroRunnerLiveState'
import type {
  StructuredJsonSubmission,
  StructuredJsonSubmissionResult,
} from './macroStructuredCapture'
import type { NotificationDispatcher } from './notificationService'
import type { MacroRunStore } from './macroRunStore'
import type { MacroRecordStore } from './sharedContentStore'
import type { RoomControlledOperationTicket, TerminalRoomManager } from './terminalRoomManager'

export { MacroNotRunnableError } from './macroRunnerLiveState'
export type { MacroStartPreflight } from './macroRunnerLiveState'

export class MacroRunnerService {
  private readonly lifecycle: MacroRunnerLifecycle

  constructor(
    manager: TerminalRoomManager,
    records: MacroRecordStore<MacroDefinitionV5>,
    runStore: MacroRunStore,
    notificationService: NotificationDispatcher,
    agentEvents: AgentEventStore,
  ) {
    this.lifecycle = new MacroRunnerLifecycle(manager, records, runStore, notificationService, agentEvents)
  }

  hasActiveRun(roomId: string, roomGeneration: string): boolean {
    return this.lifecycle.hasActiveRun(roomId, roomGeneration)
  }

  snapshot(roomId: string): MacroRunnerSnapshot {
    return this.lifecycle.snapshot(roomId)
  }

  traces(roomId: string): MacroRunTrace[] {
    return this.lifecycle.traces(roomId)
  }

  preflightStart(templateId: string): MacroStartPreflight {
    return this.lifecycle.preflightStart(templateId)
  }

  async start(
    ticket: RoomControlledOperationTicket,
    templateId: string,
    expectedMacroRevision: number,
    expectedTerminalStructureRevision: number,
    preflight: MacroStartPreflight = this.preflightStart(templateId),
  ): Promise<MacroRunnerSnapshot> {
    return this.lifecycle.start(
      ticket,
      templateId,
      expectedMacroRevision,
      expectedTerminalStructureRevision,
      preflight,
    )
  }

  pause(roomId: string): MacroRunnerSnapshot {
    return this.lifecycle.pause(roomId)
  }

  resume(roomId: string): MacroRunnerSnapshot {
    return this.lifecycle.resume(roomId)
  }

  stop(roomId: string): MacroRunnerSnapshot {
    return this.lifecycle.stop(roomId)
  }

  submitStructuredJson(
    roomId: string,
    submission: StructuredJsonSubmission,
  ): StructuredJsonSubmissionResult {
    return this.lifecycle.submitStructuredJson(roomId, submission)
  }

  updateInputDraft(
    roomId: string,
    invocationId: string,
    value: string,
    expectedInputRevision: number,
  ): MacroRunnerSnapshot {
    return this.lifecycle.updateInputDraft(roomId, invocationId, value, expectedInputRevision)
  }

  submitInput(
    roomId: string,
    invocationId: string,
    value: string,
    expectedInputRevision: number,
  ): MacroRunnerSnapshot {
    return this.lifecycle.submitInput(roomId, invocationId, value, expectedInputRevision)
  }

  destroyRoom(roomId: string, roomGeneration: string): void {
    this.lifecycle.destroyRoom(roomId, roomGeneration)
  }
}
