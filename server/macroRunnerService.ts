import type { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import type { MacroDefinitionV6 } from '../src/lib/macro/macroDefinitionTypes'
import type {
  MacroRunEventPage,
  MacroRunnerActionAck,
  MacroRunnerSnapshot,
  MacroRunSummaryPage,
} from '../src/lib/macro/runnerTypes'
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
    records: MacroRecordStore<MacroDefinitionV6>,
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

  traceSummaries(roomId: string, limit: number, cursor: string | null): MacroRunSummaryPage {
    return this.lifecycle.traceSummaries(roomId, limit, cursor)
  }

  traceEvents(roomId: string, runId: string, limit: number, cursor: string | null): MacroRunEventPage {
    return this.lifecycle.traceEvents(roomId, runId, limit, cursor)
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
  ): Promise<MacroRunnerActionAck> {
    return this.lifecycle.start(
      ticket,
      templateId,
      expectedMacroRevision,
      expectedTerminalStructureRevision,
      preflight,
    )
  }

  pause(roomId: string): MacroRunnerActionAck {
    return this.lifecycle.pause(roomId)
  }

  resume(roomId: string): MacroRunnerActionAck {
    return this.lifecycle.resume(roomId)
  }

  stop(roomId: string): MacroRunnerActionAck {
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
  ): MacroRunnerActionAck {
    return this.lifecycle.updateInputDraft(roomId, invocationId, value, expectedInputRevision)
  }

  submitInput(
    roomId: string,
    invocationId: string,
    value: string,
    expectedInputRevision: number,
  ): MacroRunnerActionAck {
    return this.lifecycle.submitInput(roomId, invocationId, value, expectedInputRevision)
  }

  destroyRoom(roomId: string, roomGeneration: string): void {
    this.lifecycle.destroyRoom(roomId, roomGeneration)
  }
}
