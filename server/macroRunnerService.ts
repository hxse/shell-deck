import { validateMacroTemplate } from '../src/lib/macro/templateSchema'
import type { BranchCondition, MacroStep, MacroTemplate } from '../src/lib/macro/templateTypes'
import { parseMockSignals } from '../src/lib/macro/mockParser'
import { AgentEventStore, agentEventKey } from '../src/lib/agentEvents/agentEventStore'
import type { AgentEvent } from '../src/lib/agentEvents/agentEventTypes'
import { captureTerminalBuffer } from '../src/lib/capture/terminalBufferCapture'
import { PROFILE_CATALOG_SUMMARY } from '../src/lib/macro/profileCatalogSummary'
import type { MacroRunnerPauseReason, MacroRunnerSnapshot, MacroRunnerStatus, StartMacroRunRequest } from '../src/lib/macro/runnerTypes'
import { resolveTerminalTargetInConfig, type ResolvedTerminalRef } from '../src/lib/macro/terminalRefResolver'
import type { RunSnapshot, RunSummary } from '../src/lib/runLog/runEventTypes'
import { RunEventStore } from '../src/lib/runLog/runEventStore'
import type { TerminalSnapshot } from '../src/lib/protocol'
import { MacroTemplateStore } from '../src/lib/macro/templateStore'
import { TerminalDeckManager } from './terminalDeckManager'

type WaitResult = 'completed' | 'manual' | 'timeout' | 'cancelled'

