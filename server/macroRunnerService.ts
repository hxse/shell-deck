import { validateMacroTemplate } from "../src/lib/macro/templateSchema"
import type {
  CaptureSourceConfig,
  ExtractTextNode,
  FlowV2ArtifactSource,
  FlowV2Node,
  InputLineNode,
  MacroTemplate,
  MessageSpec,
  ParallelSendCaptureItem,
  ParallelSendCaptureNode,
  SendLineNode,
  TerminalTarget,
  TextFilterMatcher,
  TextMatchCondition,
  WaitNode,
} from "../src/lib/macro/templateTypes"
import { AgentEventStore, agentEventKey } from "../src/lib/agentEvents/agentEventStore"
import type { AgentEvent } from "../src/lib/agentEvents/agentEventTypes"
import { captureTerminalBuffer } from "../src/lib/capture/terminalBufferCapture"
import { ParserRuntime } from "../src/lib/parser/parserRuntime"
import type { MacroRunnerPauseReason, MacroRunnerSnapshot, MacroRunnerStatus, StartMacroRunRequest } from "../src/lib/macro/runnerTypes"
import { resolveTerminalTargetInConfig, type ResolvedTerminalRef } from "../src/lib/macro/terminalRefResolver"
import type { RunSummary } from "../src/lib/runLog/runEventTypes"
import { RunEventStore } from "../src/lib/runLog/runEventStore"
import type { TerminalSnapshot } from "../src/lib/protocol"
import { MacroTemplateStore } from "../src/lib/macro/templateStore"
import { TerminalDeckManager } from "./terminalDeckManager"

