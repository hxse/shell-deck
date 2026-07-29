import type { TerminalEnding } from './terminalEnding'
import type { TerminalInputDelivery } from './terminalInputDelivery'
import type { JsonScalar, JsonSchema } from './structuredJson'

export type { TerminalEnding } from './terminalEnding'
export type { ResolvedTerminalInputDelivery, TerminalInputDelivery } from './terminalInputDelivery'

export type TerminalType = 'shell' | 'text'
export type MacroTerminalLayoutItem = { index: number; type: TerminalType }
export type MacroTerminalReference = { kind: 'terminal_index'; index: number } | { kind: 'unassigned' }
export type TimeoutAction = 'pause' | 'fail' | 'finish' | 'continue'
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'
export type NotificationFailureAction = 'continue' | 'pause' | 'fail'
export type NotificationSound = 'none' | 'bell' | 'chime' | 'ping' | 'pulse' | 'success' | 'warning' | 'alert'

export type NotifyChannel =
  | { kind: 'app'; toast: boolean; sound: NotificationSound; repeatCount: number; repeatIntervalMs: number }
  | { kind: 'system' }
  | { kind: 'telegram'; profileId: string }

export type AgentEventCaptureMode = 'result_only' | 'prompt_only' | 'prompt_and_result'
export type CaptureWaitLimit = { kind: 'unbounded' } | { kind: 'timeout'; timeoutMs: number }
export type CaptureSourceConfig =
  | { kind: 'terminal-buffer'; terminal: MacroTerminalReference; mode: 'scrollback-tail' | 'raw-stream-tail'; maxChars: number }
  | { kind: 'text-box'; terminal: MacroTerminalReference }
  | { kind: 'agent-event'; agent: { kind: 'codex' }; terminal: MacroTerminalReference; captureMode: AgentEventCaptureMode; waitLimit: CaptureWaitLimit }
  | { kind: 'structured-json'; terminal: MacroTerminalReference; schema: JsonSchema; waitLimit: CaptureWaitLimit }

export type TextArtifactName = 'captured_text' | 'extracted_text'
export type JsonArtifactName = 'captured_json'
export type ArtifactName = TextArtifactName | JsonArtifactName
export type FlowV2TextStepArtifactSource = { kind: 'step_artifact'; stepId: string; artifact: TextArtifactName }
export type FlowV2JsonStepArtifactSource = { kind: 'step_artifact'; stepId: string; artifact: JsonArtifactName }
export type FlowV2StepArtifactSource = FlowV2TextStepArtifactSource | FlowV2JsonStepArtifactSource
export type FlowV2ArtifactSource = FlowV2StepArtifactSource | { kind: 'unassigned' }
export type FlowV2TextArtifactSource = FlowV2TextStepArtifactSource | { kind: 'unassigned' }
export type FlowV2JsonArtifactSource = FlowV2JsonStepArtifactSource | { kind: 'unassigned' }
export type ScopedTemplateText = { kind: 'template'; template: string }
export type TemplatableScalarText = string | ScopedTemplateText
export type MessagePart = { kind: 'text'; text: string } | ScopedTemplateText | { kind: 'artifact'; source: FlowV2ArtifactSource }
export type MessageSpec = { parts: MessagePart[] }

export type TextSplitSpec =
  | { kind: 'lines'; keepEmpty: boolean }
  | { kind: 'regex'; pattern: string; flags?: string; keepEmpty: boolean }
export type SimpleTextMatchOp = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with'
export type TextFilterMatcher =
  | { kind: 'simple'; op: SimpleTextMatchOp; text: string }
  | { kind: 'regex'; pattern: string; flags?: string }
export type TextFilterSpec = { kind: 'include' | 'exclude'; matcher: TextFilterMatcher }
export type TextSelectSpec = { mode: 'all' } | { mode: 'index'; index: number } | { mode: 'range'; start: number; end?: number }
export type TextExtractSpec = { kind: 'none' } | { kind: 'regex'; pattern: string; flags?: string; group: number | string }
export type TextTrimMode = 'none' | 'left' | 'right' | 'both'
export type TextMatchCondition = {
  kind: 'text_match'
  source: FlowV2ArtifactSource
  matcher: TextFilterMatcher
  scope: { kind: 'whole' } | { kind: 'lines'; mode: 'first' | 'last' | 'any' | 'all'; includeEmptyLines?: boolean }
}
export type JsonMatchKind =
  | 'exists'
  | 'not_exists'
  | 'equals'
  | 'not_equals'
  | 'less_than'
  | 'less_than_or_equal'
  | 'greater_than'
  | 'greater_than_or_equal'