type RuntimeState = {
  configId: string
  runId: string
  template: MacroTemplate
  status: MacroRunnerStatus
  currentStepId: string | null
  pauseReason: MacroRunnerPauseReason | null
  waitingInput: MacroRunnerSnapshot['waitingInput']
  captureArtifacts: Map<string, string>
  parserSignals: Map<string, Record<string, boolean | null>>
  consumedAgentEvents: Set<string>
  agentEventBaselines: Map<string, number>
  manualContinueRequested: boolean
  pauseRequested: boolean
  mockCaptureText: string
  mockCaptureReady: boolean
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
    const validation = validateMacroTemplate(template, { indexMap: this.manager.indexMap(configId), profileCatalog: PROFILE_CATALOG_SUMMARY })
    const run = await this.runEventStore.createRun(configId, { templateId: template.id, templateName: template.name })
    const runtime: RuntimeState = {
      configId,
      runId: run.runId,
      template,
      status: 'running',
      currentStepId: template.steps[0]?.id ?? null,
      pauseReason: null,
      waitingInput: null,
      captureArtifacts: new Map(),
      parserSignals: new Map(),
      consumedAgentEvents: new Set(),
      agentEventBaselines: new Map(),
      manualContinueRequested: false,
      pauseRequested: false,
      mockCaptureText: request.mockCaptureText ?? 'mock capture ready ai-fixable',
      mockCaptureReady: request.mockCaptureReady ?? true,
      token: this.nextToken++,
    }
    this.runtimes.set(configId, runtime)

    if (!validation.ok) {
      await this.failRun(runtime, 'preflight_failed', validation.issues.map((issue) => issue.path + ': ' + issue.message).join('; '))
      return this.snapshotForRuntime(configId, runtime)
    }

    if (template.steps.length === 0) {
      await this.failRun(runtime, "preflight_failed", "template has no steps")
      return this.snapshotForRuntime(configId, runtime)
    }

    void this.run(runtime, runtime.currentStepId)
    return this.snapshotForRuntime(configId, runtime)
  }

  async pause(configId: string): Promise<MacroRunnerSnapshot> {
    const runtime = this.runtimeOrThrow(configId)
    if (!isLive(runtime.status)) return this.snapshotForRuntime(configId, runtime)
    runtime.pauseRequested = true
    await this.pauseRun(runtime, 'user_pause', 'Paused by user')
    return this.snapshotForRuntime(configId, runtime)
  }

  async resume(configId: string, nextStepId?: string): Promise<MacroRunnerSnapshot> {
    const runtime = this.runtimeOrThrow(configId)
    if (runtime.status === 'waiting') {
      const step = runtime.currentStepId ? runtime.template.steps.find((candidate) => candidate.id === runtime.currentStepId) : undefined
      if (step?.type === 'wait' && (step.mode === 'user-continue' || step.mode === 'capture-ready-or-user')) {
        runtime.manualContinueRequested = true
        await this.runEventStore.appendEvent(configId, runtime.runId, { kind: 'wait_manual_continue', stepId: step.id, summary: 'Manual continue requested: ' + step.mode, data: { mode: step.mode } })
      }
      return this.snapshotForRuntime(configId, runtime)
    }
    if (runtime.status !== 'paused') return this.snapshotForRuntime(configId, runtime)
    runtime.pauseRequested = false
    runtime.manualContinueRequested = false
    runtime.status = 'running'
    runtime.pauseReason = null
    runtime.waitingInput = null
    await this.runEventStore.appendEvent(configId, runtime.runId, { kind: 'run_resumed', summary: 'Run resumed', data: { nextStepId: nextStepId ?? runtime.currentStepId } })
    void this.run(runtime, nextStepId ?? runtime.currentStepId)
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
    if (runtime.status !== 'waiting_user_input' || !waiting) throw new Error('runner_not_waiting_for_input')
    if (!waiting.allowEmpty && text.length === 0) throw new Error('input_line_empty_not_allowed')
    const step = runtime.template.steps.find((candidate) => candidate.id === waiting.stepId)
    if (!step || step.type !== 'input_line') throw new Error('waiting_input_step_missing')

    const artifact = await this.runEventStore.writeArtifact(configId, runtime.runId, 'user-input', text, 'txt', step.id)
    await this.runEventStore.appendEvent(configId, runtime.runId, { kind: 'user_input_submitted', stepId: step.id, summary: 'User input submitted', data: { artifactRef: artifact.artifact.artifactRef } })
    const resolved = this.resolveTerminal(runtime, step.terminal)
    await this.appendTerminalRef(runtime, step.id, step.terminal, resolved)
    const result = this.manager.input(configId, { kind: 'id', value: resolved.terminalId }, text + '\r')
    if (!result.ok) {
      await this.pauseRun(runtime, 'terminal_input_rejected', result.reason, step.id)
      return this.snapshotForRuntime(configId, runtime)
    }
    await this.runEventStore.appendEvent(configId, runtime.runId, {
      kind: 'terminal_line_sent',
      stepId: step.id,
      summary: 'Input line sent to terminal',
      data: { terminalId: resolved.terminalId, artifactRef: artifact.artifact.artifactRef, enter: true },
    })
    await this.completeStep(runtime, step.id)
    runtime.status = 'running'
    runtime.waitingInput = null
    void this.run(runtime, this.nextStepId(runtime, step))
    return this.snapshotForRuntime(configId, runtime)
  }

  private async run(runtime: RuntimeState, startStepId: string | null): Promise<void> {
    let stepId = startStepId
    while (stepId && this.runtimes.get(runtime.configId)?.token === runtime.token) {
      if (runtime.pauseRequested || runtime.status !== 'running') return
      const step = runtime.template.steps.find((candidate) => candidate.id === stepId)
      if (!step) {
        await this.pauseRun(runtime, 'step_not_found', 'Step not found: ' + stepId, stepId)
        return
      }
      runtime.currentStepId = step.id
      try {
        const next = await this.executeStep(runtime, step)
        if (!next || !isLive(runtime.status) || runtime.status !== 'running') return
        stepId = await this.transition(runtime, step, next)
      } catch (error) {
        await this.pauseRun(runtime, 'step_error', error instanceof Error ? error.message : String(error), step.id)
        return
      }
    }
  }

  private async executeStep(runtime: RuntimeState, step: MacroStep): Promise<string | null> {
    await this.startStep(runtime, step.id)
    if (step.type === 'send_line') {
      const resolved = this.resolveTerminal(runtime, step.terminal)
      await this.appendTerminalRef(runtime, step.id, step.terminal, resolved)
      const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'send', step.text, 'txt', step.id)
      const result = this.manager.input(runtime.configId, { kind: 'id', value: resolved.terminalId }, step.text + '\r')
      if (!result.ok) throw new Error('terminal_input_rejected:' + result.reason)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'terminal_line_sent', stepId: step.id, summary: 'Line sent to terminal', data: { terminalId: resolved.terminalId, artifactRef: artifact.artifact.artifactRef, enter: true } })
      await this.completeStep(runtime, step.id)
      return this.nextStepId(runtime, step)
    }
    if (step.type === 'sleep') {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'sleep_started', stepId: step.id, summary: 'Sleep started', data: { durationMs: step.durationMs } })
      const completed = await this.waitForDuration(runtime, step.durationMs, 'running')
      if (!completed) return null
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'sleep_completed', stepId: step.id, summary: 'Sleep completed', data: { durationMs: step.durationMs } })
      await this.completeStep(runtime, step.id)
      return this.nextStepId(runtime, step)
    }
    if (step.type === 'wait') return await this.executeWait(runtime, step)
    if (step.type === 'input_line') {
      const resolved = this.resolveTerminal(runtime, step.terminal)
      runtime.status = 'waiting_user_input'
      runtime.waitingInput = { stepId: step.id, prompt: step.prompt, allowEmpty: step.allowEmpty, terminalId: resolved.terminalId }
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'user_input_requested', stepId: step.id, summary: 'User input requested', data: { prompt: step.prompt, allowEmpty: step.allowEmpty, terminalId: resolved.terminalId } })
      return null
    }
    if (step.type === 'capture-source') {
      const resolved = this.resolveTerminal(runtime, step.capture.terminal)
      await this.appendTerminalRef(runtime, step.id, step.capture.terminal, resolved)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'capture_wait_started', stepId: step.id, summary: 'Capture source started', data: { captureKind: step.capture.kind, terminalId: resolved.terminalId } })

      if (step.capture.kind === 'terminal-buffer') {
        const terminal = this.terminalSnapshot(runtime.configId, resolved.terminalId)
        const captured = captureTerminalBuffer({ replay: terminal.replay, maxChars: step.capture.maxChars })
        const rawArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'capture-raw', captured.rawText, 'txt', step.id)
        const normalizedArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'capture-normalized', captured.normalizedText, 'txt', step.id)
        runtime.captureArtifacts.set(step.id, normalizedArtifact.artifact.artifactRef)
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: 'capture_artifact_created',
          stepId: step.id,
          summary: 'Terminal buffer capture artifact created',
          data: {
            captureKind: 'terminal-buffer',
            terminalId: resolved.terminalId,
            mode: step.capture.mode,
            maxChars: step.capture.maxChars,
            artifactRef: normalizedArtifact.artifact.artifactRef,
            rawArtifactRef: rawArtifact.artifact.artifactRef,
            normalizedArtifactRef: normalizedArtifact.artifact.artifactRef,
            truncated: captured.truncated,
            rawCharsBeforeTail: captured.rawCharsBeforeTail,
            capturedChars: captured.capturedChars,
            strippedAnsi: captured.strippedAnsi,
          },
        })
      } else {
        const event = this.nextAgentEventForCapture(runtime, step.id, resolved.terminalId, step.capture.agentKind, step.capture.eventKind, step.capture.adapter)
        if (!event) throw new Error('agent_event_not_ready:' + resolved.terminalId)
        runtime.consumedAgentEvents.add(agentEventKey(event))
        const rawArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'agent-event-raw', JSON.stringify(event, null, 2), 'json', step.id)
        const captureArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'capture-agent', event.capturedText ?? '', 'txt', step.id)
        runtime.captureArtifacts.set(step.id, captureArtifact.artifact.artifactRef)
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: 'capture_artifact_created',
          stepId: step.id,
          summary: 'AgentEvent capture artifact created',
          data: {
            captureKind: 'agent-event',
            terminalId: resolved.terminalId,
            agentKind: step.capture.agentKind,
            eventKind: step.capture.eventKind,
            adapter: step.capture.adapter,
            agentSessionId: event.agentSessionId,
            codexSessionId: event.adapterMetadata.codexSessionId,
            launchId: event.launchId,
            agentTurnId: event.agentTurnId ?? null,
            artifactRef: captureArtifact.artifact.artifactRef,
            rawArtifactRef: rawArtifact.artifact.artifactRef,
          },
        })
      }

      await this.completeStep(runtime, step.id)
      return this.nextStepId(runtime, step)
    }
    if (step.type === 'parse') {
      const artifactRef = runtime.captureArtifacts.get(step.captureStep)
      if (!artifactRef) throw new Error('missing_capture_artifact:' + step.captureStep)
      const text = this.runEventStore.readArtifact(runtime.configId, runtime.runId, artifactRef)
      const parsed = parseMockSignals(step.parser, text, PROFILE_CATALOG_SUMMARY)
      runtime.parserSignals.set(step.id, parsed.signals)
      const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'parser-output', JSON.stringify(parsed, null, 2), 'json', step.id)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parser_normalized', stepId: step.id, summary: 'Mock parser normalized signals', data: { captureArtifactRef: artifactRef, artifactRef: artifact.artifact.artifactRef, signals: parsed.signals } })
      await this.completeStep(runtime, step.id)
      return this.nextStepId(runtime, step)
    }
    if (step.type === 'branch') {
      const signals = runtime.parserSignals.get(step.fromParseStep)
      if (!signals) throw new Error('missing_parser_signals:' + step.fromParseStep)
      const selected = this.evaluateBranch(step.conditions, signals) ?? step.else
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'branch_decision', stepId: step.id, summary: selected ? 'Branch selected ' + selected : 'Branch had no target', data: { selectedStepId: selected ?? null, signals } })
      await this.completeStep(runtime, step.id)
      if (!selected) await this.pauseRun(runtime, 'branch_no_target', 'Branch did not select a next step', step.id)
      return selected ?? null
    }
    if (step.type === 'goto') {
      await this.completeStep(runtime, step.id)
      return step.goto
    }
    if (step.type === 'pause') {
      await this.pauseRun(runtime, 'template_pause', step.reason ?? 'Template paused', step.id)
      return null
    }
    if (step.type === 'complete') {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'run_completed', summary: step.reason ?? 'Run completed', data: { reason: step.reason ?? 'Run completed' } })
      runtime.status = 'completed'
      runtime.currentStepId = step.id
      await this.completeStep(runtime, step.id)
      return null
    }
    if (step.type === 'fail') {
      await this.failRun(runtime, 'template_fail', step.reason ?? 'Template failed', step.id)
      return null
    }
    if (step.type === 'stop') {
      await this.completeStep(runtime, step.id)
      await this.stopRun(runtime, step.reason ?? 'Template stopped', 'template_stop', step.id)
      return null
    }
    throw new Error('unsupported_step:' + (step as { type: string }).type)
  }

  private async executeWait(runtime: RuntimeState, step: Extract<MacroStep, { type: 'wait' }>): Promise<string | null> {
    runtime.status = 'waiting'
    runtime.manualContinueRequested = false
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'wait_started', stepId: step.id, summary: 'Wait started: ' + step.mode, data: { mode: step.mode } })

    let result: WaitResult = 'completed'
    if (step.mode === 'duration') result = await this.waitForDuration(runtime, step.durationMs, 'waiting') ? 'completed' : 'cancelled'
    if (step.mode === 'terminal-quiet') result = await this.waitForTerminalQuiet(runtime, step)
    if (step.mode === 'capture-ready-or-user') result = await this.waitForCaptureReadyOrManual(runtime, step)
    if (step.mode === 'user-continue') result = await this.waitForManualContinue(runtime)

    if (result === 'cancelled') return null
    if (result === 'timeout') {
      const message = 'Wait timed out: ' + step.mode
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'wait_timeout', stepId: step.id, summary: message, data: { mode: step.mode } })
      if ('onTimeout' in step && step.onTimeout === 'fail') await this.failRun(runtime, 'wait_timeout', message, step.id)
      else await this.pauseRun(runtime, 'wait_timeout', message, step.id)
      return null
    }

    runtime.status = 'running'
    runtime.manualContinueRequested = false
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'wait_completed', stepId: step.id, summary: 'Wait completed: ' + step.mode, data: { mode: step.mode, manualContinue: result === 'manual' } })
    await this.completeStep(runtime, step.id)
    return this.nextStepId(runtime, step)
  }

  private async waitForDuration(runtime: RuntimeState, durationMs: number, status: MacroRunnerStatus): Promise<boolean> {
    const deadline = Date.now() + durationMs
    while (Date.now() < deadline) {
      if (!this.runtimeCanContinue(runtime, status)) return false
      await delay(Math.min(25, Math.max(1, deadline - Date.now())))
    }
    return this.runtimeCanContinue(runtime, status)
  }

  private async waitForManualContinue(runtime: RuntimeState): Promise<WaitResult> {
    while (this.runtimeCanContinue(runtime, 'waiting')) {
      if (runtime.manualContinueRequested) return 'manual'
      await delay(25)
    }
    return 'cancelled'
  }

  private async waitForCaptureReadyOrManual(runtime: RuntimeState, step: Extract<MacroStep, { type: 'wait'; mode: 'capture-ready-or-user' }>): Promise<WaitResult> {
    this.rememberAgentEventBaseline(runtime, step.captureStep)
    const deadline = Date.now() + step.timeoutMs
    while (Date.now() < deadline) {
      if (!this.runtimeCanContinue(runtime, 'waiting')) return 'cancelled'
      if (this.captureSourceReady(runtime, step.captureStep)) return 'completed'
      if (runtime.manualContinueRequested) return 'manual'
      await delay(Math.min(25, Math.max(1, deadline - Date.now())))
    }
    return this.captureSourceReady(runtime, step.captureStep) ? 'completed' : 'timeout'
  }

  private captureSourceReady(runtime: RuntimeState, captureStepId: string): boolean {
    const captureStep = runtime.template.steps.find((step) => step.id === captureStepId)
    if (captureStep?.type !== 'capture-source' || !runtime.mockCaptureReady) return false
    if (captureStep.capture.kind === 'terminal-buffer') return true
    try {
      const resolved = this.resolveTerminal(runtime, captureStep.capture.terminal)
      return Boolean(this.nextAgentEventForCapture(runtime, captureStep.id, resolved.terminalId, captureStep.capture.agentKind, captureStep.capture.eventKind, captureStep.capture.adapter))
    } catch {
      return false
    }
  }

  private async waitForTerminalQuiet(runtime: RuntimeState, step: Extract<MacroStep, { type: 'wait'; mode: 'terminal-quiet' }>): Promise<WaitResult> {
    const resolved = this.resolveTerminal(runtime, step.terminal)
    await this.appendTerminalRef(runtime, step.id, step.terminal, resolved)
    const startedAt = Date.now()
    let lastChangeAt = startedAt
    let lastSize = this.terminalReplaySize(runtime.configId, resolved.terminalId)
    while (Date.now() - startedAt < step.maxMs) {
      if (!this.runtimeCanContinue(runtime, 'waiting')) return 'cancelled'
      const size = this.terminalReplaySize(runtime.configId, resolved.terminalId)
      if (size !== lastSize) {
        lastSize = size
        lastChangeAt = Date.now()
      }
      if (Date.now() - lastChangeAt >= step.quietMs) return 'completed'
      await delay(25)
    }
    return 'timeout'
  }

  private runtimeCanContinue(runtime: RuntimeState, status: MacroRunnerStatus): boolean {
    return this.runtimes.get(runtime.configId)?.token === runtime.token && !runtime.pauseRequested && runtime.status === status
  }

  private terminalReplaySize(configId: string, terminalId: string): number {
    return this.terminalSnapshot(configId, terminalId).replay.reduce((total, chunk) => total + chunk.length, 0)
  }

  private evaluateBranch(conditions: BranchCondition[], signals: Record<string, boolean | null>): string | undefined {
    for (const condition of conditions) {
      const actual = signals[condition.signal]
      if (actual === undefined) throw new Error('branch_signal_missing:' + condition.signal)
      if (condition.op === 'is_null' && actual === null) return condition.goto
      if (condition.op === '==' && actual === condition.value) return condition.goto
      if (condition.op === '!=' && actual !== condition.value) return condition.goto
    }
    return undefined
  }

  private async transition(runtime: RuntimeState, from: MacroStep, targetStepId: string): Promise<string | null> {
    const fromIndex = runtime.template.steps.findIndex((step) => step.id === from.id)
    const targetIndex = runtime.template.steps.findIndex((step) => step.id === targetStepId)
    if (targetIndex === -1) throw new Error('target_step_not_found:' + targetStepId)
    const isBackEdge = targetIndex < fromIndex
    const key = from.id + '->' + targetStepId
    const count = isBackEdge ? this.backEdgeCount(runtime, from.id, targetStepId) + 1 : 0
    if (isBackEdge) {
      if (!from.loopGuard) throw new Error('back_edge_missing_loop_guard:' + key)
      if (count > from.loopGuard.maxIterations) {
        const message = 'Loop guard limit reached for ' + key + ' at ' + count + '/' + from.loopGuard.maxIterations
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'control_transition', stepId: from.id, summary: message, data: { fromStepId: from.id, toStepId: targetStepId, backEdge: true, count, limit: from.loopGuard.maxIterations } })
        if (from.loopGuard.onLimit === 'fail') await this.failRun(runtime, 'loop_guard_limit', message, from.id)
        else await this.pauseRun(runtime, 'loop_guard_limit', message, from.id)
        return null
      }
    }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'control_transition', stepId: from.id, summary: 'Transition ' + from.id + ' -> ' + targetStepId, data: { fromStepId: from.id, toStepId: targetStepId, backEdge: isBackEdge, count } })
    return targetStepId
  }

  private backEdgeCount(runtime: RuntimeState, fromStepId: string, toStepId: string): number {
    return this.runEventStore.snapshot(runtime.configId, runtime.runId).replay.events.filter((event) => {
      return event.kind === 'control_transition'
        && event.data.fromStepId === fromStepId
        && event.data.toStepId === toStepId
        && event.data.backEdge === true
    }).length
  }

  private nextStepId(runtime: RuntimeState, step: MacroStep): string | null {
    if ('next' in step && step.next) return step.next
    const index = runtime.template.steps.findIndex((candidate) => candidate.id === step.id)
    return runtime.template.steps[index + 1]?.id ?? null
  }

  private resolveTerminal(runtime: RuntimeState, target: Parameters<typeof resolveTerminalTargetInConfig>[0]): ResolvedTerminalRef {
    const resolved = resolveTerminalTargetInConfig(target, this.manager.indexMap(runtime.configId))
    const terminal = this.terminalSnapshot(runtime.configId, resolved.terminalId)
    if (terminal.status !== 'running') throw new Error('terminal_not_running:' + resolved.terminalId)
    return resolved
  }

  private async appendTerminalRef(runtime: RuntimeState, stepId: string, ref: Parameters<typeof resolveTerminalTargetInConfig>[0], resolved: ResolvedTerminalRef): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'terminal_ref_resolved', stepId, summary: 'Terminal ref resolved', data: { ref, terminalId: resolved.terminalId, terminalAlias: resolved.terminalAlias, terminalIndex: resolved.terminalIndex } })
  }

  private rememberAgentEventBaseline(runtime: RuntimeState, captureStepId: string): void {
    if (runtime.agentEventBaselines.has(captureStepId)) return
    const captureStep = runtime.template.steps.find((step) => step.id === captureStepId)
    if (captureStep?.type !== 'capture-source' || captureStep.capture.kind !== 'agent-event') return
    const resolved = this.resolveTerminal(runtime, captureStep.capture.terminal)
    this.agentEventStore.importSpool(runtime.configId)
    runtime.agentEventBaselines.set(captureStepId, this.agentEventStore.countMatching({ configId: runtime.configId, terminalId: resolved.terminalId, agentKind: captureStep.capture.agentKind, eventKind: captureStep.capture.eventKind, adapter: captureStep.capture.adapter }))
  }

  private nextAgentEventForCapture(runtime: RuntimeState, captureStepId: string, terminalId: string, agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook'): AgentEvent | undefined {
    this.agentEventStore.importSpool(runtime.configId)
    return this.agentEventStore.nextMatching({ configId: runtime.configId, terminalId, agentKind, eventKind, adapter }, runtime.agentEventBaselines.get(captureStepId) ?? 0, runtime.consumedAgentEvents)
  }

  private terminalSnapshot(configId: string, terminalId: string): TerminalSnapshot {
    const snapshot = this.manager.deckSnapshot(configId).terminals.find((terminal) => terminal.terminalId === terminalId)
    if (!snapshot) throw new Error('terminal_not_found:' + terminalId)
    return snapshot
  }

  private async startStep(runtime: RuntimeState, stepId: string): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'step_started', stepId, summary: 'Step started: ' + stepId, data: {} })
  }

  private async completeStep(runtime: RuntimeState, stepId: string): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'step_completed', stepId, summary: 'Step completed: ' + stepId, data: {} })
  }

  private async stopRun(runtime: RuntimeState, message: string, code: string, stepId?: string): Promise<void> {
    runtime.pauseRequested = true
    runtime.status = 'stopped'
    runtime.waitingInput = null
    runtime.pauseReason = { code, message, stepId }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'run_stopped', summary: message, data: { code, reason: message, ...(stepId ? { stepId } : {}) } })
  }

  private async pauseRun(runtime: RuntimeState, code: string, message: string, stepId = runtime.currentStepId ?? undefined): Promise<void> {
    runtime.status = 'paused'
    runtime.pauseRequested = true
    runtime.pauseReason = { code, message, stepId }
    runtime.waitingInput = null
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'run_paused', stepId, summary: message, data: { code, reason: message } })
  }

  private async failRun(runtime: RuntimeState, code: string, message: string, stepId = runtime.currentStepId ?? undefined): Promise<void> {
    runtime.status = 'failed'
    runtime.pauseRequested = true
    runtime.pauseReason = { code, message, stepId }
    runtime.waitingInput = null
    if (stepId) {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'step_failed', stepId, summary: message, data: { code, reason: message } })
    }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'run_failed', summary: message, data: { code, reason: message } })
  }

  private storedLiveRun(configId: string): RunSummary | undefined {
    return this.runEventStore.listRuns(configId).find((run) => run.status === 'running' || run.status === 'paused' || run.status === 'interrupted')
  }

  private snapshotForStoredInterrupted(configId: string, summary: RunSummary): MacroRunnerSnapshot {
    const runs = this.runEventStore.listRuns(configId)
    const run = this.runEventStore.snapshot(configId, summary.runId)
    const started = run.replay.events.find((event) => event.kind === "run_started")
    const templateId = typeof started?.data.templateId === "string" ? started.data.templateId : null
    const templateName = typeof started?.data.templateName === "string" ? started.data.templateName : null
    return {
      configId,
      status: "interrupted",
      runId: summary.runId,
      templateId,
      templateName,
      currentStepId: run.derivedState.currentStepId,
      waitingInput: null,
      pauseReason: { code: "runtime_interrupted", message: "Runner runtime is not active; stop this run or inspect the run log before starting another macro.", stepId: run.derivedState.currentStepId ?? undefined },
      run,
      runs,
    }
  }

  private runtimeOrThrow(configId: string): RuntimeState {
    const runtime = this.runtimes.get(configId)
    if (!runtime) throw new Error('runner_idle')
    return runtime
  }

  private snapshotForRuntime(configId: string, runtime?: RuntimeState): MacroRunnerSnapshot {
    const runs = this.runEventStore.listRuns(configId)
    if (!runtime) {
      return { configId, status: 'idle', runId: null, templateId: null, templateName: null, currentStepId: null, waitingInput: null, pauseReason: null, runs }
    }
    const run = this.runEventStore.snapshot(configId, runtime.runId)
    return {
      configId,
      status: runtime.status,
      runId: runtime.runId,
      templateId: runtime.template.id,
      templateName: runtime.template.name,
      currentStepId: runtime.currentStepId,
      waitingInput: runtime.waitingInput,
      pauseReason: runtime.pauseReason,
      run,
      runs,
    }
  }
}

function liveRunError(runId: string): Error & { existingRunId?: string } {
  const error = new Error("live_run_exists:" + runId) as Error & { existingRunId?: string }
  error.existingRunId = runId
  return error
}

function isLive(status: MacroRunnerStatus): boolean {
  return status === 'running' || status === 'waiting' || status === 'waiting_user_input' || status === 'paused' || status === 'interrupted'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
