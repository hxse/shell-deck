import type { TerminalRef } from "../terminalIdentity"

export type TerminalTarget = TerminalRef
export type TimeoutAction = "pause" | "fail" | "finish" | "continue"
export type BranchOperator = "==" | "!=" | "is_null"
export type SignalType = "boolean-null" | "string-enum"

export type BooleanNullRegexRule = {
  signal: string
  type: "boolean-null"
  pattern: string
  flags?: string
  onMatch: boolean | null
  onNoMatch: boolean | null
}

export type ParserConfig =
  | { kind: "ai-json"; profileId: string }
  | { kind: "regex"; rules: BooleanNullRegexRule[] }

export type CaptureSourceConfig =
  | {
    kind: "terminal-buffer"
    terminal: TerminalTarget
    mode: "scrollback-tail" | "raw-stream-tail"
    maxChars: number
  }
  | {
    kind: "text-box"
    terminal: TerminalTarget
  }
  | {
    kind: "agent-event"
    agent: { kind: "codex" }
    terminal: TerminalTarget
    eventKind: "stop"
    field: "last_assistant_message"
  }

export type ArtifactName = "captured_text" | "merged_text" | "extracted_text"

export type FlowV2ArtifactSource = {
  kind: "step_artifact"
  stepId: string
  artifact: ArtifactName
}

export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "artifact"; source?: FlowV2ArtifactSource }

export type MessageSpec = {
  parts: MessagePart[]
}

export type TextSplitSpec =
  | { kind: "lines"; keepEmpty: boolean }
  | { kind: "regex"; pattern: string; flags?: string; keepEmpty: boolean }

export type TextFilterMatcher =
  | { kind: "simple"; op: SimpleTextMatchOp; text: string }
  | { kind: "regex"; pattern: string; flags?: string }

export type TextFilterSpec = {
  kind: "include" | "exclude"
  matcher: TextFilterMatcher
}

export type TextSelectSpec =
  | { mode: "all" }
  | { mode: "index"; index: number }
  | { mode: "range"; start: number; end?: number }

export type TextExtractSpec =
  | { kind: "none" }
  | { kind: "regex"; pattern: string; flags?: string; group: number | string }

export type TextTrimMode = "none" | "left" | "right" | "both"

export type SimpleTextMatchOp = "contains" | "not_contains" | "equals" | "not_equals" | "starts_with" | "ends_with"

export type TextMatchCondition = {
  kind: "text_match"
  source: FlowV2ArtifactSource
  matcher:
    | { kind: "simple"; op: SimpleTextMatchOp; text: string }
    | { kind: "regex"; pattern: string; flags?: string }
  scope:
    | { kind: "whole" }
    | { kind: "lines"; mode: "first" | "last" | "any" | "all"; includeEmptyLines?: boolean }
}

export type SendLineNode = {
  id: string
  type: "send_line"
  terminal: TerminalTarget
  message: MessageSpec
}

export type InputLineNode = {
  id: string
  type: "input_line"
  terminal: TerminalTarget
  prompt: string
  allowEmpty: boolean
  defaultSource?: FlowV2ArtifactSource
}

export type WaitNode =
  | { id: string; type: "wait"; mode: "duration"; durationMs: number }
  | { id: string; type: "wait"; mode: "terminal-quiet"; terminal: TerminalTarget; quietMs: number; maxMs: number; onTimeout: TimeoutAction }
  | { id: string; type: "wait"; mode: "user-continue"; prompt: string }

export type CaptureSourceNode = {
  id: string
  type: "capture-source"
  capture: CaptureSourceConfig
}

export type ExtractTextNode = {
  id: string
  type: "extract_text"
  source: FlowV2ArtifactSource
  split: TextSplitSpec
  filters: TextFilterSpec[]
  select: TextSelectSpec
  extract: TextExtractSpec
  trim: TextTrimMode
  onEmpty: TimeoutAction
}

export type ParallelLaneActionNode = SendLineNode | WaitNode | CaptureSourceNode | ExtractTextNode

export type ParallelOutputSource = FlowV2ArtifactSource | { kind: "none" }

export type ParallelLaneOutputNode = {
  id: string
  type: "output"
  source: ParallelOutputSource
}

export type ParallelLaneNode = ParallelLaneActionNode | ParallelLaneOutputNode

export type ParallelLane = {
  id: string
  label: string
  terminal: TerminalTarget
  body: ParallelLaneNode[]
}

export type ParallelNode = {
  id: string
  type: "parallel"
  lanes: ParallelLane[]
  merge: {
    kind: "sectioned_text"
    separator: string
    includeEmptyOutputs: boolean
  }
  onLaneFail: "pause" | "fail"
}

export type FlowV2ActionNode = SendLineNode | InputLineNode | WaitNode | CaptureSourceNode | ExtractTextNode | ParallelNode

export type FlowV2IfBranch = {
  kind: "if" | "elif"
  condition: TextMatchCondition
  body: FlowV2Node[]
}

export type FlowV2ForRange = { kind?: "count"; count: number } | { kind: "forever" }

export type FlowV2ControlTerminalNode =
  | { id: string; type: "break"; reason?: string; body?: FlowV2ActionNode[] }
  | { id: string; type: "continue"; reason?: string; body?: FlowV2ActionNode[] }
  | { id: string; type: "finish"; reason?: string; body?: FlowV2ActionNode[] }

export type FlowV2ControlNode =
  | { id: string; type: "if"; branches: FlowV2IfBranch[]; else?: FlowV2Node[] }
  | { id: string; type: "for"; range: FlowV2ForRange; body: FlowV2Node[] }
  | FlowV2ControlTerminalNode

export type FlowV2Node = FlowV2ActionNode | FlowV2ControlNode

export type MacroTemplate = {
  schemaVersion: 2
  id: string
  name: string
  description: string
  configId: string
  body: FlowV2Node[]
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
