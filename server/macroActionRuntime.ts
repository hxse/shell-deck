import { captureTerminalBuffer } from '../src/lib/capture/terminalBufferCapture'
import { createGeneratedId } from '../src/lib/generatedId'
import type {
  AgentEventCaptureMode,
  AgentEventWaitLimit,
  CaptureSourceConfig,
  FlowV2ActionNode,
} from '../src/lib/macro/macroDefinitionTypes'
import type { FrozenTerminalBinding } from '../src/lib/macro/runnerTypes'
import type { TextListTemplateBinding } from '../src/lib/macro/scopedTextTemplate'
import { buildTerminalInputPayload, resolveTerminalInputDelivery } from '../src/lib/terminal/terminalInputDelivery'
import type { NotificationDispatcher } from './notificationService'
import type { TerminalRoomManager } from './terminalRoomManager'
import {
  assignedMacroTerminalIndex,
  extractMacroText,
  readMacroArtifact,
  renderMacroMessage,
  renderMacroScalar,
  type MacroArtifactMap,
} from './macroTextEvaluation'

export type MacroExecutableActionNode = Exclude<FlowV2ActionNode, { type: 'parallel' }>

export type MacroActionRuntimeContext = {
  manager: TerminalRoomManager
  notificationService: NotificationDispatcher
  run: {
    runId: string
    roomId: string
    roomGeneration: string
    bindings: ReadonlyMap<number, FrozenTerminalBinding>
    artifacts: MacroArtifactMap
    templateBindings: TextListTemplateBinding[]
    abortSignal: AbortSignal
  }
  callbacks: {
    isTerminalized: () => boolean
    currentNodeId: () => string | null
    checkpoint: () => Promise<void>
    waitForInput: (prompt: string, defaultText?: string) => Promise<string>
    pauseRun: (reason: string, stepId: string) => Promise<void>
    finishFlow: () => never
    waitForAgentEventCapture: (
      stepId: string,
      binding: FrozenTerminalBinding,
      captureMode: AgentEventCaptureMode,
      waitLimit: AgentEventWaitLimit,
    ) => Promise<{ text: string; raw: unknown; events: Array<{ eventId: string }> }>
    appendEvent: (kind: string, data?: Record<string, unknown>) => void
    persistArtifact: (stepId: string, name: string, value: string, prefix: string, data?: Record<string, unknown>) => string
    writeSupplementalArtifact: (stepId: string, artifact: string, prefix: string, value: string, extension?: string) => string
  }
}

