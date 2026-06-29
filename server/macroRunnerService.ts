import { validateMacroTemplate } from '../src/lib/macro/templateSchema'
import type { BranchCondition, LaneSuccessCondition, MacroStep, MacroTemplate, ParallelAllStep, ParallelLane, ParallelLaneStep } from '../src/lib/macro/templateTypes'
import { AgentEventStore, agentEventKey } from '../src/lib/agentEvents/agentEventStore'
import type { AgentEvent } from '../src/lib/agentEvents/agentEventTypes'
import { captureTerminalBuffer } from '../src/lib/capture/terminalBufferCapture'
import { PROFILE_CATALOG_SUMMARY } from '../src/lib/macro/profileCatalogSummary'
import { ParserRuntime } from '../src/lib/parser/parserRuntime'
import { parserInvocationErrorMetadata } from '../src/lib/parser/parserProfileTypes'
import type { MacroRunnerPauseReason, MacroRunnerSnapshot, MacroRunnerStatus, StartMacroRunRequest } from '../src/lib/macro/runnerTypes'
import { resolveTerminalTargetInConfig, type ResolvedTerminalRef } from '../src/lib/macro/terminalRefResolver'
import type { RunSnapshot, RunSummary } from '../src/lib/runLog/runEventTypes'
import { RunEventStore } from '../src/lib/runLog/runEventStore'
import type { TerminalSnapshot } from '../src/lib/protocol'
import { MacroTemplateStore } from '../src/lib/macro/templateStore'
import { TerminalDeckManager } from './terminalDeckManager'

type WaitResult = 'completed' | 'manual' | 'timeout' | 'cancelled'

