import type { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import type { MacroDefinitionV5, MacroRecord } from '../src/lib/macro/macroDefinitionTypes'
import {
  validateMacroDefinitionV5,
  validateRunnableMacroDefinitionV5,
} from '../src/lib/macro/macroDefinitionValidation'
import { validateMacroRuntimeBinding } from '../src/lib/macro/macroRuntimeBinding'
import type {
  FrozenTerminalBinding,
  MacroRunEventPage,
  MacroRunnerActionAck,
  MacroRunnerSnapshot,
  MacroRunSummaryPage,
  RunManifestV1,
} from '../src/lib/macro/runnerTypes'
import { executeMacroAction, type MacroActionRuntimeContext } from './macroActionRuntime'
import { initializeMacroAgentEventBaselines, waitForMacroAgentEventCapture } from './macroAgentCapture'
import { executeMacroFlow, MacroFlowSignal } from './macroFlowExecutor'
import { MacroRunnerInteraction } from './macroRunnerInteraction'
import { MacroRunnerArtifacts } from './macroRunnerArtifacts'
import {
  createLiveRun,
  isActiveRunStatus,
  liveRunActionAck,
  MacroNotRunnableError,
  type LiveRun,
  type MacroStartPreflight,
} from './macroRunnerLiveState'
import { MacroRunnerPublication } from './macroRunnerPublication'
import {
  submitMacroStructuredJson,
  waitForMacroStructuredJson,
  type StructuredJsonSubmission,
  type StructuredJsonSubmissionResult,
} from './macroStructuredCapture'
import type { NotificationDispatcher } from './notificationService'
import { macroDefinitionHash, type MacroRunStore } from './macroRunStore'
import type { MacroRecordStore } from './sharedContentStore'
import type { RoomControlledOperationTicket, TerminalRoomManager } from './terminalRoomManager'

export class MacroRunnerLifecycle {
  private readonly runs = new Map<string, LiveRun>()
  private readonly publication: MacroRunnerPublication
  private readonly interaction: MacroRunnerInteraction
  private readonly artifacts: MacroRunnerArtifacts
  constructor(
    private readonly manager: TerminalRoomManager,
    private readonly records: MacroRecordStore<MacroDefinitionV5>,
    private readonly runStore: MacroRunStore,
    private readonly notificationService: NotificationDispatcher,
    private readonly agentEvents: AgentEventStore,
  ) {
    this.publication = new MacroRunnerPublication(manager, runStore, (roomId) => this.runs.get(roomId))
    this.interaction = new MacroRunnerInteraction({
      activeRun: (roomId) => this.activeRun(roomId),
      appendEvent: (run, kind, data) => this.appendEvent(run, kind, data),
      bumpAndPublish: (run) => this.publication.bumpAndPublish(run),
    })
    this.artifacts = new MacroRunnerArtifacts(runStore, (run, kind, data) => this.appendEvent(run, kind, data))
  }

  hasActiveRun(roomId: string, roomGeneration: string): boolean {
    const run = this.runs.get(roomId)
    return Boolean(run && run.roomGeneration === roomGeneration && isActiveRunStatus(run.status))
  }

  snapshot(roomId: string): MacroRunnerSnapshot {
    return this.publication.snapshot(roomId)
  }

  traceSummaries(roomId: string, limit: number, cursor: string | null): MacroRunSummaryPage { return this.runStore.traceSummariesForRoom(roomId, limit, cursor) }

  traceEvents(roomId: string, runId: string, limit: number, cursor: string | null): MacroRunEventPage { return this.runStore.traceEventsForRoom(roomId, runId, limit, cursor) }

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

  start(
    ticket: RoomControlledOperationTicket,
    templateId: string,
    expectedMacroRevision: number,
    expectedTerminalStructureRevision: number,
    preflight: MacroStartPreflight,
  ): MacroRunnerActionAck {
    if (!Number.isInteger(expectedMacroRevision) || expectedMacroRevision < 1) throw new Error('invalid_macro_revision')
    const existing = this.runs.get(ticket.roomId)
    if (existing && isActiveRunStatus(existing.status)) throw new Error('run_already_active')
    if (this.manager.terminalStructureRevision(ticket.roomId) !== expectedTerminalStructureRevision) {
      throw new Error('terminal_structure_revision_conflict')
    }
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
      const hash = preflight.definitionHash
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
      catch (error) { if (errorMessage(error) === 'log_storage_limit_reached') throw error; throw new Error('run_manifest_write_failed') }
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
      const live = createLiveRun({
        runId,
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        recordId: record.id,
        recordRevision: record.revision,
        runtimeRevision: this.publication.nextRuntimeRevision(room.roomId),
        definitionHash: 'sha256:' + preflight.definitionHash,
        definition,
        bindings,
      })
      initializeMacroAgentEventBaselines({
        serverInstanceId: this.manager.serverInstanceId,
        agentEvents: this.agentEvents,
        roomId: live.roomId,
        roomGeneration: live.roomGeneration,
        baselines: live.agentEventBaselines,
        consumedEventIds: live.consumedAgentEventIds,
      }, live.definition.body, live.bindings)
      this.runStore.retainCurrentRoomRun(live.roomId, live.runId)
      this.runs.set(room.roomId, live)
      this.publication.publishSnapshot(live)
      queueMicrotask(() => void this.execute(live))
      return liveRunActionAck(live)
    } catch (error) {
      if (started) {
        try { this.runStore.append(runId, 'run_failed', { code: startFailureEvidenceCode(error) }) } catch {}
        this.runStore.releaseLiveRun(runId)
      } else this.runStore.removeUnstarted(runId)
      if (structureLocked) this.manager.releaseRunStructureLock(ticket.roomId, runId)
      throw error
    }
  }

  pause(roomId: string): MacroRunnerActionAck {
    return this.interaction.pause(roomId)
  }

  resume(roomId: string): MacroRunnerActionAck {
    return this.interaction.resume(roomId)
  }

  stop(roomId: string): MacroRunnerActionAck {
    const snapshot = this.interaction.stop(roomId)
    const run = this.runs.get(roomId)
    if (run) run.pendingStructuredCapture = null
    return snapshot
  }

  submitStructuredJson(
    roomId: string,
    submission: StructuredJsonSubmission,
  ): StructuredJsonSubmissionResult {
    return submitMacroStructuredJson(this.runs.get(roomId), submission)
  }

  updateInputDraft(
    roomId: string,
    invocationId: string,
    value: string,
    expectedInputRevision: number,
  ): MacroRunnerActionAck {
    return this.interaction.updateInputDraft(roomId, invocationId, value, expectedInputRevision)
  }

  submitInput(
    roomId: string,
    invocationId: string,
    value: string,
    expectedInputRevision: number,
  ): MacroRunnerActionAck {
    return this.interaction.submitInput(roomId, invocationId, value, expectedInputRevision)
  }

  destroyRoom(roomId: string, roomGeneration: string): void {
    const run = this.runs.get(roomId)
    if (!run || run.roomGeneration !== roomGeneration) return
    run.abortController.abort()
    run.pendingStructuredCapture = null
    for (const resolve of run.pauseWaiters.splice(0)) resolve()
    this.interaction.cancelPendingInput(run)
    try { this.finish(run, 'failed', 'run_failed', { code: 'room_destroyed' }, 'room_destroyed') } catch {}
    this.publication.clearPublishTimer(run)
    this.runStore.releaseLiveRun(run.runId, roomId)
    this.runs.delete(roomId)
    this.publication.deleteRuntimeRevision(roomId)
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
        checkpoint: () => this.interaction.checkpoint(run),
        waitForInput: (prompt, defaultText) => this.interaction.waitForInput(run, prompt, defaultText),
        pauseRun: (reason, stepId) => this.interaction.pauseRun(run, reason, stepId),
        finishFlow: () => { throw new MacroFlowSignal('finish') },
        waitForAgentEventCapture: (stepId, binding, captureMode, waitLimit) => waitForMacroAgentEventCapture({
          serverInstanceId: this.manager.serverInstanceId,
          agentEvents: this.agentEvents,
          roomId: run.roomId,
          roomGeneration: run.roomGeneration,
          baselines: run.agentEventBaselines,
          consumedEventIds: run.consumedAgentEventIds,
          abortSignal: run.abortController.signal,
          checkpoint: () => this.interaction.checkpoint(run),
          validateBinding: (terminalIndex) => {
            const frozen = run.bindings.get(terminalIndex)
            if (!frozen) throw new Error('frozen_terminal_binding_missing')
            if (!this.manager.hasTerminalLaunch(run.roomId, run.roomGeneration, frozen.terminalId, frozen.launchId)) {
              throw new Error('frozen_terminal_launch_lost')
            }
          },
          totalPausedMs: (now) => this.interaction.totalPausedMs(run, now),
        }, stepId, binding, captureMode, waitLimit),
        waitForStructuredJsonCapture: (stepId, binding, schema, waitLimit) => waitForMacroStructuredJson(
          run,
          stepId,
          binding,
          schema,
          waitLimit,
          {
            checkpoint: () => this.interaction.checkpoint(run),
            validateBinding: () => {
              if (!this.manager.hasTerminalLaunch(
                run.roomId,
                run.roomGeneration,
                binding.terminalId,
                binding.launchId,
              )) throw new Error('frozen_terminal_launch_lost')
            },
            totalPausedMs: (now) => this.interaction.totalPausedMs(run, now),
          },
        ),
        appendEvent: (kind, data) => this.appendEvent(run, kind, data),
        persistArtifact: (stepId, name, value, prefix, data) => {
          return this.artifacts.persistText(run, stepId, name, value, prefix, data)
        },
        persistJsonArtifact: (stepId, name, value, prefix, data) => {
          return this.artifacts.persistJson(run, stepId, name, value, prefix, data)
        },
        writeSupplementalArtifact: (stepId, artifact, prefix, value, extension) => {
          return this.artifacts.writeSupplemental(run, stepId, artifact, prefix, value, extension)
        },
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
          checkpoint: () => this.interaction.checkpoint(run),
          setCurrentNodeId: (nodeId) => { run.currentNodeId = nodeId },
          appendEvent: (kind, data) => this.appendEvent(run, kind, data),
          executeAction: (node) => executeMacroAction(actionContext, node),
          persistArtifact: (stepId, name, value, prefix, data) => {
            return this.artifacts.persistText(run, stepId, name, value, prefix, data)
          },
          pauseRun: (reason, stepId) => this.interaction.pauseRun(run, reason, stepId),
          isTerminalized: () => run.terminalized,
          isCancellation: (error) => isRunCancellation(run, error),
        },
      })
      if (run.abortController.signal.aborted) throw new Error('run_stopped')
      this.finish(run, 'completed', 'run_completed', {})
    } catch (error) {
      if (run.terminalized) return
      if (run.abortController.signal.aborted || errorMessage(error) === 'run_stopped') {
        this.finish(run, 'stopped', 'run_stopped', {})
      } else if (error instanceof MacroFlowSignal && error.signal === 'finish') {
        this.finish(run, 'completed', 'run_completed', { reason: 'finish' })
      } else {
        this.finish(run, 'failed', 'run_failed', { code: errorMessage(error) }, errorMessage(error))
      }
    }
  }

  private finish(
    run: LiveRun,
    status: 'completed' | 'failed' | 'stopped',
    event: string,
    data: Record<string, unknown>,
    error: string | null = null,
  ): void {
    if (run.terminalized) return
    try {
      this.runStore.append(run.runId, event, data)
      run.terminalized = true
      run.status = status
      run.currentNodeId = null
      run.error = error
      run.pendingInput = null
      run.pendingStructuredCapture = null
      this.publication.bumpAndPublish(run)
    } catch {
      run.terminalized = true
      run.status = 'failed'
      run.currentNodeId = null
      run.error = 'run_event_append_failed'
      run.pendingStructuredCapture = null
      this.interaction.cancelPendingInput(run)
      this.publication.bumpAndPublish(run)
    } finally { this.manager.releaseRunStructureLock(run.roomId, run.runId) }
  }

  private appendEvent(run: LiveRun, kind: string, data: Record<string, unknown> = {}): void {
    if (run.terminalized) return
    this.runStore.append(run.runId, kind, data)
    this.publication.bumpAndPublish(run)
  }

  private activeRun(roomId: string): LiveRun {
    const run = this.runs.get(roomId)
    if (!run || !isActiveRunStatus(run.status)) throw new Error('run_not_active')
    return run
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRunCancellation(run: LiveRun, error: unknown): boolean {
  return run.abortController.signal.aborted || errorMessage(error) === 'run_stopped'
}

function startFailureEvidenceCode(error: unknown): string {
  const code = errorMessage(error)
  if (code.startsWith('room_control_')) return 'room_control_lost_during_start'
  if (code === 'room_destroying' || code === 'room_not_found') return 'room_destroyed_during_start'
  return 'run_bootstrap_failed'
}
