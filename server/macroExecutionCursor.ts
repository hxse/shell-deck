import type { AgentEvent } from "../src/lib/agentEvents/agentEventTypes"
import type { TextListTemplateBinding } from "../src/lib/macro/scopedTextTemplate"
import type { InputNode, TextListItem, WaitNode } from "../src/lib/macro/templateTypes"

export type ExecutionPathSegment =
  | { readonly kind: "for"; readonly stepId: string; readonly iterationIndex: number }
  | { readonly kind: "parallel-lane"; readonly stepId: string; readonly laneId: string }

export type ExecutionContext = {
  readonly executionPath: readonly ExecutionPathSegment[]
  readonly templateBinding?: TextListTemplateBinding
}

export type DurationWaitCursor = {
  mode: "duration"
  remainingMs: number
}

export type TerminalQuietWaitCursor = {
  mode: "terminal-quiet"
  remainingMs: number
  quietElapsedMs: number
  lastReplay: string
}

export type UserContinueWaitCursor = {
  mode: "user-continue"
  continueRequested: boolean
}

export type WaitCursor = DurationWaitCursor | TerminalQuietWaitCursor | UserContinueWaitCursor

export type WaitingInputExecutionCursor = {
  node: InputNode
  context: ExecutionContext
}

export type WaitingContinueExecutionCursor = {
  node: Extract<WaitNode, { mode: "user-continue" }>
  context: ExecutionContext
}

export type CapturedAgentEventsCursor = {
  text: string
  raw: unknown
  events: AgentEvent[]
  turnId: string | null
  sessionId: string | null
  codexSessionId: string | null
}

export type AgentEventCaptureCursor = {
  remainingMs: number
  captured?: CapturedAgentEventsCursor
}

export type NotificationExecutionCursor = {
  notificationId: string
  createdAt: string
  title: string
  message: string
  messageArtifactRef: string
  requested: boolean
  browserDelivered: boolean
  deliveredTelegramProfiles: Set<string>
}

export type NotificationExecutionCursorSnapshot = Omit<NotificationExecutionCursor, "deliveredTelegramProfiles"> & {
  deliveredTelegramProfiles: string[]
}

export type MacroExecutionCursor = {
  sequenceIndexes: Map<string, number>
  startedInvocations: Set<string>
  completedInvocations: Set<string>
  branchSelections: Map<string, number | "else" | "none">
  loopIterations: Map<string, number>
  completedParallelLanes: Set<string>
  waitStates: Map<string, WaitCursor>
  waitingInputExecution: WaitingInputExecutionCursor | null
  waitingContinueExecution: WaitingContinueExecutionCursor | null
  artifactRefs: Map<string, Map<string, string>>
  consumedAgentEvents: Set<string>
  agentEventBaselines: Map<string, number>
  agentEventCaptureStates: Map<string, AgentEventCaptureCursor>
  notificationStates: Map<string, NotificationExecutionCursor>
}

export type MacroExecutionCursorSnapshot = {
  schemaVersion: 1
  sequenceIndexes: Array<[string, number]>
  startedInvocations: string[]
  completedInvocations: string[]
  branchSelections: Array<[string, number | "else" | "none"]>
  loopIterations: Array<[string, number]>
  completedParallelLanes: string[]
  waitStates: Array<[string, WaitCursor]>
  waitingInputExecution: WaitingInputExecutionCursor | null
  waitingContinueExecution: WaitingContinueExecutionCursor | null
  artifactRefs: Array<[string, Array<[string, string]>]>
  consumedAgentEvents: string[]
  agentEventBaselines: Array<[string, number]>
  agentEventCaptureStates: Array<[string, AgentEventCaptureCursor]>
  notificationStates: Array<[string, NotificationExecutionCursorSnapshot]>
}

export function createMacroExecutionCursor(): MacroExecutionCursor {
  return {
    sequenceIndexes: new Map(),
    startedInvocations: new Set(),
    completedInvocations: new Set(),
    branchSelections: new Map(),
    loopIterations: new Map(),
    completedParallelLanes: new Set(),
    waitStates: new Map(),
    waitingInputExecution: null,
    waitingContinueExecution: null,
    artifactRefs: new Map(),
    consumedAgentEvents: new Set(),
    agentEventBaselines: new Map(),
    agentEventCaptureStates: new Map(),
    notificationStates: new Map(),
  }
}

export function snapshotMacroExecutionCursor(cursor: MacroExecutionCursor): MacroExecutionCursorSnapshot {
  return {
    schemaVersion: 1,
    sequenceIndexes: [...cursor.sequenceIndexes],
    startedInvocations: [...cursor.startedInvocations],
    completedInvocations: [...cursor.completedInvocations],
    branchSelections: [...cursor.branchSelections],
    loopIterations: [...cursor.loopIterations],
    completedParallelLanes: [...cursor.completedParallelLanes],
    waitStates: [...cursor.waitStates].map(([key, state]) => [key, { ...state }]),
    waitingInputExecution: cloneCursorValue(cursor.waitingInputExecution),
    waitingContinueExecution: cloneCursorValue(cursor.waitingContinueExecution),
    artifactRefs: [...cursor.artifactRefs].map(([key, refs]) => [key, [...refs]]),
    consumedAgentEvents: [...cursor.consumedAgentEvents],
    agentEventBaselines: [...cursor.agentEventBaselines],
    agentEventCaptureStates: [...cursor.agentEventCaptureStates].map(([key, state]) => [key, cloneCursorValue(state)]),
    notificationStates: [...cursor.notificationStates].map(([key, state]) => [key, {
      ...state,
      deliveredTelegramProfiles: [...state.deliveredTelegramProfiles],
    }]),
  }
}

