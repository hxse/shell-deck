import type { MacroDefinitionIssue } from '../src/lib/macro/macroDefinitionValidation'
import type { MacroDefinitionV6 } from '../src/lib/macro/macroDefinitionTypes'
import type {
  FrozenTerminalBinding,
  MacroRunnerActionAck,
  MacroRunnerSnapshot,
} from '../src/lib/macro/runnerTypes'
import type { TextListTemplateBinding } from '../src/lib/macro/scopedTextTemplate'
import type { StructuredJsonValidator, JsonValue } from '../src/lib/macro/structuredJson'
import type { MacroArtifactMap } from './macroTextEvaluation'

export type PendingInputResult =
  | { kind: 'submitted'; value: string }
  | { kind: 'cancelled' }

export type PendingInput = {
  invocationId: string
  prompt: string
  defaultText: string
  draft: string
  inputRevision: number
  resolve: (result: PendingInputResult) => void
}

export type PendingStructuredCapture = {
  stepId: string
  binding: FrozenTerminalBinding
  validator: StructuredJsonValidator
  submittedValue: JsonValue | undefined
}

export type LiveRun = {
  runId: string
  roomId: string
  roomGeneration: string
  recordId: string
  recordRevision: number
  runtimeRevision: number
  publishedEventSeq: number
  publishedRuntimeRevision: number
  hasPublishedSnapshot: boolean
  definitionHash: string
  publishTimer: ReturnType<typeof setTimeout> | null
  definition: MacroDefinitionV6
  bindings: Map<number, FrozenTerminalBinding>
  status: MacroRunnerSnapshot['status']
  currentNodeId: string | null
  error: string | null
  abortController: AbortController
  pauseWaiters: Array<() => void>
  pendingInput: PendingInput | null
  pendingStructuredCapture: PendingStructuredCapture | null
  artifacts: MacroArtifactMap
  templateBindings: TextListTemplateBinding[]
  parallelProgress: Map<string, number>
  agentEventBaselines: Map<string, number>
  consumedAgentEventIds: Set<string>
  terminalized: boolean
  cooperativeCheckpointCount: number
  pausedStartedAtMs: number | null
  accumulatedPausedMs: number
}

export class MacroNotRunnableError extends Error {
  constructor(readonly issues: MacroDefinitionIssue[]) { super('macro_not_runnable') }
}

export type MacroStartPreflight = {
  recordId: string
  recordRevision: number
  definitionHash: string
}

export function createLiveRun(input: {
  runId: string
  roomId: string
  roomGeneration: string
  recordId: string
  recordRevision: number
  runtimeRevision: number
  definitionHash: string
  definition: MacroDefinitionV6
  bindings: FrozenTerminalBinding[]
}): LiveRun {
  freezeDefinitionProjection(input.definition)
  return {
    ...input,
    publishedEventSeq: 0,
    publishedRuntimeRevision: 0,
    hasPublishedSnapshot: false,
    publishTimer: null,
    bindings: new Map(input.bindings.map((binding) => [binding.index, binding])),
    status: 'running',
    currentNodeId: null,
    error: null,
    abortController: new AbortController(),
    pauseWaiters: [],
    pendingInput: null,
    pendingStructuredCapture: null,
    artifacts: new Map(),
    templateBindings: [],
    parallelProgress: new Map(),
    agentEventBaselines: new Map(),
    consumedAgentEventIds: new Set(),
    terminalized: false,
    cooperativeCheckpointCount: 0,
    pausedStartedAtMs: null,
    accumulatedPausedMs: 0,
  }
}

function freezeDefinitionProjection(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freezeDefinitionProjection(child)
  Object.freeze(value)
}

export function isActiveRunStatus(status: MacroRunnerSnapshot['status']): boolean {
  return ['starting', 'running', 'paused', 'waiting_input', 'stopping'].includes(status)
}

export function liveRunRuntimeInput(run: LiveRun): MacroRunnerSnapshot['runtimeInput'] {
  return run.pendingInput ? {
    invocationId: run.pendingInput.invocationId,
    prompt: run.pendingInput.prompt,
    defaultText: run.pendingInput.defaultText,
    draft: run.pendingInput.draft,
    inputRevision: run.pendingInput.inputRevision,
    status: 'waiting',
  } : null
}

export function liveRunActionAck(run: LiveRun): MacroRunnerActionAck {
  return {
    roomId: run.roomId,
    roomGeneration: run.roomGeneration,
    runId: run.runId,
    runtimeRevision: run.runtimeRevision,
    status: run.status,
    runtimeInput: run.pendingInput ? {
      invocationId: run.pendingInput.invocationId,
      inputRevision: run.pendingInput.inputRevision,
      status: 'waiting',
    } : null,
  }
}