type LaneFailureAction = 'pause' | 'fail'

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
  abortControllers: Set<AbortController>
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
      abortControllers: new Set(),
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
    this.abortActiveParsers(runtime)
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
    this.abortActiveParsers(runtime)
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
    if (step.type === 'parallel_all') return await this.executeParallelAll(runtime, step)
    if (step.type === 'parse') {
      const artifactRef = runtime.captureArtifacts.get(step.captureStep)
      if (!artifactRef) throw new Error('missing_capture_artifact:' + step.captureStep)
      const text = this.runEventStore.readArtifact(runtime.configId, runtime.runId, artifactRef)
      const abortController = new AbortController()
      this.registerAbortController(runtime, abortController)
      let parsed: Awaited<ReturnType<ParserRuntime['parse']>>
      try {
        parsed = await this.parserRuntime.parse({
          configId: runtime.configId,
          runId: runtime.runId,
          stepId: step.id,
          captureArtifactRef: artifactRef,
          parser: step.parser,
          text,
          signal: abortController.signal,
        })
      } catch (error) {
        if (!this.runtimeCanContinue(runtime, 'running')) return null
        const parserError = parserInvocationErrorMetadata(error)
        if (parserError) {
          await this.pauseRun(runtime, parserError.code, error instanceof Error ? error.message : String(error), step.id, parserError)
          return null
        }
        throw error
      } finally {
        this.releaseAbortController(runtime, abortController)
      }
      if (!this.runtimeCanContinue(runtime, 'running')) return null
      if (parsed.status === 'disagreement') {
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
          kind: 'parser_disagreement',
          stepId: step.id,
          summary: 'Parser replicas disagreed: ' + parsed.profileId,
          data: {
            profileId: parsed.profileId,
            strategy: parsed.strategy,
            variants: parsed.variants.map((variant) => ({ signals: variant.signals, rawArtifactRef: variant.rawArtifactRef, normalizedArtifactRef: variant.normalizedArtifactRef, inputArtifactRef: variant.inputArtifactRef ?? null, metadata: variant.metadata })),
          },
        })
        await this.pauseRun(runtime, 'parser_disagreement', 'Parser replicas disagreed for ' + parsed.profileId, step.id)
        return null
      }
      runtime.parserSignals.set(step.id, parsed.signals)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, {
        kind: 'parser_normalized',
        stepId: step.id,
        summary: 'Parser normalized signals',
        data: {
          parserKind: parsed.parserKind,
          profileId: parsed.profileId ?? null,
          captureArtifactRef: artifactRef,
          rawArtifactRef: parsed.rawArtifactRef,
          normalizedArtifactRef: parsed.normalizedArtifactRef,
          artifactRef: parsed.normalizedArtifactRef,
          inputArtifactRef: parsed.inputArtifactRef ?? null,
          signals: parsed.signals,
          metadata: parsed.metadata,
        },
      })
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

  private async executeParallelAll(runtime: RuntimeState, step: ParallelAllStep): Promise<string | null> {
    this.hydrateParallelRuntimeFromEvents(runtime, step)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_all_started', stepId: step.id, summary: 'Parallel all started: ' + step.id, data: { laneIds: step.lanes.map((lane) => lane.id) } })
    await Promise.all(step.lanes.map((lane) => this.executeParallelLane(runtime, step, lane)))
    if (!this.runtimeCanContinue(runtime, 'running')) return null
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_all_joined', stepId: step.id, summary: 'Parallel all joined: all_success', data: { mode: step.join.mode, laneIds: step.lanes.map((lane) => lane.id) } })
    await this.completeStep(runtime, step.id)
    return this.nextStepId(runtime, step)
  }

  private async executeParallelLane(runtime: RuntimeState, parent: ParallelAllStep, lane: ParallelLane): Promise<void> {
    if (!this.runtimeCanContinue(runtime, 'running')) return
    if (this.parallelLaneSucceeded(runtime, parent.id, lane.id)) return
    const terminal = this.resolveTerminal(runtime, lane.terminal)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_lane_started', stepId: parent.id, summary: 'Parallel lane started: ' + lane.id, data: { laneId: lane.id, terminalId: terminal.terminalId, terminalAlias: terminal.terminalAlias, terminalIndex: terminal.terminalIndex } })
    for (const laneStep of lane.steps) {
      if (!this.runtimeCanContinue(runtime, 'running')) return
      if (this.parallelLaneStepCompleted(runtime, parent.id, lane.id, laneStep.id)) continue
      try {
        await this.executeParallelLaneStep(runtime, parent, lane, laneStep, terminal)
      } catch (error) {
        if (!this.runtimeCanContinue(runtime, 'running')) return
        await this.failParallelLane(runtime, parent, lane.id, laneStep.id, 'pause', error instanceof Error ? error.message : String(error), { code: 'parallel_lane_step_error' })
        return
      }
    }
    if (!this.runtimeCanContinue(runtime, 'running')) return
    const signals = runtime.parserSignals.get(this.laneStepKey(parent.id, lane.id, lane.success.fromParseStep))
    if (!signals) {
      await this.failParallelLane(runtime, parent, lane.id, lane.success.fromParseStep, parent.join.onLaneFail, 'Missing lane parser signals: ' + lane.success.fromParseStep, { code: 'parallel_lane_missing_parser_signals' })
      return
    }
    const success = this.evaluateLaneSuccess(lane.success.conditions, signals)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_lane_condition_evaluated', stepId: parent.id, summary: success.ok ? 'Parallel lane condition passed: ' + lane.id : 'Parallel lane condition failed: ' + lane.id, data: { laneId: lane.id, fromParseStep: lane.success.fromParseStep, ok: success.ok, failedSignal: success.failedSignal ?? null, signals } })
    if (!success.ok) {
      await this.failParallelLane(runtime, parent, lane.id, lane.success.fromParseStep, parent.join.onLaneFail, 'Parallel lane success condition failed: ' + lane.id, { code: 'parallel_lane_condition_failed', failedSignal: success.failedSignal ?? null, signals })
      return
    }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_lane_succeeded', stepId: parent.id, summary: 'Parallel lane succeeded: ' + lane.id, data: { laneId: lane.id } })
  }

  private async executeParallelLaneStep(runtime: RuntimeState, parent: ParallelAllStep, lane: ParallelLane, laneStep: ParallelLaneStep, terminal: ResolvedTerminalRef): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_lane_step_started', stepId: parent.id, summary: 'Parallel lane step started: ' + lane.id + '/' + laneStep.id, data: { laneId: lane.id, laneStepId: laneStep.id, laneStepType: laneStep.type } })
    if (laneStep.type === 'send_line') {
      if (!this.parallelLaneLineSent(runtime, parent.id, lane.id, laneStep.id)) {
        const target = laneStep.terminal ?? lane.terminal
        const resolved = this.resolveTerminal(runtime, target)
        if (resolved.terminalId !== terminal.terminalId) throw new Error('parallel_lane_terminal_mismatch:' + lane.id + ':' + laneStep.id)
        await this.appendTerminalRef(runtime, parent.id, target, resolved)
        const artifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'parallel-send', laneStep.text, 'txt', parent.id)
        const result = this.manager.input(runtime.configId, { kind: 'id', value: resolved.terminalId }, laneStep.text + '\r')
        if (!result.ok) throw new Error('terminal_input_rejected:' + result.reason)
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'terminal_line_sent', stepId: parent.id, summary: 'Parallel lane line sent: ' + lane.id + '/' + laneStep.id, data: { laneId: lane.id, laneStepId: laneStep.id, terminalId: resolved.terminalId, artifactRef: artifact.artifact.artifactRef, enter: true } })
      }
      await this.completeParallelLaneStep(runtime, parent.id, lane.id, laneStep.id)
      return
    }
    if (laneStep.type === 'sleep') {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'sleep_started', stepId: parent.id, summary: 'Parallel lane sleep started', data: { laneId: lane.id, laneStepId: laneStep.id, durationMs: laneStep.durationMs } })
      const completed = await this.waitForDuration(runtime, laneStep.durationMs, 'running')
      if (!completed) return
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'sleep_completed', stepId: parent.id, summary: 'Parallel lane sleep completed', data: { laneId: lane.id, laneStepId: laneStep.id, durationMs: laneStep.durationMs } })
      await this.completeParallelLaneStep(runtime, parent.id, lane.id, laneStep.id)
      return
    }
    if (laneStep.type === 'wait') {
      const waitResult = await this.executeParallelLaneWait(runtime, parent, lane, laneStep, terminal)
      if (waitResult === 'cancelled') return
      if (waitResult === 'timeout') {
        const action = 'onTimeout' in laneStep ? laneStep.onTimeout : parent.join.onTimeout ?? 'pause'
        await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'wait_timeout', stepId: parent.id, summary: 'Parallel lane wait timed out: ' + lane.id + '/' + laneStep.id, data: { laneId: lane.id, laneStepId: laneStep.id, mode: laneStep.mode } })
        await this.failParallelLane(runtime, parent, lane.id, laneStep.id, action, 'Parallel lane wait timed out: ' + lane.id + '/' + laneStep.id, { code: 'parallel_lane_wait_timeout', mode: laneStep.mode })
        return
      }
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'wait_completed', stepId: parent.id, summary: 'Parallel lane wait completed: ' + lane.id + '/' + laneStep.id, data: { laneId: lane.id, laneStepId: laneStep.id, mode: laneStep.mode } })
      await this.completeParallelLaneStep(runtime, parent.id, lane.id, laneStep.id)
      return
    }
    if (laneStep.type === 'capture-source') {
      await this.captureParallelLaneSource(runtime, parent, lane, laneStep, terminal)
      await this.completeParallelLaneStep(runtime, parent.id, lane.id, laneStep.id)
      return
    }
    if (laneStep.type === 'parse') {
      await this.parseParallelLaneCapture(runtime, parent, lane, laneStep)
      await this.completeParallelLaneStep(runtime, parent.id, lane.id, laneStep.id)
    }
  }

  private async executeParallelLaneWait(runtime: RuntimeState, parent: ParallelAllStep, lane: ParallelLane, laneStep: Extract<ParallelLaneStep, { type: 'wait' }>, terminal: ResolvedTerminalRef): Promise<WaitResult> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_lane_waiting', stepId: parent.id, summary: 'Parallel lane waiting: ' + lane.id + '/' + laneStep.id, data: { laneId: lane.id, laneStepId: laneStep.id, mode: laneStep.mode } })
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'wait_started', stepId: parent.id, summary: 'Parallel lane wait started: ' + laneStep.mode, data: { laneId: lane.id, laneStepId: laneStep.id, mode: laneStep.mode } })
    if (laneStep.mode === 'duration') return await this.waitForDuration(runtime, laneStep.durationMs, 'running') ? 'completed' : 'cancelled'
    if (laneStep.mode === 'terminal-quiet') {
      const resolved = this.resolveTerminal(runtime, laneStep.terminal)
      if (resolved.terminalId !== terminal.terminalId) throw new Error('parallel_lane_terminal_mismatch:' + lane.id + ':' + laneStep.id)
      return await this.waitForParallelTerminalQuiet(runtime, laneStep, resolved.terminalId)
    }
    if (laneStep.mode === 'capture-ready-or-user') return await this.waitForParallelCaptureReady(runtime, parent, lane, laneStep)
    throw new Error('parallel_lane_wait_mode_not_allowed:' + laneStep.mode)
  }

  private async waitForParallelTerminalQuiet(runtime: RuntimeState, step: Extract<ParallelLaneStep, { type: 'wait'; mode: 'terminal-quiet' }>, terminalId: string): Promise<WaitResult> {
    const startedAt = Date.now()
    let lastChangeAt = startedAt
    let lastSize = this.terminalReplaySize(runtime.configId, terminalId)
    while (Date.now() - startedAt < step.maxMs) {
      if (!this.runtimeCanContinue(runtime, 'running')) return 'cancelled'
      const size = this.terminalReplaySize(runtime.configId, terminalId)
      if (size !== lastSize) {
        lastSize = size
        lastChangeAt = Date.now()
      }
      if (Date.now() - lastChangeAt >= step.quietMs) return 'completed'
      await delay(25)
    }
    return 'timeout'
  }

  private async waitForParallelCaptureReady(runtime: RuntimeState, parent: ParallelAllStep, lane: ParallelLane, step: Extract<ParallelLaneStep, { type: 'wait'; mode: 'capture-ready-or-user' }>): Promise<WaitResult> {
    this.rememberParallelAgentEventBaseline(runtime, parent.id, lane, step.captureStep)
    const deadline = Date.now() + step.timeoutMs
    while (Date.now() < deadline) {
      if (!this.runtimeCanContinue(runtime, 'running')) return 'cancelled'
      if (this.parallelCaptureSourceReady(runtime, parent.id, lane, step.captureStep)) return 'completed'
      await delay(Math.min(25, Math.max(1, deadline - Date.now())))
    }
    return this.parallelCaptureSourceReady(runtime, parent.id, lane, step.captureStep) ? 'completed' : 'timeout'
  }

  private async captureParallelLaneSource(runtime: RuntimeState, parent: ParallelAllStep, lane: ParallelLane, laneStep: Extract<ParallelLaneStep, { type: 'capture-source' }>, terminal: ResolvedTerminalRef): Promise<void> {
    const resolved = this.resolveTerminal(runtime, laneStep.capture.terminal)
    if (resolved.terminalId !== terminal.terminalId) throw new Error('parallel_lane_terminal_mismatch:' + lane.id + ':' + laneStep.id)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'capture_wait_started', stepId: parent.id, summary: 'Parallel lane capture started', data: { laneId: lane.id, laneStepId: laneStep.id, captureKind: laneStep.capture.kind, terminalId: resolved.terminalId } })
    if (laneStep.capture.kind === 'terminal-buffer') {
      const terminalSnapshot = this.terminalSnapshot(runtime.configId, resolved.terminalId)
      const captured = captureTerminalBuffer({ replay: terminalSnapshot.replay, maxChars: laneStep.capture.maxChars })
      const rawArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'parallel-capture-raw', captured.rawText, 'txt', parent.id)
      const normalizedArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'parallel-capture-normalized', captured.normalizedText, 'txt', parent.id)
      runtime.captureArtifacts.set(this.laneStepKey(parent.id, lane.id, laneStep.id), normalizedArtifact.artifact.artifactRef)
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'capture_artifact_created', stepId: parent.id, summary: 'Parallel lane terminal buffer capture artifact created', data: { laneId: lane.id, laneStepId: laneStep.id, captureKind: 'terminal-buffer', terminalId: resolved.terminalId, mode: laneStep.capture.mode, maxChars: laneStep.capture.maxChars, artifactRef: normalizedArtifact.artifact.artifactRef, rawArtifactRef: rawArtifact.artifact.artifactRef, normalizedArtifactRef: normalizedArtifact.artifact.artifactRef, truncated: captured.truncated, rawCharsBeforeTail: captured.rawCharsBeforeTail, capturedChars: captured.capturedChars, strippedAnsi: captured.strippedAnsi } })
      return
    }
    const event = this.nextParallelAgentEventForCapture(runtime, parent.id, lane.id, laneStep.id, resolved.terminalId, laneStep.capture.agentKind, laneStep.capture.eventKind, laneStep.capture.adapter)
    if (!event) throw new Error('agent_event_not_ready:' + resolved.terminalId)
    runtime.consumedAgentEvents.add(agentEventKey(event))
    const rawArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'parallel-agent-event-raw', JSON.stringify(event, null, 2), 'json', parent.id)
    const captureArtifact = await this.runEventStore.writeArtifact(runtime.configId, runtime.runId, 'parallel-capture-agent', event.capturedText ?? '', 'txt', parent.id)
    runtime.captureArtifacts.set(this.laneStepKey(parent.id, lane.id, laneStep.id), captureArtifact.artifact.artifactRef)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'capture_artifact_created', stepId: parent.id, summary: 'Parallel lane AgentEvent capture artifact created', data: { laneId: lane.id, laneStepId: laneStep.id, captureKind: 'agent-event', terminalId: resolved.terminalId, agentKind: laneStep.capture.agentKind, eventKind: laneStep.capture.eventKind, adapter: laneStep.capture.adapter, agentSessionId: event.agentSessionId, codexSessionId: event.adapterMetadata.codexSessionId, launchId: event.launchId, agentTurnId: event.agentTurnId ?? null, artifactRef: captureArtifact.artifact.artifactRef, rawArtifactRef: rawArtifact.artifact.artifactRef } })
  }

  private async parseParallelLaneCapture(runtime: RuntimeState, parent: ParallelAllStep, lane: ParallelLane, laneStep: Extract<ParallelLaneStep, { type: 'parse' }>): Promise<void> {
    const captureKey = this.laneStepKey(parent.id, lane.id, laneStep.captureStep)
    const artifactRef = runtime.captureArtifacts.get(captureKey)
    if (!artifactRef) throw new Error('missing_parallel_capture_artifact:' + lane.id + ':' + laneStep.captureStep)
    const text = this.runEventStore.readArtifact(runtime.configId, runtime.runId, artifactRef)
    const abortController = new AbortController()
    this.registerAbortController(runtime, abortController)
    let parsed: Awaited<ReturnType<ParserRuntime['parse']>> | null = null
    try {
      parsed = await this.parserRuntime.parse({ configId: runtime.configId, runId: runtime.runId, stepId: parent.id, captureArtifactRef: artifactRef, parser: laneStep.parser, text, signal: abortController.signal, laneId: lane.id, laneStepId: laneStep.id } as never)
    } catch (error) {
      if (!this.runtimeCanContinue(runtime, 'running')) return
      const parserError = parserInvocationErrorMetadata(error)
      if (parserError) {
        await this.failParallelLane(runtime, parent, lane.id, laneStep.id, 'pause', error instanceof Error ? error.message : String(error), parserError)
        return
      }
      throw error
    } finally {
      this.releaseAbortController(runtime, abortController)
    }
    if (!this.runtimeCanContinue(runtime, 'running') || !parsed) return
    if (parsed.status === 'disagreement') {
      await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parser_disagreement', stepId: parent.id, summary: 'Parallel lane parser replicas disagreed: ' + lane.id, data: { laneId: lane.id, laneStepId: laneStep.id, profileId: parsed.profileId, strategy: parsed.strategy, variants: parsed.variants.map((variant) => ({ signals: variant.signals, rawArtifactRef: variant.rawArtifactRef, normalizedArtifactRef: variant.normalizedArtifactRef, inputArtifactRef: variant.inputArtifactRef ?? null, metadata: variant.metadata })) } })
      await this.failParallelLane(runtime, parent, lane.id, laneStep.id, 'pause', 'Parser replicas disagreed for lane ' + lane.id, { code: 'parser_disagreement' })
      return
    }
    runtime.parserSignals.set(this.laneStepKey(parent.id, lane.id, laneStep.id), parsed.signals)
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parser_normalized', stepId: parent.id, summary: 'Parallel lane parser normalized signals', data: { laneId: lane.id, laneStepId: laneStep.id, parserKind: parsed.parserKind, profileId: parsed.profileId ?? null, captureArtifactRef: artifactRef, rawArtifactRef: parsed.rawArtifactRef, normalizedArtifactRef: parsed.normalizedArtifactRef, artifactRef: parsed.normalizedArtifactRef, inputArtifactRef: parsed.inputArtifactRef ?? null, signals: parsed.signals, metadata: parsed.metadata } })
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_lane_parser_normalized', stepId: parent.id, summary: 'Parallel lane parser normalized: ' + lane.id + '/' + laneStep.id, data: { laneId: lane.id, laneStepId: laneStep.id, signals: parsed.signals, artifactRef: parsed.normalizedArtifactRef, rawArtifactRef: parsed.rawArtifactRef, inputArtifactRef: parsed.inputArtifactRef ?? null } })
  }

  private async completeParallelLaneStep(runtime: RuntimeState, parentStepId: string, laneId: string, laneStepId: string): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_lane_step_completed', stepId: parentStepId, summary: 'Parallel lane step completed: ' + laneId + '/' + laneStepId, data: { laneId, laneStepId } })
  }

  private async failParallelLane(runtime: RuntimeState, parent: ParallelAllStep, laneId: string, laneStepId: string, action: LaneFailureAction, message: string, data: Record<string, unknown> = {}): Promise<void> {
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'parallel_lane_failed', stepId: parent.id, summary: message, data: { laneId, laneStepId, action, ...data } })
    if (action === 'fail') await this.failRun(runtime, String(data.code ?? 'parallel_lane_failed'), message, parent.id)
    else await this.pauseRun(runtime, String(data.code ?? 'parallel_lane_failed'), message, parent.id, { laneId, laneStepId, ...data })
  }

  private hydrateParallelRuntimeFromEvents(runtime: RuntimeState, parent: ParallelAllStep): void {
    for (const event of this.runEventStore.snapshot(runtime.configId, runtime.runId).replay.events) {
      if (event.stepId !== parent.id) continue
      const laneId = typeof event.data.laneId === 'string' ? event.data.laneId : null
      const laneStepId = typeof event.data.laneStepId === 'string' ? event.data.laneStepId : null
      if (!laneId || !laneStepId) continue
      const key = this.laneStepKey(parent.id, laneId, laneStepId)
      if (event.kind === 'capture_artifact_created' && typeof event.data.artifactRef === 'string') runtime.captureArtifacts.set(key, event.data.artifactRef)
      if (event.kind === 'parser_normalized' && isSignalRecord(event.data.signals)) runtime.parserSignals.set(key, event.data.signals)
    }
  }

  private parallelLaneSucceeded(runtime: RuntimeState, parentStepId: string, laneId: string): boolean {
    return this.runEventStore.snapshot(runtime.configId, runtime.runId).replay.events.some((event) => event.stepId === parentStepId && event.kind === 'parallel_lane_succeeded' && event.data.laneId === laneId)
  }

  private parallelLaneStepCompleted(runtime: RuntimeState, parentStepId: string, laneId: string, laneStepId: string): boolean {
    return this.runEventStore.snapshot(runtime.configId, runtime.runId).replay.events.some((event) => event.stepId === parentStepId && event.kind === 'parallel_lane_step_completed' && event.data.laneId === laneId && event.data.laneStepId === laneStepId)
  }

  private parallelLaneLineSent(runtime: RuntimeState, parentStepId: string, laneId: string, laneStepId: string): boolean {
    return this.runEventStore.snapshot(runtime.configId, runtime.runId).replay.events.some((event) => event.stepId === parentStepId && event.kind === 'terminal_line_sent' && event.data.laneId === laneId && event.data.laneStepId === laneStepId)
  }

  private evaluateLaneSuccess(conditions: LaneSuccessCondition[], signals: Record<string, boolean | null>): { ok: boolean; failedSignal?: string } {
    for (const condition of conditions) {
      const actual = signals[condition.signal]
      if (actual === undefined) return { ok: false, failedSignal: condition.signal }
      if (condition.op === 'is_null') {
        if (actual !== null) return { ok: false, failedSignal: condition.signal }
      } else if (condition.op === '==' && actual !== condition.value) return { ok: false, failedSignal: condition.signal }
      else if (condition.op === '!=' && actual === condition.value) return { ok: false, failedSignal: condition.signal }
    }
    return { ok: true }
  }

  private parallelCaptureSourceReady(runtime: RuntimeState, parentStepId: string, lane: ParallelLane, captureStepId: string): boolean {
    const captureStep = lane.steps.find((step) => step.id === captureStepId)
    if (captureStep?.type !== 'capture-source' || !runtime.mockCaptureReady) return false
    if (captureStep.capture.kind === 'terminal-buffer') return true
    try {
      const resolved = this.resolveTerminal(runtime, captureStep.capture.terminal)
      return Boolean(this.nextParallelAgentEventForCapture(runtime, parentStepId, lane.id, captureStep.id, resolved.terminalId, captureStep.capture.agentKind, captureStep.capture.eventKind, captureStep.capture.adapter))
    } catch {
      return false
    }
  }

  private rememberParallelAgentEventBaseline(runtime: RuntimeState, parentStepId: string, lane: ParallelLane, captureStepId: string): void {
    const key = this.laneStepKey(parentStepId, lane.id, captureStepId)
    if (runtime.agentEventBaselines.has(key)) return
    const captureStep = lane.steps.find((step) => step.id === captureStepId)
    if (captureStep?.type !== 'capture-source' || captureStep.capture.kind !== 'agent-event') return
    const resolved = this.resolveTerminal(runtime, captureStep.capture.terminal)
    this.agentEventStore.importSpool(runtime.configId)
    runtime.agentEventBaselines.set(key, this.agentEventStore.countMatching({ configId: runtime.configId, terminalId: resolved.terminalId, agentKind: captureStep.capture.agentKind, eventKind: captureStep.capture.eventKind, adapter: captureStep.capture.adapter }))
  }

  private nextParallelAgentEventForCapture(runtime: RuntimeState, parentStepId: string, laneId: string, laneStepId: string, terminalId: string, agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook'): AgentEvent | undefined {
    this.agentEventStore.importSpool(runtime.configId)
    return this.agentEventStore.nextMatching({ configId: runtime.configId, terminalId, agentKind, eventKind, adapter }, runtime.agentEventBaselines.get(this.laneStepKey(parentStepId, laneId, laneStepId)) ?? 0, runtime.consumedAgentEvents)
  }

  private laneStepKey(parentStepId: string, laneId: string, laneStepId: string): string {
    return parentStepId + '/' + laneId + '/' + laneStepId
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

  private registerAbortController(runtime: RuntimeState, controller: AbortController): void {
    runtime.abortControllers.add(controller)
  }

  private releaseAbortController(runtime: RuntimeState, controller: AbortController): void {
    runtime.abortControllers.delete(controller)
  }

  private abortActiveParsers(runtime: RuntimeState): void {
    for (const controller of runtime.abortControllers) controller.abort()
    runtime.abortControllers.clear()
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
    this.abortActiveParsers(runtime)
    runtime.pauseRequested = true
    runtime.status = 'stopped'
    runtime.waitingInput = null
    runtime.pauseReason = { code, message, stepId }
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'run_stopped', summary: message, data: { code, reason: message, ...(stepId ? { stepId } : {}) } })
  }

  private async pauseRun(runtime: RuntimeState, code: string, message: string, stepId = runtime.currentStepId ?? undefined, data: Record<string, unknown> = {}): Promise<void> {
    this.abortActiveParsers(runtime)
    runtime.status = 'paused'
    runtime.pauseRequested = true
    runtime.pauseReason = { code, message, stepId }
    runtime.waitingInput = null
    await this.runEventStore.appendEvent(runtime.configId, runtime.runId, { kind: 'run_paused', stepId, summary: message, data: { code, reason: message, ...data } })
  }

  private async failRun(runtime: RuntimeState, code: string, message: string, stepId = runtime.currentStepId ?? undefined): Promise<void> {
    this.abortActiveParsers(runtime)
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

function isSignalRecord(value: unknown): value is Record<string, boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === 'boolean' || item === null)
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