type ControlResult = "completed" | "suspended" | "break" | "continue" | "return"
type CaptureExecutionResult = { artifactRef: string; text: string }
type CaptureExecutionOptions = { eventData?: Record<string, unknown>; captureIdentityId?: string }

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
    const validation = validateMacroTemplate(template, { indexMap: this.manager.indexMap(configId) })
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
    if (!waiting.allowEmpty && text.length === 0) throw new Error("input_line_empty_not_allowed")
    const node = this.findNode(runtime.template.body, waiting.stepId)
    if (!node || node.type !== "input_line") throw new Error("waiting_input_step_missing")
    await this.sendInputLine(runtime, node, text)
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
      if (result === "return") await this.completeRun(runtime, "Run returned")
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
    if (node.type === "break" || node.type === "continue") {
      await this.startStep(runtime, node.id)
      await this.completeStep(runtime, node.id)
      return node.type
    }
    if (node.type === "return") {
      await this.startStep(runtime, node.id)
      await this.completeStep(runtime, node.id)
      return "return"
    }
    if (node.type === "if") return await this.executeIf(runtime, node, skipCompleted)
    if (node.type === "for") return await this.executeFor(runtime, node)
    if (node.type === "send_line") return await this.executeSendLine(runtime, node)
    if (node.type === "input_line") return await this.executeInputLine(runtime, node)
    if (node.type === "wait") return await this.executeWait(runtime, node)
    if (node.type === "capture-source") return await this.executeCapture(runtime, node.id, node.capture)
    if (node.type === "extract_text") return await this.executeExtractText(runtime, node)
    return await this.executeParallelSendCapture(runtime, node)
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

  private async executeFor(runtime: RuntimeState, node: Extract<FlowV2Node, { type: "for" }>): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    for (let index = 0; index < node.range.count; index += 1) {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "control_transition", stepId: node.id, summary: "For iteration " + (index + 1) + "/" + node.range.count, data: { iteration: index + 1, count: node.range.count } })
      const result = await this.executeBody(runtime, node.body, false)
      if (result === "break") break
      if (result === "continue") continue
      if (result !== "completed") return result
    }
    await this.completeStep(runtime, node.id)
    return "completed"
  }

  private async executeSendLine(runtime: RuntimeState, node: SendLineNode): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    const text = this.renderMessage(runtime, node.message)
    const resolved = this.resolveTerminal(runtime, node.terminal)
    await this.appendTerminalRef(runtime, node.id, node.terminal, resolved)
    const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "send", text, "txt", node.id)
    const result = this.manager.input(runtime.configId, { kind: "id", value: resolved.terminalId }, text + "\r")
    if (!result.ok) throw new Error("terminal_input_rejected:" + result.reason)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "terminal_line_sent", stepId: node.id, summary: "Line sent to terminal", data: { terminalId: resolved.terminalId, artifactRef: artifact.artifact.artifactRef, enter: true } })
    await this.completeStep(runtime, node.id)
    return "completed"
  }

  private async executeInputLine(runtime: RuntimeState, node: InputLineNode): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    const resolved = this.resolveTerminal(runtime, node.terminal)
    const defaultText = node.defaultSource ? this.readArtifactSource(runtime, node.defaultSource) : undefined
    runtime.status = "waiting_user_input"
    runtime.waitingInput = { stepId: node.id, prompt: node.prompt, allowEmpty: node.allowEmpty, terminalId: resolved.terminalId, defaultText }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "user_input_requested", stepId: node.id, summary: "User input requested", data: { prompt: node.prompt, allowEmpty: node.allowEmpty, terminalId: resolved.terminalId, defaultSource: node.defaultSource ?? null, defaultChars: defaultText?.length ?? 0 } })
    return "suspended"
  }

  private async sendInputLine(runtime: RuntimeState, node: InputLineNode, userInput: string): Promise<void> {
    const inputArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "user-input", userInput, "txt", node.id)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "user_input_submitted", stepId: node.id, summary: "User input submitted", data: { artifactRef: inputArtifact.artifact.artifactRef } })
    const text = userInput
    const resolved = this.resolveTerminal(runtime, node.terminal)
    await this.appendTerminalRef(runtime, node.id, node.terminal, resolved)
    const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "input-line", text, "txt", node.id)
    const result = this.manager.input(runtime.configId, { kind: "id", value: resolved.terminalId }, text + "\r")
    if (!result.ok) {
      await this.pauseRun(runtime, "terminal_input_rejected", result.reason, node.id)
      return
    }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "terminal_line_sent", stepId: node.id, summary: "Input line sent to terminal", data: { terminalId: resolved.terminalId, artifactRef: artifact.artifact.artifactRef, enter: true } })
    await this.completeStep(runtime, node.id)
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
      if (node.onTimeout === "return") return "return"
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
    const event = this.nextAgentEventForCapture(runtime, options.captureIdentityId ?? stepId, resolved.terminalId)
    if (!event) throw new Error("agent_event_not_ready:" + resolved.terminalId)
    runtime.consumedAgentEvents.add(agentEventKey(event))
    const rawArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "agent-event-raw", JSON.stringify(event, null, 2), "json", stepId)
    const text = event.capturedText ?? ""
    const captureArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "capture-agent", text, "txt", stepId)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "capture_artifact_created", stepId, summary: "AgentEvent capture artifact created", data: { captureKind: "agent-event", agentKind: capture.agent.kind, eventKind: capture.eventKind, field: capture.field, terminalId: resolved.terminalId, agentSessionId: event.agentSessionId, codexSessionId: event.adapterMetadata.codexSessionId, launchId: event.launchId, agentTurnId: event.agentTurnId ?? null, artifactRef: captureArtifact.artifact.artifactRef, rawArtifactRef: rawArtifact.artifact.artifactRef, ...eventData } })
    return { artifactRef: captureArtifact.artifact.artifactRef, text }
  }

  private async executeParallelSendCapture(runtime: RuntimeState, node: ParallelSendCaptureNode): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "parallel_send_capture_started", stepId: node.id, summary: "Parallel send/capture started: " + node.id, data: { itemIds: node.items.map((item) => item.id) } })
    const results = await Promise.all(node.items.map((item) => this.executeParallelItem(runtime, node, item).catch((error) => ({ itemId: item.id, error }))))
    const failed = results.find((result): result is { itemId: string; error: unknown } => "error" in result)
    if (failed) {
      if (!this.runtimeCanContinue(runtime)) return "suspended"
      const message = failed.error instanceof Error ? failed.error.message : String(failed.error)
      if (node.onItemFail === "fail") await this.failRun(runtime, "parallel_item_failed", message, node.id)
      else await this.pauseRun(runtime, "parallel_item_failed", message, node.id, { itemId: failed.itemId })
      return "suspended"
    }
    if (!this.runtimeCanContinue(runtime)) return "suspended"
    const merged = results.map((result) => {
      const ok = result as { itemId: string; terminalAlias: string; text: string }
      if (!node.merge.includeEmptyCaptures && ok.text.length === 0) return ""
      return node.merge.separator.replaceAll("{itemId}", ok.itemId).replaceAll("{terminalAlias}", ok.terminalAlias) + "\n" + ok.text
    }).filter((text) => text.length > 0).join("\n\n")
    const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "parallel-merged", merged, "txt", node.id)
    this.setArtifact(runtime, node.id, "merged_text", artifact.artifact.artifactRef)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "parallel_send_capture_joined", stepId: node.id, summary: "Parallel send/capture joined", data: { artifactRef: artifact.artifact.artifactRef, itemIds: node.items.map((item) => item.id) } })
    await this.completeStep(runtime, node.id)
    return "completed"
  }

  private async executeParallelItem(runtime: RuntimeState, parent: ParallelSendCaptureNode, item: ParallelSendCaptureItem): Promise<{ itemId: string; terminalAlias: string; text: string }> {
    const resolved = this.resolveTerminal(runtime, item.terminal)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "parallel_send_capture_item_started", stepId: parent.id, summary: "Parallel item started: " + item.id, data: { itemId: item.id, terminalId: resolved.terminalId, terminalAlias: resolved.terminalAlias } })
    const sendText = this.renderMessage(runtime, item.send.message)
    const sendArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "parallel-send", sendText, "txt", parent.id)
    const sendResult = this.manager.input(runtime.configId, { kind: "id", value: resolved.terminalId }, sendText + "\r")
    if (!sendResult.ok) throw new Error("terminal_input_rejected:" + sendResult.reason)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "terminal_line_sent", stepId: parent.id, summary: "Parallel item line sent: " + item.id, data: { itemId: item.id, terminalId: resolved.terminalId, artifactRef: sendArtifact.artifact.artifactRef, enter: true } })
    if (item.wait) {
      const completed = await this.executeParallelItemWait(runtime, parent.id, item.id, item.wait)
      if (!completed) throw new Error("parallel_item_wait_incomplete:" + item.id)
    }
    if (!this.runtimeCanContinue(runtime)) throw new Error("parallel_item_interrupted:" + item.id)
    const capture = await this.captureSource(runtime, parent.id, item.capture.capture, { captureIdentityId: item.capture.id, eventData: { itemId: item.id, captureStepId: item.capture.id } })
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "parallel_send_capture_item_completed", stepId: parent.id, summary: "Parallel item completed: " + item.id, data: { itemId: item.id, terminalId: resolved.terminalId, capturedChars: capture.text.length, artifactRef: capture.artifactRef } })
    return { itemId: item.id, terminalAlias: resolved.terminalAlias, text: capture.text }
  }

  private async executeParallelItemWait(runtime: RuntimeState, parentStepId: string, itemId: string, wait: WaitNode): Promise<boolean> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "wait_started", stepId: parentStepId, summary: "Parallel item wait started: " + itemId, data: { itemId, mode: wait.mode } })
    let completed = false
    if (wait.mode === "duration") completed = await this.waitForDuration(runtime, wait.durationMs, "running")
    else if (wait.mode === "terminal-quiet") completed = await this.waitForTerminalQuiet(runtime, wait)
    if (!completed) {
      if (this.runtimeCanContinue(runtime)) await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "wait_timeout", stepId: parentStepId, summary: "Parallel item wait did not complete: " + itemId, data: { itemId, mode: wait.mode, onTimeout: wait.mode === "terminal-quiet" ? wait.onTimeout : null } })
      return false
    }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "wait_completed", stepId: parentStepId, summary: "Parallel item wait completed: " + itemId, data: { itemId, mode: wait.mode } })
    return true
  }

  private async executeExtractText(runtime: RuntimeState, node: ExtractTextNode): Promise<ControlResult> {
    await this.startStep(runtime, node.id)
    const input = this.readArtifactSource(runtime, node.source)
    const output = this.applyTextExtraction(input, node)
    const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, "extract-text", output, "txt", node.id)
    this.setArtifact(runtime, node.id, "extracted_text", artifact.artifact.artifactRef)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: "text_extracted", stepId: node.id, summary: "Text extracted: " + node.id, data: { source: node.source, split: node.split, filters: node.filters, select: node.select, extract: node.extract, trim: node.trim, onEmpty: node.onEmpty, artifactRef: artifact.artifact.artifactRef, inputChars: input.length, outputChars: output.length, empty: output.length === 0 } })
    if (output.length === 0) {
      if (node.onEmpty === "return") return "return"
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
    if (select.mode === "first") return parts.length > 0 ? [parts[0]] : []
    if (select.mode === "last") return parts.length > 0 ? [parts[parts.length - 1]] : []
    if (select.mode === "all") return parts
    if (select.mode === "index") return select.index < parts.length ? [parts[select.index]] : []
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

  private nextAgentEventForCapture(runtime: RuntimeState, captureStepId: string, terminalId: string): AgentEvent | undefined {
    this.agentEventStore.importSpool(runtime.configId)
    const match = { configId: runtime.configId, terminalId, agentKind: "codex" as const, eventKind: "agent.output" as const, adapter: "codex-stop-hook" as const }
    if (!runtime.agentEventBaselines.has(captureStepId)) runtime.agentEventBaselines.set(captureStepId, 0)
    return this.agentEventStore.nextMatching(match, runtime.agentEventBaselines.get(captureStepId) ?? 0, runtime.consumedAgentEvents)
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
