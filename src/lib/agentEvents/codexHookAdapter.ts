import type { AgentEvent, HookEnv } from './agentEventTypes'

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

  if (hookName === 'UserPromptSubmit') {
    return {
      ...base,
      eventKind: 'agent.prompt_submitted',
      agentTurnId: requiredString(payload, 'turn_id'),
      capturedText: requiredString(payload, 'prompt'),
      adapterMetadata: {
        adapter: 'codex-user-prompt-submit-hook',
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

  return codexHookErrorEvent(env, receivedAt, 'unsupported_hook_event:' + hookName, sessionId, payload)
}

export function codexHookErrorEvent(env: HookEnv, receivedAt: string, message: string, sessionId = 'unknown', payload: Record<string, unknown> = {}): AgentEvent {
  return {
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.error',
    configId: env.configId,
    terminalId: env.terminalId,
    launchId: env.launchId,
    agentSessionId: sessionId,
    adapterMetadata: {
      adapter: 'codex-hook-error',
      codexSessionId: sessionId,
    },
    raw: {
      source: 'codex.hook_receiver_failed',
      payload,
    },
    receivedAt,
    error: message,
  }
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('missing_' + key)
  }
  return value
}
