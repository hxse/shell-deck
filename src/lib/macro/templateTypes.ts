import type { TerminalRef } from '../terminalIdentity'
import type { SignalType } from './profileCatalogSummary'

export type TerminalTarget = TerminalRef
export type TimeoutAction = 'pause' | 'fail'
export type BranchOperator = '==' | '!=' | 'is_null'

export type CaptureSourceConfig =
  | {
    kind: 'terminal-buffer'
    terminal: TerminalTarget
    mode: 'scrollback-tail'
    maxChars: number
  }
  | {
    kind: 'agent-event'
    agentKind: 'codex'
    eventKind: 'agent.output'
    adapter: 'codex-stop-hook'
    terminal: TerminalTarget
  }

export type BooleanNullRegexRule = {
  signal: string
  type: SignalType
  pattern: string
  flags?: string
  onMatch: boolean | null
  onNoMatch: boolean | null
}

export type ParserConfig =
  | { kind: 'ai-json'; profileId: string }
  | { kind: 'regex'; rules: BooleanNullRegexRule[] }

export type BranchCondition = {
  signal: string
  op: BranchOperator
  value?: boolean
  goto: string
}

export type LaneSuccessCondition = {
  signal: string
  op: BranchOperator
  value?: boolean
}

export type LoopGuard = {
  maxIterations: number
  onLimit: TimeoutAction
}

export type MacroStepBase = {
  id: string
  type: string
  next?: string
  loopGuard?: LoopGuard
}

export type SendLineStep = MacroStepBase & {
  type: 'send_line'
  terminal: TerminalTarget
  text: string
}

export type SleepStep = MacroStepBase & {
  type: 'sleep'
  durationMs: number
}

export type InputLineStep = MacroStepBase & {
  type: 'input_line'
  terminal: TerminalTarget
  prompt: string
  allowEmpty: boolean
}

export type WaitStep =
  | (MacroStepBase & { type: 'wait'; mode: 'duration'; durationMs: number; next?: string })
  | (MacroStepBase & { type: 'wait'; mode: 'capture-ready-or-user'; captureStep: string; timeoutMs: number; onTimeout: TimeoutAction; next?: string })
  | (MacroStepBase & { type: 'wait'; mode: 'terminal-quiet'; terminal: TerminalTarget; quietMs: number; maxMs: number; onTimeout: TimeoutAction; next?: string })
  | (MacroStepBase & { type: 'wait'; mode: 'user-continue'; prompt: string; next?: string })

export type CaptureSourceStep = MacroStepBase & {
  type: 'capture-source'
  capture: CaptureSourceConfig
}

export type ParseStep = MacroStepBase & {
  type: 'parse'
  captureStep: string
  parser: ParserConfig
}

export type BranchStep = Omit<MacroStepBase, 'next'> & {
  type: 'branch'
  fromParseStep: string
  conditions: BranchCondition[]
  else?: string
}

export type GotoStep = MacroStepBase & {
  type: 'goto'
  goto: string
}

export type TerminalStateStep = Omit<MacroStepBase, 'next'> & {
  type: 'pause' | 'complete' | 'fail' | 'stop'
  reason?: string
}

export type ParallelLaneWaitStep =
  | { id: string; type: 'wait'; mode: 'duration'; durationMs: number }
  | { id: string; type: 'wait'; mode: 'capture-ready-or-user'; captureStep: string; timeoutMs: number; onTimeout: TimeoutAction }
  | { id: string; type: 'wait'; mode: 'terminal-quiet'; terminal: TerminalTarget; quietMs: number; maxMs: number; onTimeout: TimeoutAction }
  | { id: string; type: 'wait'; mode: 'user-continue'; prompt: string }

export type ParallelLaneStep =
  | (Omit<SendLineStep, 'terminal' | 'next' | 'loopGuard'> & { terminal?: TerminalTarget })
  | Omit<SleepStep, 'next' | 'loopGuard'>
  | ParallelLaneWaitStep
  | Omit<CaptureSourceStep, 'next' | 'loopGuard'>
  | Omit<ParseStep, 'next' | 'loopGuard'>

export type ParallelLane = {
  id: string
  terminal: TerminalTarget
  steps: ParallelLaneStep[]
  success: {
    fromParseStep: string
    mode: 'all'
    conditions: LaneSuccessCondition[]
  }
}

export type ParallelAllStep = MacroStepBase & {
  type: 'parallel_all'
  lanes: ParallelLane[]
  join: {
    mode: 'all_success'
    onLaneFail: TimeoutAction
    onTimeout?: TimeoutAction
  }
}

export type MacroStep =
  | SendLineStep
  | SleepStep
  | InputLineStep
  | WaitStep
  | CaptureSourceStep
  | ParseStep
  | BranchStep
  | GotoStep
  | TerminalStateStep
  | ParallelAllStep

export type MacroTemplate = {
  schemaVersion: 1
  id: string
  name: string
  description: string
  configId: string
  steps: MacroStep[]
  createdAt: string
  updatedAt: string
}

export type TemplateSummary = {
  id: string
  name: string
  description: string
  updatedAt: string
  stepCount: number
}

export type ValidationIssue = {
  path: string
  message: string
}

export type ValidationResult = {
  ok: boolean
  issues: ValidationIssue[]
}
