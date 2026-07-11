import shortUuid from "short-uuid"
import { validateMacroTemplate } from "../src/lib/macro/templateSchema"
import { renderScopedTemplate, renderTemplatableScalar } from "../src/lib/macro/scopedTextTemplate"
import type {
  CaptureSourceConfig,
  ExtractTextNode,
  FlowV2ArtifactSource,
  FlowV2Node,
  InputNode,
  MacroTemplate,
  MessageSpec,
  NotifyChannel,
  NotifyNode,
  ParallelLane,
  ParallelLaneNode,
  ParallelLaneOutputNode,
  ParallelNode,
  SendNode,
  TerminalTarget,
  TextFilterMatcher,
  TextListItem,
  TextMatchCondition,
  WaitNode,
} from "../src/lib/macro/templateTypes"
import { AgentEventStore, agentEventKey } from "../src/lib/agentEvents/agentEventStore"
import type { AgentEvent, AgentEventMatch } from "../src/lib/agentEvents/agentEventTypes"
import { captureTerminalBuffer } from "../src/lib/capture/terminalBufferCapture"
import { ParserRuntime } from "../src/lib/parser/parserRuntime"
import type { MacroRunnerPauseReason, MacroRunnerSnapshot, MacroRunnerStatus, StartMacroRunRequest } from "../src/lib/macro/runnerTypes"
import { resolveTerminalTargetInConfig, type ResolvedTerminalRef } from "../src/lib/macro/terminalRefResolver"
import type { RunSummary } from "../src/lib/runLog/runEventTypes"
import { RunEventStore } from "../src/lib/runLog/runEventStore"
import type { TerminalSnapshot } from "../src/lib/protocol"
import { MacroTemplateStore } from "../src/lib/macro/templateStore"
import { TerminalDeckManager } from "./terminalDeckManager"
import { NotificationService, type NotificationDispatcher } from "./notificationService"
import {
  artifactInvocationCandidates,
  createMacroExecutionCursor,
  executionPathData,
  forIterationContext,
  invocationKey,
  parallelLaneContext,
  parallelLaneKey,
  pruneCompletedExecutionScope,
  rootExecutionContext,
  sequenceKey,
  type DurationWaitCursor,
  type CapturedAgentEventsCursor,
  type ExecutionContext,
  type MacroExecutionCursor,
  type TerminalQuietWaitCursor,
} from "./macroExecutionCursor"

type ControlResult = "completed" | "suspended" | "break" | "continue" | "finish"
type CaptureExecutionResult = { artifactRef: string; text: string }
type AgentEventCaptureMode = "result_only" | "prompt_only" | "prompt_and_result"
type CapturedAgentEvents = CapturedAgentEventsCursor
type CaptureExecutionOptions = { eventData?: Record<string, unknown>; captureIdentityId?: string }
type ParallelLaneExecutionResult = { laneId: string; laneLabel: string; terminalAlias: string; text: string }
type ParallelLaneExecutionFailure = { laneId: string; context: ExecutionContext; error: unknown }
const MACRO_ENTER_SEQUENCE = "\n"
const notificationIdTranslator = shortUuid()

type RuntimeState = {
  configId: string
  runId: string
  template: MacroTemplate
  status: MacroRunnerStatus
  currentStepId: string | null
  nextStepId: string | null
  nextContext: ExecutionContext
  currentContext: ExecutionContext
  pauseReason: MacroRunnerPauseReason | null
  waitingInput: MacroRunnerSnapshot["waitingInput"]
  cursor: MacroExecutionCursor
  pauseRequested: boolean
  pauseRequestedAt: number | null
  pendingUserPause: boolean
  stopRequested: boolean
  activeOperations: number
  boundaryWaiters: Array<() => void>
  inputSubmissionInProgress: boolean
  checkpointDrain: boolean
  runActive: boolean
  runAgainRequested: boolean
  token: number
}

export class MacroRunnerService {
  private readonly runtimes = new Map<string, RuntimeState>()
  private nextToken = 1

  constructor(
    readonly manager: TerminalDeckManager,
    readonly templateStore: MacroTemplateStore,
    readonly runEventStore: RunEventStore,
    readonly agentEventStore = new AgentEventStore(runEventStore.rootDir),
    readonly parserRuntime = new ParserRuntime(runEventStore),
    readonly notificationService: NotificationDispatcher = new NotificationService(runEventStore.rootDir),
  ) {}

  snapshot(configId: string): MacroRunnerSnapshot {
    const runtime = this.runtimes.get(configId)
    if (runtime) return this.snapshotForRuntime(configId, runtime)
    const storedLive = this.storedLiveRun(configId)
    if (storedLive) return this.snapshotForStoredInterrupted(configId, storedLive)
    return this.snapshotForRuntime(configId)
  }

  async start(configId: string, request: StartMacroRunRequest): Promise<MacroRunnerSnapshot> {
    const existing = this.runtimes.get(configId)
    if (existing && isLive(existing.status)) throw liveRunError(existing.runId)
    this.manager.ensureConfig(configId)
    const storedLive = this.storedLiveRun(configId)
    if (storedLive) throw liveRunError(storedLive.runId)

    const template = this.templateStore.read(configId, request.templateId)
    const validation = validateMacroTemplate(template, { indexMap: this.manager.indexMap(configId), terminals: this.manager.deckSnapshot(configId).terminals })
    const run = await this.runEventStore.createRun(configId, { templateId: template.id, templateName: template.name })
    const runtime: RuntimeState = {
      configId,
      runId: run.runId,
      nextStepId: template.body[0]?.id ?? null,
      nextContext: rootExecutionContext(),
      template,
      status: "running",
      currentStepId: template.body[0]?.id ?? null,
      currentContext: rootExecutionContext(),
      pauseReason: null,
      waitingInput: null,
      cursor: createMacroExecutionCursor(),
      pauseRequested: false,
      pauseRequestedAt: null,
      pendingUserPause: false,
      stopRequested: false,
      activeOperations: 0,
      boundaryWaiters: [],
      inputSubmissionInProgress: false,
      checkpointDrain: false,
      runActive: false,
      runAgainRequested: false,
      token: this.nextToken++,
    }
    this.runtimes.set(configId, runtime)

    if (!validation.ok) {
      await this.failRun(runtime, "preflight_failed", validation.issues.map((issue) => issue.path + ": " + issue.message).join("; "))
      return this.snapshotForRuntime(configId, runtime)
    }
    if (template.body.length === 0) {
      await this.failRun(runtime, "preflight_failed", "template has no body")
      return this.snapshotForRuntime(configId, runtime)
    }
    this.initializeAgentEventBaselines(runtime)
    this.scheduleRun(runtime)
    return this.snapshotForRuntime(configId, runtime)
  }

  async pause(configId: string): Promise<MacroRunnerSnapshot> {
    const runtime = this.runtimeOrThrow(configId)
    if (runtime.status === "paused" || !isLive(runtime.status)) return this.snapshotForRuntime(configId, runtime)
    runtime.pendingUserPause = true
    this.requestOperationInterruption(runtime)
    await this.settleAtOperationBoundary(runtime)
    return this.snapshotForRuntime(configId, runtime)
  }

  async resume(configId: string): Promise<MacroRunnerSnapshot> {
    const runtime = this.runtimeOrThrow(configId)
    await this.waitForOperationsIdle(runtime)
    this.beginOperation(runtime)
    let shouldSchedule = false
    try {
      if (runtime.status === "waiting") {
        const waiting = runtime.cursor.waitingContinueExecution
        const key = waiting ? invocationKey(waiting.context, waiting.node.id) : ""
        const waitState = key ? runtime.cursor.waitStates.get(key) : undefined
        if (waiting && waitState?.mode === "user-continue") {
          waitState.continueRequested = true
          runtime.status = "running"
          runtime.pauseRequested = false
          runtime.pauseRequestedAt = null
          runtime.pauseReason = null
          runtime.currentStepId = waiting.node.id
          runtime.currentContext = waiting.context
          await this.runEventStore.appendEvent(configId, runtime.runId, {
            kind: "wait_manual_continue",
            stepId: waiting.node.id,
            summary: "Manual continue requested",
            data: { mode: waiting.node.mode, executionPath: executionPathData(waiting.context) },
          })
          shouldSchedule = true
        }
      } else if (runtime.status === "paused") {
        runtime.status = "running"
        runtime.pauseRequested = false
        runtime.pauseRequestedAt = null
        runtime.pauseReason = null
        runtime.waitingInput = null
        await this.runEventStore.appendEvent(configId, runtime.runId, {
          kind: "run_resumed",
          summary: "Run resumed",
          data: { nextStepId: runtime.nextStepId, executionPath: executionPathData(runtime.nextContext) },
        })
        shouldSchedule = true
      }
    } finally {
      await this.endOperation(runtime)
    }
    if (shouldSchedule && runtime.status === "running" && !runtime.pauseRequested) this.scheduleRun(runtime)
    return this.snapshotForRuntime(configId, runtime)
  }

