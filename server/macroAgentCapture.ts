import { performance } from 'node:perf_hooks'
import type { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import type { AgentEvent, AgentEventMatch } from '../src/lib/agentEvents/agentEventTypes'
import type { AgentEventCaptureMode, CaptureWaitLimit, FlowV2Node } from '../src/lib/macro/macroDefinitionTypes'
import type { FrozenTerminalBinding } from '../src/lib/macro/runnerTypes'

type CaptureAgentEventKind = 'agent.prompt_submitted' | 'agent.output' | 'agent.error'

export type MacroAgentCaptureState = {
  roomId: string
  roomGeneration: string
  baselines: Map<string, number>
  consumedEventIds: Set<string>
}

export type MacroAgentCaptureContext = MacroAgentCaptureState & {
  serverInstanceId: string
  agentEvents: AgentEventStore
}

export type MacroAgentCaptureWaitContext = MacroAgentCaptureContext & {
  abortSignal: AbortSignal
  checkpoint: () => Promise<void>
  validateBinding: (terminalIndex: number) => void
  totalPausedMs: (now: number) => number
}

export function initializeMacroAgentEventBaselines(
  context: MacroAgentCaptureContext,
  nodes: FlowV2Node[],
  bindings: ReadonlyMap<number, FrozenTerminalBinding>,
): void {
  for (const target of agentCaptureTargets(nodes)) {
    const binding = bindings.get(target.terminalIndex)
    if (!binding) continue
    for (const eventKind of agentEventKinds(target.captureMode)) {
      const match = agentEventMatch(context, binding, eventKind)
      context.baselines.set(agentEventBaselineKey(target.stepId, eventKind), context.agentEvents.countMatching(match))
    }
    const errorKind = 'agent.error' as const
    context.baselines.set(
      agentEventBaselineKey(target.stepId, errorKind),
      context.agentEvents.countMatching(agentEventMatch(context, binding, errorKind)),
    )
  }
}

export async function waitForMacroAgentEventCapture(
  context: MacroAgentCaptureWaitContext,
  stepId: string,
  binding: FrozenTerminalBinding,
  captureMode: AgentEventCaptureMode,
  waitLimit: CaptureWaitLimit,
): Promise<{ text: string; raw: unknown; events: AgentEvent[] }> {
  const startedAtMs = performance.now()
  const pausedAtStartMs = context.totalPausedMs(startedAtMs)
  const logIdentity = {
    serverInstanceId: context.serverInstanceId,
    roomId: context.roomId,
    roomGeneration: context.roomGeneration,
  }
  let observedVersion = -1
  while (true) {
    await context.checkpoint()
    context.validateBinding(binding.index)
    const currentVersion = context.agentEvents.version(logIdentity)
    if (currentVersion !== observedVersion) {
      observedVersion = currentVersion
      const hookError = context.agentEvents.nextMatching(
        agentEventMatch(context, binding, 'agent.error'),
        context.baselines.get(agentEventBaselineKey(stepId, 'agent.error')) ?? 0,
        context.consumedEventIds,
      )
      if (hookError) {
        context.consumedEventIds.add(hookError.eventId)
        throw new Error('agent_event_hook_error:' + binding.terminalId)
      }
      const captured = agentEventsForCapture(context, stepId, binding, captureMode)
      if (captured) {
        for (const event of captured.events) context.consumedEventIds.add(event.eventId)
        return captured
      }
    }
    const remaining = waitLimit.kind === 'timeout'
      ? waitLimit.timeoutMs - activeElapsedMs(context, startedAtMs, pausedAtStartMs)
      : null
    if (remaining !== null && remaining <= 0) throw new Error('agent_event_capture_timeout:' + binding.terminalId)
    const slice = remaining === null ? 100 : Math.min(100, remaining)
    await context.agentEvents.waitForChange(logIdentity, observedVersion, slice, context.abortSignal)
  }
}

function agentCaptureTargets(nodes: FlowV2Node[]): Array<{ stepId: string; terminalIndex: number; captureMode: AgentEventCaptureMode }> {
  const targets: Array<{ stepId: string; terminalIndex: number; captureMode: AgentEventCaptureMode }> = []
  for (const node of nodes) {
    if (node.type === 'capture-source' && node.capture.kind === 'agent-event' && node.capture.terminal.kind === 'terminal_index') {
      targets.push({ stepId: node.id, terminalIndex: node.capture.terminal.index, captureMode: node.capture.captureMode })
    }
    if (node.type === 'if') {
      for (const branch of node.branches) targets.push(...agentCaptureTargets(branch.body))
      if (node.else) targets.push(...agentCaptureTargets(node.else))
    }
    if (node.type === 'for') targets.push(...agentCaptureTargets(node.body))
    if (node.type === 'parallel') for (const lane of node.lanes) for (const item of lane.body) {
      if (
        item.type === 'capture-source'
        && item.capture.kind === 'agent-event'
        && item.capture.terminal.kind === 'terminal_index'
      ) {
        targets.push({
          stepId: item.id,
          terminalIndex: item.capture.terminal.index,
          captureMode: item.capture.captureMode,
        })
      }
    }
    if ((node.type === 'break' || node.type === 'continue' || node.type === 'finish') && node.body) {
      targets.push(...agentCaptureTargets(node.body))
    }
  }
  return targets
}

function agentEventsForCapture(
  context: MacroAgentCaptureContext,
  stepId: string,
  binding: FrozenTerminalBinding,
  captureMode: AgentEventCaptureMode,
): { text: string; raw: unknown; events: AgentEvent[] } | undefined {
  if (captureMode !== 'prompt_and_result') {
    const eventKind = captureMode === 'prompt_only' ? 'agent.prompt_submitted' : 'agent.output'
    const match = agentEventMatch(context, binding, eventKind)
    const event = context.agentEvents.nextMatching(
      match,
      context.baselines.get(agentEventBaselineKey(stepId, eventKind)) ?? 0,
      context.consumedEventIds,
    )
    return event ? { text: event.capturedText ?? '', raw: event, events: [event] } : undefined
  }
  const promptKind = 'agent.prompt_submitted' as const
  const outputKind = 'agent.output' as const
  const prompts = context.agentEvents.matching(agentEventMatch(context, binding, promptKind))
    .slice(context.baselines.get(agentEventBaselineKey(stepId, promptKind)) ?? 0)
    .filter((event) => !context.consumedEventIds.has(event.eventId))
  const outputs = context.agentEvents.matching(agentEventMatch(context, binding, outputKind))
    .slice(context.baselines.get(agentEventBaselineKey(stepId, outputKind)) ?? 0)
    .filter((event) => !context.consumedEventIds.has(event.eventId))
  for (const prompt of prompts) {
    const output = outputs.find((candidate) => candidate.agentSessionId === prompt.agentSessionId && candidate.agentTurnId && candidate.agentTurnId === prompt.agentTurnId)
    if (!output) continue
    return {
      text: `===== user prompt =====\n${prompt.capturedText ?? ''}\n\n===== assistant result =====\n${output.capturedText ?? ''}`,
      raw: { promptEvent: prompt, outputEvent: output },
      events: [prompt, output],
    }
  }
  return undefined
}

function agentEventMatch(context: MacroAgentCaptureContext, binding: FrozenTerminalBinding, eventKind: CaptureAgentEventKind): AgentEventMatch {
  return {
    serverInstanceId: context.serverInstanceId,
    roomId: context.roomId,
    roomGeneration: context.roomGeneration,
    terminalId: binding.terminalId,
    launchId: binding.launchId,
    agentKind: 'codex',
    eventKind,
    adapter: eventKind === 'agent.output'
      ? 'codex-stop-hook'
      : eventKind === 'agent.prompt_submitted'
        ? 'codex-user-prompt-submit-hook'
        : 'codex-hook-error',
  }
}

function agentEventKinds(captureMode: AgentEventCaptureMode): Array<'agent.prompt_submitted' | 'agent.output'> {
  if (captureMode === 'prompt_only') return ['agent.prompt_submitted']
  if (captureMode === 'prompt_and_result') return ['agent.prompt_submitted', 'agent.output']
  return ['agent.output']
}

function agentEventBaselineKey(stepId: string, eventKind: CaptureAgentEventKind): string {
  return `${stepId}|${eventKind}`
}

function activeElapsedMs(context: MacroAgentCaptureWaitContext, startedAtMs: number, pausedAtStartMs: number): number {
  const now = performance.now()
  return now - startedAtMs - (context.totalPausedMs(now) - pausedAtStartMs)
}
