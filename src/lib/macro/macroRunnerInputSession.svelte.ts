import type { TerminalRoomClient } from '../terminalRoomClient'
import type { MacroRecordSession } from './macroRecordSession.svelte'
import type { MacroRunnerClient } from './macroRunnerClient'
import type { MacroRunnerActionAck, MacroRunnerSnapshot } from './runnerTypes'

type RunnerInput = NonNullable<MacroRunnerSnapshot['runtimeInput']>

type MacroRunnerInputSessionOptions = {
  roomClient(): TerminalRoomClient | null
  canMutateShared(): boolean
  runner(): MacroRunnerSnapshot | null
  runnerClient: MacroRunnerClient
  record: MacroRecordSession
  refreshRunner(): Promise<void>
}

export function createMacroRunnerInputSession(options: MacroRunnerInputSessionOptions) {
  let value = $state('')
  let dirty = $state(false)
  let syncing = $state(false)
  let submitting = $state(false)
  let submittedInvocationId = $state<string | null>(null)
  let flushPromise: Promise<void> | null = null
  let submitPromise: Promise<void> | null = null
  let editGeneration = 0
  let acknowledgedGeneration = 0
  let cursor: RunnerInput | null = null
  let observedInput: RunnerInput | null = null

  $effect(() => {
    const snapshot = options.runner()
    if (snapshot) observeSnapshot(snapshot)
  })

  $effect(() => {
    if (options.canMutateShared()) return
    const input = options.runner()?.runtimeInput ?? null
    observedInput = input
    cursor = input
    value = input?.draft ?? ''
    dirty = false
    acknowledgedGeneration = editGeneration
  })

  function update(next: string): void {
    const roomClient = options.roomClient()
    if (!roomClient || !options.canMutateShared()) {
      options.record.rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected')
      return
    }
    const input = currentInput()
    if (!input) { options.record.rejectMutation('runner_not_waiting_input'); return }
    const requestInFlight = flushPromise !== null || syncing
    editGeneration += 1
    value = next
    if (!requestInFlight && next === input.draft) {
      acknowledgedGeneration = editGeneration
      dirty = false
    } else dirty = editGeneration > acknowledgedGeneration
    if (dirty) void flush()
  }

  function flush(): Promise<void> {
    if (flushPromise) return flushPromise
    const operation = runFlush()
    flushPromise = operation
    void operation.finally(() => {
      if (flushPromise === operation) flushPromise = null
    })
    return operation
  }

  async function runFlush(): Promise<void> {
    syncing = true
    try {
      while (editGeneration > acknowledgedGeneration) {
        const roomClient = options.roomClient()
        if (!roomClient || !options.canMutateShared()) break
        const input = currentInput()
        if (!input) break
        const desired = value
        const sentGeneration = editGeneration
        try {
          const ack = await options.runnerClient.updateInputDraft(
            input.invocationId,
            desired,
            input.inputRevision,
          )
          assertActionAck(ack, roomClient.roomId)
          const acknowledged = ack.runtimeInput
          if (!acknowledged
            || acknowledged.invocationId !== input.invocationId
            || acknowledged.inputRevision !== input.inputRevision + 1) {
            throw new Error('runner_input_ack_mismatch')
          }
          cursor = {
            ...input,
            draft: desired,
            inputRevision: acknowledged.inputRevision,
          }
          acknowledgedGeneration = Math.max(acknowledgedGeneration, sentGeneration)
          if (value === desired) acknowledgedGeneration = editGeneration
          dirty = acknowledgedGeneration < editGeneration
        } catch (error) {
          if (messageOf(error) === 'runner_input_revision_conflict') {
            const previousRevision = currentInput()?.inputRevision ?? -1
            await options.refreshRunner()
            if ((currentInput()?.inputRevision ?? -1) > previousRevision) continue
          }
          options.record.reportMutationError(error)
          break
        }
      }
    } finally {
      dirty = acknowledgedGeneration < editGeneration
      syncing = false
    }
  }

  function submit(): Promise<void> {
    if (submitPromise) return submitPromise
    const operation = runSubmit()
    submitPromise = operation
    void operation.finally(() => {
      if (submitPromise === operation) submitPromise = null
    })
    return operation
  }

  async function runSubmit(): Promise<void> {
    const roomClient = options.roomClient()
    if (!roomClient || !options.canMutateShared()) {
      options.record.rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (options.record.operationPending) {
      options.record.rejectMutation('operation_pending')
      return
    }
    await flush()
    const input = currentInput()
    if (!input || dirty) {
      if (!input) options.record.rejectMutation('runner_not_waiting_input')
      return
    }
    if (submittedInvocationId === input.invocationId) return
    submittedInvocationId = input.invocationId
    submitting = true
    const token = options.record.beginOperation()
    try {
      const ack = await options.runnerClient.submitInput(
        input.invocationId,
        value,
        input.inputRevision,
      )
      assertActionAck(ack, roomClient.roomId)
      if (ack.runtimeInput !== null) throw new Error('runner_input_ack_mismatch')
      cursor = null
    } catch (error) {
      submittedInvocationId = null
      if (options.record.canCommit(token)) {
        options.record.reportMutationError(error)
        if (messageOf(error) === 'runner_input_revision_conflict') await options.refreshRunner()
      }
    } finally {
      options.record.endOperation(token)
      submitting = false
    }
  }

  function observeSnapshot(next: MacroRunnerSnapshot): void {
    const input = next.runtimeInput
    if (!input) {
      submittedInvocationId = null
      observedInput = null
      cursor = null
      value = ''
      dirty = false
      editGeneration = 0
      acknowledgedGeneration = 0
      return
    }
    if (submittedInvocationId && submittedInvocationId !== input.invocationId) {
      submittedInvocationId = null
    }
    const previousInput = observedInput
    observedInput = input
    if (!cursor || cursor.invocationId !== input.invocationId
      || input.inputRevision >= cursor.inputRevision) cursor = input
    if (previousInput?.invocationId !== input.invocationId) {
      value = input.draft
      dirty = false
      editGeneration = 0
      acknowledgedGeneration = 0
      return
    }
    const hasLocalEdit = editGeneration > acknowledgedGeneration
    if (!hasLocalEdit || !options.canMutateShared() || value === input.draft) {
      value = input.draft
      dirty = false
      acknowledgedGeneration = editGeneration
    } else dirty = true
  }

  function currentInput(): RunnerInput | null {
    const input = options.runner()?.runtimeInput
    if (!input) return null
    return cursor?.invocationId === input.invocationId ? cursor : input
  }

  return {
    get value() { return value },
    get syncing() { return syncing || submitting || submittedInvocationId !== null },
    update,
    submit,
  }
}

function assertActionAck(ack: MacroRunnerActionAck, roomId: string): void {
  if (ack.roomId !== roomId || !ack.runId || !Number.isInteger(ack.runtimeRevision)) {
    throw new Error('runner_action_ack_identity_mismatch')
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
