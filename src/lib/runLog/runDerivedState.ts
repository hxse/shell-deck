import { extractArtifactRefs } from './artifactRefs'
import type { ReplayResult, RunDerivedState, RunEvent, RunStatus, StepStatus } from './runEventTypes'

export function deriveRunState(configId: string, runId: string, replay: ReplayResult): RunDerivedState {
  const state: RunDerivedState = {
    runId,
    configId,
    status: replay.ok ? 'empty' : 'recoverable_error',
    currentStepId: null,
    stepStatus: {},
    artifactRefs: [],
    pauseReason: replay.error?.message ?? null,
    lastError: replay.error?.message ?? null,
    eventCount: replay.events.length,
  }
  const artifactRefs = new Set<string>()
  for (const event of replay.events) {
    applyEvent(state, event)
    for (const ref of extractArtifactRefs(event.data)) artifactRefs.add(ref)
  }
  state.artifactRefs = [...artifactRefs].sort()
  if (!replay.ok) {
    state.status = 'recoverable_error'
    state.pauseReason = replay.error?.message ?? state.pauseReason
    state.lastError = replay.error?.message ?? state.lastError
  }
  return state
}

function applyEvent(state: RunDerivedState, event: RunEvent): void {
  if (event.kind === 'run_started') setRunStatus(state, 'running')
  if (event.kind === 'run_resumed') {
    setRunStatus(state, 'running')
    state.pauseReason = null
  }
  if (event.kind === 'run_paused') {
    setRunStatus(state, 'paused')
    state.pauseReason = stringData(event, 'reason') ?? event.summary
  }
  if (event.kind === 'run_completed') {
    setRunStatus(state, 'completed')
    state.currentStepId = null
  }
  if (event.kind === 'run_failed') {
    setRunStatus(state, 'failed')
    state.currentStepId = null
    state.lastError = stringData(event, 'reason') ?? event.summary
  }
  if (event.kind === 'run_interrupted') {
    setRunStatus(state, 'interrupted')
    state.currentStepId = null
    state.pauseReason = stringData(event, 'reason') ?? event.summary
  }
  if (event.kind === 'step_started' && event.stepId) setStep(state, event.stepId, 'running')
  if (event.kind === 'step_completed' && event.stepId) setStep(state, event.stepId, 'completed')
  if (event.kind === 'step_failed' && event.stepId) {
    setStep(state, event.stepId, 'failed')
    setRunStatus(state, 'failed')
    state.lastError = stringData(event, 'reason') ?? event.summary
  }
}

function setRunStatus(state: RunDerivedState, status: RunStatus): void {
  state.status = status
}

function setStep(state: RunDerivedState, stepId: string, status: StepStatus): void {
  state.stepStatus = { ...state.stepStatus, [stepId]: status }
  state.currentStepId = status === 'running' ? stepId : state.currentStepId === stepId ? null : state.currentStepId
}

function stringData(event: RunEvent, key: string): string | null {
  const value = event.data[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}
