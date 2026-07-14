export const AGENT_EVENT_KINDS = ['agent.session_started', 'agent.prompt_submitted', 'agent.output', 'agent.error'] as const
export const AGENT_EVENT_ADAPTERS = ['codex-session-start-hook', 'codex-user-prompt-submit-hook', 'codex-stop-hook', 'codex-hook-error'] as const

export type AgentEventKind = typeof AGENT_EVENT_KINDS[number]
export type AgentEventAdapter = typeof AGENT_EVENT_ADAPTERS[number]

export type AgentEventInput = {
  protocolVersion: 1
  agentKind: 'codex'
  eventKind: AgentEventKind
  roomGeneration: string
  terminalId: string
  launchId: string
  agentSessionId: string
  agentTurnId?: string
  adapterMetadata: {
    adapter: AgentEventAdapter
    codexSessionId: string
  }
  capturedText?: string
  raw: {
    source: string
    payload?: Record<string, unknown>
  }
  error?: string
}

export type AgentEvent = AgentEventInput & {
  eventId: string
  serverInstanceId: string
  roomId: string
  receivedAt: string
}

export type HookEnv = {
  roomGeneration: string
  terminalId: string
  launchId: string
}

export type AgentEventMatch = {
  serverInstanceId: string
  roomId: string
  roomGeneration: string
  terminalId: string
  launchId: string
  agentKind?: 'codex'
  eventKind?: AgentEventKind
  adapter?: AgentEventAdapter
}

export type AgentEventValidationIssue = {
  path: string
  message: string
}

export type AgentEventValidationResult = {
  ok: boolean
  issues: AgentEventValidationIssue[]
}
