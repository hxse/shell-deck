import { validateMacroTemplate } from "../src/lib/macro/templateSchema"
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

type ControlResult = "completed" | "suspended" | "break" | "continue" | "finish"
type CaptureExecutionResult = { artifactRef: string; text: string }
type AgentEventCaptureMode = "result_only" | "prompt_only" | "prompt_and_result"
type CapturedAgentEvents = { text: string; raw: unknown; events: AgentEvent[]; turnId: string | null; sessionId: string | null; codexSessionId: string | null }
type CaptureExecutionOptions = { eventData?: Record<string, unknown>; captureIdentityId?: string }
type ParallelLaneExecutionResult = { laneId: string; laneLabel: string; terminalAlias: string; text: string }
const MACRO_ENTER_SEQUENCE = "\n"

type RuntimeState = {
  configId: string
  runId: string
  template: MacroTemplate
  status: MacroRunnerStatus
  currentStepId: string | null
  pauseReason: MacroRunnerPauseReason | null
  waitingInput: MacroRunnerSnapshot["waitingInput"]
  artifactRefs: Map<string, Map<string, string>>
  completedSteps: Set<string>
  consumedAgentEvents: Set<string>
  agentEventBaselines: Map<string, number>
  manualContinueRequested: boolean
  pauseRequested: boolean
  mockCaptureText: string
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
      template,
      status: "running",
      currentStepId: template.body[0]?.id ?? null,
      pauseReason: null,
      waitingInput: null,
      artifactRefs: new Map(),
      completedSteps: this.completedStepsFromRun(configId, run.runId),
      consumedAgentEvents: new Set(),
      agentEventBaselines: new Map(),
      manualContinueRequested: false,
      pauseRequested: false,
      mockCaptureText: request.mockCaptureText ?? "mock capture ready ai-fixable",
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
    void this.run(runtime)
    return this.snapshotForRuntime(configId, runtime)
  }

  async pause(configId: string): Promise<MacroRunnerSnapshot> {
    const runtime = this.runtimeOrThrow(configId)
    if (!isLive(runtime.status)) return this.snapshotForRuntime(configId, runtime)
    runtime.pauseRequested = true
    await this.pauseRun(runtime, "user_pause", "Paused by user")
    return this.snapshotForRuntime(configId, runtime)
  }

  async resume(configId: string, _nextStepId?: string): Promise<MacroRunnerSnapshot> {
    const runtime = this.runtimeOrThrow(configId)
    if (runtime.status === "waiting") {
      const waitNode = this.findNode(runtime.template.body, runtime.currentStepId)
      if (waitNode?.type === "wait" && waitNode.mode === "user-continue") {
        runtime.manualContinueRequested = true
        runtime.status = "running"
        runtime.pauseRequested = false
        await this.runEventStore.appendEvent(configId, runtime.runId, { kind: "wait_manual_continue", stepId: waitNode.id, summary: "Manual continue requested", data: { mode: waitNode.mode } })
        void this.run(runtime)
      }
      return this.snapshotForRuntime(configId, runtime)
    }
    if (runtime.status !== "paused") return this.snapshotForRuntime(configId, runtime)
    runtime.status = "running"
    runtime.pauseRequested = false
    runtime.manualContinueRequested = false
    runtime.pauseReason = null
    runtime.waitingInput = null
    await this.runEventStore.appendEvent(configId, runtime.runId, { kind: "run_resumed", summary: "Run resumed", data: { nextStepId: runtime.currentStepId } })
    void this.run(runtime)
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
    runtime.pauseRequested = true
    runtime.status = "stopped"
    runtime.waitingInput = null
    runtime.pauseReason = { code: "user_stop", message: "Stopped by user", stepId: runtime.currentStepId ?? undefined }
    await this.runEventStore.appendEvent(configId, runtime.runId, { kind: "run_stopped", summary: "Run stopped", data: { reason: "Stopped by user" } })
    return this.snapshotForRuntime(configId, runtime)
  }

  async submitInput(configId: string, text: string): Promise<MacroRunnerSnapshot> {
    const runtime = this.runtimeOrThrow(configId)
    const waiting = runtime.waitingInput
    if (runtime.status !== "waiting_user_input" || !waiting) throw new Error("runner_not_waiting_for_input")
    if (!waiting.allowEmpty && text.length === 0) throw new Error("input_empty_not_allowed")
    const node = this.findNode(runtime.template.body, waiting.stepId)
    if (!node || node.type !== "input") throw new Error("waiting_input_step_missing")
    await this.sendInput(runtime, node, text)
    runtime.status = "running"
    runtime.waitingInput = null
    void this.run(runtime)
    return this.snapshotForRuntime(configId, runtime)
  }

  private async run(runtime: RuntimeState): Promise<void> {
    if (this.runtimes.get(runtime.configId)?.token !== runtime.token) return
    if (runtime.status !== "running" || runtime.pauseRequested) return
    try {
      const result = await this.executeBody(runtime, runtime.template.body, true)
      if (result === "completed") await this.completeRun(runtime, "Run completed")
      if (result === "finish") await this.completeRun(runtime, "Run finished")
      if (result === "break" || result === "continue") await this.pauseRun(runtime, "control_outside_loop", result + " escaped loop")
    } catch (error) {
      if (runtime.status === "running") await this.pauseRun(runtime, "step_error", error instanceof Error ? error.message : String(error), runtime.currentStepId ?? undefined)
    }
  }

  private async executeBody(runtime: RuntimeState, nodes: FlowV2Node[], skipCompleted: boolean): Promise<ControlResult> {
    for (const node of nodes) {
      if (!this.runtimeCanContinue(runtime)) return "suspended"
      if (skipCompleted && runtime.completedSteps.has(node.id)) continue
      runtime.currentStepId = node.id
      const result = await this.executeNode(runtime, node, skipCompleted)
      if (result !== "completed") return result
    }
    return "completed"
  }

  private async executeNode(runtime: RuntimeState, node: FlowV2Node, skipCompleted: boolean): Promise<ControlResult> {
    if (node.type === "break" || node.type === "continue" || node.type === "finish") return await this.executeControlTerminal(runtime, node, skipCompleted)
    if (node.type === "if") return await this.executeIf(runtime, node, skipCompleted)
    if (node.type === "for") return await this.executeFor(runtime, node)
    if (node.type === "send") return await this.executeSend(runtime, node)
    if (node.type === "notify") return await this.executeNotify(runtime, node)
    if (node.type === "input") return await this.executeInput(runtime, node)
    if (node.type === "wait") return await this.executeWait(runtime, node)
    if (node.type === "capture-source") return await this.executeCapture(runtime, node.id, node.capture)
    if (node.type === "extract_text") return await this.executeExtractText(runtime, node)
    return await this.executeParallel(runtime, node, skipCompleted)
  }

  private async executeIf(runtime: RuntimeState, node: Extract<FlowV2Node, { type: "if" }>, skipCompleted: boolean): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    for (const branch of node.branches) {
      const matched = this.evaluateTextMatch(runtime, branch.condition)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "branch_decision", stepId: node.id, summary: "Text match branch " + branch.kind + " = " + matched, data: { branchKind: branch.kind, matched } })
      if (matched) {
        const result = await this.executeBody(runtime, branch.body, skipCompleted)
        if (result !== "completed") return result
        await this.completeStep(runtime, node.id)
        return "completed"
      }
    }
    if (node.else) {
      const result = await this.executeBody(runtime, node.else, skipCompleted)
      if (result !== "completed") return result
    }
    await this.completeStep(runtime, node.id)
    return "completed"
  }

  private async executeControlTerminal(runtime: RuntimeState, node: Extract<FlowV2Node, { type: "break" | "continue" | "finish" }>, skipCompleted: boolean): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    const bodyResult = await this.executeBody(runtime, node.body ?? [], skipCompleted)
    if (bodyResult === "suspended") return bodyResult
    if (bodyResult === "finish") return bodyResult
    if (bodyResult === "break" || bodyResult === "continue") return bodyResult
    await this.completeStep(runtime, node.id)
    return node.type === "finish" ? "finish" : node.type
  }

  private async executeFor(runtime: RuntimeState, node: Extract<FlowV2Node, { type: "for" }>): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    const forever = node.range.kind === "forever"
    const count = forever ? Number.POSITIVE_INFINITY : ("count" in node.range ? node.range.count : 1)
    for (let index = 0; index < count; index += 1) {
      if (!this.runtimeCanContinue(runtime)) return "suspended"
      const summary = forever ? "For iteration " + (index + 1) + "/forever" : "For iteration " + (index + 1) + "/" + count
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "control_transition", stepId: node.id, summary, data: { iteration: index + 1, count: forever ? null : count, forever } })
      const result = await this.executeBody(runtime, node.body, false)
      if (result === "break") break
      if (result === "continue") continue
      if (result !== "completed") return result
      if (forever) await delay(0)
    }
    await this.completeStep(runtime, node.id)
    return "completed"
  }

  private async executeSend(runtime: RuntimeState, node: SendNode): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    const text = this.renderMessage(runtime, node.message)
    const resolved = this.resolveTerminal(runtime, node.terminal)
    await this.appendTerminalRef(runtime, node.id, node.terminal, resolved)
    const result = await this.writeTerminalText(runtime, node.id, resolved.terminalId, "send", text, node.enter, "Text sent to terminal")
    if (!result.ok) throw new Error("terminal_input_rejected:" + result.reason)
    await this.completeStep(runtime, node.id)
    return "completed"
  }

  private async executeNotify(runtime: RuntimeState, node: NotifyNode): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    const message = this.renderMessage(runtime, node.message)
    const createdAt = new Date().toISOString()
    const notificationId = "notif_" + node.id + "_" + Date.now()
    const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "notification-message", message, "txt", node.id)
    const channels = node.channels.map((channel) => this.sanitizeNotifyChannel(channel))
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "notification_requested", stepId: node.id, summary: "Notification requested: " + node.title, data: { notificationId, createdAt, level: node.level, title: node.title, channels, onFailure: node.onFailure, message: { artifactRef: artifact.artifact.artifactRef, chars: message.length } } })

    const browserChannels = channels.filter((channel): channel is Extract<ReturnType<MacroRunnerService["sanitizeNotifyChannel"]>, { kind: "app" | "system" }> => channel.kind === "app" || channel.kind === "system")
    if (browserChannels.length > 0) {
      this.manager.broadcastConfigMessage(runtime.configId, { type: "macro_notification", configId: runtime.configId, runId: runtime.runId, stepId: node.id, notificationId, createdAt, level: node.level, title: node.title, message, channels: browserChannels })
    }

    const failures: string[] = []
    for (const channel of node.channels) {
      if (channel.kind !== "telegram") continue
      const result = await this.notificationService.sendTelegram({ profileId: channel.profileId, title: node.title, message, level: node.level, notificationId, runId: runtime.runId, stepId: node.id, createdAt })
      if (result.ok) {
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "notification_delivered", stepId: node.id, summary: "Telegram notification delivered: " + channel.profileId, data: { notificationId, createdAt, channel: { kind: "telegram", profileId: channel.profileId }, status: result.status } })
      } else {
        failures.push(result.code)
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "notification_failed", stepId: node.id, summary: "Telegram notification failed: " + channel.profileId, data: { notificationId, createdAt, channel: { kind: "telegram", profileId: channel.profileId }, code: result.code, status: result.status ?? null, message: result.message } })
      }
    }

    if (failures.length > 0) {
      const messageText = "Notification failed: " + failures.join(", ")
      if (node.onFailure === "fail") {
        await this.failRun(runtime, "notification_failed", messageText, node.id)
        return "suspended"
      }
      if (node.onFailure === "pause") {
        await this.pauseRun(runtime, "notification_failed", messageText, node.id)
        return "suspended"
      }
    }

    await this.completeStep(runtime, node.id)
    return "completed"
  }

  private sanitizeNotifyChannel(channel: NotifyChannel): NotifyChannel {
    if (channel.kind === "telegram") return { kind: "telegram", profileId: channel.profileId }
    if (channel.kind === "system") return { kind: "system" }
    return { kind: "app", toast: channel.toast, sound: channel.sound }
  }

  private async executeInput(runtime: RuntimeState, node: InputNode): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    const resolved = this.resolveTerminal(runtime, node.terminal)
    const defaultText = node.defaultSource ? this.readArtifactSource(runtime, node.defaultSource) : undefined
    runtime.status = "waiting_user_input"
    runtime.waitingInput = { stepId: node.id, prompt: node.prompt, allowEmpty: node.allowEmpty, terminalId: resolved.terminalId, defaultText }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "user_input_requested", stepId: node.id, summary: "User input requested", data: { prompt: node.prompt, allowEmpty: node.allowEmpty, terminalId: resolved.terminalId, defaultSource: node.defaultSource ?? null, defaultChars: defaultText?.length ?? 0 } })
    return "suspended"
  }

  private async sendInput(runtime: RuntimeState, node: InputNode, userInput: string): Promise<void> {
    const inputArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "user-input", userInput, "txt", node.id)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "user_input_submitted", stepId: node.id, summary: "User input submitted", data: { artifactRef: inputArtifact.artifact.artifactRef } })
    const resolved = this.resolveTerminal(runtime, node.terminal)
    await this.appendTerminalRef(runtime, node.id, node.terminal, resolved)
    const result = await this.writeTerminalText(runtime, node.id, resolved.terminalId, "input", userInput, node.enter, "Input text sent to terminal")
    if (!result.ok) {
      await this.pauseRun(runtime, "terminal_input_rejected", result.reason, node.id)
      return
    }
    await this.completeStep(runtime, node.id)
  }

  private async writeTerminalText(runtime: RuntimeState, stepId: string, terminalId: string, prefix: string, content: string, enter: boolean, summary: string) {
    const payload = content + (enter ? MACRO_ENTER_SEQUENCE : "")
    const contentArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, prefix + "-content", content, "txt", stepId)
    const writeArtifact = payload === content ? contentArtifact : await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, prefix + "-write", payload, "txt", stepId)
    const result = this.manager.input(runtime.configId, { kind: "id", value: terminalId }, payload)
    if (!result.ok) return result
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "terminal_text_sent", stepId, summary, data: { terminalId, enter, enterSequence: enter ? "lf" : "none", content: { artifactRef: contentArtifact.artifact.artifactRef, chars: content.length }, write: { artifactRef: writeArtifact.artifact.artifactRef, chars: payload.length } } })
    return result
  }

  private async executeWait(runtime: RuntimeState, node: WaitNode): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "wait_started", stepId: node.id, summary: "Wait started: " + node.mode, data: { mode: node.mode } })
    if (node.mode === "duration") {
      const completed = await this.waitForDuration(runtime, node.durationMs, "running")
      if (!completed) return "suspended"
      await this.waitCompleted(runtime, node.id, node.mode)
      return "completed"
    }
    if (node.mode === "user-continue") {
      if (!runtime.manualContinueRequested) {
        runtime.status = "waiting"
        runtime.pauseReason = { code: "wait_user_continue", message: node.prompt, stepId: node.id }
        return "suspended"
      }
      runtime.manualContinueRequested = false
      await this.waitCompleted(runtime, node.id, node.mode)
      return "completed"
    }
    const completed = await this.waitForTerminalQuiet(runtime, node)
    if (!completed) {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "wait_timeout", stepId: node.id, summary: "Wait timed out: terminal-quiet", data: { mode: node.mode } })
      if (node.onTimeout === "finish") return "finish"
      await this.pauseRun(runtime, "wait_timeout", "Wait timed out: terminal-quiet", node.id)
      return "suspended"
    }
    await this.waitCompleted(runtime, node.id, node.mode)
    return "completed"
  }

  private async executeCapture(runtime: RuntimeState, stepId: string, capture: CaptureSourceConfig): Promise<ControlResult> {
    await this.startStep(runtime, stepId)
    const result = await this.captureSource(runtime, stepId, capture)
    this.setArtifact(runtime, stepId, "captured_text", result.artifactRef)
    await this.completeStep(runtime, stepId)
    return "completed"
  }

  private async captureSource(runtime: RuntimeState, stepId: string, capture: CaptureSourceConfig, options: CaptureExecutionOptions = {}): Promise<CaptureExecutionResult> {
    const resolved = this.resolveTerminal(runtime, capture.terminal)
    const eventData = options.eventData ?? {}
    await this.appendTerminalRef(runtime, stepId, capture.terminal, resolved)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "capture_wait_started", stepId, summary: "Capture source started", data: { captureKind: capture.kind, terminalId: resolved.terminalId, ...eventData } })
    if (capture.kind === "terminal-buffer") {
      const terminal = this.terminalSnapshot(runtime.configId, resolved.terminalId)
      const captured = captureTerminalBuffer({ replay: terminal.replay, maxChars: capture.maxChars })
      const rawArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "capture-raw", captured.rawText, "txt", stepId)
      const normalizedArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "capture-normalized", captured.normalizedText, "txt", stepId)
      const capturedArtifact = capture.mode === "raw-stream-tail" ? rawArtifact : normalizedArtifact
      const capturedText = capture.mode === "raw-stream-tail" ? captured.rawText : captured.normalizedText
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "capture_artifact_created", stepId, summary: "Terminal buffer capture artifact created", data: { captureKind: "terminal-buffer", terminalId: resolved.terminalId, mode: capture.mode, maxChars: capture.maxChars, artifactRef: capturedArtifact.artifact.artifactRef, rawArtifactRef: rawArtifact.artifact.artifactRef, normalizedArtifactRef: normalizedArtifact.artifact.artifactRef, truncated: captured.truncated, rawCharsBeforeTail: captured.rawCharsBeforeTail, capturedChars: captured.capturedChars, strippedAnsi: captured.strippedAnsi, ...eventData } })
      return { artifactRef: capturedArtifact.artifact.artifactRef, text: capturedText }
    }
    if (capture.kind === "text-box") {
      const terminal = this.terminalSnapshot(runtime.configId, resolved.terminalId)
      if (terminal.backend !== "text") throw new Error("terminal_not_text_box:" + resolved.terminalId)
      const text = terminal.replay.join("")
      const captureArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "capture-text-box", text, "txt", stepId)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "capture_artifact_created", stepId, summary: "Text box capture artifact created", data: { captureKind: "text-box", terminalId: resolved.terminalId, artifactRef: captureArtifact.artifact.artifactRef, capturedChars: text.length, ...eventData } })
      return { artifactRef: captureArtifact.artifact.artifactRef, text }
    }
    const captured = await this.waitForAgentEventsForCapture(runtime, options.captureIdentityId ?? stepId, resolved.terminalId, this.agentEventCaptureMode(capture))
    if (!captured) throw new Error("agent_event_not_ready:" + resolved.terminalId)
    for (const event of captured.events) runtime.consumedAgentEvents.add(agentEventKey(event))
    const rawArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "agent-event-raw", JSON.stringify(captured.raw, null, 2), "json", stepId)
    const captureArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "capture-agent", captured.text, "txt", stepId)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "capture_artifact_created", stepId, summary: "AgentEvent capture artifact created", data: { captureKind: "agent-event", agentKind: capture.agent.kind, captureMode: this.agentEventCaptureMode(capture), terminalId: resolved.terminalId, agentSessionId: captured.sessionId, codexSessionId: captured.codexSessionId, agentTurnId: captured.turnId, artifactRef: captureArtifact.artifact.artifactRef, rawArtifactRef: rawArtifact.artifact.artifactRef, ...eventData } })
    return { artifactRef: captureArtifact.artifact.artifactRef, text: captured.text }
  }

  private async executeParallel(runtime: RuntimeState, node: ParallelNode, skipCompleted: boolean): Promise<ControlResult> {
    const alreadyStarted = skipCompleted && this.hasRunEvent(runtime, "parallel_started", node.id)
    if (!alreadyStarted) {
      await this.startStep(runtime, node.id)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "parallel_started", stepId: node.id, summary: "Parallel started: " + node.id, data: { laneIds: node.lanes.map((lane) => lane.id) } })
    }
    const results = await Promise.all(node.lanes.map((lane) => this.executeParallelLane(runtime, node, lane, skipCompleted).catch((error) => ({ laneId: lane.id, error }))))
    const failed = results.find((result): result is { laneId: string; error: unknown } => "error" in result)
    if (failed) {
      if (!this.runtimeCanContinue(runtime)) return "suspended"
      const message = failed.error instanceof Error ? failed.error.message : String(failed.error)
      if (node.onLaneFail === "fail") await this.failRun(runtime, "parallel_lane_failed", message, node.id)
      else await this.pauseRun(runtime, "parallel_lane_failed", message, node.id, { laneId: failed.laneId })
      return "suspended"
    }
    if (!this.runtimeCanContinue(runtime)) return "suspended"
    const merged = (results as ParallelLaneExecutionResult[]).map((result) => {
      if (!node.merge.includeEmptyOutputs && result.text.length === 0) return ""
      return node.merge.separator
        .replaceAll("{laneId}", result.laneId)
        .replaceAll("{laneLabel}", result.laneLabel)
        .replaceAll("{terminalAlias}", result.terminalAlias) + result.text
    }).filter((text) => text.length > 0).join("\n\n")
    const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "parallel-merged", merged, "txt", node.id)
    this.setArtifact(runtime, node.id, "merged_text", artifact.artifact.artifactRef)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "parallel_joined", stepId: node.id, summary: "Parallel joined", data: { artifactRef: artifact.artifact.artifactRef, laneIds: node.lanes.map((lane) => lane.id) } })
    await this.completeStep(runtime, node.id)
    return "completed"
  }

  private async executeParallelLane(runtime: RuntimeState, parent: ParallelNode, lane: ParallelLane, skipCompleted: boolean): Promise<ParallelLaneExecutionResult> {
    const resolved = this.resolveTerminal(runtime, lane.terminal)
    const output = lane.body[lane.body.length - 1] as ParallelLaneOutputNode
    const actions = lane.body.slice(0, -1)
    const laneAlreadyCompleted = skipCompleted && actions.length > 0 && actions.every((item) => runtime.completedSteps.has(item.id))
    if (!laneAlreadyCompleted) {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "parallel_lane_started", stepId: parent.id, summary: "Parallel lane started: " + lane.id, data: { laneId: lane.id, laneLabel: lane.label, terminalId: resolved.terminalId, terminalAlias: resolved.terminalAlias } })
    }
    for (const item of actions) {
      if (!this.runtimeCanContinue(runtime)) throw new Error("parallel_lane_interrupted:" + lane.id)
      if (skipCompleted && runtime.completedSteps.has(item.id)) continue
      const result = await this.executeParallelLaneAction(runtime, item)
      if (result !== "completed") throw new Error("parallel_lane_incomplete:" + lane.id + ":" + result)
    }
    if (!this.runtimeCanContinue(runtime)) throw new Error("parallel_lane_interrupted:" + lane.id)
    const text = output.source.kind === "none" ? "" : this.readArtifactSource(runtime, output.source)
    if (!laneAlreadyCompleted) {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "parallel_lane_completed", stepId: parent.id, summary: "Parallel lane completed: " + lane.id, data: { laneId: lane.id, laneLabel: lane.label, terminalId: resolved.terminalId, terminalAlias: resolved.terminalAlias, outputSource: output.source, outputChars: text.length } })
    }
    return { laneId: lane.id, laneLabel: lane.label, terminalAlias: resolved.terminalAlias, text }
  }

  private async executeParallelLaneAction(runtime: RuntimeState, node: ParallelLaneNode): Promise<ControlResult> {
    if (node.type === "send") return await this.executeSend(runtime, node)
    if (node.type === "wait") return await this.executeWait(runtime, node)
    if (node.type === "capture-source") return await this.executeCapture(runtime, node.id, node.capture)
    if (node.type === "extract_text") return await this.executeExtractText(runtime, node)
    return "completed"
  }

  private async executeExtractText(runtime: RuntimeState, node: ExtractTextNode): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    const input = this.readArtifactSource(runtime, node.source)
    const output = this.applyTextExtraction(input, node)
    const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "extract-text", output, "txt", node.id)
    this.setArtifact(runtime, node.id, "extracted_text", artifact.artifact.artifactRef)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "text_extracted", stepId: node.id, summary: "Text extracted: " + node.id, data: { source: node.source, split: node.split, filters: node.filters, select: node.select, extract: node.extract, trim: node.trim, onEmpty: node.onEmpty, artifactRef: artifact.artifact.artifactRef, inputChars: input.length, outputChars: output.length, empty: output.length === 0 } })
    if (output.length === 0) {
      if (node.onEmpty === "finish") return "finish"
      if (node.onEmpty === "continue") return "continue"
      if (node.onEmpty === "fail") {
        await this.failRun(runtime, "extract_empty", "Text extraction produced no output", node.id)
        return "suspended"
      }
      await this.pauseRun(runtime, "extract_empty", "Text extraction produced no output", node.id)
      return "suspended"
    }
    await this.completeStep(runtime, node.id)
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

  private renderMessage(runtime: RuntimeState, message: MessageSpec): string {
    return message.parts.map((part) => {
      if (part.kind === "text") return part.text
      if (!part.source) return ""
      const ref = this.getArtifact(runtime, part.source.stepId, part.source.artifact)
      if (!ref) throw new Error("missing_artifact_source:" + part.source.stepId + ":" + part.source.artifact)
      return this.runEventStore.readArtifact(runtime.configId, runtime.runId, ref)
    }).join("")
  }

  private evaluateTextMatch(runtime: RuntimeState, condition: TextMatchCondition): boolean {
    const text = this.readArtifactSource(runtime, condition.source)
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

  private readArtifactSource(runtime: RuntimeState, source: FlowV2ArtifactSource): string {
    const ref = this.getArtifact(runtime, source.stepId, source.artifact)
    if (!ref) throw new Error("missing_artifact_source:" + source.stepId + ":" + source.artifact)
    return this.runEventStore.readArtifact(runtime.configId, runtime.runId, ref)
  }

  private setArtifact(runtime: RuntimeState, stepId: string, artifact: "captured_text" | "merged_text" | "extracted_text", artifactRef: string): void {
    const map = runtime.artifactRefs.get(stepId) ?? new Map<string, string>()
    map.set(artifact, artifactRef)
    runtime.artifactRefs.set(stepId, map)
  }

  private getArtifact(runtime: RuntimeState, stepId: string, artifact: string): string | undefined {
    return runtime.artifactRefs.get(stepId)?.get(artifact)
  }

  private async waitCompleted(runtime: RuntimeState, stepId: string, mode: string): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "wait_completed", stepId, summary: "Wait completed: " + mode, data: { mode } })
    await this.completeStep(runtime, stepId)
  }

  private async waitForDuration(runtime: RuntimeState, durationMs: number, requiredStatus: MacroRunnerStatus): Promise<boolean> {
    const deadline = Date.now() + durationMs
    while (Date.now() < deadline) {
      if (!this.runtimeCanContinue(runtime, requiredStatus)) return false
      await delay(Math.min(50, deadline - Date.now()))
    }
    return this.runtimeCanContinue(runtime, requiredStatus)
  }

  private async waitForTerminalQuiet(runtime: RuntimeState, step: Extract<WaitNode, { mode: "terminal-quiet" }>): Promise<boolean> {
    const resolved = this.resolveTerminal(runtime, step.terminal)
    let lastReplay = this.terminalSnapshot(runtime.configId, resolved.terminalId).replay.join("")
    let quietSince = Date.now()
    const deadline = Date.now() + step.maxMs
    while (Date.now() < deadline) {
      if (!this.runtimeCanContinue(runtime, "running")) return false
      await delay(50)
      const replay = this.terminalSnapshot(runtime.configId, resolved.terminalId).replay.join("")
      if (replay !== lastReplay) {
        lastReplay = replay
        quietSince = Date.now()
      }
      if (Date.now() - quietSince >= step.quietMs) return true
    }
    return false
  }

  private initializeAgentEventBaselines(runtime: RuntimeState): void {
    this.agentEventStore.importSpool(runtime.configId)
    for (const target of this.agentEventCaptureTargets(runtime, runtime.template.body)) {
      for (const eventKind of this.agentEventKindsForCaptureMode(target.captureMode)) {
        const match = this.agentEventMatch(runtime.configId, target.terminalId, eventKind)
        runtime.agentEventBaselines.set(this.agentEventBaselineKey(target.captureStepId, match), this.agentEventStore.countMatching(match))
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

  private async waitForAgentEventsForCapture(runtime: RuntimeState, captureStepId: string, terminalId: string, captureMode: AgentEventCaptureMode): Promise<CapturedAgentEvents | undefined> {
    const timeoutMs = Number(process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS || 600000)
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      if (!this.runtimeCanContinue(runtime, "running")) return undefined
      const captured = this.agentEventsForCapture(runtime, captureStepId, terminalId, captureMode)
      if (captured) return captured
      await delay(100)
    }
    return undefined
  }

  private agentEventsForCapture(runtime: RuntimeState, captureStepId: string, terminalId: string, captureMode: AgentEventCaptureMode): CapturedAgentEvents | undefined {
    this.agentEventStore.importSpool(runtime.configId)
    if (captureMode === "result_only") {
      const event = this.nextAgentEventForCapture(runtime, captureStepId, terminalId, "agent.output")
      return event ? this.capturedSingleAgentEvent(event) : undefined
    }
    if (captureMode === "prompt_only") {
      const event = this.nextAgentEventForCapture(runtime, captureStepId, terminalId, "agent.prompt_submitted")
      return event ? this.capturedSingleAgentEvent(event) : undefined
    }
    const promptMatch = this.agentEventMatch(runtime.configId, terminalId, "agent.prompt_submitted")
    const outputMatch = this.agentEventMatch(runtime.configId, terminalId, "agent.output")
    const prompts = this.agentEventStore.matching(promptMatch).slice(this.baselineForAgentEvent(runtime, captureStepId, promptMatch)).filter((event) => !runtime.consumedAgentEvents.has(agentEventKey(event)))
    const outputs = this.agentEventStore.matching(outputMatch).slice(this.baselineForAgentEvent(runtime, captureStepId, outputMatch)).filter((event) => !runtime.consumedAgentEvents.has(agentEventKey(event)))
    for (const promptEvent of prompts) {
      const outputEvent = outputs.find((candidate) => candidate.agentTurnId && candidate.agentTurnId === promptEvent.agentTurnId && candidate.agentSessionId === promptEvent.agentSessionId)
      if (outputEvent) return this.capturedPromptAndResult(promptEvent, outputEvent)
    }
    return undefined
  }

  private nextAgentEventForCapture(runtime: RuntimeState, captureStepId: string, terminalId: string, eventKind: "agent.prompt_submitted" | "agent.output"): AgentEvent | undefined {
    const match = this.agentEventMatch(runtime.configId, terminalId, eventKind)
    return this.agentEventStore.nextMatching(match, this.baselineForAgentEvent(runtime, captureStepId, match), runtime.consumedAgentEvents)
  }

  private baselineForAgentEvent(runtime: RuntimeState, captureStepId: string, match: AgentEventMatch): number {
    const key = this.agentEventBaselineKey(captureStepId, match)
    if (!runtime.agentEventBaselines.has(key)) runtime.agentEventBaselines.set(key, this.agentEventStore.countMatching(match))
    return runtime.agentEventBaselines.get(key) ?? 0
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
    return [captureStepId, match.eventKind ?? "", match.adapter ?? ""].join("|")
  }

  private terminalSnapshot(configId: string, terminalId: string): TerminalSnapshot {
    const snapshot = this.manager.deckSnapshot(configId).terminals.find((terminal) => terminal.terminalId === terminalId)
    if (!snapshot) throw new Error("terminal_not_found:" + terminalId)
    return snapshot
  }

  private resolveTerminal(runtime: RuntimeState, target: TerminalTarget): ResolvedTerminalRef {
    return resolveTerminalTargetInConfig(target, this.manager.indexMap(runtime.configId))
  }

  private async appendTerminalRef(runtime: RuntimeState, stepId: string, target: TerminalTarget, resolved: ResolvedTerminalRef): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "terminal_ref_resolved", stepId, summary: "Terminal ref resolved", data: { target, terminalId: resolved.terminalId, terminalAlias: resolved.terminalAlias, terminalIndex: resolved.terminalIndex } })
  }

  private async startStep(runtime: RuntimeState, stepId: string): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "step_started", stepId, summary: "Step started: " + stepId, data: {} })
  }

  private async completeStep(runtime: RuntimeState, stepId: string): Promise<void> {
    runtime.completedSteps.add(stepId)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "step_completed", stepId, summary: "Step completed: " + stepId, data: {} })
  }

  private async completeRun(runtime: RuntimeState, reason: string): Promise<void> {
    if (runtime.status !== "running") return
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "run_completed", summary: reason, data: { reason } })
    runtime.status = "completed"
  }

  private async pauseRun(runtime: RuntimeState, code: string, message: string, stepId = runtime.currentStepId ?? undefined, data: Record<string, unknown> = {}): Promise<void> {
    runtime.status = "paused"
    runtime.pauseRequested = true
    runtime.pauseReason = { code, message, stepId }
    runtime.waitingInput = null
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "run_paused", stepId, summary: message, data: { code, reason: message, ...data } })
  }

  private async failRun(runtime: RuntimeState, code: string, message: string, stepId = runtime.currentStepId ?? undefined): Promise<void> {
    runtime.status = "failed"
    runtime.pauseRequested = true
    runtime.pauseReason = { code, message, stepId }
    runtime.waitingInput = null
    if (stepId) await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "step_failed", stepId, summary: message, data: { code, reason: message } })
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "run_failed", summary: message, data: { code, reason: message } })
  }

  private runtimeCanContinue(runtime: RuntimeState, requiredStatus: MacroRunnerStatus = "running"): boolean {
    return this.runtimes.get(runtime.configId)?.token === runtime.token && runtime.status === requiredStatus && !runtime.pauseRequested
  }

  private completedStepsFromRun(configId: string, runId: string): Set<string> {
    return new Set(this.runEventStore.snapshot(configId, runId).replay.events.filter((event) => event.kind === "step_completed" && typeof event.stepId === "string").map((event) => event.stepId as string))
  }

  private hasRunEvent(runtime: RuntimeState, kind: string, stepId: string): boolean {
    return this.runEventStore.snapshot(runtime.configId, runtime.runId).replay.events.some((event) => event.kind === kind && event.stepId === stepId)
  }

  private findNode(nodes: FlowV2Node[], stepId: string | null): FlowV2Node | undefined {
    if (!stepId) return undefined
    for (const node of nodes) {
      if (node.id === stepId) return node
      if (node.type === "if") {
        for (const branch of node.branches) {
          const found = this.findNode(branch.body, stepId)
          if (found) return found
        }
        if (node.else) {
          const found = this.findNode(node.else, stepId)
          if (found) return found
        }
      }
      if (node.type === "for") {
        const found = this.findNode(node.body, stepId)
        if (found) return found
      }
      if (node.type === "parallel") {
        for (const lane of node.lanes) {
          const found = this.findNode(lane.body.filter((item) => item.type !== "output") as FlowV2Node[], stepId)
          if (found) return found
        }
      }
      if ((node.type === "break" || node.type === "continue" || node.type === "finish") && node.body) {
        const found = this.findNode(node.body, stepId)
        if (found) return found
      }
    }
    return undefined
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
