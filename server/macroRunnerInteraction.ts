import { performance } from 'node:perf_hooks'
import { createGeneratedId } from '../src/lib/generatedId'
import type { MacroRunnerSnapshot } from '../src/lib/macro/runnerTypes'
import type { LiveRun, PendingInput, PendingInputResult } from './macroRunnerLiveState'

const COOPERATIVE_CHECKPOINT_BUDGET = 64

export type MacroRunnerInteractionPorts = {
  activeRun: (roomId: string) => LiveRun
  snapshot: (roomId: string) => MacroRunnerSnapshot
  appendEvent: (run: LiveRun, kind: string, data?: Record<string, unknown>) => void
  bumpAndPublish: (run: LiveRun) => void
}

export class MacroRunnerInteraction {
  constructor(private readonly ports: MacroRunnerInteractionPorts) {}

  pause(roomId: string): MacroRunnerSnapshot {
    const run = this.ports.activeRun(roomId)
    if (run.status !== 'running') throw new Error('run_not_running')
    this.ports.appendEvent(run, 'run_paused')
    this.enterPaused(run)
    return this.ports.snapshot(roomId)
  }

  resume(roomId: string): MacroRunnerSnapshot {
    const run = this.ports.activeRun(roomId)
    if (run.status !== 'paused') throw new Error('run_not_paused')
    this.ports.appendEvent(run, 'run_resumed')
    this.leavePaused(run)
    for (const resolve of run.pauseWaiters.splice(0)) resolve()
    return this.ports.snapshot(roomId)
  }

  stop(roomId: string): MacroRunnerSnapshot {
    const run = this.ports.activeRun(roomId)
    try { this.ports.appendEvent(run, 'run_stopping') }
    catch { run.error = 'run_event_append_failed' }
    run.status = 'stopping'
    run.abortController.abort()
    for (const resolve of run.pauseWaiters.splice(0)) resolve()
    this.cancelPendingInput(run)
    this.ports.bumpAndPublish(run)
    return this.ports.snapshot(roomId)
  }

  updateInputDraft(
    roomId: string,
    invocationId: string,
    value: string,
    expectedInputRevision: number,
  ): MacroRunnerSnapshot {
    const run = this.ports.activeRun(roomId)
    const pending = this.assertPendingInput(run, invocationId, expectedInputRevision)
    pending.draft = value
    pending.inputRevision += 1
    this.ports.bumpAndPublish(run)
    return this.ports.snapshot(roomId)
  }

  submitInput(
    roomId: string,
    invocationId: string,
    value: string,
    expectedInputRevision: number,
  ): MacroRunnerSnapshot {
    const run = this.ports.activeRun(roomId)
    const pending = this.assertPendingInput(run, invocationId, expectedInputRevision)
    const nextInputRevision = pending.inputRevision + 1
    this.ports.appendEvent(run, 'runner_input_submitted', {
      invocationId,
      inputRevision: nextInputRevision,
      chars: value.length,
    })
    pending.draft = value
    pending.inputRevision = nextInputRevision
    run.pendingInput = null
    run.status = 'running'
    pending.resolve({ kind: 'submitted', value })
    return this.ports.snapshot(roomId)
  }

  async pauseRun(run: LiveRun, reason: string, stepId: string): Promise<void> {
    if (run.status !== 'paused') {
      this.enterPaused(run)
      this.ports.appendEvent(run, 'run_paused', { reason, stepId })
    }
    await this.checkpoint(run)
  }

  async checkpoint(run: LiveRun): Promise<void> {
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

  totalPausedMs(run: LiveRun, now = performance.now()): number {
    return run.accumulatedPausedMs + (run.pausedStartedAtMs === null ? 0 : now - run.pausedStartedAtMs)
  }

  async waitForInput(run: LiveRun, prompt: string, defaultText = ''): Promise<string> {
    if (run.pendingInput) throw new Error('runner_input_already_pending')
    run.status = 'waiting_input'
    const result = await new Promise<PendingInputResult>((resolve) => {
      const invocationId = createGeneratedId('runnerInput')
      run.pendingInput = { invocationId, prompt, defaultText, draft: defaultText, inputRevision: 0, resolve }
      this.ports.appendEvent(run, 'runner_input_requested', {
        invocationId,
        inputRevision: 0,
        hasDefaultText: defaultText.length > 0,
        promptChars: prompt.length,
      })
    })
    if (result.kind === 'cancelled') throw new Error('run_stopped')
    return result.value
  }

  cancelPendingInput(run: LiveRun): void {
    const pending = run.pendingInput
    run.pendingInput = null
    pending?.resolve({ kind: 'cancelled' })
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

  private assertPendingInput(run: LiveRun, invocationId: string, expectedInputRevision: number): PendingInput {
    const pending = run.pendingInput
    if (!pending || run.status !== 'waiting_input') throw new Error('runner_not_waiting_input')
    if (pending.invocationId !== invocationId) throw new Error('runner_input_invocation_mismatch')
    if (!Number.isInteger(expectedInputRevision) || expectedInputRevision < 0 || pending.inputRevision !== expectedInputRevision) {
      throw new Error('runner_input_revision_conflict')
    }
    return pending
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
