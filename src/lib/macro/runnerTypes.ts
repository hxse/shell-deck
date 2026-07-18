import type { MacroDefinitionV4 } from './macroDefinitionTypes'

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
  definition: MacroDefinitionV4
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
    definition: MacroDefinitionV4
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
}

export type MacroRunnerDelta = Omit<MacroRunnerSnapshot, 'events'> & {
  events: MacroRunEvent[]
}

export type MacroRunTrace = MacroRunEventWindow & {
  runId: string
  createdAt: string
  macroRecord: { id: string; revision: number }
  roomId: string
  roomGeneration: string
  status: 'completed' | 'failed' | 'stopped' | 'interrupted'
}
