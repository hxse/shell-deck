import type { MacroDefinitionV6 } from './macroDefinitionTypes'

export type FrozenTerminalBinding = {
  index: number
  type: 'shell' | 'text'
  terminalId: string
  launchId: string
}

export type RunManifestV1 = {
  schemaVersion: 1
  runId: string
  createdAt: string
  macroRecord: { id: string; revision: number }
  definition: MacroDefinitionV6
  definitionHash: { algorithm: 'sha256'; value: string }
  runtime: {
    serverInstanceId: string
    roomId: string
    roomGeneration: string
    terminalStructureRevision: number
  }
  terminalBindings: FrozenTerminalBinding[]
}

export type MacroRunnerStatus = 'idle' | 'starting' | 'running' | 'paused' | 'waiting_input' | 'stopping' | 'completed' | 'failed' | 'stopped'

export function isActiveMacroRunnerStatus(status: MacroRunnerStatus | null | undefined): boolean {
  return status === 'starting' || status === 'running' || status === 'paused'
    || status === 'waiting_input' || status === 'stopping'
}
export type MacroRunEvent = {
  schemaVersion: 1
  eventId: string
  eventSeq: number
  runId: string
  serverInstanceId: string
  roomId: string
  roomGeneration: string
  kind: string
  createdAt: string
  data: Record<string, unknown>
}

export type MacroRunEventWindow = {
  events: MacroRunEvent[]
  firstAvailableEventSeq: number
  lastEventSeq: number
  totalEventCount: number
  discardedEventCount: number
}

export type MacroRunnerSnapshot = MacroRunEventWindow & {
  roomId: string
  roomGeneration: string
  runtimeRevision: number
  runId: string | null
  runningMacro: {
    recordId: string
    recordRevision: number
    definition: MacroDefinitionV6
    definitionHash: string
  } | null
  status: MacroRunnerStatus
  currentNodeId: string | null
  error: string | null
  runtimeInput: {
    invocationId: string
    prompt: string
    defaultText: string
    draft: string
    inputRevision: number
    status: 'waiting'
  } | null
  stateHash: string
}

export type MacroRunnerDelta = MacroRunEventWindow & {
  roomId: string
  roomGeneration: string
  runId: string
  definitionHash: string
  expectedRuntimeRevision: number
  runtimeRevision: number
  status: MacroRunnerStatus
  currentNodeId: string | null
  error: string | null
  runtimeInput: MacroRunnerSnapshot['runtimeInput']
  events: MacroRunEvent[]
  stateHash: string
}

export type MacroRunnerInputAck = {
  invocationId: string
  inputRevision: number
  status: 'waiting'
}

export type MacroRunnerActionAck = {
  roomId: string
  roomGeneration: string
  runId: string
  runtimeRevision: number
  status: MacroRunnerStatus
  runtimeInput: MacroRunnerInputAck | null
}

export type MacroRunSummary = {
  runId: string
  createdAt: string
  macroRecord: { id: string; revision: number }
  roomId: string
  roomGeneration: string
  status: 'completed' | 'failed' | 'stopped' | 'interrupted'
  firstAvailableEventSeq: number
  lastEventSeq: number
  totalEventCount: number
  discardedEventCount: number
}

export type MacroRunSummaryPage = {
  items: MacroRunSummary[]
  nextCursor: string | null
}

export type MacroRunEventPage = MacroRunEventWindow & {
  runId: string
  nextCursor: string | null
}

export function traceEventWindow(
  runner: MacroRunnerSnapshot | null,
  selectedRunId: string | null,
  persisted: MacroRunEventPage | null,
): MacroRunEventWindow | null {
  return runner?.runId === selectedRunId
    ? runner
    : persisted
}