export function restoreMacroExecutionCursor(snapshot: MacroExecutionCursorSnapshot): MacroExecutionCursor {
  if (snapshot.schemaVersion !== 1) throw new Error("unsupported_macro_execution_cursor_snapshot")
  return {
    sequenceIndexes: new Map(snapshot.sequenceIndexes),
    startedInvocations: new Set(snapshot.startedInvocations),
    completedInvocations: new Set(snapshot.completedInvocations),
    branchSelections: new Map(snapshot.branchSelections),
    loopIterations: new Map(snapshot.loopIterations),
    completedParallelLanes: new Set(snapshot.completedParallelLanes),
    waitStates: new Map(snapshot.waitStates.map(([key, state]) => [key, { ...state }])),
    waitingInputExecution: cloneCursorValue(snapshot.waitingInputExecution),
    waitingContinueExecution: cloneCursorValue(snapshot.waitingContinueExecution),
    artifactRefs: new Map(snapshot.artifactRefs.map(([key, refs]) => [key, new Map(refs)])),
    consumedAgentEvents: new Set(snapshot.consumedAgentEvents),
    agentEventBaselines: new Map(snapshot.agentEventBaselines),
    agentEventCaptureStates: new Map(snapshot.agentEventCaptureStates.map(([key, state]) => [key, cloneCursorValue(state)])),
    notificationStates: new Map(snapshot.notificationStates.map(([key, state]) => [key, {
      ...state,
      deliveredTelegramProfiles: new Set(state.deliveredTelegramProfiles),
    }])),
  }
}

export function pruneCompletedExecutionScope(cursor: MacroExecutionCursor, context: ExecutionContext): void {
  const scopePath = pathKey(context.executionPath)
  if (scopePath.length === 0) return

  pruneSet(cursor.startedInvocations, scopePath)
  pruneSet(cursor.completedInvocations, scopePath)
  pruneSet(cursor.completedParallelLanes, scopePath)
  pruneMap(cursor.sequenceIndexes, scopePath)
  pruneMap(cursor.branchSelections, scopePath)
  pruneMap(cursor.loopIterations, scopePath)
  pruneMap(cursor.waitStates, scopePath)
  pruneMap(cursor.artifactRefs, scopePath)
  pruneMap(cursor.agentEventBaselines, scopePath)
  pruneMap(cursor.agentEventCaptureStates, scopePath)
  pruneMap(cursor.notificationStates, scopePath)
}

export function rootExecutionContext(): ExecutionContext {
  return { executionPath: [] }
}

export function forIterationContext(parent: ExecutionContext, stepId: string, iterationIndex: number, item: TextListItem | undefined): ExecutionContext {
  return {
    executionPath: [...parent.executionPath, { kind: "for", stepId, iterationIndex }],
    templateBinding: item === undefined
      ? parent.templateBinding
      : { index: iterationIndex + 1, key: item.key, value: item.value, forStepId: stepId },
  }
}

export function parallelLaneContext(parent: ExecutionContext, stepId: string, laneId: string): ExecutionContext {
  return {
    executionPath: [...parent.executionPath, { kind: "parallel-lane", stepId, laneId }],
    templateBinding: parent.templateBinding,
  }
}

export function invocationKey(context: ExecutionContext, stepId: string): string {
  return invocationKeyForPath(context.executionPath, stepId)
}

export function sequenceKey(context: ExecutionContext, owner: string): string {
  return "sequence:" + owner + ":" + pathKey(context.executionPath)
}

export function parallelLaneKey(context: ExecutionContext, parentStepId: string, laneId: string): string {
  return invocationKey(context, parentStepId) + ":lane:" + laneId
}

export function artifactInvocationCandidates(context: ExecutionContext, producerStepId: string): string[] {
  const candidates: string[] = []
  for (let length = context.executionPath.length; length >= 0; length -= 1) {
    candidates.push(invocationKeyForPath(context.executionPath.slice(0, length), producerStepId))
  }
  return candidates
}

export function executionPathData(context: ExecutionContext): ExecutionPathSegment[] {
  return context.executionPath.map((segment) => ({ ...segment }))
}

function invocationKeyForPath(path: readonly ExecutionPathSegment[], stepId: string): string {
  return "invocation:" + stepId + ":" + pathKey(path)
}

function pathKey(path: readonly ExecutionPathSegment[]): string {
  return path.map((segment) => segment.kind === "for"
    ? "for(" + segment.stepId + ")[" + segment.iterationIndex + "]"
    : "parallel(" + segment.stepId + ")/" + segment.laneId).join("/")
}

function pruneSet(values: Set<string>, scopePath: string): void {
  for (const key of values) {
    if (keyBelongsToScope(key, scopePath)) values.delete(key)
  }
}

function pruneMap<T>(values: Map<string, T>, scopePath: string): void {
  for (const key of values.keys()) {
    if (keyBelongsToScope(key, scopePath)) values.delete(key)
  }
}

function keyBelongsToScope(key: string, scopePath: string): boolean {
  const marker = ":" + scopePath
  const start = key.indexOf(marker)
  if (start < 0) return false
  const boundary = key[start + marker.length]
  return boundary === undefined || boundary === "/" || boundary === ":" || boundary === "|"
}

function cloneCursorValue<T>(value: T): T {
  return structuredClone(value)
}