export async function executeMacroAction(context: MacroActionRuntimeContext, node: MacroExecutableActionNode): Promise<void> {
  const templateBinding = context.run.templateBindings.at(-1)
  if (node.type === 'send') {
    send(
      context,
      assignedMacroTerminalIndex(node.terminal),
      renderMacroMessage(node.message, context.run.artifacts, templateBinding),
      node.delivery,
      node.ending,
      node.id,
    )
    return
  }
  if (node.type === 'input') {
    const prompt = renderMacroScalar(node.prompt, templateBinding)
    const defaultText = node.defaultSource ? readMacroArtifact(context.run.artifacts, node.defaultSource) : ''
    const value = await context.callbacks.waitForInput(prompt, defaultText)
    if (!node.allowEmpty && value.length === 0) throw new Error('runner_input_empty')
    send(context, assignedMacroTerminalIndex(node.terminal), value, node.delivery, node.ending, node.id)
    return
  }
  if (node.type === 'notify') {
    const title = renderMacroScalar(node.title, templateBinding)
    const message = renderMacroMessage(node.message, context.run.artifacts, templateBinding)
    const notificationId = createGeneratedId('notification')
    const createdAt = new Date().toISOString()
    const messageArtifactRef = context.callbacks.writeSupplementalArtifact(node.id, 'notification_message', 'notification-message', message)
    const browserChannels = node.channels.filter((channel): channel is Extract<typeof channel, { kind: 'app' | 'system' }> => channel.kind === 'app' || channel.kind === 'system')
    context.callbacks.appendEvent('notification_requested', {
      stepId: node.id,
      notificationId,
      createdAt,
      level: node.level,
      title,
      messageArtifactRef,
      channels: node.channels,
      onFailure: node.onFailure,
    })
    if (browserChannels.length > 0) {
      context.manager.broadcastRoomMessage(context.run.roomId, {
        type: 'macro_notification',
        roomId: context.run.roomId,
        roomGeneration: context.run.roomGeneration,
        runId: context.run.runId,
        stepId: node.id,
        notificationId,
        createdAt,
        level: node.level,
        title,
        message,
        channels: browserChannels,
      })
    }
    const failures: string[] = []
    for (const channel of node.channels) if (channel.kind === 'telegram') {
      const result = await context.notificationService.sendTelegram({
        profileId: channel.profileId,
        title,
        message,
        level: node.level,
        notificationId,
        createdAt,
        runId: context.run.runId,
        stepId: node.id,
      })
      await context.callbacks.checkpoint()
      if (result.ok) {
        context.callbacks.appendEvent('notification_delivered', {
          stepId: node.id,
          notificationId,
          channel: { kind: 'telegram', profileId: channel.profileId },
          status: result.status,
        })
      } else {
        failures.push(result.code)
        context.callbacks.appendEvent('notification_failed', {
          stepId: node.id,
          notificationId,
          channel: { kind: 'telegram', profileId: channel.profileId },
          code: result.code,
          status: result.status ?? null,
          message: result.message,
        })
      }
    }
    if (failures.length > 0 && node.onFailure === 'fail') throw new Error('notification_failed:' + failures.join(','))
    if (failures.length > 0 && node.onFailure === 'pause') {
      await context.callbacks.pauseRun('notification_failed:' + failures.join(','), node.id)
    }
    return
  }
  if (node.type === 'wait') {
    if (node.mode === 'duration') await waitDuration(context, node.durationMs)
    else if (node.mode === 'user-continue') {
      await context.callbacks.waitForInput(renderMacroScalar(node.prompt, templateBinding))
    } else {
      await waitQuiet(
        context,
        assignedMacroTerminalIndex(node.terminal),
        node.quietMs,
        node.maxMs,
        node.onTimeout,
      )
    }
    return
  }
  if (node.type === 'capture-source') {
    const captured = await capture(context, node.id, node.capture)
    context.callbacks.persistArtifact(node.id, 'captured_text', captured.text, 'capture', captured.data)
    return
  }
  const output = extractMacroText(readMacroArtifact(context.run.artifacts, node.source), node)
  context.callbacks.persistArtifact(node.id, 'extracted_text', output, 'extract-text', { empty: output.length === 0 })
  if (output.length === 0) {
    if (node.onEmpty === 'fail') throw new Error('extract_text_empty')
    if (node.onEmpty === 'finish') context.callbacks.finishFlow()
    if (node.onEmpty === 'pause') await context.callbacks.pauseRun('extract_text_empty', node.id)
  }
}

function send(
  context: MacroActionRuntimeContext,
  terminalIndex: number,
  content: string,
  delivery: 'auto' | 'direct' | 'bracketed-paste',
  ending: 'none' | 'lf' | 'cr' | 'crlf',
  stepId: string,
): void {
  if (context.callbacks.isTerminalized() || context.run.abortSignal.aborted) throw new Error('run_stopped')
  const binding = frozenBinding(context, terminalIndex)
  const resolved = resolveTerminalInputDelivery(delivery, binding.type)
  const payload = buildTerminalInputPayload(content, resolved, ending)
  if (!payload.ok) throw new Error(payload.reason)
  const result = context.manager.input(context.run.roomId, binding.terminalId, payload.payload)
  if (!result.ok) throw new Error('frozen_terminal_not_ready')
  const currentTerminalIndex = context.manager.indexMap(context.run.roomId).find((item) => item.terminalId === binding.terminalId)?.index ?? null
  context.callbacks.appendEvent('terminal_input_sent', {
    stepId,
    configuredTerminalIndex: terminalIndex,
    currentTerminalIndex,
    terminalId: binding.terminalId,
    launchId: binding.launchId,
    requestedDelivery: delivery,
    resolvedDelivery: resolved,
    ending,
  })
}

