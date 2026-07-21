import type { RoomSnapshot, TerminalRuntimePosition } from '../protocol'
import type { TerminalRoomClient } from '../terminalRoomClient'
import {
  validateMacroDefinitionV5,
  validateMacroTerminalLayout,
  validateRunnableMacroDefinitionV5,
} from './macroDefinitionValidation'
import {
  formatMacroIssues,
  formatMacroJsonValidation,
  messageOf,
  type MacroJsonEditSession,
} from './macroJsonEditSession.svelte'
import type { MacroRecordSession } from './macroRecordSession.svelte'
import { validateMacroRuntimeBinding } from './macroRuntimeBinding'
import { MacroRunnerClient } from './macroRunnerClient'
import type { MacroRunnerSnapshot, MacroRunTrace } from './runnerTypes'

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
}

export function createMacroRunnerSession(options: MacroRunnerSessionOptions) {
  const runnerClient = new MacroRunnerClient(options.roomClient)
  let preparing = $state(false)
  let runner = $state<MacroRunnerSnapshot | null>(null)
  let traces = $state<MacroRunTrace[]>([])
  let runnerInput = $state('')
  let runnerInputDirty = $state(false)
  let runnerInputSyncing = $state(false)
  let runnerInputFlushPromise: Promise<void> | null = null
  let runnerInputEditGeneration = 0
  let runnerInputAcknowledgedGeneration = 0
  let runnerRefreshGeneration = 0

  $effect(() => {
    const next = options.runnerSnapshot()
    if (next) installRunnerSnapshot(next)
  })

  $effect(() => {
    if (options.canMutateShared()) return
    const input = runner?.runtimeInput
    runnerInput = input?.draft ?? ''
    runnerInputDirty = false
    runnerInputAcknowledgedGeneration = runnerInputEditGeneration
  })

  function mount(): void {
    void refreshTraces()
  }

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
    if (options.record.operationPending || options.json.editing) {
      return { disabled: true, reason: 'Save or cancel the pending edit first' }
    }
    const portableValidation = validateMacroDefinitionV5(draft)
    if (!portableValidation.ok) return { disabled: true, reason: 'Fix macro validation issues' }
    const runnableValidation = validateRunnableMacroDefinitionV5(draft)
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
        const nextRunner = action === 'pause'
          ? await runnerClient.pause()
          : action === 'resume'
            ? await runnerClient.resume()
            : await runnerClient.stop()
        if (options.record.canCommit(token)) installRunnerSnapshot(nextRunner)
      } catch (error) {
        if (options.record.canCommit(token)) options.record.reportMutationError(error)
      } finally {
        options.record.endOperation(token)
      }
      return
    }

    const draft = options.record.draft
    const portableValidation = validateMacroDefinitionV5(draft)
    const runnableValidation = validateRunnableMacroDefinitionV5(draft)
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
      const nextRunner = await runnerClient.start(record.id, record.revision, structureRevision)
      if (options.record.canCommit(token)) {
        installRunnerSnapshot(nextRunner)
        options.record.setErrorText(null)
      }
    } catch (error) {
      if (options.record.canCommit(token)) options.record.reportMutationError(error, true)
    } finally {
      options.record.endOperation(token)
    }
  }

  async function submitRunnerInput(): Promise<void> {
    const roomClient = options.roomClient()
    if (!roomClient || !options.canMutateShared()) {
      options.record.rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (options.record.operationPending) { options.record.rejectMutation('operation_pending'); return }
    await flushRunnerInputDraft()
    const input = runner?.runtimeInput
    if (!input || runnerInputDirty) {
      if (!input) options.record.rejectMutation('runner_not_waiting_input')
      return
    }
    const token = options.record.beginOperation()
    const value = runnerInput
    try {
      const nextRunner = await runnerClient.submitInput(input.invocationId, value, input.inputRevision)
      if (options.record.canCommit(token)) installRunnerSnapshot(nextRunner)
    } catch (error) {
      if (options.record.canCommit(token)) {
        options.record.reportMutationError(error)
        if (messageOf(error) === 'runner_input_revision_conflict') await refreshRunner(false)
      }
    } finally {
      options.record.endOperation(token)
    }
  }

  function updateRunnerInput(value: string): void {
    const roomClient = options.roomClient()
    if (!roomClient || !options.canMutateShared()) {
      options.record.rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (!runner?.runtimeInput) { options.record.rejectMutation('runner_not_waiting_input'); return }
    const requestInFlight = runnerInputFlushPromise !== null || runnerInputSyncing
    runnerInputEditGeneration += 1
    runnerInput = value
    if (!requestInFlight && value === runner.runtimeInput.draft) {
      runnerInputAcknowledgedGeneration = runnerInputEditGeneration
      runnerInputDirty = false
    } else {
      runnerInputDirty = runnerInputEditGeneration > runnerInputAcknowledgedGeneration
    }
    if (runnerInputDirty) void flushRunnerInputDraft()
  }

  function flushRunnerInputDraft(): Promise<void> {
    if (runnerInputFlushPromise) return runnerInputFlushPromise
    const operation = (async () => {
      runnerInputSyncing = true
      try {
        while (runnerInputEditGeneration > runnerInputAcknowledgedGeneration) {
          if (!options.roomClient() || !options.canMutateShared()) break
          const input = runner?.runtimeInput
          if (!input) break
          const desired = runnerInput
          const sentGeneration = runnerInputEditGeneration
          try {
            const next = await runnerClient.updateInputDraft(input.invocationId, desired, input.inputRevision)
            installRunnerSnapshot(next)
            const acknowledged = next.runtimeInput
            if (acknowledged?.invocationId === input.invocationId) {
              runnerInputAcknowledgedGeneration = Math.max(runnerInputAcknowledgedGeneration, sentGeneration)
              if (runnerInput === acknowledged.draft) {
                runnerInputAcknowledgedGeneration = runnerInputEditGeneration
              }
              runnerInputDirty = runnerInputAcknowledgedGeneration < runnerInputEditGeneration
            }
          } catch (error) {
            const reason = messageOf(error)
            if (reason === 'runner_input_revision_conflict') {
              const previousRevision = runner?.runtimeRevision
              await refreshRunner(false)
              if (runner?.runtimeRevision === previousRevision) {
                options.record.reportMutationError(error)
                break
              }
              continue
            }
            options.record.reportMutationError(error)
            break
          }
        }
      } finally {
        runnerInputDirty = runnerInputAcknowledgedGeneration < runnerInputEditGeneration
        runnerInputSyncing = false
      }
    })()
    runnerInputFlushPromise = operation
    void operation.finally(() => {
      if (runnerInputFlushPromise === operation) runnerInputFlushPromise = null
    })
    return operation
  }

  async function refreshRunner(report = true): Promise<void> {
    if (!options.roomClient()) return
    const generation = ++runnerRefreshGeneration
    try {
      const nextRunner = await runnerClient.snapshot()
      if (generation === runnerRefreshGeneration) installRunnerSnapshot(nextRunner)
    } catch (error) {
      if (report) options.record.setErrorText(messageOf(error))
    }
  }

  async function refreshTraces(report = true): Promise<void> {
    if (!options.roomClient()) return
    try {
      traces = await runnerClient.traces()
    } catch (error) {
      if (report) options.record.setErrorText(messageOf(error))
    }
  }

  function installRunnerSnapshot(next: MacroRunnerSnapshot): void {
    if (runner && runner.roomGeneration === next.roomGeneration
      && next.runtimeRevision < runner.runtimeRevision) return
    const previousInput = runner?.runtimeInput
    runner = next
    const input = next.runtimeInput
    if (!input) {
      runnerInput = ''
      runnerInputDirty = false
      runnerInputEditGeneration = 0
      runnerInputAcknowledgedGeneration = 0
      return
    }
    if (previousInput?.invocationId !== input.invocationId) {
      runnerInput = input.draft
      runnerInputDirty = false
      runnerInputEditGeneration = 0
      runnerInputAcknowledgedGeneration = 0
      return
    }
    const hasUnacknowledgedLocalEdit = runnerInputEditGeneration > runnerInputAcknowledgedGeneration
    if (!hasUnacknowledgedLocalEdit || !options.canMutateShared() || runnerInput === input.draft) {
      runnerInput = input.draft
      runnerInputDirty = false
      runnerInputAcknowledgedGeneration = runnerInputEditGeneration
    } else {
      runnerInputDirty = true
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
    get traces() { return traces },
    get runnerInput() { return runnerInput },
    get runnerInputSyncing() { return runnerInputSyncing },
    get prepareState() { return resolvePrepareState() },
    get startState() { return resolveStartState() },
    mount,
    prepareTerminals,
    controlRunner,
    submitRunnerInput,
    updateRunnerInput,
    refreshRunner,
    refreshTraces,
  }
}

export type MacroRunnerSession = ReturnType<typeof createMacroRunnerSession>
