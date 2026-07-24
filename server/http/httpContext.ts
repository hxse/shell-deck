import type { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import type { MacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionTypes'
import type { ContentEditLeaseService } from '../contentEditLeaseService'
import type { MacroRunnerService } from '../macroRunnerService'
import type { NotificationService } from '../notificationService'
import type { MacroRecordStore } from '../sharedContentStore'
import type { TerminalRoomManager } from '../terminalRoomManager'

export type HttpContext = {
  manager: TerminalRoomManager
  contentEditLeases: ContentEditLeaseService
  agentEventStore: AgentEventStore
  ingestToken: string
  notificationService: NotificationService
  macroStore: MacroRecordStore<MacroDefinitionV5>
  macroRunner: MacroRunnerService
}

export type HttpRouteResult = Response | null
