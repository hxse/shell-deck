import { assertGeneratedId, assertRoomRouteToken } from '../generatedId'
import {
  AGENT_EVENT_ADAPTERS,
  AGENT_EVENT_KINDS,
  type AgentEvent,
  type AgentEventAdapter,
  type AgentEventInput,
  type AgentEventKind,
  type AgentEventValidationIssue,
  type AgentEventValidationResult,
} from './agentEventTypes'

const KIND_SET = new Set<string>(AGENT_EVENT_KINDS)
const ADAPTER_SET = new Set<string>(AGENT_EVENT_ADAPTERS)
const INPUT_KEYS = new Set(['protocolVersion', 'agentKind', 'eventKind', 'roomGeneration', 'terminalId', 'launchId', 'agentSessionId', 'agentTurnId', 'adapterMetadata', 'capturedText', 'raw', 'error'])
const EVENT_KEYS = new Set([...INPUT_KEYS, 'eventId', 'serverInstanceId', 'roomId', 'receivedAt'])

export function isAgentEventKind(value: unknown): value is AgentEventKind {
  return typeof value === 'string' && KIND_SET.has(value)
}

export function isAgentEventAdapter(value: unknown): value is AgentEventAdapter {
  return typeof value === 'string' && ADAPTER_SET.has(value)
}

export function validateAgentEventInput(value: unknown): AgentEventValidationResult {
  return validate(value, false)
}

export function validateAgentEvent(value: unknown): AgentEventValidationResult {
  return validate(value, true)
}

export function assertValidAgentEventInput(value: unknown): AgentEventInput {
  const result = validateAgentEventInput(value)
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.path + ': ' + issue.message).join('; '))
  return value as AgentEventInput
}

export function assertValidAgentEvent(value: unknown): AgentEvent {
  const result = validateAgentEvent(value)
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.path + ': ' + issue.message).join('; '))
  return value as AgentEvent
}

function validate(value: unknown, stored: boolean): AgentEventValidationResult {
  const issues: AgentEventValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '$', message: 'AgentEvent must be an object' }] }
  const allowed = stored ? EVENT_KEYS : INPUT_KEYS
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push({ path: key, message: 'unknown field' })

  if (value.protocolVersion !== 1) issues.push({ path: 'protocolVersion', message: 'protocolVersion must be 1' })
  if (value.agentKind !== 'codex') issues.push({ path: 'agentKind', message: 'agentKind must be codex' })
  if (!isAgentEventKind(value.eventKind)) issues.push({ path: 'eventKind', message: 'eventKind is not supported' })
  validateGenerated(value.roomGeneration, 'roomGeneration', 'roomGeneration', issues)
  validateGenerated(value.terminalId, 'terminalId', 'terminal', issues)
  validateGenerated(value.launchId, 'launchId', 'terminalLaunch', issues)
  validateNonEmptyString(value.agentSessionId, 'agentSessionId', issues)
  if (value.agentTurnId !== undefined) validateNonEmptyString(value.agentTurnId, 'agentTurnId', issues)

  if (stored) {
    validateGenerated(value.eventId, 'eventId', 'runEvent', issues)
    validateGenerated(value.serverInstanceId, 'serverInstanceId', 'serverInstance', issues)
    try { assertRoomRouteToken(value.roomId) } catch { issues.push({ path: 'roomId', message: 'invalid roomId' }) }
    if (!isExactIsoTimestamp(value.receivedAt)) issues.push({ path: 'receivedAt', message: 'receivedAt must be an ISO timestamp' })
  }

  if (!isRecord(value.adapterMetadata)) {
    issues.push({ path: 'adapterMetadata', message: 'adapterMetadata must be an object' })
  } else {
    for (const key of Object.keys(value.adapterMetadata)) if (key !== 'adapter' && key !== 'codexSessionId') issues.push({ path: 'adapterMetadata.' + key, message: 'unknown field' })
    if (!isAgentEventAdapter(value.adapterMetadata.adapter)) issues.push({ path: 'adapterMetadata.adapter', message: 'adapter is not supported' })
    validateNonEmptyString(value.adapterMetadata.codexSessionId, 'adapterMetadata.codexSessionId', issues)
    if (typeof value.agentSessionId === 'string' && typeof value.adapterMetadata.codexSessionId === 'string' && value.agentSessionId !== value.adapterMetadata.codexSessionId) {
      issues.push({ path: 'adapterMetadata.codexSessionId', message: 'codexSessionId must match agentSessionId' })
    }
  }

  if (!isRecord(value.raw)) {
    issues.push({ path: 'raw', message: 'raw must be an object' })
  } else {
    for (const key of Object.keys(value.raw)) if (key !== 'source' && key !== 'payload') issues.push({ path: 'raw.' + key, message: 'unknown field' })
    validateNonEmptyString(value.raw.source, 'raw.source', issues)
    if (value.raw.payload !== undefined && !isRecord(value.raw.payload)) issues.push({ path: 'raw.payload', message: 'raw.payload must be an object' })
  }

  if (value.eventKind === 'agent.prompt_submitted') {
    validateNonEmptyString(value.agentTurnId, 'agentTurnId', issues)
    validateString(value.capturedText, 'capturedText', issues)
    requireAdapter(value, 'codex-user-prompt-submit-hook', 'agent.prompt_submitted', issues)
  }
  if (value.eventKind === 'agent.output') {
    validateNonEmptyString(value.agentTurnId, 'agentTurnId', issues)
    validateString(value.capturedText, 'capturedText', issues)
    requireAdapter(value, 'codex-stop-hook', 'agent.output', issues)
  }
  if (value.eventKind === 'agent.session_started') requireAdapter(value, 'codex-session-start-hook', 'agent.session_started', issues)
  if (value.eventKind === 'agent.error') {
    requireAdapter(value, 'codex-hook-error', 'agent.error', issues)
    if (value.error !== undefined) validateNonEmptyString(value.error, 'error', issues)
  }
  return { ok: issues.length === 0, issues }
}

function requireAdapter(value: Record<string, unknown>, adapter: AgentEventAdapter, kind: string, issues: AgentEventValidationIssue[]): void {
  if (isRecord(value.adapterMetadata) && value.adapterMetadata.adapter !== adapter) issues.push({ path: 'adapterMetadata.adapter', message: kind + ' must use ' + adapter })
}

function validateGenerated(value: unknown, path: string, kind: 'roomGeneration' | 'terminal' | 'terminalLaunch' | 'runEvent' | 'serverInstance', issues: AgentEventValidationIssue[]): void {
  try { assertGeneratedId(value, kind) } catch { issues.push({ path, message: 'invalid ' + path }) }
}

function validateString(value: unknown, path: string, issues: AgentEventValidationIssue[]): void {
  if (typeof value !== 'string') issues.push({ path, message: path + ' must be a string' })
}

function validateNonEmptyString(value: unknown, path: string, issues: AgentEventValidationIssue[]): void {
  if (typeof value !== 'string' || value.length === 0) issues.push({ path, message: path + ' must be a non-empty string' })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isExactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new Date(value).toISOString() === value }
  catch { return false }
}
