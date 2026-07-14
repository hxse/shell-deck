import { expect, test } from 'bun:test'
import { assertValidAgentEventInput } from '../../src/lib/agentEvents/agentEventSchema'
import { normalizeCodexHookPayload } from '../../src/lib/agentEvents/codexHookAdapter'
import { createGeneratedId } from '../../src/lib/generatedId'

const env = { roomGeneration: createGeneratedId('roomGeneration'), terminalId: createGeneratedId('terminal'), launchId: createGeneratedId('terminalLaunch') }

test('Codex Stop hook normalizes assistant output and mirrors session id', () => {
  const event = normalizeCodexHookPayload({
    hook_event_name: 'Stop',
    session_id: 'codex-session-a',
    turn_id: 'turn-a',
    last_assistant_message: 'review complete',
  }, env)

  expect(assertValidAgentEventInput(event)).toBe(event)
  expect(event).toMatchObject({
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.output',
    roomGeneration: env.roomGeneration,
    terminalId: env.terminalId,
    launchId: env.launchId,
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
  }, env)

  expect(assertValidAgentEventInput(event)).toBe(event)
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
  }, env)

  expect(assertValidAgentEventInput(event)).toBe(event)
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
  }, env)
  event.adapterMetadata.codexSessionId = 'other-session'

  expect(() => assertValidAgentEventInput(event)).toThrow('codexSessionId must match agentSessionId')
})
