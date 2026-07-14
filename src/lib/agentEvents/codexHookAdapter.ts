import type { AgentEventInput, HookEnv } from './agentEventTypes'

export function normalizeCodexHookPayload(payload: Record<string, unknown>, env: HookEnv): AgentEventInput {
  const hookName = requiredString(payload, 'hook_event_name')
  const sessionId = requiredString(payload, 'session_id')
  const base = {
    protocolVersion: 1 as const,
    agentKind: 'codex' as const,
    roomGeneration: env.roomGeneration,
    terminalId: env.terminalId,
    launchId: env.launchId,
    agentSessionId: sessionId,
    raw: { source: `codex.${hookName}`, payload },
  }

  if (hookName === 'SessionStart') return { ...base, eventKind: 'agent.session_started', adapterMetadata: { adapter: 'codex-session-start-hook', codexSessionId: sessionId } }
  if (hookName === 'UserPromptSubmit') return {
    ...base,
    eventKind: 'agent.prompt_submitted',
    agentTurnId: requiredString(payload, 'turn_id'),
    capturedText: requiredString(payload, 'prompt'),
    adapterMetadata: { adapter: 'codex-user-prompt-submit-hook', codexSessionId: sessionId },
  }
  if (hookName === 'Stop') return {
    ...base,
    eventKind: 'agent.output',
    agentTurnId: requiredString(payload, 'turn_id'),
    capturedText: requiredString(payload, 'last_assistant_message'),
    adapterMetadata: { adapter: 'codex-stop-hook', codexSessionId: sessionId },
  }
  return codexHookErrorEvent(env, 'unsupported_hook_event:' + hookName, sessionId, payload)
}

export function codexHookErrorEvent(env: HookEnv, message: string, sessionId = 'unknown', payload: Record<string, unknown> = {}): AgentEventInput {
  return {
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.error',
    roomGeneration: env.roomGeneration,
    terminalId: env.terminalId,
    launchId: env.launchId,
    agentSessionId: sessionId,
    adapterMetadata: { adapter: 'codex-hook-error', codexSessionId: sessionId },
    raw: { source: 'codex.hook_receiver_failed', payload },
    error: message,
  }
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error('missing_' + key)
  return value
}
