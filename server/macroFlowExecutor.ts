import type {
  FlowV2Node,
  MacroTerminalLayoutItem,
  ParallelLane,
} from '../src/lib/macro/macroDefinitionTypes'
import { buildParallelTerminalUsage } from '../src/lib/macro/parallelTerminalUsage'
import type { TextListTemplateBinding } from '../src/lib/macro/scopedTextTemplate'
import type {
  MacroActionExecutionOptions,
  MacroExecutableActionNode,
} from './macroActionRuntime'
import {
  matchesMacroCondition,
  type MacroArtifactMap,
} from './macroTextEvaluation'
import { ParallelSharedTextQueue } from './parallelSharedTextQueue'

export type MacroRunControlSignal = 'break' | 'continue' | 'finish'

export class MacroFlowSignal extends Error {
  constructor(readonly signal: MacroRunControlSignal) {
    super(signal)
  }
}

export type MacroFlowExecutionContext = {
  body: FlowV2Node[]
  terminalLayout: MacroTerminalLayoutItem[]
  artifacts: MacroArtifactMap
  templateBindings: TextListTemplateBinding[]
  parallelProgress: Map<string, number>
  abortSignal: AbortSignal
  callbacks: {
    checkpoint: () => Promise<void>
    setCurrentNodeId: (nodeId: string) => void
    appendEvent: (kind: string, data?: Record<string, unknown>) => void
    executeAction: (
      node: MacroExecutableActionNode,
      options?: MacroActionExecutionOptions,
    ) => Promise<void>
    pauseRun: (reason: string, stepId: string) => Promise<void>
    isTerminalized: () => boolean
    isCancellation: (error: unknown) => boolean
  }
}

export async function executeMacroFlow(context: MacroFlowExecutionContext): Promise<void> {
  await executeNodes(context, context.body)
}

async function executeNodes(context: MacroFlowExecutionContext, nodes: FlowV2Node[]): Promise<void> {
  for (const node of nodes) {
    await context.callbacks.checkpoint()
    context.callbacks.setCurrentNodeId(node.id)
    context.callbacks.appendEvent('step_started', { stepId: node.id, type: node.type })
    try {
      await executeNode(context, node)
      context.callbacks.appendEvent('step_completed', { stepId: node.id, type: node.type })
    } catch (error) {
      if (!context.callbacks.isTerminalized() && !(error instanceof MacroFlowSignal) && !context.callbacks.isCancellation(error)) {
        context.callbacks.appendEvent('step_failed', { stepId: node.id, type: node.type, code: errorMessage(error) })
      }
      throw error
    }
  }
}

async function executeNode(context: MacroFlowExecutionContext, node: FlowV2Node): Promise<void> {
  if (node.type === 'parallel') {
    await executeParallel(context, node)
    return
  }
  if (node.type === 'if') {
    const branch = node.branches.find((candidate) => matchesMacroCondition(context.artifacts, candidate.condition))
    if (branch) await executeNodes(context, branch.body)
    else if (node.else) await executeNodes(context, node.else)
    return
  }
  if (node.type === 'for') {
    if (node.range.kind === 'count') {
      for (let index = 1; index <= node.range.count; index += 1) {
        if (!(await executeLoopBody(context, node.body))) break
      }
    } else if (node.range.kind === 'forever') {
      while (await executeLoopBody(context, node.body)) await context.callbacks.checkpoint()
    } else {
      for (const [offset, item] of node.range.items.entries()) {
        context.templateBindings.push({ index: offset + 1, key: item.key, value: item.value, forStepId: node.id })
        try {
          if (!(await executeLoopBody(context, node.body))) break
        } finally {
          context.templateBindings.pop()
        }
      }
    }
    return
  }
  if (node.type === 'break') {
    if (node.body) await executeNodes(context, node.body)
    throw new MacroFlowSignal('break')
  }
  if (node.type === 'continue') {
    if (node.body) await executeNodes(context, node.body)
    throw new MacroFlowSignal('continue')
  }
  if (node.type === 'finish') {
    if (node.body) await executeNodes(context, node.body)
    throw new MacroFlowSignal('finish')
  }
  await context.callbacks.executeAction(node)
}

async function executeLoopBody(context: MacroFlowExecutionContext, body: FlowV2Node[]): Promise<boolean> {
  try {
    await executeNodes(context, body)
    return true
  } catch (error) {
    if (error instanceof MacroFlowSignal && error.signal === 'continue') return true
    if (error instanceof MacroFlowSignal && error.signal === 'break') return false
    throw error
  }
}

