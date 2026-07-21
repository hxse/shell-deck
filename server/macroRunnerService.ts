import type { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import { performance } from 'node:perf_hooks'
import { createGeneratedId } from '../src/lib/generatedId'
import type {
  MacroDefinitionV5,
  MacroRecord,
} from '../src/lib/macro/macroDefinitionTypes'
import { validateMacroDefinitionV5, validateRunnableMacroDefinitionV5, type MacroDefinitionIssue } from '../src/lib/macro/macroDefinitionValidation'
import { validateMacroRuntimeBinding } from '../src/lib/macro/macroRuntimeBinding'
import type { FrozenTerminalBinding, MacroRunnerDelta, MacroRunnerSnapshot, MacroRunTrace, RunManifestV1 } from '../src/lib/macro/runnerTypes'
import type { TextListTemplateBinding } from '../src/lib/macro/scopedTextTemplate'
import { executeMacroAction, type MacroActionRuntimeContext } from './macroActionRuntime'
import { initializeMacroAgentEventBaselines, waitForMacroAgentEventCapture } from './macroAgentCapture'
import { executeMacroFlow, MacroFlowSignal } from './macroFlowExecutor'
import type { NotificationDispatcher } from './notificationService'
import type { MacroRecordStore } from './sharedContentStore'
import { macroDefinitionHash, MacroRunStore } from './macroRunStore'
import type { MacroArtifactMap } from './macroTextEvaluation'
import type { RoomControlledOperationTicket, TerminalRoomManager } from './terminalRoomManager'

type PendingInputResult = { kind: 'submitted'; value: string } | { kind: 'cancelled' }
type PendingInput = {
  invocationId: string
  prompt: string
  defaultText: string
  draft: string
  inputRevision: number
  resolve: (result: PendingInputResult) => void
}

type LiveRun = {
  runId: string
  roomId: string
  roomGeneration: string
  recordId: string
  recordRevision: number
  runtimeRevision: number
  publishedEventSeq: number
  publishTimer: ReturnType<typeof setTimeout> | null
  definition: MacroDefinitionV5
  bindings: Map<number, FrozenTerminalBinding>
  status: MacroRunnerSnapshot['status']
  currentNodeId: string | null
  error: string | null
  abortController: AbortController
  pauseWaiters: Array<() => void>
  pendingInput: PendingInput | null
  artifacts: MacroArtifactMap
  templateBindings: TextListTemplateBinding[]
  parallelProgress: Map<string, number>
  parallelOutputs: Map<string, string>
  agentEventBaselines: Map<string, number>
  consumedAgentEventIds: Set<string>
  terminalized: boolean
  cooperativeCheckpointCount: number
  pausedStartedAtMs: number | null
  accumulatedPausedMs: number
}

const COOPERATIVE_CHECKPOINT_BUDGET = 64

export class MacroNotRunnableError extends Error {
  constructor(readonly issues: MacroDefinitionIssue[]) { super('macro_not_runnable') }
}

export type MacroStartPreflight = {
  recordId: string
  recordRevision: number
  definitionHash: string
}
export class MacroRunnerService {
  private readonly runs = new Map<string, LiveRun>()
  private readonly runtimeRevisions = new Map<string, number>()

  constructor(
    private readonly manager: TerminalRoomManager,
    private readonly records: MacroRecordStore<MacroDefinitionV5>,
    private readonly runStore: MacroRunStore,
    private readonly notificationService: NotificationDispatcher,
    private readonly agentEvents: AgentEventStore,
  ) {}

  hasActiveRun(roomId: string, roomGeneration: string): boolean {
    const run = this.runs.get(roomId)
    return Boolean(run && run.roomGeneration === roomGeneration && ['starting', 'running', 'paused', 'waiting_input', 'stopping'].includes(run.status))
  }

  snapshot(roomId: string): MacroRunnerSnapshot {
    const room = this.manager.roomSummaryById(roomId)
    const run = this.runs.get(roomId)
    if (!run || run.roomGeneration !== room.roomGeneration) {
      return idleSnapshot(room.roomId, room.roomGeneration, this.runtimeRevisions.get(room.roomId) ?? 0)
    }
    return {
      roomId: run.roomId,
      roomGeneration: run.roomGeneration,
      runtimeRevision: run.runtimeRevision,
      runId: run.runId,
      runningMacro: {
        recordId: run.recordId,
        recordRevision: run.recordRevision,
        definition: structuredClone(run.definition),
      },
      status: run.status,
      currentNodeId: run.currentNodeId,
      error: run.error,
      runtimeInput: run.pendingInput ? {
        invocationId: run.pendingInput.invocationId,
        prompt: run.pendingInput.prompt,
        defaultText: run.pendingInput.defaultText,
        draft: run.pendingInput.draft,
        inputRevision: run.pendingInput.inputRevision,
        status: 'waiting',
      } : null,
      ...this.runStore.readEventWindow(run.runId),
    }
  }

  traces(roomId: string): MacroRunTrace[] { return this.runStore.listTracesForRoom(roomId) }

  preflightStart(templateId: string): MacroStartPreflight {
    const record = this.records.read(templateId) as MacroRecord
    const persistable = validateMacroDefinitionV5(record.definition)
    if (!persistable.ok) throw new Error('invalid_macro_definition')
    const runnable = validateRunnableMacroDefinitionV5(persistable.value)
    if (!runnable.ok) throw new MacroNotRunnableError(runnable.issues)
    return {
      recordId: record.id,
      recordRevision: record.revision,
      definitionHash: macroDefinitionHash(runnable.value),
    }
  }

  async start(
    ticket: RoomControlledOperationTicket,
    templateId: string,
    expectedMacroRevision: number,
    expectedTerminalStructureRevision: number,
    preflight: MacroStartPreflight = this.preflightStart(templateId),
  ): Promise<MacroRunnerSnapshot> {
    if (!Number.isInteger(expectedMacroRevision) || expectedMacroRevision < 1) throw new Error('invalid_macro_revision')
    const existing = this.runs.get(ticket.roomId)
    if (existing && ['starting', 'running', 'paused', 'waiting_input', 'stopping'].includes(existing.status)) throw new Error('run_already_active')
    if (this.manager.terminalStructureRevision(ticket.roomId) !== expectedTerminalStructureRevision) throw new Error('terminal_structure_revision_conflict')
    const record = this.records.read(templateId) as MacroRecord
    if (record.id !== preflight.recordId || record.revision !== preflight.recordRevision) throw new Error('macro_revision_conflict')
    if (record.revision !== expectedMacroRevision) throw new Error('macro_revision_conflict')
    const validated = validateRunnableMacroDefinitionV5(record.definition)
    if (!validated.ok) throw new MacroNotRunnableError(validated.issues)
    if (macroDefinitionHash(validated.value) !== preflight.definitionHash) throw new Error('macro_revision_conflict')
    const definition = structuredClone(validated.value)
    const positions = this.manager.terminalPositions(ticket.roomId)
    const bindingValidation = validateMacroRuntimeBinding(definition.terminalLayout, positions)
    if (bindingValidation.status !== 'ready') throw new Error(bindingValidation.code)
    const bindings: FrozenTerminalBinding[] = definition.terminalLayout.map((item) => {
      const position = positions[item.index - 1]!
      return { index: item.index, type: item.type, terminalId: position.terminalId, launchId: position.launchId }
    })
    const runId = this.runStore.reserveRunId()
    let started = false
    let structureLocked = false
    try {
      this.manager.acquireRunStructureLock(ticket.roomId, runId)
      structureLocked = true
      ticket.assertAuthorized()
      const room = this.manager.roomSummaryById(ticket.roomId)
      const hash = macroDefinitionHash(definition)
      const manifest: RunManifestV1 = {
        schemaVersion: 1,
        runId,
        createdAt: new Date().toISOString(),
        macroRecord: { id: record.id, revision: record.revision },
        definition,
        definitionHash: { algorithm: 'sha256', value: hash },
        runtime: {
          serverInstanceId: this.manager.serverInstanceId,
          roomId: room.roomId,
          roomGeneration: room.roomGeneration,
          terminalStructureRevision: expectedTerminalStructureRevision,
        },
        terminalBindings: bindings,
      }
      let manifestRef: string
      try { manifestRef = this.runStore.publishManifest(manifest) }
      catch { throw new Error('run_manifest_write_failed') }
      try {
        ticket.assertAuthorized()
        this.runStore.append(runId, 'run_started', { manifestRef, definitionHash: hash, terminalBindings: bindings })
        started = true
      } catch (error) {
        this.runStore.removeUnstarted(runId)
        const code = errorMessage(error)
        if (code.startsWith('room_control_') || code === 'room_destroying' || code === 'room_not_found') throw error
        throw new Error('run_event_append_failed')
      }
      ticket.assertAuthorized()
      const live: LiveRun = {
        runId,
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        recordId: record.id,
        recordRevision: record.revision,
        runtimeRevision: this.nextRuntimeRevision(room.roomId),
        publishedEventSeq: 0,
        publishTimer: null,
        definition,
        bindings: new Map(bindings.map((binding) => [binding.index, binding])),
        status: 'running',
        currentNodeId: null,
        error: null,
        abortController: new AbortController(),
        pauseWaiters: [],
        pendingInput: null,
        artifacts: new Map(),
        templateBindings: [],
        parallelProgress: new Map(),
        parallelOutputs: new Map(),
        agentEventBaselines: new Map(),
        consumedAgentEventIds: new Set(),
        terminalized: false,
        cooperativeCheckpointCount: 0,
        pausedStartedAtMs: null,
        accumulatedPausedMs: 0,
      }
      initializeMacroAgentEventBaselines({
        serverInstanceId: this.manager.serverInstanceId,
        agentEvents: this.agentEvents,
        roomId: live.roomId,
        roomGeneration: live.roomGeneration,
        baselines: live.agentEventBaselines,
        consumedEventIds: live.consumedAgentEventIds,
      }, live.definition.body, live.bindings)
      this.runs.set(room.roomId, live)
      this.publishSnapshot(live)
      queueMicrotask(() => void this.execute(live))
      return this.snapshot(room.roomId)
    } catch (error) {
      if (started) {
        try { this.runStore.append(runId, 'run_failed', { code: startFailureEvidenceCode(error) }) } catch {}
      } else this.runStore.removeUnstarted(runId)
      if (structureLocked) this.manager.releaseRunStructureLock(ticket.roomId, runId)
      throw error
    }
  }

  pause(roomId: string): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    if (run.status !== 'running') throw new Error('run_not_running')
    this.appendEvent(run, 'run_paused')
    this.enterPaused(run)
    return this.snapshot(roomId)
  }

  resume(roomId: string): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    if (run.status !== 'paused') throw new Error('run_not_paused')
    this.appendEvent(run, 'run_resumed')
    this.leavePaused(run)
    for (const resolve of run.pauseWaiters.splice(0)) resolve()
    return this.snapshot(roomId)
  }

  stop(roomId: string): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    try { this.appendEvent(run, 'run_stopping') }
    catch { run.error = 'run_event_append_failed' }
    run.status = 'stopping'
    run.abortController.abort()
    for (const resolve of run.pauseWaiters.splice(0)) resolve()
    this.cancelPendingInput(run)
    this.bumpAndPublish(run)
    return this.snapshot(roomId)
  }

  updateInputDraft(roomId: string, invocationId: string, value: string, expectedInputRevision: number): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    const pending = this.assertPendingInput(run, invocationId, expectedInputRevision)
    pending.draft = value
    pending.inputRevision += 1
    this.bumpAndPublish(run)
    return this.snapshot(roomId)
  }

  submitInput(roomId: string, invocationId: string, value: string, expectedInputRevision: number): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    const pending = this.assertPendingInput(run, invocationId, expectedInputRevision)
    const nextInputRevision = pending.inputRevision + 1
    this.appendEvent(run, 'runner_input_submitted', {
      invocationId,
      inputRevision: nextInputRevision,
      chars: value.length,
    })
    pending.draft = value
    pending.inputRevision = nextInputRevision
    run.pendingInput = null
    run.status = 'running'
    pending.resolve({ kind: 'submitted', value })
    return this.snapshot(roomId)
  }

  destroyRoom(roomId: string, roomGeneration: string): void {
    const run = this.runs.get(roomId)
    if (!run || run.roomGeneration !== roomGeneration) return
    run.abortController.abort()
    for (const resolve of run.pauseWaiters.splice(0)) resolve()
    this.cancelPendingInput(run)
    try { this.finish(run, 'failed', 'run_failed', { code: 'room_destroyed' }, 'room_destroyed') } catch {}
    if (run.publishTimer) clearTimeout(run.publishTimer)
    this.runs.delete(roomId)
    this.runtimeRevisions.delete(roomId)
  }

  private async execute(run: LiveRun): Promise<void> {
    const actionContext: MacroActionRuntimeContext = {
      manager: this.manager,
      notificationService: this.notificationService,
      run: {
        runId: run.runId,
        roomId: run.roomId,
        roomGeneration: run.roomGeneration,
        bindings: run.bindings,
        artifacts: run.artifacts,
        templateBindings: run.templateBindings,
        abortSignal: run.abortController.signal,
      },
      callbacks: {
        isTerminalized: () => run.terminalized,
        currentNodeId: () => run.currentNodeId,
        checkpoint: () => this.checkpoint(run),
        waitForInput: (prompt, defaultText) => this.waitForInput(run, prompt, defaultText),
        pauseRun: (reason, stepId) => this.pauseRun(run, reason, stepId),
        finishFlow: () => { throw new MacroFlowSignal('finish') },
        waitForAgentEventCapture: (stepId, binding, captureMode, waitLimit) => waitForMacroAgentEventCapture({
          serverInstanceId: this.manager.serverInstanceId,
          agentEvents: this.agentEvents,
          roomId: run.roomId,
          roomGeneration: run.roomGeneration,
          baselines: run.agentEventBaselines,
          consumedEventIds: run.consumedAgentEventIds,
          abortSignal: run.abortController.signal,
          checkpoint: () => this.checkpoint(run),
          validateBinding: (terminalIndex) => {
            const frozen = run.bindings.get(terminalIndex)
            if (!frozen) throw new Error('frozen_terminal_binding_missing')
            if (!this.manager.hasTerminalLaunch(run.roomId, run.roomGeneration, frozen.terminalId, frozen.launchId)) {
              throw new Error('frozen_terminal_launch_lost')
            }
          },
          totalPausedMs: (now) => this.totalPausedMs(run, now),
        }, stepId, binding, captureMode, waitLimit),
        appendEvent: (kind, data) => this.appendEvent(run, kind, data),
        persistArtifact: (stepId, name, value, prefix, data) => this.persistArtifact(run, stepId, name, value, prefix, data),
        writeSupplementalArtifact: (stepId, artifact, prefix, value, extension) => this.writeSupplementalArtifact(run, stepId, artifact, prefix, value, extension),
      },
    }
    try {
      await executeMacroFlow({
        body: run.definition.body,
        artifacts: run.artifacts,
        templateBindings: run.templateBindings,
        parallelProgress: run.parallelProgress,
        parallelOutputs: run.parallelOutputs,
        callbacks: {
          checkpoint: () => this.checkpoint(run),
          setCurrentNodeId: (nodeId) => { run.currentNodeId = nodeId },
          appendEvent: (kind, data) => this.appendEvent(run, kind, data),
          executeAction: (node) => executeMacroAction(actionContext, node),
          persistArtifact: (stepId, name, value, prefix, data) => this.persistArtifact(run, stepId, name, value, prefix, data),
          pauseRun: (reason, stepId) => this.pauseRun(run, reason, stepId),
          isTerminalized: () => run.terminalized,
          isCancellation: (error) => isRunCancellation(run, error),
        },
      })
      if (run.abortController.signal.aborted) throw new Error('run_stopped')
      this.finish(run, 'completed', 'run_completed', {})
    } catch (error) {
      if (run.terminalized) return
      if (run.abortController.signal.aborted || errorMessage(error) === 'run_stopped') this.finish(run, 'stopped', 'run_stopped', {})
      else if (error instanceof MacroFlowSignal && error.signal === 'finish') this.finish(run, 'completed', 'run_completed', { reason: 'finish' })
      else this.finish(run, 'failed', 'run_failed', { code: errorMessage(error) }, errorMessage(error))
    }
  }

  private finish(run: LiveRun, status: 'completed' | 'failed' | 'stopped', event: string, data: Record<string, unknown>, error: string | null = null): void {
    if (run.terminalized) return
    try {
      this.runStore.append(run.runId, event, data)
      run.terminalized = true
      run.status = status
      run.currentNodeId = null
      run.error = error
      run.pendingInput = null
      this.bumpAndPublish(run)
    } catch {
      run.terminalized = true
      run.status = 'failed'
      run.currentNodeId = null
      run.error = 'run_event_append_failed'
      this.cancelPendingInput(run)
      this.bumpAndPublish(run)
    } finally { this.manager.releaseRunStructureLock(run.roomId, run.runId) }
  }

  private setArtifact(run: LiveRun, stepId: string, name: string, value: string): void {
    const outputs = run.artifacts.get(stepId) ?? new Map<string, string>()
    outputs.set(name, value)
    run.artifacts.set(stepId, outputs)
  }

  private persistArtifact(run: LiveRun, stepId: string, name: string, value: string, prefix: string, data: Record<string, unknown> = {}): string {
    const artifactRef = this.runStore.writeArtifact(run.runId, prefix, value)
    this.setArtifact(run, stepId, name, value)
    this.appendEvent(run, 'artifact_created', { stepId, artifact: name, artifactRef, chars: value.length, ...data })
    return artifactRef
  }

  private writeSupplementalArtifact(run: LiveRun, stepId: string, artifact: string, prefix: string, value: string, extension = 'txt'): string {
    const artifactRef = this.runStore.writeArtifact(run.runId, prefix, value, extension)
    this.appendEvent(run, 'artifact_created', { stepId, artifact, artifactRef, chars: value.length })
    return artifactRef
  }

  private async pauseRun(run: LiveRun, reason: string, stepId: string): Promise<void> {
    if (run.status !== 'paused') {
      this.enterPaused(run)
      this.appendEvent(run, 'run_paused', { reason, stepId })
    }
    await this.checkpoint(run)
  }

  private async checkpoint(run: LiveRun): Promise<void> {
    if (run.abortController.signal.aborted) throw new Error('run_stopped')
    await this.waitWhilePaused(run)
    if (run.abortController.signal.aborted) throw new Error('run_stopped')
    run.cooperativeCheckpointCount += 1
    if (run.cooperativeCheckpointCount >= COOPERATIVE_CHECKPOINT_BUDGET) {
      run.cooperativeCheckpointCount = 0
      await yieldToEventLoop()
      if (run.abortController.signal.aborted) throw new Error('run_stopped')
      await this.waitWhilePaused(run)
      if (run.abortController.signal.aborted) throw new Error('run_stopped')
    }
  }

  private async waitWhilePaused(run: LiveRun): Promise<void> {
    while (run.status === 'paused') await new Promise<void>((resolve) => run.pauseWaiters.push(resolve))
  }

  private enterPaused(run: LiveRun): void {
    run.status = 'paused'
    run.pausedStartedAtMs ??= performance.now()
  }

  private leavePaused(run: LiveRun): void {
    const now = performance.now()
    if (run.pausedStartedAtMs !== null) run.accumulatedPausedMs += now - run.pausedStartedAtMs
    run.pausedStartedAtMs = null
    run.status = 'running'
  }

  private totalPausedMs(run: LiveRun, now = performance.now()): number {
    return run.accumulatedPausedMs + (run.pausedStartedAtMs === null ? 0 : now - run.pausedStartedAtMs)
  }

  private async waitForInput(run: LiveRun, prompt: string, defaultText = ''): Promise<string> {
    if (run.pendingInput) throw new Error('runner_input_already_pending')
    run.status = 'waiting_input'
    const result = await new Promise<PendingInputResult>((resolve) => {
      const invocationId = createGeneratedId('runnerInput')
      run.pendingInput = { invocationId, prompt, defaultText, draft: defaultText, inputRevision: 0, resolve }
      this.appendEvent(run, 'runner_input_requested', {
        invocationId,
        inputRevision: 0,
        hasDefaultText: defaultText.length > 0,
        promptChars: prompt.length,
      })
    })
    if (result.kind === 'cancelled') throw new Error('run_stopped')
    return result.value
  }

  private cancelPendingInput(run: LiveRun): void {
    const pending = run.pendingInput
    run.pendingInput = null
    pending?.resolve({ kind: 'cancelled' })
  }

  private assertPendingInput(run: LiveRun, invocationId: string, expectedInputRevision: number): PendingInput {
    const pending = run.pendingInput
    if (!pending || run.status !== 'waiting_input') throw new Error('runner_not_waiting_input')
    if (pending.invocationId !== invocationId) throw new Error('runner_input_invocation_mismatch')
    if (!Number.isInteger(expectedInputRevision) || expectedInputRevision < 0 || pending.inputRevision !== expectedInputRevision) {
      throw new Error('runner_input_revision_conflict')
    }
    return pending
  }

  private appendEvent(run: LiveRun, kind: string, data: Record<string, unknown> = {}): void {
    if (run.terminalized) return
    this.runStore.append(run.runId, kind, data)
    this.bumpAndPublish(run)
  }

  private bumpAndPublish(run: LiveRun): void {
    if (this.runs.get(run.roomId) !== run) return
    run.runtimeRevision = this.nextRuntimeRevision(run.roomId)
    this.schedulePublish(run)
  }

  private nextRuntimeRevision(roomId: string): number {
    const revision = (this.runtimeRevisions.get(roomId) ?? 0) + 1
    this.runtimeRevisions.set(roomId, revision)
    return revision
  }

  private publishSnapshot(run: LiveRun): void {
    try {
      const room = this.manager.roomSummaryById(run.roomId)
      if (room.roomGeneration !== run.roomGeneration || this.runs.get(run.roomId) !== run) return
      const snapshot = this.snapshot(run.roomId)
      const canSendDelta = run.publishedEventSeq >= snapshot.firstAvailableEventSeq - 1
      if (!canSendDelta) {
        this.manager.broadcastRoomMessage(run.roomId, { type: 'runner_snapshot', snapshot })
      } else {
        const delta: MacroRunnerDelta = {
          ...snapshot,
          events: snapshot.events.filter((event) => event.eventSeq > run.publishedEventSeq),
        }
        this.manager.broadcastRoomMessage(run.roomId, { type: 'runner_delta', delta })
      }
      run.publishedEventSeq = snapshot.lastEventSeq
    } catch {
      // Destroy closes mutation admission and owns final client teardown.
    }
  }

  private schedulePublish(run: LiveRun): void {
    if (run.publishTimer) return
    run.publishTimer = setTimeout(() => {
      run.publishTimer = null
      this.publishSnapshot(run)
    }, 25)
    run.publishTimer.unref?.()
  }

  private activeRun(roomId: string): LiveRun {
    const run = this.runs.get(roomId)
    if (!run || !['starting', 'running', 'paused', 'waiting_input', 'stopping'].includes(run.status)) throw new Error('run_not_active')
    return run
  }
}

function idleSnapshot(roomId: string, roomGeneration: string, runtimeRevision: number): MacroRunnerSnapshot {
  return {
    roomId,
    roomGeneration,
    runtimeRevision,
    runId: null,
    runningMacro: null,
    status: 'idle',
    currentNodeId: null,
    error: null,
    runtimeInput: null,
    events: [],
    firstAvailableEventSeq: 0,
    lastEventSeq: 0,
    totalEventCount: 0,
    discardedEventCount: 0,
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function isRunCancellation(run: LiveRun, error: unknown): boolean {
  return run.abortController.signal.aborted || errorMessage(error) === 'run_stopped'
}

function startFailureEvidenceCode(error: unknown): string {
  const code = errorMessage(error)
  if (code.startsWith('room_control_')) return 'room_control_lost_during_start'
  if (code === 'room_destroying' || code === 'room_not_found') return 'room_destroyed_during_start'
  return 'run_bootstrap_failed'
}