export type JsonMatchCondition = {
  kind: 'json_match'
  source: FlowV2JsonArtifactSource
  pointer: string
  matcher:
    | { kind: 'exists' | 'not_exists' }
    | { kind: 'equals' | 'not_equals'; value: JsonScalar }
    | { kind: 'less_than' | 'less_than_or_equal' | 'greater_than' | 'greater_than_or_equal'; value: number }
}
export type MacroCondition = TextMatchCondition | JsonMatchCondition

export type SendNode = { id: string; type: 'send'; terminal: MacroTerminalReference; message: MessageSpec; delivery: TerminalInputDelivery; ending: TerminalEnding }
export type NotifyNode = { id: string; type: 'notify'; level: NotificationLevel; title: TemplatableScalarText; message: MessageSpec; channels: NotifyChannel[]; onFailure: NotificationFailureAction }
export type InputNode = { id: string; type: 'input'; terminal: MacroTerminalReference; prompt: TemplatableScalarText; allowEmpty: boolean; delivery: TerminalInputDelivery; ending: TerminalEnding; defaultSource?: FlowV2StepArtifactSource }
export type WaitNode =
  | { id: string; type: 'wait'; mode: 'duration'; durationMs: number }
  | { id: string; type: 'wait'; mode: 'terminal-quiet'; terminal: MacroTerminalReference; quietMs: number; maxMs: number; onTimeout: TimeoutAction }
  | { id: string; type: 'wait'; mode: 'user-continue'; prompt: TemplatableScalarText }
export type CaptureSourceNode = { id: string; type: 'capture-source'; capture: CaptureSourceConfig }
export type ExtractTextNode = { id: string; type: 'extract_text'; source: FlowV2ArtifactSource; split: TextSplitSpec; filters: TextFilterSpec[]; select: TextSelectSpec; extract: TextExtractSpec; trim: TextTrimMode; onEmpty: TimeoutAction }

export type ParallelCaptureNode = {
  id: string
  type: 'capture-source'
  capture: Exclude<CaptureSourceConfig, { kind: 'structured-json' }>
}
export type ParallelLaneActionNode =
  | SendNode
  | Extract<WaitNode, { mode: 'duration' | 'terminal-quiet' }>
  | ParallelCaptureNode
  | ExtractTextNode
  | NotifyNode
export type ParallelLane = { id: string; label: string; body: ParallelLaneActionNode[] }
export type ParallelSharedTextOrder = 'pane_order' | 'completion_order'
export type ParallelNode = {
  id: string
  type: 'parallel'
  lanes: ParallelLane[]
  sharedTextOrder: ParallelSharedTextOrder
  onLaneFail: 'pause' | 'fail'
}

export type FlowV2ActionNode = SendNode | NotifyNode | InputNode | WaitNode | CaptureSourceNode | ExtractTextNode | ParallelNode
export type FlowV2IfBranch = { kind: 'if' | 'elif'; condition: MacroCondition; body: FlowV2Node[] }
export type TextListItem = { key: string; value: string }
export type FlowV2ForRange = { kind: 'count'; count: number } | { kind: 'forever' } | { kind: 'text-list'; items: TextListItem[] }
export type FlowV2ControlTerminalNode =
  | { id: string; type: 'break'; reason?: string; body?: FlowV2ActionNode[] }
  | { id: string; type: 'continue'; reason?: string; body?: FlowV2ActionNode[] }
  | { id: string; type: 'finish'; reason?: string; body?: FlowV2ActionNode[] }
export type FlowV2ControlNode =
  | { id: string; type: 'if'; branches: FlowV2IfBranch[]; else?: FlowV2Node[] }
  | { id: string; type: 'for'; range: FlowV2ForRange; body: FlowV2Node[] }
  | FlowV2ControlTerminalNode
export type FlowV2Node = FlowV2ActionNode | FlowV2ControlNode

export type MacroDefinitionV6 = {
  schemaVersion: 6
  name: string
  description: string
  terminalLayout: MacroTerminalLayoutItem[]
  body: FlowV2Node[]
}

export type MacroRecord = {
  id: string
  revision: number
  createdAt: string
  updatedAt: string
  definition: MacroDefinitionV6
}

export type MacroRecordSummary = {
  id: string
  revision: number
  name: string
  description: string
  updatedAt: string
  stepCount: number
}
