import type { RunSnapshot, RunSummary } from '../runLog/runEventTypes'

export type MacroRunnerStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'waiting_user_input'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'stopped'

export type MacroRunnerPauseReason = {
  code: string
  message: string
  stepId?: string
}

export type MacroRunnerSnapshot = {
  configId: string
  status: MacroRunnerStatus
  runId: string | null
  templateId: string | null
  templateName: string | null
  currentStepId: string | null
  waitingInput: null | {
    stepId: string
    prompt: string
    allowEmpty: boolean
    terminalId: string
    defaultText?: string
  }
  pauseReason: MacroRunnerPauseReason | null
  run?: RunSnapshot
  runs: RunSummary[]
}

export type StartMacroRunRequest = {
  templateId: string
  mockCaptureText?: string
  mockCaptureReady?: boolean
}

export type SubmitMacroInputRequest = {
  text: string
}

export type RunnerApiResponse = {
  ok: true
  runner: MacroRunnerSnapshot
} | {
  ok: false
  error: string
  existingRunId?: string
}
