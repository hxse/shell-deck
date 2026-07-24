import type { RoomSnapshot, TerminalRuntimePosition } from '../protocol'
import type { TerminalRoomClient } from '../terminalRoomClient'
import { validateMacroTerminalLayout } from './macroDefinitionValidation'
import {
  formatMacroIssues,
  formatMacroJsonValidation,
  messageOf,
  type MacroJsonEditSession,
} from './macroJsonEditSession.svelte'
import type { MacroRecordSession } from './macroRecordSession.svelte'
import { validateMacroRuntimeBinding } from './macroRuntimeBinding'
import { MacroRunnerClient } from './macroRunnerClient'
import { createMacroRunnerInputSession } from './macroRunnerInputSession.svelte'
import { validateMacroRunnerSnapshot } from './runnerSnapshotMerge'
import {
  isActiveMacroRunnerStatus,
  type MacroRunnerSnapshot,
} from './runnerTypes'
import { createMacroTraceSession } from './macroTraceSession.svelte'

type MacroRunnerSessionOptions = {
  roomClient(): TerminalRoomClient | null
  canMutateShared(): boolean
  terminalStructureRevision(): number
  terminalPositions(): TerminalRuntimePosition[] | null
  terminalStructureLocked(): boolean
  runnerSnapshot(): MacroRunnerSnapshot | null
  record: MacroRecordSession
  json: MacroJsonEditSession
  onRoomSnapshot(snapshot: RoomSnapshot): void
  flushPendingText(): Promise<void>
}

