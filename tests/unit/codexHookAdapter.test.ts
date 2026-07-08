import { expect, test } from 'bun:test'
import { assertValidAgentEvent } from '../../src/lib/agentEvents/agentEventSchema'
import { normalizeCodexHookPayload } from '../../src/lib/agentEvents/codexHookAdapter'

const env = { configId: 'local', terminalId: 'term_hook_a', launchId: 'launch_hook_a' }

test('Codex Stop hook normalizes assistant output and mirrors session id', () => {
  const event = normalizeCodexHookPayload({
    hook_event_name: 'Stop',
    session_id: 'codex-session-a',
    turn_id: 'turn-a',
    last_assistant_message: 'review complete',
  }, env, '2026-06-30T00:00:00.000Z')

  expect(assertValidAgentEvent(event)).toBe(event)
  expect(event).toMatchObject({
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.output',
    configId: 'local',
    terminalId: 'term_hook_a',
    launchId: 'launch_hook_a',
    agentSessionId: 'codex-session-a',
    agentTurnId: 'turn-a',
    adapterMetadata: {
      adapter: 'codex-stop-hook',
      codexSessionId: 'codex-session-a',
    },
    capturedText: 'review complete',
  })
})

test('Codex UserPromptSubmit hook normalizes submitted prompt', () => {
  const event = normalizeCodexHookPayload({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'codex-session-p',
    turn_id: 'turn-p',
    prompt: 'review this task',
  }, env, '2026-06-30T00:00:00.500Z')

  expect(assertValidAgentEvent(event)).toBe(event)
  expect(event).toMatchObject({
    eventKind: 'agent.prompt_submitted',
    agentSessionId: 'codex-session-p',
    agentTurnId: 'turn-p',
    capturedText: 'review this task',
    adapterMetadata: {
      adapter: 'codex-user-prompt-submit-hook',
      codexSessionId: 'codex-session-p',
    },
  })
})

test('Codex SessionStart hook keeps codexSessionId available for tracing', () => {
  const event = normalizeCodexHookPayload({
    hook_event_name: 'SessionStart',
    session_id: 'codex-session-b',
  }, env, '2026-06-30T00:00:01.000Z')

  expect(assertValidAgentEvent(event)).toBe(event)
  expect(event.eventKind).toBe('agent.session_started')
  expect(event.agentSessionId).toBe('codex-session-b')
  expect(event.adapterMetadata.codexSessionId).toBe('codex-session-b')
})

test('AgentEvent schema rejects mismatched codex session mirror', () => {
  const event = normalizeCodexHookPayload({
    hook_event_name: 'Stop',
    session_id: 'codex-session-c',
    turn_id: 'turn-c',
    last_assistant_message: 'done',
  }, env, '2026-06-30T00:00:02.000Z')
  event.adapterMetadata.codexSessionId = 'other-session'

  expect(() => assertValidAgentEvent(event)).toThrow('codexSessionId must match agentSessionId')
})
