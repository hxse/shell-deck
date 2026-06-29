export type AgentEvent = {
  protocolVersion: 1
  agentKind: 'codex'
  eventKind: 'agent.session_started' | 'agent.output' | 'agent.error'
  configId: string
  terminalId: string
  launchId: string
  agentSessionId: string
  agentTurnId?: string
  adapterMetadata: {
    adapter: 'codex-session-start-hook' | 'codex-stop-hook' | 'codex-hook-error'
    codexSessionId: string
  }
  capturedText?: string
  raw: {
    source: string
    payloadRef?: string
    payload: Record<string, unknown>
  }
  receivedAt: string
}

export type HookEnv = {
  configId: string
  terminalId: string
  launchId: string
}

export type IngestResult =
  | { ok: true; accepted: true; spooled: false; event: AgentEvent }
  | { ok: true; accepted: false; spooled: true; event: AgentEvent }
  | { ok: false; reason: 'invalid_token' }

export class ProbeAgentEventIngest {
  readonly token: string
  online = true
  readonly accepted: AgentEvent[] = []
  readonly spooled: AgentEvent[] = []

  constructor(token: string) {
    this.token = token
  }

  post(event: AgentEvent, token: string): IngestResult {
    if (token !== this.token) {
      return { ok: false, reason: 'invalid_token' }
    }
    if (!this.online) {
      this.spooled.push(event)
      return { ok: true, accepted: false, spooled: true, event }
    }
    this.accepted.push(event)
    return { ok: true, accepted: true, spooled: false, event }
  }

  importSpool() {
    const imported = this.spooled.splice(0)
    this.accepted.push(...imported)
    return imported.length
  }
}

export function normalizeCodexHookPayload(payload: Record<string, unknown>, env: HookEnv, receivedAt = new Date().toISOString()): AgentEvent {
  const hookName = requiredString(payload, 'hook_event_name')
  const sessionId = requiredString(payload, 'session_id')
  const base = {
    protocolVersion: 1 as const,
    agentKind: 'codex' as const,
    configId: env.configId,
    terminalId: env.terminalId,
    launchId: env.launchId,
    agentSessionId: sessionId,
    raw: {
      source: `codex.${hookName}`,
      payload,
    },
    receivedAt,
  }

  if (hookName === 'SessionStart') {
    return {
      ...base,
      eventKind: 'agent.session_started',
      adapterMetadata: {
        adapter: 'codex-session-start-hook',
        codexSessionId: sessionId,
      },
    }
  }

  if (hookName === 'Stop') {
    return {
      ...base,
      eventKind: 'agent.output',
      agentTurnId: requiredString(payload, 'turn_id'),
      capturedText: requiredString(payload, 'last_assistant_message'),
      adapterMetadata: {
        adapter: 'codex-stop-hook',
        codexSessionId: sessionId,
      },
    }
  }

  return {
    ...base,
    eventKind: 'agent.error',
    adapterMetadata: {
      adapter: 'codex-hook-error',
      codexSessionId: sessionId,
    },
  }
}

function requiredString(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing_${key}`)
  }
  return value
}