async function executeParallel(
  context: MacroFlowExecutionContext,
  node: Extract<FlowV2Node, { type: 'parallel' }>,
): Promise<void> {
  const usage = buildParallelTerminalUsage(node, context.terminalLayout)
  const invocationAbort = new AbortController()
  const stopInvocation = () => invocationAbort.abort(new Error('run_stopped'))
  if (context.abortSignal.aborted) stopInvocation()
  else context.abortSignal.addEventListener('abort', stopInvocation, { once: true })
  const queue = new ParallelSharedTextQueue(usage.sharedTextPlans, invocationAbort.signal)
  const execute = (lane: ParallelLane) => executeLane(
    context,
    node.id,
    lane,
    queue,
    invocationAbort.signal,
  )
    .then(() => ({ ok: true as const, lane }))
    .catch((error: unknown) => ({ ok: false as const, lane, error }))
  const active = new Map(node.lanes.map((lane) => [lane.id, execute(lane)]))
  try {
    while (active.size > 0) {
      const settled = await Promise.race(active.values())
      active.delete(settled.lane.id)
      if (settled.ok) continue
      if (settled.error instanceof MacroFlowSignal) {
        cancelParallelInvocation(invocationAbort, queue, settled.error)
        await Promise.all(active.values())
        throw settled.error
      }
      if (context.callbacks.isCancellation(settled.error)) {
        cancelParallelInvocation(invocationAbort, queue, new Error('run_stopped'))
        await Promise.all(active.values())
        throw settled.error
      }
      const code = `parallel_lane_failed:${settled.lane.id}:${errorMessage(settled.error)}`
      if (node.onLaneFail === 'fail') {
        cancelParallelInvocation(invocationAbort, queue, new Error(code))
        await Promise.all(active.values())
        throw new Error(code)
      }
      await context.callbacks.pauseRun(code, node.id)
      if (context.abortSignal.aborted || context.callbacks.isTerminalized()) {
        cancelParallelInvocation(invocationAbort, queue, new Error('run_stopped'))
        await Promise.all(active.values())
        throw new Error('run_stopped')
      }
      active.set(settled.lane.id, execute(settled.lane))
    }
    queue.finish()
    for (const lane of node.lanes) context.parallelProgress.delete(`${node.id}:${lane.id}`)
  } catch (error) {
    queue.cancel(error instanceof Error ? error : new Error(errorMessage(error)))
    await Promise.all(active.values())
    throw error
  } finally {
    context.abortSignal.removeEventListener('abort', stopInvocation)
    queue.dispose()
  }
}

async function executeLane(
  context: MacroFlowExecutionContext,
  parallelId: string,
  lane: ParallelLane,
  queue: ParallelSharedTextQueue,
  abortSignal: AbortSignal,
): Promise<void> {
  const progressKey = `${parallelId}:${lane.id}`
  let index = context.parallelProgress.get(progressKey) ?? 0
  while (index < lane.body.length) {
    if (abortSignal.aborted) throw new Error('run_stopped')
    await context.callbacks.checkpoint()
    if (abortSignal.aborted) throw new Error('run_stopped')
    const node = lane.body[index]
    context.callbacks.setCurrentNodeId(node.id)
    context.callbacks.appendEvent('step_started', { stepId: node.id, type: node.type, parallelId, laneId: lane.id })
    try {
      await context.callbacks.executeAction(node, {
        abortSignal,
        dispatchTerminalWrite: queue.dispatch,
      })
      context.callbacks.appendEvent('step_completed', { stepId: node.id, type: node.type, parallelId, laneId: lane.id })
      index += 1
      context.parallelProgress.set(progressKey, index)
    } catch (error) {
      if (!abortSignal.aborted && !context.callbacks.isTerminalized() && !(error instanceof MacroFlowSignal) && !context.callbacks.isCancellation(error)) {
        context.callbacks.appendEvent('step_failed', {
          stepId: node.id,
          type: node.type,
          parallelId,
          laneId: lane.id,
          code: errorMessage(error),
        })
      }
      throw error
    }
  }
}

function cancelParallelInvocation(
  controller: AbortController,
  queue: ParallelSharedTextQueue,
  error: Error,
): void {
  if (!controller.signal.aborted) controller.abort(error)
  queue.cancel(error)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