export function createMacroRunnerSession(options: MacroRunnerSessionOptions) {
  const runnerClient = new MacroRunnerClient(options.roomClient)
  let preparing = $state(false)
  let runner = $state<MacroRunnerSnapshot | null>(null)
  let runnerRefreshGeneration = 0
  const input = createMacroRunnerInputSession({
    roomClient: options.roomClient,
    canMutateShared: options.canMutateShared,
    runner: () => runner,
    runnerClient,
    record: options.record,
    refreshRunner: () => refreshRunner(false),
  })
  const trace = createMacroTraceSession({
    runnerClient,
    roomClient: options.roomClient,
    reportError: (error) => options.record.setErrorText(error),
  })

  $effect(() => {
    const next = options.runnerSnapshot()
    if (next) installRunnerSnapshot(next)
  })

  function resolvePrepareState(): { disabled: boolean; reason: string } {
    if (!options.record.draft && !options.json.editing) {
      return { disabled: true, reason: 'No current macro draft' }
    }
    if (!options.roomClient() || !options.canMutateShared()) {
      return { disabled: true, reason: 'Room control is required' }
    }
    if (options.record.operationPending) {
      return { disabled: true, reason: 'Wait for the pending macro operation' }
    }
    if (options.terminalStructureLocked()) {
      return { disabled: true, reason: 'room_structure_locked_by_run' }
    }
    const result = options.json.editing
      ? options.json.parseTerminalLayout()
      : validateMacroTerminalLayout(options.record.draft?.terminalLayout)
    if (!result.ok) return { disabled: true, reason: 'Fix terminalLayout before preparing' }
    return { disabled: false, reason: '' }
  }

  function resolveStartState(): { disabled: boolean; reason: string } {
    const draft = options.record.draft
    if (!draft) return { disabled: true, reason: 'No current macro' }
    if (!options.roomClient() || !options.canMutateShared()) {
      return { disabled: true, reason: 'Room control is required' }
    }
    if (isActiveMacroRunnerStatus(runner?.status)) {
      return { disabled: true, reason: 'Wait for the active macro run to finish' }
    }
    if (options.record.operationPending || options.json.editing) {
      return { disabled: true, reason: 'Save or cancel the pending edit first' }
    }
    const portableValidation = options.record.diagnostics.persistable
    if (!portableValidation.ok) return { disabled: true, reason: 'Fix macro validation issues' }
    const runnableValidation = options.record.diagnostics.runnable
    if (!runnableValidation.ok) {
      const unassigned = runnableValidation.issues.filter((issue) =>
        issue.code === 'unassigned_terminal_reference' || issue.code === 'unassigned_artifact_reference',
      )
      if (unassigned.length > 0) {
        return {
          disabled: true,
          reason: `Assign ${unassigned.length} terminal or artifact reference${unassigned.length === 1 ? '' : 's'} before Start`,
        }
      }
      return { disabled: true, reason: 'Fix macro runnable validation issues' }
    }
    const runtimeValidation = validateMacroRuntimeBinding(draft.terminalLayout, options.terminalPositions())
    if (runtimeValidation.status !== 'ready') {
      return { disabled: true, reason: runtimeValidation.code }
    }
    if (options.record.dirty && options.record.selectedRecord
      && (!options.record.contentEditing || !options.record.editLease)) {
      return { disabled: true, reason: 'Edit lease is required to save before Start' }
    }
    return { disabled: false, reason: '' }
  }

  async function prepareTerminals(): Promise<void> {
    options.record.flushDiagnostics()
    const roomClient = options.roomClient()
    if (!roomClient || !options.canMutateShared()) {
      options.record.rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (options.record.operationPending) { options.record.rejectMutation('operation_pending'); return }
    if (options.terminalStructureLocked()) {
      options.record.rejectMutation('room_structure_locked_by_run')
      return
    }
    const source = options.json.editing ? 'json' : 'visual'
    const layout = source === 'json'
      ? options.json.parseTerminalLayout()
      : validateMacroTerminalLayout(options.record.draft?.terminalLayout)
    if (!layout.ok) {
      const reason = 'error' in layout
        ? formatMacroJsonValidation(layout)
        : formatMacroIssues(layout.issues)
      options.record.rejectMutation(reason)
      return
    }
    const token = options.record.beginOperation()
    preparing = true
    const capturedRevision = source === 'json' ? options.json.revision : options.record.draftRevision
    try {
      const result = await runnerClient.prepare(layout.value, options.terminalStructureRevision())
      if (!definitionOperationIsCurrent(token, source, capturedRevision)) return
      options.onRoomSnapshot(result.snapshot)
      options.record.setErrorText(result.ok
        ? null
        : `${result.error}: ${result.operation} terminal ${result.failedIndex}`)
    } catch (error) {
      if (options.record.canCommit(token)) options.record.reportMutationError(error)
    } finally {
      preparing = false
      options.record.endOperation(token)
    }
  }

  async function controlRunner(action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> {
    const roomClient = options.roomClient()
    if (!roomClient || !options.canMutateShared()) {
      options.record.rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (options.record.operationPending) { options.record.rejectMutation('operation_pending'); return }
    if (action !== 'start') {
      const token = options.record.beginOperation()
      try {
        const ack = action === 'pause'
          ? await runnerClient.pause()
          : action === 'resume'
            ? await runnerClient.resume()
            : await runnerClient.stop()
        assertRunnerActionAck(ack, roomClient.roomId)
      } catch (error) {
        if (options.record.canCommit(token)) options.record.reportMutationError(error)
      } finally {
        options.record.endOperation(token)
      }
      return
    }

    const draft = options.record.draft
    try {
      await options.flushPendingText()
    } catch (error) {
      options.record.rejectMutation(messageOf(error))
      return
    }
    const diagnostics = options.record.flushDiagnostics()
    const portableValidation = diagnostics.persistable
    const runnableValidation = diagnostics.runnable
    const runtimeValidation = draft
      ? validateMacroRuntimeBinding(draft.terminalLayout, options.terminalPositions())
      : null
    if (!draft || !portableValidation.ok || !runnableValidation.ok || runtimeValidation?.status !== 'ready') {
      const startState = resolveStartState()
      options.record.rejectMutation(startState.reason || 'macro_not_runnable')
      return
    }
    const token = options.record.beginOperation()
    const snapshot = options.record.captureStartRecordSnapshot()
    const structureRevision = options.terminalStructureRevision()
    if (!snapshot) {
      options.record.endOperation(token)
      return
    }
    try {
      const record = await options.record.resolveStartRecord(token, snapshot)
      if (!record || !options.record.canCommit(token)) return
      const ack = await runnerClient.start(record.id, record.revision, structureRevision)
      assertRunnerActionAck(ack, roomClient.roomId)
      if (options.record.canCommit(token)) {
        options.record.setErrorText(null)
      }
    } catch (error) {
      if (options.record.canCommit(token)) options.record.reportMutationError(error, true)
    } finally {
      options.record.endOperation(token)
    }
  }

  async function refreshRunner(report = true): Promise<void> {
    if (!options.roomClient()) return
    const generation = ++runnerRefreshGeneration
    try {
      const nextRunner = await runnerClient.snapshot()
      const validated = await validateMacroRunnerSnapshot(nextRunner)
      if (validated.kind !== 'applied') throw new Error('runner_resync_invalid_snapshot')
      if (generation === runnerRefreshGeneration) installRunnerSnapshot(validated.snapshot)
    } catch (error) {
      if (report) options.record.setErrorText(messageOf(error))
    }
  }
  function installRunnerSnapshot(next: MacroRunnerSnapshot): void {
    if (runner && runner.roomGeneration === next.roomGeneration
      && next.runtimeRevision < runner.runtimeRevision) return
    runner = next
  }

  function assertRunnerActionAck(ack: { roomId: string; runId: string; runtimeRevision: number }, roomId: string): void {
    if (ack.roomId !== roomId || !ack.runId || !Number.isInteger(ack.runtimeRevision)) {
      throw new Error('runner_action_ack_identity_mismatch')
    }
  }
  function definitionOperationIsCurrent(
    token: Parameters<MacroRecordSession['canCommit']>[0],
    source: 'visual' | 'json',
    revision: number,
  ): boolean {
    if (!options.record.canCommit(token)) return false
    return source === 'json'
      ? options.json.revision === revision
      : options.record.draftRevision === revision
  }

  return {
    get preparing() { return preparing },
    get runner() { return runner },
    get traces() { return trace.summaries },
    get traceEvents() { return trace.events },
    get selectedTraceRunId() { return trace.selectedRunId },
    get hasPreviousTracePage() { return trace.hasPreviousSummaryPage },
    get hasNextTracePage() { return trace.hasNextSummaryPage },
    get hasPreviousTraceEventPage() { return trace.hasPreviousEventPage },
    get hasNextTraceEventPage() { return trace.hasNextEventPage },
    get runnerInput() { return input.value },
    get runnerInputSyncing() { return input.syncing },
    get prepareState() { return resolvePrepareState() },
    get startState() { return resolveStartState() },
    prepareTerminals,
    controlRunner,
    submitRunnerInput: input.submit,
    updateRunnerInput: input.update,
    refreshRunner,
    refreshTraces: trace.refresh,
    selectTrace: trace.selectRun,
    nextTraceSummaryPage: trace.nextSummaryPage,
    previousTraceSummaryPage: trace.previousSummaryPage,
    nextTraceEventPage: trace.nextEventPage,
    previousTraceEventPage: trace.previousEventPage,
  }
}

export type MacroRunnerSession = ReturnType<typeof createMacroRunnerSession>
