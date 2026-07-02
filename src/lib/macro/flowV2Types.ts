import type { BranchOperator, CaptureSourceConfig, ParserConfig, TerminalTarget, TimeoutAction } from './templateTypes'

export type FlowV2Template = {
  schemaVersion: 2
  id: string
  name: string
  description?: string
  configId: string
  body: FlowV2Node[]
  createdAt?: string
  updatedAt?: string
}

export type FlowV2Condition = {
  fromParseStep: string
  signal: string
  op: BranchOperator
  value?: boolean
}

export type FlowV2ArtifactSource = {
  kind: 'step_artifact'
  stepId: string
  artifact: 'captured_text' | 'merged_text'
}

export type FlowV2ParallelLane = {
  id: string
  terminal: TerminalTarget
  send: {
    text: string
  }
  wait:
    | { mode: 'duration'; durationMs: number }
    | { mode: 'terminal-quiet'; quietMs: number; maxMs: number; onTimeout: TimeoutAction }
  capture: {
    kind: 'terminal-buffer'
    mode: 'scrollback-tail'
    maxChars: number
  }
}

export type FlowV2MergeParallelResultsSource = {
  kind: 'parallel_all'
  stepId: string
  captures: 'all'
}

export type FlowV2ActionNode =
  | { id: string; type: 'send_line'; terminal: TerminalTarget; text: string }
  | { id: string; type: 'send_artifact'; terminal: TerminalTarget; source: FlowV2ArtifactSource }
  | { id: string; type: 'input_line'; terminal: TerminalTarget; prompt: string; allowEmpty: boolean }
  | { id: string; type: 'sleep'; mode: 'duration'; durationMs: number }
  | { id: string; type: 'sleep'; mode: 'until-resume'; reason?: string }
  | { id: string; type: 'wait'; mode: 'duration'; durationMs: number }
  | { id: string; type: 'wait'; mode: 'capture-ready-or-user'; captureStep: string; timeoutMs: number; onTimeout: TimeoutAction }
  | { id: string; type: 'wait'; mode: 'terminal-quiet'; terminal: TerminalTarget; quietMs: number; maxMs: number; onTimeout: TimeoutAction }
  | { id: string; type: 'wait'; mode: 'user-continue'; prompt: string }
  | { id: string; type: 'capture-source'; capture: CaptureSourceConfig }
  | { id: string; type: 'parse'; source: FlowV2ArtifactSource; parser: ParserConfig }
  | { id: string; type: 'parallel_all'; lanes: FlowV2ParallelLane[]; join: { mode: 'all_completed'; onLaneFail: TimeoutAction; onTimeout?: TimeoutAction } }
  | { id: string; type: 'merge_parallel_results'; source: FlowV2MergeParallelResultsSource; format: { kind: 'sectioned_text'; includeLaneId: boolean; includeTerminal: boolean } }

export type FlowV2IfBranch = {
  kind: 'if' | 'elif'
  condition: FlowV2Condition
  body: FlowV2Node[]
}

export type FlowV2ControlNode =
  | { id: string; type: 'if'; branches: FlowV2IfBranch[]; else?: FlowV2Node[] }
  | { id: string; type: 'for'; range: { count: number }; body: FlowV2Node[] }
  | { id: string; type: 'break'; reason?: string }
  | { id: string; type: 'continue'; reason?: string }
  | { id: string; type: 'return'; reason?: string }

export type FlowV2Node = FlowV2ActionNode | FlowV2ControlNode