async function capture(
  context: MacroActionRuntimeContext,
  stepId: string,
  source: CaptureSourceConfig,
): Promise<{ text: string; data: Record<string, unknown> }> {
  const configuredTerminalIndex = assignedMacroTerminalIndex(source.terminal)
  const binding = frozenBinding(context, configuredTerminalIndex)
  const currentTerminalIndex = context.manager.indexMap(context.run.roomId).find((item) => item.terminalId === binding.terminalId)?.index ?? null
  if (source.kind === 'agent-event') {
    const captured = await context.callbacks.waitForAgentEventCapture(stepId, binding, source.captureMode, source.waitLimit)
    const rawArtifactRef = context.callbacks.writeSupplementalArtifact(
      stepId,
      'agent_event_raw',
      'agent-event-raw',
      JSON.stringify(captured.raw, null, 2) + '\n',
      'json',
    )
    return {
      text: captured.text,
      data: {
        captureKind: source.kind,
        captureMode: source.captureMode,
        configuredTerminalIndex,
        currentTerminalIndex,
        terminalId: binding.terminalId,
        launchId: binding.launchId,
        rawArtifactRef,
        agentEventIds: captured.events.map((event) => event.eventId),
      },
    }
  }
  const snapshot = context.manager.terminalSnapshot(context.manager.resolveTerminal(context.run.roomId, binding.terminalId))
  const text = snapshot.replay.join('')
  if (source.kind === 'text-box') {
    return {
      text,
      data: {
        captureKind: source.kind,
        configuredTerminalIndex,
        currentTerminalIndex,
        terminalId: binding.terminalId,
        launchId: binding.launchId,
      },
    }
  }
  const captured = captureTerminalBuffer({ replay: snapshot.replay, maxChars: source.maxChars })
  const rawArtifactRef = context.callbacks.writeSupplementalArtifact(stepId, 'terminal_buffer_raw', 'capture-raw', captured.rawText)
  const normalizedArtifactRef = context.callbacks.writeSupplementalArtifact(stepId, 'terminal_buffer_normalized', 'capture-normalized', captured.normalizedText)
  return {
    text: source.mode === 'raw-stream-tail' ? captured.rawText : captured.normalizedText,
    data: {
      captureKind: source.kind,
      mode: source.mode,
      maxChars: source.maxChars,
      configuredTerminalIndex,
      currentTerminalIndex,
      terminalId: binding.terminalId,
      launchId: binding.launchId,
      rawArtifactRef,
      normalizedArtifactRef,
      truncated: captured.truncated,
      rawCharsBeforeTail: captured.rawCharsBeforeTail,
      capturedChars: captured.capturedChars,
      strippedAnsi: captured.strippedAnsi,
    },
  }
}

function frozenBinding(context: MacroActionRuntimeContext, terminalIndex: number): FrozenTerminalBinding {
  const binding = context.run.bindings.get(terminalIndex)
  if (!binding) throw new Error('frozen_terminal_binding_missing')
  if (!context.manager.hasTerminalLaunch(
    context.run.roomId,
    context.run.roomGeneration,
    binding.terminalId,
    binding.launchId,
  )) throw new Error('frozen_terminal_launch_lost')
  return binding
}

async function waitDuration(context: MacroActionRuntimeContext, durationMs: number): Promise<void> {
  let remaining = durationMs
  while (remaining > 0) {
    await context.callbacks.checkpoint()
    const slice = Math.min(remaining, 50)
    await abortableDelay(slice, context.run.abortSignal)
    remaining -= slice
  }
}

async function waitQuiet(
  context: MacroActionRuntimeContext,
  terminalIndex: number,
  quietMs: number,
  maxMs: number,
  onTimeout: 'pause' | 'fail' | 'finish' | 'continue',
): Promise<void> {
  const binding = frozenBinding(context, terminalIndex)
  let previous = context.manager.terminalOutputActivityRevision(
    context.run.roomId,
    context.run.roomGeneration,
    binding.terminalId,
    binding.launchId,
  )
  let quiet = 0
  let elapsed = 0
  while (elapsed < maxMs) {
    const slice = Math.min(50, maxMs - elapsed)
    await waitDuration(context, slice)
    elapsed += slice
    const revision = context.manager.terminalOutputActivityRevision(
      context.run.roomId,
      context.run.roomGeneration,
      binding.terminalId,
      binding.launchId,
    )
    quiet = revision === previous ? quiet + slice : 0
    previous = revision
    if (quiet >= quietMs) return
  }
  if (onTimeout === 'continue') return
  if (onTimeout === 'finish') context.callbacks.finishFlow()
  if (onTimeout === 'pause') {
    await context.callbacks.pauseRun('terminal_quiet_timeout', context.callbacks.currentNodeId() ?? '')
    return
  }
  throw new Error('terminal_quiet_timeout')
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('run_stopped')); return }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', aborted, { once: true })
    function done() { signal.removeEventListener('abort', aborted); resolve() }
    function aborted() { clearTimeout(timer); reject(new Error('run_stopped')) }
  })
}
