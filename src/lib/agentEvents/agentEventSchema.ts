import { assertValidPublicId } from '../identifier'
import { AGENT_EVENT_ADAPTERS, AGENT_EVENT_KINDS, type AgentEvent, type AgentEventAdapter, type AgentEventKind, type AgentEventValidationIssue, type AgentEventValidationResult } from './agentEventTypes'

const KIND_SET = new Set<string>(AGENT_EVENT_KINDS)
const ADAPTER_SET = new Set<string>(AGENT_EVENT_ADAPTERS)

export function isAgentEventKind(value: unknown): value is AgentEventKind {
  return typeof value === 'string' && KIND_SET.has(value)
}

export function isAgentEventAdapter(value: unknown): value is AgentEventAdapter {
  return typeof value === 'string' && ADAPTER_SET.has(value)
}

export function validateAgentEvent(value: unknown): AgentEventValidationResult {
  const issues: AgentEventValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '$', message: 'AgentEvent must be an object' }] }
  }

  if (value.protocolVersion !== 1) issues.push({ path: 'protocolVersion', message: 'protocolVersion must be 1' })
  if (value.agentKind !== 'codex') issues.push({ path: 'agentKind', message: 'agentKind must be codex' })
  if (!isAgentEventKind(value.eventKind)) issues.push({ path: 'eventKind', message: 'eventKind is not supported' })
  validatePublicId(value.configId, 'configId', issues)
  validatePublicId(value.terminalId, 'terminalId', issues)
  validatePublicId(value.launchId, 'launchId', issues)
  validateNonEmptyString(value.agentSessionId, 'agentSessionId', issues)
  if (value.agentTurnId !== undefined) validateNonEmptyString(value.agentTurnId, 'agentTurnId', issues)
  if (typeof value.receivedAt !== 'string' || Number.isNaN(Date.parse(value.receivedAt))) {
    issues.push({ path: 'receivedAt', message: 'receivedAt must be an ISO timestamp' })
  }

  if (!isRecord(value.adapterMetadata)) {
    issues.push({ path: 'adapterMetadata', message: 'adapterMetadata must be an object' })
  } else {
    if (!isAgentEventAdapter(value.adapterMetadata.adapter)) {
      issues.push({ path: 'adapterMetadata.adapter', message: 'adapter is not supported' })
    }
    validateNonEmptyString(value.adapterMetadata.codexSessionId, 'adapterMetadata.codexSessionId', issues)
    if (typeof value.agentSessionId === 'string' && typeof value.adapterMetadata.codexSessionId === 'string' && value.agentSessionId !== value.adapterMetadata.codexSessionId) {
      issues.push({ path: 'adapterMetadata.codexSessionId', message: 'codexSessionId must match agentSessionId' })
    }
  }

  if (!isRecord(value.raw)) {
    issues.push({ path: 'raw', message: 'raw must be an object' })
  } else {
    validateNonEmptyString(value.raw.source, 'raw.source', issues)
    if (value.raw.payloadRef !== undefined) validateNonEmptyString(value.raw.payloadRef, 'raw.payloadRef', issues)
    if (value.raw.payload !== undefined && !isRecord(value.raw.payload)) {
      issues.push({ path: 'raw.payload', message: 'raw.payload must be an object' })
    }
  }

  if (value.eventKind === 'agent.prompt_submitted') {
    validateNonEmptyString(value.agentTurnId, 'agentTurnId', issues)
    validateString(value.capturedText, 'capturedText', issues)
    if (isRecord(value.adapterMetadata) && value.adapterMetadata.adapter !== 'codex-user-prompt-submit-hook') {
      issues.push({ path: 'adapterMetadata.adapter', message: 'agent.prompt_submitted must use codex-user-prompt-submit-hook' })
    }
  }
  if (value.eventKind === 'agent.output') {
    validateNonEmptyString(value.agentTurnId, 'agentTurnId', issues)
    validateString(value.capturedText, 'capturedText', issues)
    if (isRecord(value.adapterMetadata) && value.adapterMetadata.adapter !== 'codex-stop-hook') {
      issues.push({ path: 'adapterMetadata.adapter', message: 'agent.output must use codex-stop-hook' })
    }
  }
  if (value.eventKind === 'agent.session_started' && isRecord(value.adapterMetadata) && value.adapterMetadata.adapter !== 'codex-session-start-hook') {
    issues.push({ path: 'adapterMetadata.adapter', message: 'agent.session_started must use codex-session-start-hook' })
  }
  if (value.eventKind === 'agent.error') {
    if (isRecord(value.adapterMetadata) && value.adapterMetadata.adapter !== 'codex-hook-error') {
      issues.push({ path: 'adapterMetadata.adapter', message: 'agent.error must use codex-hook-error' })
    }
    if (value.error !== undefined) validateNonEmptyString(value.error, 'error', issues)
  }

  return { ok: issues.length === 0, issues }
}

export function assertValidAgentEvent(value: unknown): AgentEvent {
  const result = validateAgentEvent(value)
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.path + ': ' + issue.message).join('; '))
  return value as AgentEvent
}

function validatePublicId(value: unknown, path: string, issues: AgentEventValidationIssue[]): void {
  if (typeof value !== 'string') {
    issues.push({ path, message: path + ' must be a string' })
    return
  }
  try {
    assertValidPublicId(value, path === 'terminalId' ? 'terminalId' : path === 'configId' ? 'configId' : 'genericId')
  } catch (error) {
    issues.push({ path, message: error instanceof Error ? error.message : String(error) })
  }
}

function validateString(value: unknown, path: string, issues: AgentEventValidationIssue[]): void {
  if (typeof value !== 'string') {
    issues.push({ path, message: path + ' must be a string' })
  }
}

function validateNonEmptyString(value: unknown, path: string, issues: AgentEventValidationIssue[]): void {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({ path, message: path + ' must be a non-empty string' })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
