export const RUN_EVENT_KINDS = [
  'run_started',
  'run_paused',
  'run_resumed',
  'run_completed',
  'run_failed',
  'run_interrupted',
  'run_stopped',
  'step_started',
  'step_completed',
  'step_failed',
  'artifact_created',
  'terminal_ref_resolved',
  'wait_started',
  'wait_completed',
  'wait_timeout',
  'wait_manual_continue',
  'capture_wait_started',
  'capture_artifact_created',
  'terminal_line_sent',
  'user_input_requested',
  'user_input_submitted',
  'sleep_started',
  'sleep_completed',
  'parser_normalized',
  'parser_disagreement',
  'branch_decision',
  'control_transition',
  'user_override',
  'parallel_all_started',
  'parallel_lane_started',
  'parallel_lane_step_started',
  'parallel_lane_step_completed',
  'parallel_lane_waiting',
  'parallel_lane_parser_normalized',
  'parallel_lane_condition_evaluated',
  'parallel_lane_succeeded',
  'parallel_lane_failed',
  'parallel_all_joined',
] as const

export type RunEventKind = typeof RUN_EVENT_KINDS[number]
export type RunStatus = 'empty' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted' | 'stopped' | 'recoverable_error'
export type StepStatus = 'running' | 'completed' | 'failed'

export type RunEvent = {
  schemaVersion: 1
  eventId: string
  eventSeq: number
  runId: string
  configId: string
  kind: RunEventKind
  createdAt: string
  summary: string
  data: Record<string, unknown>
  stepId?: string
}

export type ValidationIssue = {
  path: string
  message: string
}

export type ValidationResult = {
  ok: boolean
  issues: ValidationIssue[]
}

export type AppendRunEventInput = {
  kind: RunEventKind
  summary: string
  data?: Record<string, unknown>
  stepId?: string
}

export type ArtifactRecord = {
  artifactRef: string
  sizeBytes: number
  createdAt: string
}

export type RecoverableReplayError = {
  kind: 'invalid_json' | 'trailing_half_line' | 'schema_mismatch' | 'event_seq_gap' | 'duplicate_event_id' | 'missing_artifact'
  message: string
  lineNumber: number
  eventSeq?: number
  artifactRef?: string
  failedEvent?: RunEvent
}

export type ReplayResult = {
  ok: boolean
  events: RunEvent[]
  error?: RecoverableReplayError
  diagnostics: string[]
}

export type RunDerivedState = {
  runId: string
  configId: string
  status: RunStatus
  currentStepId: string | null
  stepStatus: Record<string, StepStatus>
  artifactRefs: string[]
  pauseReason: string | null
  lastError: string | null
  eventCount: number
}

export type RunNodeLog = {
  nodeId: string
  title: string
  scope: 'run' | 'step'
  events: RunEvent[]
  artifactRefs: string[]
  missingArtifactRefs: string[]
  error?: string
  failedEvent?: RunEvent
}

export type RunSnapshot = {
  runId: string
  configId: string
  replay: ReplayResult
  derivedState: RunDerivedState
  nodeLogs: RunNodeLog[]
}

export type RunSummary = {
  runId: string
  configId: string
  status: RunStatus
  eventCount: number
  updatedAt: string | null
  templateId?: string
  templateName?: string
}

export type ArtifactWriteResult = {
  artifact: ArtifactRecord
  event: RunEvent
  snapshot: RunSnapshot
}