  async stop(configId: string): Promise<MacroRunnerSnapshot> {
    const runtime = this.runtimes.get(configId)
    if (!runtime) {
      const storedLive = this.storedLiveRun(configId)
      if (!storedLive) throw new Error("runner_idle")
      await this.runEventStore.appendEvent(configId, storedLive.runId, { kind: "run_stopped", summary: "Run stopped", data: { reason: "Stopped after runtime interruption" } })
      return this.snapshot(configId)
    }
    if (!isLive(runtime.status)) return this.snapshotForRuntime(configId, runtime)
    runtime.stopRequested = true
    runtime.pendingUserPause = false
    this.requestOperationInterruption(runtime)
    await this.settleAtOperationBoundary(runtime)
    return this.snapshotForRuntime(configId, runtime)
  }

  async submitInput(configId: string, text: string): Promise<MacroRunnerSnapshot> {
    const runtime = this.runtimeOrThrow(configId)
    if (runtime.inputSubmissionInProgress) throw new Error("input_submission_in_progress")
    runtime.inputSubmissionInProgress = true
    let shouldSchedule = false
    try {
      await this.waitForOperationsIdle(runtime)
      const waiting = runtime.waitingInput
      const execution = runtime.cursor.waitingInputExecution
      if (runtime.status !== "waiting_user_input" || !waiting || !execution) throw new Error("runner_not_waiting_for_input")
      if (!waiting.allowEmpty && text.length === 0) throw new Error("input_empty_not_allowed")

      this.beginOperation(runtime)
      try {
        const sent = await this.sendInput(runtime, execution.node, execution.context, text)
        if (sent && !runtime.stopRequested && runtime.status === "waiting_user_input") {
          runtime.status = "running"
          runtime.pauseReason = null
          runtime.waitingInput = null
          runtime.cursor.waitingInputExecution = null

          runtime.pauseRequested = true
          runtime.checkpointDrain = true
          try {
            await this.run(runtime)
          } finally {
            runtime.checkpointDrain = false
          }

          if (runtime.status === "running" && !runtime.pendingUserPause && !runtime.stopRequested) {
            runtime.pauseRequested = false
            runtime.pauseRequestedAt = null
            shouldSchedule = true
          }
        }
      } finally {
        await this.endOperation(runtime)
      }
      if (shouldSchedule && runtime.status === "running" && !runtime.pauseRequested) this.scheduleRun(runtime)
      return this.snapshotForRuntime(configId, runtime)
    } finally {
      runtime.inputSubmissionInProgress = false
    }
  }

  private scheduleRun(runtime: RuntimeState): void {
    if (runtime.runActive) {
      runtime.runAgainRequested = true
      return
    }
    void this.run(runtime)
  }

  private async run(runtime: RuntimeState): Promise<void> {
    if (runtime.runActive) {
      runtime.runAgainRequested = true
      return
    }
    runtime.runActive = true
    this.beginOperation(runtime)
    try {
      if (this.runtimes.get(runtime.configId)?.token !== runtime.token) return
      if (runtime.status !== "running" || (runtime.pauseRequested && !runtime.checkpointDrain)) return
      const result = await this.executeBody(runtime, runtime.template.body, rootExecutionContext(), "root")
      if (result === "completed" && !runtime.stopRequested) await this.completeRun(runtime, "Run completed")
      if (result === "finish" && !runtime.stopRequested) await this.completeRun(runtime, "Run finished")
      if ((result === "break" || result === "continue") && !runtime.stopRequested) {
        await this.pauseRun(runtime, "control_outside_loop", result + " escaped loop")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = message === "missing_template_binding" ? "missing_template_binding" : "step_error"
      if (runtime.status === "running" && !runtime.stopRequested) {
        await this.pauseRun(runtime, code, message, runtime.currentStepId ?? undefined)
      }
    } finally {
      runtime.runActive = false
      await this.endOperation(runtime)
      if (runtime.runAgainRequested) {
        runtime.runAgainRequested = false
        if (runtime.status === "running" && !runtime.pauseRequested) this.scheduleRun(runtime)
      }
    }
  }

  private async executeBody(runtime: RuntimeState, nodes: FlowV2Node[], context: ExecutionContext, owner: string): Promise<ControlResult> {
    const key = sequenceKey(context, owner)
    let index = runtime.cursor.sequenceIndexes.get(key) ?? 0
    while (index < nodes.length) {
      const node = nodes[index]
      if (!this.runtimeCanContinue(runtime) && !this.runtimeCanDrainInvocation(runtime, invocationKey(context, node.id))) return "suspended"
      runtime.currentStepId = node.id
      runtime.currentContext = context
      runtime.nextStepId = node.id
      runtime.nextContext = context
      const result = await this.executeNode(runtime, node, context)
      if (result === "suspended") return result
      index += 1
      runtime.cursor.sequenceIndexes.set(key, index)
      runtime.nextStepId = result === "completed" ? nodes[index]?.id ?? null : null
      runtime.nextContext = context
      if (result !== "completed") return result
    }
    return "completed"
  }

  private async executeNode(runtime: RuntimeState, node: FlowV2Node, context: ExecutionContext): Promise<ControlResult> {
    if (runtime.cursor.completedInvocations.has(invocationKey(context, node.id))) return "completed"
    if (node.type === "break" || node.type === "continue" || node.type === "finish") return await this.executeControlTerminal(runtime, node, context)
    if (node.type === "if") return await this.executeIf(runtime, node, context)
    if (node.type === "for") return await this.executeFor(runtime, node, context)
    if (node.type === "send") return await this.executeSend(runtime, node, context)
    if (node.type === "notify") return await this.executeNotify(runtime, node, context)
    if (node.type === "input") return await this.executeInput(runtime, node, context)
    if (node.type === "wait") return await this.executeWait(runtime, node, context)
    if (node.type === "capture-source") return await this.executeCapture(runtime, node.id, node.capture, context)
    if (node.type === "extract_text") return await this.executeExtractText(runtime, node, context)
    return await this.executeParallel(runtime, node, context)
  }

  private async executeIf(runtime: RuntimeState, node: Extract<FlowV2Node, { type: "if" }>, context: ExecutionContext): Promise<ControlResult> {
    await this.startStep(runtime, node.id, context)
    const key = invocationKey(context, node.id)
    let selection = runtime.cursor.branchSelections.get(key)
    if (selection === undefined) {
      selection = "none"
      for (let index = 0; index < node.branches.length; index += 1) {
        const branch = node.branches[index]
        const matched = this.evaluateTextMatch(runtime, branch.condition, context)
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: "branch_decision",
          stepId: node.id,
          summary: "Text match branch " + branch.kind + " = " + matched,
          data: { branchKind: branch.kind, matched, executionPath: executionPathData(context) },
        })
        if (matched) {
          selection = index
          break
        }
      }
      if (selection === "none" && node.else) selection = "else"
      runtime.cursor.branchSelections.set(key, selection)
    }

