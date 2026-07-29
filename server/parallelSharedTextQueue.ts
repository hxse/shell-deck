import type { ParallelSharedTextOrder } from '../src/lib/macro/macroDefinitionTypes'

export type ParallelSharedTextPlan = {
  terminalIndex: number
  order: ParallelSharedTextOrder
  sendPlan: string[]
}

export type MacroTerminalWriteRequest = {
  stepId: string
  terminalIndex: number
  write: () => void
  record: () => void
}

type PendingWrite = MacroTerminalWriteRequest & {
  resolve: () => void
  reject: (error: unknown) => void
}

type DirectWriteState = {
  terminalIndex: number
  written: boolean
  recorded: boolean
}

type TargetQueue = {
  plan: string[]
  ordinalByStepId: Map<string, number>
  cursor: number
  ready: Map<number, PendingWrite>
  written: Set<string>
  recorded: Set<string>
}

export class ParallelSharedTextQueue {
  private readonly targets = new Map<number, TargetQueue>()
  private readonly directWrites = new Map<string, DirectWriteState>()
  private readonly completionTargets = new Map<number, {
    plan: Set<string>
    written: Set<string>
    recorded: Set<string>
  }>()
  private cancelled: Error | null = null
  private readonly onAbort = () => this.cancel(new Error('run_stopped'))

  constructor(plans: ParallelSharedTextPlan[], private readonly abortSignal: AbortSignal) {
    for (const plan of plans) {
      if (plan.order === 'completion_order') {
        this.completionTargets.set(plan.terminalIndex, {
          plan: new Set(plan.sendPlan),
          written: new Set(),
          recorded: new Set(),
        })
        continue
      }
      this.targets.set(plan.terminalIndex, {
        plan: plan.sendPlan,
        ordinalByStepId: new Map(plan.sendPlan.map((stepId, ordinal) => [stepId, ordinal])),
        cursor: 0,
        ready: new Map(),
        written: new Set(),
        recorded: new Set(),
      })
    }
    if (abortSignal.aborted) this.cancel(new Error('run_stopped'))
    else abortSignal.addEventListener('abort', this.onAbort, { once: true })
  }

  dispatch = async (request: MacroTerminalWriteRequest): Promise<void> => {
    if (this.cancelled) throw this.cancelled
    const completionTarget = this.completionTargets.get(request.terminalIndex)
    if (completionTarget) {
      if (!completionTarget.plan.has(request.stepId)) {
        throw new Error(`parallel_shared_text_plan_missing:${request.stepId}`)
      }
      if (!completionTarget.written.has(request.stepId)) {
        request.write()
        completionTarget.written.add(request.stepId)
      }
      if (!completionTarget.recorded.has(request.stepId)) {
        request.record()
        completionTarget.recorded.add(request.stepId)
      }
      return
    }
    const target = this.targets.get(request.terminalIndex)
    if (!target) {
      this.dispatchDirect(request)
      return
    }
    const ordinal = target.ordinalByStepId.get(request.stepId)
    if (ordinal === undefined) throw new Error(`parallel_shared_text_plan_missing:${request.stepId}`)
    if (ordinal < target.cursor) {
      this.finishPreviouslyWritten(target, request)
      this.drain(target)
      return
    }
    if (target.ready.has(ordinal)) throw new Error(`parallel_shared_text_send_duplicate:${request.stepId}`)
    return new Promise<void>((resolve, reject) => {
      target.ready.set(ordinal, { ...request, resolve, reject })
      this.drain(target)
    })
  }

  cancel(error: Error): void {
    if (this.cancelled) return
    this.cancelled = error
    for (const target of this.targets.values()) {
      for (const pending of target.ready.values()) pending.reject(error)
      target.ready.clear()
    }
  }

  finish(): void {
    if (this.cancelled) throw this.cancelled
    for (const [terminalIndex, target] of this.targets) {
      if (target.cursor !== target.plan.length || target.ready.size > 0) {
        throw new Error(`parallel_shared_text_queue_incomplete:${terminalIndex}`)
      }
    }
    for (const [terminalIndex, target] of this.completionTargets) {
      if (target.recorded.size !== target.plan.size) {
        throw new Error(`parallel_shared_text_queue_incomplete:${terminalIndex}`)
      }
    }
  }

  dispose(): void {
    this.abortSignal.removeEventListener('abort', this.onAbort)
  }

  private drain(target: TargetQueue): void {
    while (!this.cancelled) {
      const pending = target.ready.get(target.cursor)
      if (!pending) return
      target.ready.delete(target.cursor)
      try {
        pending.write()
        target.written.add(pending.stepId)
        target.cursor += 1
        pending.record()
        target.recorded.add(pending.stepId)
        pending.resolve()
      } catch (error) {
        pending.reject(error)
        return
      }
    }
  }

  private finishPreviouslyWritten(
    target: TargetQueue,
    request: MacroTerminalWriteRequest,
  ): void {
    if (!target.written.has(request.stepId)) {
      throw new Error(`parallel_shared_text_cursor_corrupt:${request.stepId}`)
    }
    if (target.recorded.has(request.stepId)) return
    request.record()
    target.recorded.add(request.stepId)
  }

  private dispatchDirect(request: MacroTerminalWriteRequest): void {
    const state = this.directWrites.get(request.stepId) ?? {
      terminalIndex: request.terminalIndex,
      written: false,
      recorded: false,
    }
    if (state.terminalIndex !== request.terminalIndex) {
      throw new Error(`parallel_terminal_write_target_changed:${request.stepId}`)
    }
    this.directWrites.set(request.stepId, state)
    if (!state.written) {
      request.write()
      state.written = true
    }
    if (!state.recorded) {
      request.record()
      state.recorded = true
    }
  }
}
