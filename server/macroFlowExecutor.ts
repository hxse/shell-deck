import type { FlowV2Node, ParallelLane } from '../src/lib/macro/macroDefinitionTypes'
import type { TextListTemplateBinding } from '../src/lib/macro/scopedTextTemplate'
import type { MacroExecutableActionNode } from './macroActionRuntime'
import {
  assignedMacroTerminalIndex,
  matchesMacroCondition,
  readMacroArtifact,
  type MacroArtifactMap,
} from './macroTextEvaluation'

export type MacroRunControlSignal = 'break' | 'continue' | 'finish'

export class MacroFlowSignal extends Error {
  constructor(readonly signal: MacroRunControlSignal) {
    super(signal)
  }
}

export type MacroFlowExecutionContext = {
  body: FlowV2Node[]
  artifacts: MacroArtifactMap
  templateBindings: TextListTemplateBinding[]
  parallelProgress: Map<string, number>
  parallelOutputs: Map<string, string>
  callbacks: {
    checkpoint: () => Promise<void>
    setCurrentNodeId: (nodeId: string) => void
    appendEvent: (kind: string, data?: Record<string, unknown>) => void
    executeAction: (node: MacroExecutableActionNode) => Promise<void>
    persistArtifact: (stepId: string, name: string, value: string, prefix: string, data?: Record<string, unknown>) => string
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
    const sections = await executeParallel(context, node)
    const merged = sections
      .filter((value) => node.merge.includeEmptyOutputs || value.text.length > 0)
      .map((value) => node.merge.separator
        .replaceAll('{laneId}', value.laneId)
        .replaceAll('{laneLabel}', value.label)
        .replaceAll('{terminalIndex}', String(value.terminalIndex)) + value.text)
      .join('\n\n')
    context.callbacks.persistArtifact(
      node.id,
      'merged_text',
      merged,
      'parallel-merged',
      { laneIds: sections.map((section) => section.laneId) },
    )
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
): Promise<Array<{ laneId: string; label: string; terminalIndex: number; text: string }>> {
  while (true) {
    const settled = await Promise.all(node.lanes.map(async (lane) => {
      try {
        return { ok: true as const, value: await executeLane(context, node.id, lane) }
      } catch (error) {
        return { ok: false as const, laneId: lane.id, error }
      }
    }))
    const failed = settled.find((result) => !result.ok)
    if (!failed) {
      const values = settled.map((result) => (result as Extract<typeof result, { ok: true }>).value)
      for (const lane of node.lanes) {
        context.parallelProgress.delete(`${node.id}:${lane.id}`)
        context.parallelOutputs.delete(`${node.id}:${lane.id}`)
      }
      return values
    }
    const code = `parallel_lane_failed:${failed.laneId}:${errorMessage(failed.error)}`
    if (node.onLaneFail === 'fail') throw new Error(code)
    await context.callbacks.pauseRun(code, node.id)
  }
}

async function executeLane(
  context: MacroFlowExecutionContext,
  parallelId: string,
  lane: ParallelLane,
): Promise<{ laneId: string; label: string; terminalIndex: number; text: string }> {
  const progressKey = `${parallelId}:${lane.id}`
  let index = context.parallelProgress.get(progressKey) ?? 0
  while (index < lane.body.length) {
    await context.callbacks.checkpoint()
    const node = lane.body[index]
    if (node.type === 'output') {
      context.parallelOutputs.set(
        progressKey,
        node.source.kind === 'none' ? '' : readMacroArtifact(context.artifacts, node.source),
      )
      index += 1
      context.parallelProgress.set(progressKey, index)
      continue
    }
    const inherited = { ...node } as Record<string, unknown>
    if (node.type === 'send' || (node.type === 'wait' && node.mode === 'terminal-quiet')) inherited.terminal = lane.terminal
    if (node.type === 'capture-source') inherited.capture = { ...node.capture, terminal: lane.terminal }
    context.callbacks.setCurrentNodeId(node.id)
    context.callbacks.appendEvent('step_started', { stepId: node.id, type: node.type, parallelId, laneId: lane.id })
    try {
      await context.callbacks.executeAction(inherited as unknown as MacroExecutableActionNode)
      context.callbacks.appendEvent('step_completed', { stepId: node.id, type: node.type, parallelId, laneId: lane.id })
      index += 1
      context.parallelProgress.set(progressKey, index)
    } catch (error) {
      if (!context.callbacks.isTerminalized() && !(error instanceof MacroFlowSignal) && !context.callbacks.isCancellation(error)) {
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
  return {
    laneId: lane.id,
    label: lane.label,
    terminalIndex: assignedMacroTerminalIndex(lane.terminal),
    text: context.parallelOutputs.get(progressKey) ?? '',
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
