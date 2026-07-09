import { assertValidPublicId } from '../identifier'
import { assertEventId, assertRunId, assertStepId } from './identifier'
import { RUN_EVENT_KINDS, type RunEvent, type RunEventKind, type ValidationIssue, type ValidationResult } from './runEventTypes'

const RUN_SCOPED = new Set<RunEventKind>(['run_started', 'run_completed', 'run_failed', 'run_interrupted', 'run_stopped'])
const CONTEXT_SCOPED = new Set<RunEventKind>(['run_paused', 'run_resumed', 'artifact_created', 'user_override'])
const STEP_SCOPED = new Set<RunEventKind>([
  'step_started',
  'step_completed',
  'step_failed',
  'terminal_ref_resolved',
  'wait_started',
  'wait_completed',
  'wait_timeout',
  'wait_manual_continue',
  'capture_wait_started',
  'capture_artifact_created',
  'text_extracted',
  'terminal_text_sent',
  'user_input_requested',
  'user_input_submitted',
  'sleep_started',
  'sleep_completed',
  'parser_normalized',
  'parser_disagreement',
  'branch_decision',
  'control_transition',
  'parallel_all_started',
  'parallel_started',
  'parallel_lane_started',
  'parallel_lane_step_started',
  'parallel_lane_step_completed',
  'parallel_lane_waiting',
  'parallel_lane_parser_normalized',
  'parallel_lane_condition_evaluated',
  'parallel_lane_succeeded',
  'parallel_lane_failed',
  'parallel_lane_completed',
  'parallel_all_joined',
  'parallel_joined',
  'parallel_send_capture_started',
  'parallel_send_capture_item_started',
  'parallel_send_capture_item_completed',
  'parallel_send_capture_joined',
  'notification_requested',
  'notification_delivered',
  'notification_failed',
])
const KIND_SET = new Set<string>(RUN_EVENT_KINDS)

export type RunEventValidationOptions = {
  configId?: string
  runId?: string
  eventSeq?: number
}

export function isRunEventKind(value: unknown): value is RunEventKind {
  return typeof value === 'string' && KIND_SET.has(value)
}

export function validateRunEvent(value: unknown, options: RunEventValidationOptions = {}): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '$', message: 'event must be an object' }] }
  }

  if (value.schemaVersion !== 1) issues.push({ path: 'schemaVersion', message: 'schemaVersion must be 1' })
  validateId(value.eventId, 'eventId', assertEventId, issues)
  validateId(value.runId, 'runId', assertRunId, issues)
  validateId(value.configId, 'configId', (input) => assertValidPublicId(input, 'configId'), issues)

  if (!Number.isInteger(value.eventSeq) || Number(value.eventSeq) < 1) {
    issues.push({ path: 'eventSeq', message: 'eventSeq must be a positive integer' })
  } else if (options.eventSeq !== undefined && value.eventSeq !== options.eventSeq) {
    issues.push({ path: 'eventSeq', message: 'eventSeq must be ' + options.eventSeq })
  }

  if (!isRunEventKind(value.kind)) issues.push({ path: 'kind', message: 'kind is not supported' })
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) {
    issues.push({ path: 'createdAt', message: 'createdAt must be an ISO timestamp' })
  }
  if (typeof value.summary !== 'string' || value.summary.trim().length === 0) {
    issues.push({ path: 'summary', message: 'summary must be a non-empty string' })
  }
  if (!isRecord(value.data)) issues.push({ path: 'data', message: 'data must be an object' })

  if (typeof value.configId === 'string' && options.configId !== undefined && value.configId !== options.configId) {
    issues.push({ path: 'configId', message: 'configId does not match run scope' })
  }
  if (typeof value.runId === 'string' && options.runId !== undefined && value.runId !== options.runId) {
    issues.push({ path: 'runId', message: 'runId does not match run scope' })
  }

  if (isRunEventKind(value.kind)) {
    if (RUN_SCOPED.has(value.kind) && Object.prototype.hasOwnProperty.call(value, 'stepId')) {
      issues.push({ path: 'stepId', message: 'run-scoped event must omit stepId' })
    }
    if (STEP_SCOPED.has(value.kind) && typeof value.stepId !== 'string') {
      issues.push({ path: 'stepId', message: 'step-scoped event requires stepId' })
    }
    if (!RUN_SCOPED.has(value.kind) && !STEP_SCOPED.has(value.kind) && !CONTEXT_SCOPED.has(value.kind)) {
      issues.push({ path: 'kind', message: 'kind has no scope contract' })
    }
    if (Object.prototype.hasOwnProperty.call(value, 'stepId') && value.stepId !== undefined) {
      validateId(value.stepId, 'stepId', assertStepId, issues)
    }
  }

  return { ok: issues.length === 0, issues }
}

export function assertValidRunEvent(value: unknown, options: RunEventValidationOptions = {}): RunEvent {
  const result = validateRunEvent(value, options)
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.path + ': ' + issue.message).join('; '))
  return value as RunEvent
}

function validateId(value: unknown, path: string, assertId: (input: string) => string, issues: ValidationIssue[]): void {
  if (typeof value !== 'string') {
    issues.push({ path, message: path + ' must be a string' })
    return
  }
  try {
    assertId(value)
  } catch (error) {
    issues.push({ path, message: error instanceof Error ? error.message : String(error) })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