    const body = typeof selection === "number" ? node.branches[selection]?.body : selection === "else" ? node.else : undefined
    if (body) {
      const result = await this.executeBody(runtime, body, context, "if:" + node.id + ":" + selection)
      if (result === "suspended") return result
      await this.completeStep(runtime, node.id, context)
      return result
    }
    await this.completeStep(runtime, node.id, context)
    return "completed"
  }

  private async executeControlTerminal(runtime: RuntimeState, node: Extract<FlowV2Node, { type: "break" | "continue" | "finish" }>, context: ExecutionContext): Promise<ControlResult> {
    await this.startStep(runtime, node.id, context)
    const bodyResult = await this.executeBody(runtime, node.body ?? [], context, "control:" + node.id)
    if (bodyResult === "suspended") return bodyResult
    await this.completeStep(runtime, node.id, context)
    if (bodyResult !== "completed") return bodyResult
    return node.type === "finish" ? "finish" : node.type
  }

  private async executeFor(runtime: RuntimeState, node: Extract<FlowV2Node, { type: "for" }>, context: ExecutionContext): Promise<ControlResult> {
    await this.startStep(runtime, node.id, context)
    const key = invocationKey(context, node.id)
    const rangeKind = node.range.kind
    let forever = false
    let items: TextListItem[] | undefined
    let total: number
    switch (node.range.kind) {
      case "count":
        total = node.range.count
        break
      case "forever":
        forever = true
        total = Number.POSITIVE_INFINITY
        break
      case "text-list":
        items = node.range.items
        total = items.length
        break
      default:
        assertNever(node.range)
    }
    let index = runtime.cursor.loopIterations.get(key) ?? 0

    while (index < total) {
      const iterationContext = forIterationContext(context, node.id, index, items?.[index])
      const iterationKey = key + ":iteration:" + index
      if (!this.runtimeCanContinue(runtime) && !this.runtimeCanDrainInvocation(runtime, iterationKey)) return "suspended"
      runtime.currentStepId = node.id
      runtime.currentContext = iterationContext
      if (!runtime.cursor.startedInvocations.has(iterationKey)) {
        runtime.cursor.startedInvocations.add(iterationKey)
        const iterationSummary = forever ? "For iteration " + (index + 1) + "/forever" : "For iteration " + (index + 1) + "/" + total
        const iterationData = {
          executionPath: executionPathData(iterationContext),
          iterationIndex: index,
          iteration: index + 1,
          rangeKind,
          total: forever ? null : total,
        }
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: "control_transition",
          stepId: node.id,
          summary: iterationSummary,
          data: { ...iterationData, count: forever ? null : total, forever },
        })
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: "loop_iteration_started",
          stepId: node.id,
          summary: iterationSummary,
          data: iterationData,
        })
      }

      const result = await this.executeBody(runtime, node.body, iterationContext, "for:" + node.id)
      if (result === "suspended") return result
      if (!runtime.cursor.completedInvocations.has(iterationKey)) {
        runtime.cursor.completedInvocations.add(iterationKey)
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: "loop_iteration_completed",
          stepId: node.id,
          summary: "For iteration completed: " + (index + 1),
          data: {
            executionPath: executionPathData(iterationContext),
            iterationIndex: index,
            iteration: index + 1,
            rangeKind,
            total: forever ? null : total,
            result,
          },
        })
      }

      index += 1
      runtime.cursor.loopIterations.set(key, index)
      runtime.cursor.startedInvocations.delete(iterationKey)
      runtime.cursor.completedInvocations.delete(iterationKey)
      pruneCompletedExecutionScope(runtime.cursor, iterationContext)
      if ((result === "completed" || result === "continue") && index < total) {
        runtime.nextStepId = node.body[0]?.id ?? node.id
        runtime.nextContext = forIterationContext(context, node.id, index, items?.[index])
      }
      if (result === "finish") return result
      if (result === "break") break
      if (forever) await delay(0)
    }

    await this.completeStep(runtime, node.id, context)
    runtime.currentContext = context
    return "completed"
  }

  private async executeSend(runtime: RuntimeState, node: SendNode, context: ExecutionContext): Promise<ControlResult> {
    await this.startStep(runtime, node.id, context)
    const text = this.renderMessage(runtime, node.message, context)
    const resolved = this.resolveTerminal(runtime, node.terminal)
    await this.appendTerminalRef(runtime, node.id, node.terminal, resolved, context)
    const result = await this.writeTerminalText(runtime, node.id, resolved.terminalId, "send", text, node.enter, "Text sent to terminal", context)
    if (!result.ok) throw new Error("terminal_input_rejected:" + result.reason)
    await this.completeStep(runtime, node.id, context)
    return "completed"
  }

  private async executeNotify(runtime: RuntimeState, node: NotifyNode, context: ExecutionContext): Promise<ControlResult> {
    await this.startStep(runtime, node.id, context)
    const key = invocationKey(context, node.id)
    let state = runtime.cursor.notificationStates.get(key)
    if (!state) {
      const title = renderTemplatableScalar(node.title, context.templateBinding)
      const message = this.renderMessage(runtime, node.message, context)
      const createdAt = new Date().toISOString()
      const notificationId = "notif_" + node.id + "_" + notificationIdTranslator.new()
      const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "notification-message", message, "txt", node.id)
      state = {
        notificationId,
        createdAt,
        title,
        message,
        messageArtifactRef: artifact.artifact.artifactRef,
        requested: false,
        browserDelivered: false,
        deliveredTelegramProfiles: new Set(),
      }
      runtime.cursor.notificationStates.set(key, state)
    }

    const channels = node.channels.map((channel) => this.sanitizeNotifyChannel(channel))
    if (!state.requested) {
      state.requested = true
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: "notification_requested",
        stepId: node.id,
        summary: "Notification requested: " + state.title,
        data: {
          notificationId: state.notificationId,
          createdAt: state.createdAt,
          level: node.level,
          title: state.title,
          channels,
          onFailure: node.onFailure,
          message: { artifactRef: state.messageArtifactRef, chars: state.message.length },
          executionPath: executionPathData(context),
        },
      })
    }

    const browserChannels = channels.filter((channel): channel is Extract<ReturnType<MacroRunnerService["sanitizeNotifyChannel"]>, { kind: "app" | "system" }> => channel.kind === "app" || channel.kind === "system")
    if (browserChannels.length > 0 && !state.browserDelivered) {
      this.manager.broadcastConfigMessage(runtime.configId, {
        type: "macro_notification",
        configId: runtime.configId,
        runId: runtime.runId,
        stepId: node.id,
        notificationId: state.notificationId,
        createdAt: state.createdAt,
        level: node.level,
        title: state.title,
        message: state.message,
        channels: browserChannels,
      })
      state.browserDelivered = true
    }

    const failures: string[] = []
    for (const channel of node.channels) {
      if (channel.kind !== "telegram" || state.deliveredTelegramProfiles.has(channel.profileId)) continue
      const result = await this.notificationService.sendTelegram({
        profileId: channel.profileId,
        title: state.title,
        message: state.message,
        level: node.level,
        notificationId: state.notificationId,
        runId: runtime.runId,
        stepId: node.id,
        createdAt: state.createdAt,
      })
      if (result.ok) {
        state.deliveredTelegramProfiles.add(channel.profileId)
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: "notification_delivered",
          stepId: node.id,
          summary: "Telegram notification delivered: " + channel.profileId,
          data: {
            notificationId: state.notificationId,
            createdAt: state.createdAt,
            channel: { kind: "telegram", profileId: channel.profileId },
            status: result.status,
            executionPath: executionPathData(context),
          },
        })
      } else {
        failures.push(result.code)
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: "notification_failed",
          stepId: node.id,
          summary: "Telegram notification failed: " + channel.profileId,
          data: {
            notificationId: state.notificationId,
            createdAt: state.createdAt,
            channel: { kind: "telegram", profileId: channel.profileId },
            code: result.code,
            status: result.status ?? null,
            message: result.message,
            executionPath: executionPathData(context),
          },
        })
      }
    }

    if (failures.length > 0) {
      const messageText = "Notification failed: " + failures.join(", ")
      if (node.onFailure === "fail") {
        await this.failRun(runtime, "notification_failed", messageText, node.id, context)
        return "suspended"
      }
      if (node.onFailure === "pause") {
        await this.pauseRun(runtime, "notification_failed", messageText, node.id, {}, context)
        return "suspended"
      }
    }

    await this.completeStep(runtime, node.id, context)
    return "completed"
  }

  private sanitizeNotifyChannel(channel: NotifyChannel): NotifyChannel {
    if (channel.kind === "telegram") return { kind: "telegram", profileId: channel.profileId }
    if (channel.kind === "system") return { kind: "system" }
    return { kind: "app", toast: channel.toast, sound: channel.sound }
  }

  private async executeInput(runtime: RuntimeState, node: InputNode, context: ExecutionContext): Promise<ControlResult> {
    await this.startStep(runtime, node.id, context)
    const resolved = this.resolveTerminal(runtime, node.terminal)
    const prompt = renderTemplatableScalar(node.prompt, context.templateBinding)
    const defaultText = node.defaultSource ? this.readArtifactSource(runtime, node.defaultSource, context) : undefined
    const existing = runtime.cursor.waitingInputExecution
    const alreadyRequested = existing !== null && invocationKey(existing.context, existing.node.id) === invocationKey(context, node.id)
    runtime.status = "waiting_user_input"
    runtime.pauseRequested = false
    runtime.pauseReason = null
    runtime.cursor.waitingInputExecution = { node, context }
    runtime.waitingInput = { stepId: node.id, prompt, allowEmpty: node.allowEmpty, terminalId: resolved.terminalId, defaultText }
    if (!alreadyRequested) {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: "user_input_requested",
        stepId: node.id,
        summary: "User input requested",
        data: {
          prompt,
          allowEmpty: node.allowEmpty,
          terminalId: resolved.terminalId,
          defaultSource: node.defaultSource ?? null,
          defaultChars: defaultText?.length ?? 0,
          executionPath: executionPathData(context),
        },
      })
    }
    return "suspended"
  }

  private async sendInput(runtime: RuntimeState, node: InputNode, context: ExecutionContext, userInput: string): Promise<boolean> {
    const inputArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "user-input", userInput, "txt", node.id)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "user_input_submitted",
      stepId: node.id,
      summary: "User input submitted",
      data: { artifactRef: inputArtifact.artifact.artifactRef, executionPath: executionPathData(context) },
    })
    const resolved = this.resolveTerminal(runtime, node.terminal)
    await this.appendTerminalRef(runtime, node.id, node.terminal, resolved, context)
    const result = await this.writeTerminalText(runtime, node.id, resolved.terminalId, "input", userInput, node.enter, "Input text sent to terminal", context)
    if (!result.ok) {
      await this.pauseRun(runtime, "terminal_input_rejected", result.reason, node.id, {}, context)
      return false
    }
    await this.completeStep(runtime, node.id, context)
    return true
  }

  private async writeTerminalText(runtime: RuntimeState, stepId: string, terminalId: string, prefix: string, content: string, enter: boolean, summary: string, context: ExecutionContext) {
    const payload = content + (enter ? MACRO_ENTER_SEQUENCE : "")
    const contentArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, prefix + "-content", content, "txt", stepId)
    const writeArtifact = payload === content ? contentArtifact : await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, prefix + "-write", payload, "txt", stepId)
    const result = this.manager.input(runtime.configId, { kind: "id", value: terminalId }, payload)
    if (!result.ok) return result
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "terminal_text_sent",
      stepId,
      summary,
      data: {
        terminalId,
        enter,
        enterSequence: enter ? "lf" : "none",
        content: { artifactRef: contentArtifact.artifact.artifactRef, chars: content.length },
        write: { artifactRef: writeArtifact.artifact.artifactRef, chars: payload.length },
        executionPath: executionPathData(context),
      },
    })
    return result
  }

  private async executeWait(runtime: RuntimeState, node: WaitNode, context: ExecutionContext): Promise<ControlResult> {
    await this.startStep(runtime, node.id, context)
    const key = invocationKey(context, node.id)
    let state = runtime.cursor.waitStates.get(key)
    const resumed = state !== undefined
    if (!state) {
      if (node.mode === "duration") state = { mode: "duration", remainingMs: node.durationMs }
      else if (node.mode === "user-continue") state = { mode: "user-continue", continueRequested: false }
      else {
        const resolved = this.resolveTerminal(runtime, node.terminal)
        state = {
          mode: "terminal-quiet",
          remainingMs: node.maxMs,
          quietElapsedMs: 0,
          lastReplay: this.terminalSnapshot(runtime.configId, resolved.terminalId).replay.join(""),
        }
      }
      runtime.cursor.waitStates.set(key, state)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: "wait_started",
        stepId: node.id,
        summary: "Wait started: " + node.mode,
        data: { mode: node.mode, executionPath: executionPathData(context) },
      })
    }

    if (node.mode === "duration") {
      if (state.mode !== "duration") throw new Error("wait_cursor_mode_mismatch:" + node.id)
      const completed = await this.waitForDuration(runtime, state, "running")
      if (!completed) return "suspended"
      await this.waitCompleted(runtime, node.id, node.mode, context)
      return "completed"
    }

    if (node.mode === "user-continue") {
      if (state.mode !== "user-continue") throw new Error("wait_cursor_mode_mismatch:" + node.id)
      if (!state.continueRequested) {
        const prompt = renderTemplatableScalar(node.prompt, context.templateBinding)
        runtime.status = "waiting"
        runtime.pauseRequested = false
        runtime.pauseReason = { code: "wait_user_continue", message: prompt, stepId: node.id }
        runtime.cursor.waitingContinueExecution = { node, context }
        return "suspended"
      }
      runtime.cursor.waitingContinueExecution = null
      await this.waitCompleted(runtime, node.id, node.mode, context)
      return "completed"
    }

    if (state.mode !== "terminal-quiet") throw new Error("wait_cursor_mode_mismatch:" + node.id)
    if (resumed) {
      const resolved = this.resolveTerminal(runtime, node.terminal)
      state.lastReplay = this.terminalSnapshot(runtime.configId, resolved.terminalId).replay.join("")
      state.quietElapsedMs = 0
    }
    const outcome = await this.waitForTerminalQuiet(runtime, node, state)
    if (outcome === "suspended") return "suspended"
    if (outcome === "timeout") {
      runtime.cursor.waitStates.delete(key)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: "wait_timeout",
        stepId: node.id,
        summary: "Wait timed out: terminal-quiet",
        data: { mode: node.mode, executionPath: executionPathData(context) },
      })
      if (node.onTimeout === "finish") {
        await this.completeStep(runtime, node.id, context)
        return "finish"
      }
      await this.pauseRun(runtime, "wait_timeout", "Wait timed out: terminal-quiet", node.id, {}, context)
      return "suspended"
    }
    await this.waitCompleted(runtime, node.id, node.mode, context)
    return "completed"
  }

  private async executeCapture(runtime: RuntimeState, stepId: string, capture: CaptureSourceConfig, context: ExecutionContext): Promise<ControlResult> {
    await this.startStep(runtime, stepId, context)
    const result = await this.captureSource(runtime, stepId, capture, context, { captureIdentityId: invocationKey(context, stepId) })
    if (!result) return "suspended"
    this.setArtifact(runtime, context, stepId, "captured_text", result.artifactRef)
    runtime.cursor.agentEventCaptureStates.delete(invocationKey(context, stepId))
    await this.completeStep(runtime, stepId, context)
    return "completed"
  }

  private async captureSource(runtime: RuntimeState, stepId: string, capture: CaptureSourceConfig, context: ExecutionContext, options: CaptureExecutionOptions = {}): Promise<CaptureExecutionResult | undefined> {
    const resolved = this.resolveTerminal(runtime, capture.terminal)
    const eventData = options.eventData ?? {}
    const captureIdentityId = options.captureIdentityId ?? invocationKey(context, stepId)
    const waitStartedKey = captureIdentityId + ":capture-wait"
    if (!runtime.cursor.startedInvocations.has(waitStartedKey)) {
      runtime.cursor.startedInvocations.add(waitStartedKey)
      await this.appendTerminalRef(runtime, stepId, capture.terminal, resolved, context)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: "capture_wait_started",
        stepId,
        summary: "Capture source started",
        data: { captureKind: capture.kind, terminalId: resolved.terminalId, executionPath: executionPathData(context), ...eventData },
      })
    }
    if (capture.kind === "terminal-buffer") {
      const terminal = this.terminalSnapshot(runtime.configId, resolved.terminalId)
      const captured = captureTerminalBuffer({ replay: terminal.replay, maxChars: capture.maxChars })
      const rawArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "capture-raw", captured.rawText, "txt", stepId)
      const normalizedArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "capture-normalized", captured.normalizedText, "txt", stepId)
      const capturedArtifact = capture.mode === "raw-stream-tail" ? rawArtifact : normalizedArtifact
      const capturedText = capture.mode === "raw-stream-tail" ? captured.rawText : captured.normalizedText
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: "capture_artifact_created",
        stepId,
        summary: "Terminal buffer capture artifact created",
        data: {
          captureKind: "terminal-buffer",
          terminalId: resolved.terminalId,
          mode: capture.mode,
          maxChars: capture.maxChars,
          artifactRef: capturedArtifact.artifact.artifactRef,
          rawArtifactRef: rawArtifact.artifact.artifactRef,
          normalizedArtifactRef: normalizedArtifact.artifact.artifactRef,
          truncated: captured.truncated,
          rawCharsBeforeTail: captured.rawCharsBeforeTail,
          capturedChars: captured.capturedChars,
          strippedAnsi: captured.strippedAnsi,
          executionPath: executionPathData(context),
          ...eventData,
        },
      })
      return { artifactRef: capturedArtifact.artifact.artifactRef, text: capturedText }
    }
    if (capture.kind === "text-box") {
      const terminal = this.terminalSnapshot(runtime.configId, resolved.terminalId)
      if (terminal.backend !== "text") throw new Error("terminal_not_text_box:" + resolved.terminalId)
      const text = terminal.replay.join("")
      const captureArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "capture-text-box", text, "txt", stepId)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: "capture_artifact_created",
        stepId,
        summary: "Text box capture artifact created",
        data: {
          captureKind: "text-box",
          terminalId: resolved.terminalId,
          artifactRef: captureArtifact.artifact.artifactRef,
          capturedChars: text.length,
          executionPath: executionPathData(context),
          ...eventData,
        },
      })
      return { artifactRef: captureArtifact.artifact.artifactRef, text }
    }
    const captured = await this.waitForAgentEventsForCapture(runtime, captureIdentityId, stepId, resolved.terminalId, this.agentEventCaptureMode(capture))
    if (!captured) return undefined
    const rawArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "agent-event-raw", JSON.stringify(captured.raw, null, 2), "json", stepId)
    const captureArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "capture-agent", captured.text, "txt", stepId)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "capture_artifact_created",
      stepId,
      summary: "AgentEvent capture artifact created",
      data: {
        captureKind: "agent-event",
        agentKind: capture.agent.kind,
        captureMode: this.agentEventCaptureMode(capture),
        terminalId: resolved.terminalId,
        agentSessionId: captured.sessionId,
        codexSessionId: captured.codexSessionId,
        agentTurnId: captured.turnId,
        artifactRef: captureArtifact.artifact.artifactRef,
        rawArtifactRef: rawArtifact.artifact.artifactRef,
        executionPath: executionPathData(context),
        ...eventData,
      },
    })
    return { artifactRef: captureArtifact.artifact.artifactRef, text: captured.text }
  }

  private async executeParallel(runtime: RuntimeState, node: ParallelNode, context: ExecutionContext): Promise<ControlResult> {
    const key = invocationKey(context, node.id)
    const alreadyStarted = runtime.cursor.startedInvocations.has(key)
    await this.startStep(runtime, node.id, context)
    if (!alreadyStarted) {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: "parallel_started",
        stepId: node.id,
        summary: "Parallel started: " + node.id,
        data: { laneIds: node.lanes.map((lane) => lane.id), executionPath: executionPathData(context) },
      })
    }
    const results = await Promise.all(node.lanes.map((lane) => this.executeParallelLane(runtime, node, lane, context).catch((error): ParallelLaneExecutionFailure => ({
      laneId: lane.id,
      context: parallelLaneContext(context, node.id, lane.id),
      error,
    }))))
    const failed = results.find((result): result is ParallelLaneExecutionFailure => "error" in result)
    if (failed) {
      if (!this.runtimeCanContinue(runtime)) return this.markParallelSuspended(runtime, node, context)
      const message = failed.error instanceof Error ? failed.error.message : String(failed.error)
      if (node.onLaneFail === "fail") await this.failRun(runtime, "parallel_lane_failed", message, node.id, failed.context)
      else await this.pauseRun(runtime, "parallel_lane_failed", message, node.id, { laneId: failed.laneId, nextStepId: node.id }, failed.context)
      return "suspended"
    }
    if (!this.runtimeCanContinue(runtime)) return this.markParallelSuspended(runtime, node, context)
    const merged = (results as ParallelLaneExecutionResult[]).map((result) => {
      if (!node.merge.includeEmptyOutputs && result.text.length === 0) return ""
      return node.merge.separator
        .replaceAll("{laneId}", result.laneId)
        .replaceAll("{laneLabel}", result.laneLabel)
        .replaceAll("{terminalAlias}", result.terminalAlias) + result.text
    }).filter((text) => text.length > 0).join("\n\n")
    const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "parallel-merged", merged, "txt", node.id)
    this.setArtifact(runtime, context, node.id, "merged_text", artifact.artifact.artifactRef)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "parallel_joined",
      stepId: node.id,
      summary: "Parallel joined",
      data: { artifactRef: artifact.artifact.artifactRef, laneIds: node.lanes.map((lane) => lane.id), executionPath: executionPathData(context) },
    })
    await this.completeStep(runtime, node.id, context)
    return "completed"
  }

  private markParallelSuspended(runtime: RuntimeState, node: ParallelNode, context: ExecutionContext): "suspended" {
    runtime.currentStepId = node.id
    runtime.currentContext = context
    runtime.nextStepId = node.id
    runtime.nextContext = context
    return "suspended"
  }

  private async executeParallelLane(runtime: RuntimeState, parent: ParallelNode, lane: ParallelLane, context: ExecutionContext): Promise<ParallelLaneExecutionResult> {
    const laneContext = parallelLaneContext(context, parent.id, lane.id)
    const laneKey = parallelLaneKey(context, parent.id, lane.id)
    const resolved = this.resolveTerminal(runtime, lane.terminal)
    const output = lane.body[lane.body.length - 1] as ParallelLaneOutputNode
    const actions = lane.body.slice(0, -1)
    if (!runtime.cursor.completedParallelLanes.has(laneKey)) {
      const laneStartedKey = laneKey + ":started"
      if (!runtime.cursor.startedInvocations.has(laneStartedKey)) {
        runtime.cursor.startedInvocations.add(laneStartedKey)
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: "parallel_lane_started",
          stepId: parent.id,
          summary: "Parallel lane started: " + lane.id,
          data: {
            laneId: lane.id,
            laneLabel: lane.label,
            terminalId: resolved.terminalId,
            terminalAlias: resolved.terminalAlias,
            executionPath: executionPathData(laneContext),
          },
        })
      }
      const bodyKey = sequenceKey(laneContext, "parallel:" + parent.id + ":lane:" + lane.id)
      let index = runtime.cursor.sequenceIndexes.get(bodyKey) ?? 0
      while (index < actions.length) {
        if (!this.runtimeCanContinue(runtime)) throw new Error("parallel_lane_interrupted:" + lane.id)
        const item = actions[index]
        runtime.currentStepId = item.id
        runtime.currentContext = laneContext
        const result = await this.executeParallelLaneAction(runtime, item, laneContext)
        if (result === "suspended") throw new Error("parallel_lane_interrupted:" + lane.id)
        if (result !== "completed") throw new Error("parallel_lane_incomplete:" + lane.id + ":" + result)
        index += 1
        runtime.cursor.sequenceIndexes.set(bodyKey, index)
      }
      if (!this.runtimeCanContinue(runtime)) throw new Error("parallel_lane_interrupted:" + lane.id)
      const text = output.source.kind === "none" ? "" : this.readArtifactSource(runtime, output.source, laneContext)
      runtime.cursor.completedParallelLanes.add(laneKey)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: "parallel_lane_completed",
        stepId: parent.id,
        summary: "Parallel lane completed: " + lane.id,
        data: {
          laneId: lane.id,
          laneLabel: lane.label,
          terminalId: resolved.terminalId,
          terminalAlias: resolved.terminalAlias,
          outputSource: output.source,
          outputChars: text.length,
          executionPath: executionPathData(laneContext),
        },
      })
      return { laneId: lane.id, laneLabel: lane.label, terminalAlias: resolved.terminalAlias, text }
    }
    const text = output.source.kind === "none" ? "" : this.readArtifactSource(runtime, output.source, laneContext)
    return { laneId: lane.id, laneLabel: lane.label, terminalAlias: resolved.terminalAlias, text }
  }

  private async executeParallelLaneAction(runtime: RuntimeState, node: ParallelLaneNode, context: ExecutionContext): Promise<ControlResult> {
    if (runtime.cursor.completedInvocations.has(invocationKey(context, node.id))) return "completed"
    if (node.type === "send") return await this.executeSend(runtime, node, context)
    if (node.type === "wait") return await this.executeWait(runtime, node, context)
    if (node.type === "capture-source") return await this.executeCapture(runtime, node.id, node.capture, context)
    if (node.type === "extract_text") return await this.executeExtractText(runtime, node, context)
    return "completed"
  }

  private async executeExtractText(runtime: RuntimeState, node: ExtractTextNode, context: ExecutionContext): Promise<ControlResult> {
    await this.startStep(runtime, node.id, context)
    const input = this.readArtifactSource(runtime, node.source, context)
    const output = this.applyTextExtraction(input, node)
    const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "extract-text", output, "txt", node.id)
    this.setArtifact(runtime, context, node.id, "extracted_text", artifact.artifact.artifactRef)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "text_extracted",
      stepId: node.id,
      summary: "Text extracted: " + node.id,
      data: {
        source: node.source,
        split: node.split,
        filters: node.filters,
        select: node.select,
        extract: node.extract,
        trim: node.trim,
        onEmpty: node.onEmpty,
        artifactRef: artifact.artifact.artifactRef,
        inputChars: input.length,
        outputChars: output.length,
        empty: output.length === 0,
        executionPath: executionPathData(context),
      },
    })
    if (output.length === 0) {
      if (node.onEmpty === "finish" || node.onEmpty === "continue") {
        await this.completeStep(runtime, node.id, context)
        return node.onEmpty
      }
      if (node.onEmpty === "fail") {
        await this.failRun(runtime, "extract_empty", "Text extraction produced no output", node.id, context)
        return "suspended"
      }
      await this.pauseRun(runtime, "extract_empty", "Text extraction produced no output", node.id, {}, context)
      return "suspended"
    }
    await this.completeStep(runtime, node.id, context)
    return "completed"
  }

  private applyTextExtraction(input: string, node: ExtractTextNode): string {
    let parts = this.splitText(input, node)
    for (const filter of node.filters) {
      parts = parts.filter((part) => filter.kind === "include" ? this.textMatcherMatches(part, filter.matcher) : !this.textMatcherMatches(part, filter.matcher))
    }
    const selected = this.selectTextParts(parts, node)
    const extract = node.extract
    const extracted = extract.kind === "none" ? selected : selected.map((part) => this.extractRegexGroup(part, extract.pattern, extract.flags ?? "", extract.group))
    return this.trimText(extracted.join("\n"), node.trim)
  }

  private splitText(input: string, node: ExtractTextNode): string[] {
    const parts = node.split.kind === "lines" ? input.split(/\r?\n/) : input.split(new RegExp(node.split.pattern, node.split.flags ?? ""))
    return node.split.keepEmpty ? parts : parts.filter((part) => part.length > 0)
  }

  private selectTextParts(parts: string[], node: ExtractTextNode): string[] {
    const select = node.select
    if (select.mode === "all") return parts
    if (select.mode === "index") {
      const index = select.index < 0 ? parts.length + select.index : select.index
      return index >= 0 && index < parts.length ? [parts[index]] : []
    }
    if (select.mode === "range") return parts.slice(select.start, select.end)
    return []
  }

  private extractRegexGroup(input: string, pattern: string, flags: string, group: string | number): string {
    const match = new RegExp(pattern, flags).exec(input)
    if (!match) return ""
    if (typeof group === "number") return match[group] ?? ""
    return match.groups?.[group] ?? ""
  }

  private trimText(input: string, trim: ExtractTextNode["trim"]): string {
    if (trim === "left") return input.trimStart()
    if (trim === "right") return input.trimEnd()
    if (trim === "both") return input.trim()
    return input
  }

  private textMatcherMatches(candidate: string, matcher: TextFilterMatcher): boolean {
    if (matcher.kind === "regex") return new RegExp(matcher.pattern, matcher.flags ?? "").test(candidate)
    const needle = matcher.text
    if (matcher.op === "contains") return candidate.includes(needle)
    if (matcher.op === "not_contains") return !candidate.includes(needle)
    if (matcher.op === "equals") return candidate === needle
    if (matcher.op === "not_equals") return candidate !== needle
    if (matcher.op === "starts_with") return candidate.startsWith(needle)
    return candidate.endsWith(needle)
  }

  private renderMessage(runtime: RuntimeState, message: MessageSpec, context: ExecutionContext): string {
    return message.parts.map((part) => {
      if (part.kind === "text") return part.text
      if (part.kind === "template") return renderScopedTemplate(part.template, context.templateBinding)
      if (!part.source) return ""
      const ref = this.getArtifact(runtime, context, part.source.stepId, part.source.artifact)
      if (!ref) throw new Error("missing_artifact_source:" + part.source.stepId + ":" + part.source.artifact)
      return this.runEventStore.readArtifact(runtime.configId, runtime.runId, ref)
    }).join("")
  }

  private evaluateTextMatch(runtime: RuntimeState, condition: TextMatchCondition, context: ExecutionContext): boolean {
    const text = this.readArtifactSource(runtime, condition.source, context)
    const matchOne = (candidate: string) => {
      if (condition.matcher.kind === "regex") return new RegExp(condition.matcher.pattern, condition.matcher.flags ?? "").test(candidate)
      const needle = condition.matcher.text
      if (condition.matcher.op === "contains") return candidate.includes(needle)
      if (condition.matcher.op === "not_contains") return !candidate.includes(needle)
      if (condition.matcher.op === "equals") return candidate === needle
      if (condition.matcher.op === "not_equals") return candidate !== needle
      if (condition.matcher.op === "starts_with") return candidate.startsWith(needle)
      return candidate.endsWith(needle)
    }
    if (condition.scope.kind === "whole") return matchOne(text)
    const lines = text.split(/\r?\n/).filter((line) => condition.scope.kind === "lines" && condition.scope.includeEmptyLines ? true : line.length > 0)
    if (condition.scope.mode === "first") return lines.length > 0 ? matchOne(lines[0]) : false
    if (condition.scope.mode === "last") return lines.length > 0 ? matchOne(lines[lines.length - 1]) : false
    if (condition.scope.mode === "any") return lines.some(matchOne)
    return lines.length > 0 && lines.every(matchOne)
  }

  private readArtifactSource(runtime: RuntimeState, source: FlowV2ArtifactSource, context: ExecutionContext): string {
    const ref = this.getArtifact(runtime, context, source.stepId, source.artifact)
    if (!ref) throw new Error("missing_artifact_source:" + source.stepId + ":" + source.artifact)
    return this.runEventStore.readArtifact(runtime.configId, runtime.runId, ref)
  }

  private setArtifact(runtime: RuntimeState, context: ExecutionContext, stepId: string, artifact: "captured_text" | "merged_text" | "extracted_text", artifactRef: string): void {
    const key = invocationKey(context, stepId)
    const map = runtime.cursor.artifactRefs.get(key) ?? new Map<string, string>()
    map.set(artifact, artifactRef)
    runtime.cursor.artifactRefs.set(key, map)
  }

  private getArtifact(runtime: RuntimeState, context: ExecutionContext, stepId: string, artifact: string): string | undefined {
    for (const candidate of artifactInvocationCandidates(context, stepId)) {
      const ref = runtime.cursor.artifactRefs.get(candidate)?.get(artifact)
      if (ref) return ref
    }
    return undefined
  }

  private async waitCompleted(runtime: RuntimeState, stepId: string, mode: string, context: ExecutionContext): Promise<void> {
    runtime.cursor.waitStates.delete(invocationKey(context, stepId))
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "wait_completed",
      stepId,
      summary: "Wait completed: " + mode,
      data: { mode, executionPath: executionPathData(context) },
    })
    await this.completeStep(runtime, stepId, context)
  }

  private async waitForDuration(runtime: RuntimeState, state: DurationWaitCursor, requiredStatus: MacroRunnerStatus): Promise<boolean> {
    while (state.remainingMs > 0) {
      if (!this.runtimeCanContinue(runtime, requiredStatus)) return false
      const chunkMs = Math.min(50, state.remainingMs)
      const startedAt = Date.now()
      await delay(chunkMs)
      state.remainingMs = Math.max(0, state.remainingMs - this.activeElapsedSinceInterruption(runtime, startedAt))
    }
    return this.runtimeCanContinue(runtime, requiredStatus)
  }

  private async waitForTerminalQuiet(runtime: RuntimeState, step: Extract<WaitNode, { mode: "terminal-quiet" }>, state: TerminalQuietWaitCursor): Promise<"completed" | "timeout" | "suspended"> {
    const resolved = this.resolveTerminal(runtime, step.terminal)
    while (state.remainingMs > 0) {
      if (!this.runtimeCanContinue(runtime, "running")) return "suspended"
      const chunkMs = Math.min(50, state.remainingMs)
      const startedAt = Date.now()
      await delay(chunkMs)
      const elapsedMs = this.activeElapsedSinceInterruption(runtime, startedAt)
      state.remainingMs = Math.max(0, state.remainingMs - elapsedMs)
      if (!this.runtimeCanContinue(runtime, "running")) return "suspended"
      const replay = this.terminalSnapshot(runtime.configId, resolved.terminalId).replay.join("")
      if (replay !== state.lastReplay) {
        state.lastReplay = replay
        state.quietElapsedMs = 0
      } else {
        state.quietElapsedMs += elapsedMs
      }
      if (state.quietElapsedMs >= step.quietMs) return "completed"
    }
    return "timeout"
  }

  private initializeAgentEventBaselines(runtime: RuntimeState): void {
    this.agentEventStore.importSpool(runtime.configId)
    for (const target of this.agentEventCaptureTargets(runtime, runtime.template.body)) {
      for (const eventKind of this.agentEventKindsForCaptureMode(target.captureMode)) {
        const match = this.agentEventMatch(runtime.configId, target.terminalId, eventKind)
        const baseline = this.agentEventStore.countMatching(match)
        runtime.cursor.agentEventBaselines.set(this.agentEventBaselineKey(target.captureStepId, match), baseline)
        const highWaterKey = this.agentEventBaselineKey("__consumed__", match)
        runtime.cursor.agentEventBaselines.set(highWaterKey, Math.max(runtime.cursor.agentEventBaselines.get(highWaterKey) ?? 0, baseline))
      }
    }
  }

  private agentEventCaptureTargets(runtime: RuntimeState, nodes: FlowV2Node[]): Array<{ captureStepId: string; terminalId: string; captureMode: AgentEventCaptureMode }> {
    const targets: Array<{ captureStepId: string; terminalId: string; captureMode: AgentEventCaptureMode }> = []
    for (const node of nodes) {
      if (node.type === "capture-source" && node.capture.kind === "agent-event") {
        targets.push({ captureStepId: node.id, terminalId: this.resolveTerminal(runtime, node.capture.terminal).terminalId, captureMode: this.agentEventCaptureMode(node.capture) })
      }
      if (node.type === "if") {
        for (const branch of node.branches) targets.push(...this.agentEventCaptureTargets(runtime, branch.body))
        if (node.else) targets.push(...this.agentEventCaptureTargets(runtime, node.else))
      }
      if (node.type === "for") targets.push(...this.agentEventCaptureTargets(runtime, node.body))
      if (node.type === "parallel") {
        for (const lane of node.lanes) targets.push(...this.agentEventCaptureTargets(runtime, lane.body.filter((item) => item.type !== "output") as FlowV2Node[]))
      }
      if ((node.type === "break" || node.type === "continue" || node.type === "finish") && node.body) targets.push(...this.agentEventCaptureTargets(runtime, node.body))
    }
    return targets
  }

  private async waitForAgentEventsForCapture(runtime: RuntimeState, captureIdentityId: string, captureStepId: string, terminalId: string, captureMode: AgentEventCaptureMode): Promise<CapturedAgentEvents | undefined> {
    const timeoutMs = Number(process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS || 600000)
    let state = runtime.cursor.agentEventCaptureStates.get(captureIdentityId)
    if (!state) {
      state = { remainingMs: timeoutMs }
      runtime.cursor.agentEventCaptureStates.set(captureIdentityId, state)
    }
    if (state.captured) return state.captured
    while (state.remainingMs > 0) {
      if (!this.runtimeCanContinue(runtime, "running")) return undefined
      const captured = this.agentEventsForCapture(runtime, captureIdentityId, captureStepId, terminalId, captureMode)
      if (captured) {
        state.captured = captured
        this.commitAgentEventConsumption(runtime, captured.events)
        return captured
      }
      const chunkMs = Math.min(100, state.remainingMs)
      const startedAt = Date.now()
      await delay(chunkMs)
      state.remainingMs = Math.max(0, state.remainingMs - this.activeElapsedSinceInterruption(runtime, startedAt))
    }
    throw new Error("agent_event_not_ready:" + terminalId)
  }

  private agentEventsForCapture(runtime: RuntimeState, captureIdentityId: string, captureStepId: string, terminalId: string, captureMode: AgentEventCaptureMode): CapturedAgentEvents | undefined {
    this.agentEventStore.importSpool(runtime.configId)
    if (captureMode === "result_only") {
      const event = this.nextAgentEventForCapture(runtime, captureIdentityId, captureStepId, terminalId, "agent.output")
      return event ? this.capturedSingleAgentEvent(event) : undefined
    }
    if (captureMode === "prompt_only") {
      const event = this.nextAgentEventForCapture(runtime, captureIdentityId, captureStepId, terminalId, "agent.prompt_submitted")
      return event ? this.capturedSingleAgentEvent(event) : undefined
    }
    const promptMatch = this.agentEventMatch(runtime.configId, terminalId, "agent.prompt_submitted")
    const outputMatch = this.agentEventMatch(runtime.configId, terminalId, "agent.output")
    const prompts = this.agentEventStore.matching(promptMatch).slice(this.baselineForAgentEvent(runtime, captureIdentityId, captureStepId, promptMatch)).filter((event) => !runtime.cursor.consumedAgentEvents.has(agentEventKey(event)))
    const outputs = this.agentEventStore.matching(outputMatch).slice(this.baselineForAgentEvent(runtime, captureIdentityId, captureStepId, outputMatch)).filter((event) => !runtime.cursor.consumedAgentEvents.has(agentEventKey(event)))
    for (const promptEvent of prompts) {
      const outputEvent = outputs.find((candidate) => candidate.agentTurnId && candidate.agentTurnId === promptEvent.agentTurnId && candidate.agentSessionId === promptEvent.agentSessionId)
      if (outputEvent) return this.capturedPromptAndResult(promptEvent, outputEvent)
    }
    return undefined
  }

  private nextAgentEventForCapture(runtime: RuntimeState, captureIdentityId: string, captureStepId: string, terminalId: string, eventKind: "agent.prompt_submitted" | "agent.output"): AgentEvent | undefined {
    const match = this.agentEventMatch(runtime.configId, terminalId, eventKind)
    return this.agentEventStore.nextMatching(match, this.baselineForAgentEvent(runtime, captureIdentityId, captureStepId, match), runtime.cursor.consumedAgentEvents)
  }

  private commitAgentEventConsumption(runtime: RuntimeState, events: readonly AgentEvent[]): void {
    for (const event of events) {
      if (event.eventKind !== "agent.prompt_submitted" && event.eventKind !== "agent.output") continue
      const match = this.agentEventMatch(runtime.configId, event.terminalId, event.eventKind)
      runtime.cursor.consumedAgentEvents.add(agentEventKey(event))
      this.advanceConsumedAgentEventPrefix(runtime, match)
    }
  }

  private advanceConsumedAgentEventPrefix(runtime: RuntimeState, match: AgentEventMatch): void {
    const matched = this.agentEventStore.matching(match)
    const highWaterKey = this.agentEventBaselineKey("__consumed__", match)
    let highWater = runtime.cursor.agentEventBaselines.get(highWaterKey) ?? 0
    while (highWater < matched.length) {
      const key = agentEventKey(matched[highWater])
      if (!runtime.cursor.consumedAgentEvents.has(key)) break
      runtime.cursor.consumedAgentEvents.delete(key)
      highWater += 1
    }
    runtime.cursor.agentEventBaselines.set(highWaterKey, highWater)
  }

  private baselineForAgentEvent(runtime: RuntimeState, captureIdentityId: string, captureStepId: string, match: AgentEventMatch): number {
    const key = this.agentEventBaselineKey(captureIdentityId, match)
    const initialKey = this.agentEventBaselineKey(captureStepId, match)
    const highWaterKey = this.agentEventBaselineKey("__consumed__", match)
    const initial = runtime.cursor.agentEventBaselines.get(initialKey) ?? this.agentEventStore.countMatching(match)
    const baseline = Math.max(
      initial,
      runtime.cursor.agentEventBaselines.get(highWaterKey) ?? 0,
      runtime.cursor.agentEventBaselines.get(key) ?? 0,
    )
    runtime.cursor.agentEventBaselines.set(key, baseline)
    return baseline
  }

  private capturedSingleAgentEvent(event: AgentEvent): CapturedAgentEvents {
    return { text: event.capturedText ?? "", raw: event, events: [event], turnId: event.agentTurnId ?? null, sessionId: event.agentSessionId, codexSessionId: event.adapterMetadata.codexSessionId }
  }

  private capturedPromptAndResult(promptEvent: AgentEvent, outputEvent: AgentEvent): CapturedAgentEvents {
    const prompt = promptEvent.capturedText ?? ""
    const result = outputEvent.capturedText ?? ""
    return {
      text: "===== user prompt =====\n" + prompt + "\n\n===== assistant result =====\n" + result,
      raw: { promptEvent, outputEvent },
      events: [promptEvent, outputEvent],
      turnId: outputEvent.agentTurnId ?? promptEvent.agentTurnId ?? null,
      sessionId: outputEvent.agentSessionId,
      codexSessionId: outputEvent.adapterMetadata.codexSessionId,
    }
  }

  private agentEventCaptureMode(capture: Extract<CaptureSourceConfig, { kind: "agent-event" }>): AgentEventCaptureMode {
    return capture.captureMode
  }

  private agentEventKindsForCaptureMode(captureMode: AgentEventCaptureMode): Array<"agent.prompt_submitted" | "agent.output"> {
    if (captureMode === "prompt_only") return ["agent.prompt_submitted"]
    if (captureMode === "prompt_and_result") return ["agent.prompt_submitted", "agent.output"]
    return ["agent.output"]
  }

  private agentEventMatch(configId: string, terminalId: string, eventKind: "agent.prompt_submitted" | "agent.output"): AgentEventMatch {
    return { configId, terminalId, agentKind: "codex", eventKind, adapter: eventKind === "agent.prompt_submitted" ? "codex-user-prompt-submit-hook" : "codex-stop-hook" }
  }

  private agentEventBaselineKey(captureStepId: string, match: AgentEventMatch): string {
    return [captureStepId, match.terminalId ?? "", match.eventKind ?? "", match.adapter ?? ""].join("|")
  }

  private terminalSnapshot(configId: string, terminalId: string): TerminalSnapshot {
    const snapshot = this.manager.deckSnapshot(configId).terminals.find((terminal) => terminal.terminalId === terminalId)
    if (!snapshot) throw new Error("terminal_not_found:" + terminalId)
    return snapshot
  }

  private resolveTerminal(runtime: RuntimeState, target: TerminalTarget): ResolvedTerminalRef {
    return resolveTerminalTargetInConfig(target, this.manager.indexMap(runtime.configId))
  }

  private async appendTerminalRef(runtime: RuntimeState, stepId: string, target: TerminalTarget, resolved: ResolvedTerminalRef, context: ExecutionContext): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "terminal_ref_resolved",
      stepId,
      summary: "Terminal ref resolved",
      data: {
        target,
        terminalId: resolved.terminalId,
        terminalAlias: resolved.terminalAlias,
        terminalIndex: resolved.terminalIndex,
        executionPath: executionPathData(context),
      },
    })
  }

  private async startStep(runtime: RuntimeState, stepId: string, context: ExecutionContext): Promise<void> {
    const key = invocationKey(context, stepId)
    if (runtime.cursor.startedInvocations.has(key)) return
    runtime.cursor.startedInvocations.add(key)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "step_started",
      stepId,
      summary: "Step started: " + stepId,
      data: { executionPath: executionPathData(context) },
    })
  }

  private async completeStep(runtime: RuntimeState, stepId: string, context: ExecutionContext): Promise<void> {
    const key = invocationKey(context, stepId)
    if (runtime.cursor.completedInvocations.has(key)) return
    runtime.cursor.completedInvocations.add(key)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "step_completed",
      stepId,
      summary: "Step completed: " + stepId,
      data: { executionPath: executionPathData(context) },
    })
  }

  private async completeRun(runtime: RuntimeState, reason: string): Promise<void> {
    if (runtime.status !== "running") return
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "run_completed",
      summary: reason,
      data: { reason, executionPath: executionPathData(runtime.currentContext) },
    })
    runtime.status = "completed"
  }

  private requestOperationInterruption(runtime: RuntimeState): void {
    runtime.pauseRequested = true
    runtime.pauseRequestedAt ??= Date.now()
  }

  private activeElapsedSinceInterruption(runtime: RuntimeState, startedAt: number): number {
    const activeUntil = runtime.pauseRequestedAt ?? Date.now()
    return Math.max(0, activeUntil - startedAt)
  }

  private beginOperation(runtime: RuntimeState): void {
    runtime.activeOperations += 1
  }

  private async waitForOperationsIdle(runtime: RuntimeState): Promise<void> {
    while (runtime.activeOperations > 0) {
      await new Promise<void>((resolve) => runtime.boundaryWaiters.push(resolve))
    }
  }

  private async settleAtOperationBoundary(runtime: RuntimeState): Promise<void> {
    if (runtime.activeOperations > 0) {
      await new Promise<void>((resolve) => runtime.boundaryWaiters.push(resolve))
      return
    }
    await this.finalizePendingTransition(runtime)
  }

  private async endOperation(runtime: RuntimeState): Promise<void> {
    if (runtime.activeOperations <= 0) throw new Error("runner_operation_boundary_underflow")
    runtime.activeOperations -= 1
    if (runtime.activeOperations > 0) return
    try {
      await this.finalizePendingTransition(runtime)
    } finally {
      const waiters = runtime.boundaryWaiters.splice(0)
      for (const resolve of waiters) resolve()
    }
  }

  private async finalizePendingTransition(runtime: RuntimeState): Promise<void> {
    if (runtime.activeOperations > 0) return
    if (runtime.stopRequested) {
      runtime.stopRequested = false
      runtime.pendingUserPause = false
      if (isLive(runtime.status)) await this.finalizeStop(runtime)
      return
    }
    if (!runtime.pendingUserPause) return
    runtime.pendingUserPause = false
    if (runtime.status !== "paused" && isLive(runtime.status)) {
      await this.pauseRun(runtime, "user_pause", "Paused by user")
    }
  }

  private async finalizeStop(runtime: RuntimeState): Promise<void> {
    if (runtime.status === "stopped") return
    runtime.status = "stopped"
    runtime.pauseRequested = true
    runtime.pauseRequestedAt ??= Date.now()
    runtime.waitingInput = null
    runtime.cursor.waitingInputExecution = null
    runtime.cursor.waitingContinueExecution = null
    runtime.pauseReason = { code: "user_stop", message: "Stopped by user", stepId: runtime.currentStepId ?? undefined }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "run_stopped",
      summary: "Run stopped",
      data: { reason: "Stopped by user", executionPath: executionPathData(runtime.currentContext) },
    })
  }

  private async pauseRun(
    runtime: RuntimeState,
    code: string,
    message: string,
    stepId = runtime.currentStepId ?? undefined,
    data: Record<string, unknown> = {},
    context: ExecutionContext = runtime.currentContext,
  ): Promise<void> {
    if (runtime.stopRequested || runtime.status === "paused") return
    runtime.status = "paused"
    runtime.pauseRequested = true
    runtime.pauseRequestedAt ??= Date.now()
    runtime.pauseReason = { code, message, stepId }
    runtime.waitingInput = null
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
      kind: "run_paused",
      stepId,
      summary: message,
      data: {
        code,
        reason: message,
        executionPath: executionPathData(context),
        nextStepId: runtime.nextStepId,
        nextExecutionPath: executionPathData(runtime.nextContext),
        ...data,
      },
    })
  }

  private async failRun(
    runtime: RuntimeState,
    code: string,
    message: string,
    stepId = runtime.currentStepId ?? undefined,
    context: ExecutionContext = runtime.currentContext,
  ): Promise<void> {
    if (runtime.stopRequested) return
    runtime.status = "failed"
    runtime.pauseRequested = true
    runtime.pauseRequestedAt ??= Date.now()
    runtime.pauseReason = { code, message, stepId }
    runtime.waitingInput = null
    runtime.cursor.waitingInputExecution = null
    runtime.cursor.waitingContinueExecution = null
    const executionPath = executionPathData(context)
    if (stepId) await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "step_failed", stepId, summary: message, data: { code, reason: message, executionPath } })
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "run_failed", summary: message, data: { code, reason: message, executionPath } })
  }

  private runtimeCanContinue(runtime: RuntimeState, requiredStatus: MacroRunnerStatus = "running"): boolean {
    return this.runtimes.get(runtime.configId)?.token === runtime.token && runtime.status === requiredStatus && !runtime.pauseRequested
  }

  private runtimeCanDrainInvocation(runtime: RuntimeState, key: string): boolean {
    return runtime.checkpointDrain
      && this.runtimes.get(runtime.configId)?.token === runtime.token
      && runtime.status === "running"
      && (runtime.cursor.startedInvocations.has(key) || runtime.cursor.completedInvocations.has(key))
  }


  private storedLiveRun(configId: string): RunSummary | undefined {
    return this.runEventStore.listRuns(configId).find((run) => run.status === "running" || run.status === "paused" || run.status === "interrupted")
  }

  private snapshotForStoredInterrupted(configId: string, summary: RunSummary): MacroRunnerSnapshot {
    const runs = this.runEventStore.listRuns(configId)
    const run = this.runEventStore.snapshot(configId, summary.runId)
    const started = run.replay.events.find((event) => event.kind === "run_started")
    const templateId = typeof started?.data.templateId === "string" ? started.data.templateId : null
    const templateName = typeof started?.data.templateName === "string" ? started.data.templateName : null
    return { configId, status: "interrupted", runId: summary.runId, templateId, templateName, currentStepId: run.derivedState.currentStepId, waitingInput: null, pauseReason: { code: "runtime_interrupted", message: "Runner runtime is not active; stop this run or inspect the run log before starting another macro.", stepId: run.derivedState.currentStepId ?? undefined }, run, runs }
  }

  private runtimeOrThrow(configId: string): RuntimeState {
    const runtime = this.runtimes.get(configId)
    if (!runtime) throw new Error("runner_idle")
    return runtime
  }

  private snapshotForRuntime(configId: string, runtime?: RuntimeState): MacroRunnerSnapshot {
    const runs = this.runEventStore.listRuns(configId)
    if (!runtime) return { configId, status: "idle", runId: null, templateId: null, templateName: null, currentStepId: null, waitingInput: null, pauseReason: null, runs }
    const run = this.runEventStore.snapshot(configId, runtime.runId)
    return { configId, status: runtime.status, runId: runtime.runId, templateId: runtime.template.id, templateName: runtime.template.name, currentStepId: runtime.currentStepId, waitingInput: runtime.waitingInput, pauseReason: runtime.pauseReason, run, runs }
  }
}

function assertNever(value: never): never {
  throw new Error("unreachable_macro_variant:" + JSON.stringify(value))
}

function liveRunError(runId: string): Error & { existingRunId?: string } {
  const error = new Error("live_run_exists:" + runId) as Error & { existingRunId?: string }
  error.existingRunId = runId
  return error
}

function isLive(status: MacroRunnerStatus): boolean {
  return status === "running" || status === "waiting" || status === "waiting_user_input" || status === "paused" || status === "interrupted"
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
