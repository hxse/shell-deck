import type { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import type { AgentEvent, AgentEventMatch } from '../src/lib/agentEvents/agentEventTypes'
import { captureTerminalBuffer } from '../src/lib/capture/terminalBufferCapture'
import { createGeneratedId } from '../src/lib/generatedId'
import type {
  CaptureSourceConfig,
  FlowV2ArtifactSource,
  FlowV2Node,
  MacroDefinitionV3,
  MacroRecord,
  MessageSpec,
  ParallelLane,
  TemplatableScalarText,
  TextMatchCondition,
} from '../src/lib/macro/macroDefinitionTypes'
import { validateMacroDefinitionV3 } from '../src/lib/macro/macroDefinitionValidation'
import { validateMacroRuntimeBinding } from '../src/lib/macro/macroRuntimeBinding'
import type { FrozenTerminalBinding, MacroRunnerDelta, MacroRunnerSnapshot, MacroRunTrace, RunManifestV1 } from '../src/lib/macro/runnerTypes'
import { renderScopedTemplate, renderTemplatableScalar, type TextListTemplateBinding } from '../src/lib/macro/scopedTextTemplate'
import { buildTerminalInputPayload, resolveTerminalInputDelivery } from '../src/lib/terminal/terminalInputDelivery'
import type { NotificationDispatcher } from './notificationService'
import type { MacroRecordStore } from './sharedContentStore'
import { macroDefinitionHash, MacroRunStore } from './macroRunStore'
import type { RoomControlledOperationTicket, TerminalRoomManager } from './terminalRoomManager'

type ArtifactMap = Map<string, Map<string, string>>
type RunControlSignal = 'break' | 'continue' | 'finish'
type PendingInputResult = { kind: 'submitted'; value: string } | { kind: 'cancelled' }
type PendingInput = {
  invocationId: string
  prompt: string
  defaultText: string
  draft: string
  inputRevision: number
  resolve: (result: PendingInputResult) => void
}

type LiveRun = {
  runId: string
  roomId: string
  roomGeneration: string
  recordId: string
  recordRevision: number
  runtimeRevision: number
  publishedEventSeq: number
  publishTimer: ReturnType<typeof setTimeout> | null
  definition: MacroDefinitionV3
  bindings: Map<number, FrozenTerminalBinding>
  status: MacroRunnerSnapshot['status']
  currentNodeId: string | null
  error: string | null
  abortController: AbortController
  pauseWaiters: Array<() => void>
  pendingInput: PendingInput | null
  artifacts: ArtifactMap
  templateBindings: TextListTemplateBinding[]
  parallelProgress: Map<string, number>
  parallelOutputs: Map<string, string>
  agentEventBaselines: Map<string, number>
  consumedAgentEventIds: Set<string>
  terminalized: boolean
  cooperativeCheckpointCount: number
}

class FlowSignal extends Error { constructor(readonly signal: RunControlSignal) { super(signal) } }

const COOPERATIVE_CHECKPOINT_BUDGET = 64

export class MacroRunnerService {
  private readonly runs = new Map<string, LiveRun>()
  private readonly runtimeRevisions = new Map<string, number>()

  constructor(
    private readonly manager: TerminalRoomManager,
    private readonly records: MacroRecordStore<MacroDefinitionV3>,
    private readonly runStore: MacroRunStore,
    private readonly notificationService: NotificationDispatcher,
    private readonly agentEvents: AgentEventStore,
  ) {}

  hasActiveRun(roomId: string, roomGeneration: string): boolean {
    const run = this.runs.get(roomId)
    return Boolean(run && run.roomGeneration === roomGeneration && ['starting', 'running', 'paused', 'waiting_input', 'stopping'].includes(run.status))
  }

  snapshot(roomId: string): MacroRunnerSnapshot {
    const room = this.manager.roomSummaryById(roomId)
    const run = this.runs.get(roomId)
    if (!run || run.roomGeneration !== room.roomGeneration) {
      return idleSnapshot(room.roomId, room.roomGeneration, this.runtimeRevisions.get(room.roomId) ?? 0)
    }
    return {
      roomId: run.roomId,
      roomGeneration: run.roomGeneration,
      runtimeRevision: run.runtimeRevision,
      runId: run.runId,
      runningMacro: {
        recordId: run.recordId,
        recordRevision: run.recordRevision,
        definition: structuredClone(run.definition),
      },
      status: run.status,
      currentNodeId: run.currentNodeId,
      error: run.error,
      runtimeInput: run.pendingInput ? {
        invocationId: run.pendingInput.invocationId,
        prompt: run.pendingInput.prompt,
        defaultText: run.pendingInput.defaultText,
        draft: run.pendingInput.draft,
        inputRevision: run.pendingInput.inputRevision,
        status: 'waiting',
      } : null,
      ...this.runStore.readEventWindow(run.runId),
    }
  }

  traces(roomId: string): MacroRunTrace[] { return this.runStore.listTracesForRoom(roomId) }

  async start(
    ticket: RoomControlledOperationTicket,
    templateId: string,
    expectedMacroRevision: number,
    expectedTerminalStructureRevision: number,
  ): Promise<MacroRunnerSnapshot> {
    if (!Number.isInteger(expectedMacroRevision) || expectedMacroRevision < 1) throw new Error('invalid_macro_revision')
    const existing = this.runs.get(ticket.roomId)
    if (existing && ['starting', 'running', 'paused', 'waiting_input', 'stopping'].includes(existing.status)) throw new Error('run_already_active')
    if (this.manager.terminalStructureRevision(ticket.roomId) !== expectedTerminalStructureRevision) throw new Error('terminal_structure_revision_conflict')
    const record = this.records.read(templateId) as MacroRecord
    if (record.revision !== expectedMacroRevision) throw new Error('macro_revision_conflict')
    const validated = validateMacroDefinitionV3(record.definition)
    if (!validated.ok) throw new Error('invalid_macro_definition')
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
      const hash = macroDefinitionHash(definition)
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
      catch { throw new Error('run_manifest_write_failed') }
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
      const live: LiveRun = {
        runId,
        roomId: room.roomId,
        roomGeneration: room.roomGeneration,
        recordId: record.id,
        recordRevision: record.revision,
        runtimeRevision: this.nextRuntimeRevision(room.roomId),
        publishedEventSeq: 0,
        publishTimer: null,
        definition,
        bindings: new Map(bindings.map((binding) => [binding.index, binding])),
        status: 'running',
        currentNodeId: null,
        error: null,
        abortController: new AbortController(),
        pauseWaiters: [],
        pendingInput: null,
        artifacts: new Map(),
        templateBindings: [],
        parallelProgress: new Map(),
        parallelOutputs: new Map(),
        agentEventBaselines: new Map(),
        consumedAgentEventIds: new Set(),
        terminalized: false,
        cooperativeCheckpointCount: 0,
      }
      this.initializeAgentEventBaselines(live)
      this.runs.set(room.roomId, live)
      this.publishSnapshot(live)
      queueMicrotask(() => void this.execute(live))
      return this.snapshot(room.roomId)
    } catch (error) {
      if (started) {
        try { this.runStore.append(runId, 'run_failed', { code: startFailureEvidenceCode(error) }) } catch {}
      } else this.runStore.removeUnstarted(runId)
      if (structureLocked) this.manager.releaseRunStructureLock(ticket.roomId, runId)
      throw error
    }
  }

  pause(roomId: string): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    if (run.status !== 'running') throw new Error('run_not_running')
    this.appendEvent(run, 'run_paused')
    run.status = 'paused'
    return this.snapshot(roomId)
  }

  resume(roomId: string): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    if (run.status !== 'paused') throw new Error('run_not_paused')
    this.appendEvent(run, 'run_resumed')
    run.status = 'running'
    for (const resolve of run.pauseWaiters.splice(0)) resolve()
    return this.snapshot(roomId)
  }

  stop(roomId: string): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    try { this.appendEvent(run, 'run_stopping') }
    catch { run.error = 'run_event_append_failed' }
    run.status = 'stopping'
    run.abortController.abort()
    for (const resolve of run.pauseWaiters.splice(0)) resolve()
    this.cancelPendingInput(run)
    this.bumpAndPublish(run)
    return this.snapshot(roomId)
  }

  updateInputDraft(roomId: string, invocationId: string, value: string, expectedInputRevision: number): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    const pending = this.assertPendingInput(run, invocationId, expectedInputRevision)
    pending.draft = value
    pending.inputRevision += 1
    this.bumpAndPublish(run)
    return this.snapshot(roomId)
  }

  submitInput(roomId: string, invocationId: string, value: string, expectedInputRevision: number): MacroRunnerSnapshot {
    const run = this.activeRun(roomId)
    const pending = this.assertPendingInput(run, invocationId, expectedInputRevision)
    const nextInputRevision = pending.inputRevision + 1
    this.appendEvent(run, 'runner_input_submitted', {
      invocationId,
      inputRevision: nextInputRevision,
      chars: value.length,
    })
    pending.draft = value
    pending.inputRevision = nextInputRevision
    run.pendingInput = null
    run.status = 'running'
    pending.resolve({ kind: 'submitted', value })
    return this.snapshot(roomId)
  }

  destroyRoom(roomId: string, roomGeneration: string): void {
    const run = this.runs.get(roomId)
    if (!run || run.roomGeneration !== roomGeneration) return
    run.abortController.abort()
    for (const resolve of run.pauseWaiters.splice(0)) resolve()
    this.cancelPendingInput(run)
    try { this.finish(run, 'failed', 'run_failed', { code: 'room_destroyed' }, 'room_destroyed') } catch {}
    if (run.publishTimer) clearTimeout(run.publishTimer)
    this.runs.delete(roomId)
    this.runtimeRevisions.delete(roomId)
  }

  private async execute(run: LiveRun): Promise<void> {
    try {
      await this.executeNodes(run, run.definition.body)
      if (run.abortController.signal.aborted) throw new Error('run_stopped')
      this.finish(run, 'completed', 'run_completed', {})
    } catch (error) {
      if (run.terminalized) return
      if (run.abortController.signal.aborted || errorMessage(error) === 'run_stopped') this.finish(run, 'stopped', 'run_stopped', {})
      else if (error instanceof FlowSignal && error.signal === 'finish') this.finish(run, 'completed', 'run_completed', { reason: 'finish' })
      else this.finish(run, 'failed', 'run_failed', { code: errorMessage(error) }, errorMessage(error))
    }
  }

  private finish(run: LiveRun, status: 'completed' | 'failed' | 'stopped', event: string, data: Record<string, unknown>, error: string | null = null): void {
    if (run.terminalized) return
    try {
      this.runStore.append(run.runId, event, data)
      run.terminalized = true
      run.status = status
      run.currentNodeId = null
      run.error = error
      run.pendingInput = null
      this.bumpAndPublish(run)
    } catch {
      run.terminalized = true
      run.status = 'failed'
      run.currentNodeId = null
      run.error = 'run_event_append_failed'
      this.cancelPendingInput(run)
      this.bumpAndPublish(run)
    } finally { this.manager.releaseRunStructureLock(run.roomId, run.runId) }
  }

  private async executeNodes(run: LiveRun, nodes: FlowV2Node[]): Promise<void> {
    for (const node of nodes) {
      await this.checkpoint(run)
      run.currentNodeId = node.id
      this.appendEvent(run, 'step_started', { stepId: node.id, type: node.type })
      try {
        await this.executeNode(run, node)
        this.appendEvent(run, 'step_completed', { stepId: node.id, type: node.type })
      } catch (error) {
        if (!run.terminalized && !(error instanceof FlowSignal) && !isRunCancellation(run, error)) {
          this.appendEvent(run, 'step_failed', { stepId: node.id, type: node.type, code: errorMessage(error) })
        }
        throw error
      }
    }
  }

  private async executeNode(run: LiveRun, node: FlowV2Node): Promise<void> {
    if (node.type === 'send') {
      this.send(run, node.terminalIndex, this.renderMessage(run, node.message), node.delivery, node.ending, node.id)
      return
    }
    if (node.type === 'input') {
      const prompt = this.renderScalar(run, node.prompt)
      const defaultText = node.defaultSource ? this.artifact(run, node.defaultSource) : ''
      const value = await this.waitForInput(run, prompt, defaultText)
      if (!node.allowEmpty && value.length === 0) throw new Error('runner_input_empty')
      this.send(run, node.terminalIndex, value, node.delivery, node.ending, node.id)
      return
    }
    if (node.type === 'notify') {
      const title = this.renderScalar(run, node.title)
      const message = this.renderMessage(run, node.message)
      const notificationId = createGeneratedId('notification')
      const createdAt = new Date().toISOString()
      const messageArtifactRef = this.writeSupplementalArtifact(run, node.id, 'notification_message', 'notification-message', message)
      const browserChannels = node.channels.filter((channel): channel is Extract<typeof channel, { kind: 'app' | 'system' }> => channel.kind === 'app' || channel.kind === 'system')
      this.appendEvent(run, 'notification_requested', { stepId: node.id, notificationId, createdAt, level: node.level, title, messageArtifactRef, channels: node.channels, onFailure: node.onFailure })
      if (browserChannels.length > 0) {
        this.manager.broadcastRoomMessage(run.roomId, {
          type: 'macro_notification', roomId: run.roomId, roomGeneration: run.roomGeneration,
          runId: run.runId, stepId: node.id, notificationId, createdAt, level: node.level, title, message, channels: browserChannels,
        })
      }
      const failures: string[] = []
      for (const channel of node.channels) if (channel.kind === 'telegram') {
        const result = await this.notificationService.sendTelegram({ profileId: channel.profileId, title, message, level: node.level, notificationId, createdAt, runId: run.runId, stepId: node.id })
        await this.checkpoint(run)
        if (result.ok) this.appendEvent(run, 'notification_delivered', { stepId: node.id, notificationId, channel: { kind: 'telegram', profileId: channel.profileId }, status: result.status })
        else {
          failures.push(result.code)
          this.appendEvent(run, 'notification_failed', { stepId: node.id, notificationId, channel: { kind: 'telegram', profileId: channel.profileId }, code: result.code, status: result.status ?? null, message: result.message })
        }
      }
      if (failures.length > 0 && node.onFailure === 'fail') throw new Error('notification_failed:' + failures.join(','))
      if (failures.length > 0 && node.onFailure === 'pause') await this.pauseRun(run, 'notification_failed:' + failures.join(','), node.id)
      return
    }
    if (node.type === 'wait') {
      if (node.mode === 'duration') await this.waitDuration(run, node.durationMs)
      else if (node.mode === 'user-continue') await this.waitForInput(run, this.renderScalar(run, node.prompt))
      else await this.waitQuiet(run, node.terminalIndex, node.quietMs, node.maxMs, node.onTimeout)
      return
    }
    if (node.type === 'capture-source') {
      const captured = await this.capture(run, node.id, node.capture)
      this.persistArtifact(run, node.id, 'captured_text', captured.text, 'capture', captured.data)
      return
    }
    if (node.type === 'extract_text') {
      const output = extractText(this.artifact(run, node.source), node)
      this.persistArtifact(run, node.id, 'extracted_text', output, 'extract-text', { empty: output.length === 0 })
      if (output.length === 0) {
        if (node.onEmpty === 'fail') throw new Error('extract_text_empty')
        if (node.onEmpty === 'finish') throw new FlowSignal('finish')
        if (node.onEmpty === 'pause') await this.pauseRun(run, 'extract_text_empty', node.id)
      }
      return
    }
    if (node.type === 'parallel') {
      const sections = await this.executeParallel(run, node)
      const merged = sections
        .filter((value) => node.merge.includeEmptyOutputs || value.text.length > 0)
        .map((value) => node.merge.separator
          .replaceAll('{laneId}', value.laneId)
          .replaceAll('{laneLabel}', value.label)
          .replaceAll('{terminalIndex}', String(value.terminalIndex)) + value.text)
        .join('\n\n')
      this.persistArtifact(run, node.id, 'merged_text', merged, 'parallel-merged', { laneIds: sections.map((section) => section.laneId) })
      return
    }
    if (node.type === 'if') {
      const branch = node.branches.find((candidate) => matchesCondition(this.artifact(run, candidate.condition.source), candidate.condition))
      if (branch) await this.executeNodes(run, branch.body)
      else if (node.else) await this.executeNodes(run, node.else)
      return
    }
    if (node.type === 'for') {
      if (node.range.kind === 'count') {
        for (let index = 1; index <= node.range.count; index += 1) if (!(await this.executeLoopBody(run, node.body))) break
      } else if (node.range.kind === 'forever') {
        while (await this.executeLoopBody(run, node.body)) await this.checkpoint(run)
      } else {
        for (const [offset, item] of node.range.items.entries()) {
          run.templateBindings.push({ index: offset + 1, key: item.key, value: item.value, forStepId: node.id })
          try { if (!(await this.executeLoopBody(run, node.body))) break }
          finally { run.templateBindings.pop() }
        }
      }
      return
    }
    if (node.type === 'break') {
      if (node.body) await this.executeNodes(run, node.body)
      throw new FlowSignal('break')
    }
    if (node.type === 'continue') {
      if (node.body) await this.executeNodes(run, node.body)
      throw new FlowSignal('continue')
    }
    if (node.body) await this.executeNodes(run, node.body)
    throw new FlowSignal('finish')
  }

  private async executeLoopBody(run: LiveRun, body: FlowV2Node[]): Promise<boolean> {
    try { await this.executeNodes(run, body); return true }
    catch (error) {
      if (error instanceof FlowSignal && error.signal === 'continue') return true
      if (error instanceof FlowSignal && error.signal === 'break') return false
      throw error
    }
  }

  private async executeParallel(run: LiveRun, node: Extract<FlowV2Node, { type: 'parallel' }>): Promise<Array<{ laneId: string; label: string; terminalIndex: number; text: string }>> {
    while (true) {
      const settled = await Promise.all(node.lanes.map(async (lane) => {
        try { return { ok: true as const, value: await this.executeLane(run, node.id, lane) } }
        catch (error) { return { ok: false as const, laneId: lane.id, error } }
      }))
      const failed = settled.find((result) => !result.ok)
      if (!failed) {
        const values = settled.map((result) => (result as Extract<typeof result, { ok: true }>).value)
        for (const lane of node.lanes) {
          run.parallelProgress.delete(`${node.id}:${lane.id}`)
          run.parallelOutputs.delete(`${node.id}:${lane.id}`)
        }
        return values
      }
      const code = `parallel_lane_failed:${failed.laneId}:${errorMessage(failed.error)}`
      if (node.onLaneFail === 'fail') throw new Error(code)
      await this.pauseRun(run, code, node.id)
    }
  }

  private async executeLane(run: LiveRun, parallelId: string, lane: ParallelLane): Promise<{ laneId: string; label: string; terminalIndex: number; text: string }> {
    const progressKey = `${parallelId}:${lane.id}`
    let index = run.parallelProgress.get(progressKey) ?? 0
    while (index < lane.body.length) {
      await this.checkpoint(run)
      const node = lane.body[index]
      if (node.type === 'output') {
        run.parallelOutputs.set(progressKey, node.source.kind === 'none' ? '' : this.artifact(run, node.source))
        index += 1
        run.parallelProgress.set(progressKey, index)
        continue
      }
      const inherited = { ...node } as Record<string, unknown>
      if (node.type === 'send' || (node.type === 'wait' && node.mode === 'terminal-quiet')) inherited.terminalIndex = lane.terminalIndex
      if (node.type === 'capture-source') inherited.capture = { ...node.capture, terminalIndex: lane.terminalIndex }
      run.currentNodeId = node.id
      this.appendEvent(run, 'step_started', { stepId: node.id, type: node.type, parallelId, laneId: lane.id })
      try {
        await this.executeNode(run, inherited as unknown as FlowV2Node)
        this.appendEvent(run, 'step_completed', { stepId: node.id, type: node.type, parallelId, laneId: lane.id })
        index += 1
        run.parallelProgress.set(progressKey, index)
      } catch (error) {
        if (!run.terminalized && !(error instanceof FlowSignal) && !isRunCancellation(run, error)) {
          this.appendEvent(run, 'step_failed', { stepId: node.id, type: node.type, parallelId, laneId: lane.id, code: errorMessage(error) })
        }
        throw error
      }
    }
    return { laneId: lane.id, label: lane.label, terminalIndex: lane.terminalIndex, text: run.parallelOutputs.get(progressKey) ?? '' }
  }

  private send(run: LiveRun, terminalIndex: number, content: string, delivery: 'auto' | 'direct' | 'bracketed-paste', ending: 'none' | 'lf' | 'cr' | 'crlf', stepId: string): void {
    if (run.terminalized || run.abortController.signal.aborted) throw new Error('run_stopped')
    const binding = this.binding(run, terminalIndex)
    const resolved = resolveTerminalInputDelivery(delivery, binding.type)
    const payload = buildTerminalInputPayload(content, resolved, ending)
    if (!payload.ok) throw new Error(payload.reason)
    const result = this.manager.input(run.roomId, binding.terminalId, payload.payload)
    if (!result.ok) throw new Error('frozen_terminal_not_ready')
    const currentTerminalIndex = this.manager.indexMap(run.roomId).find((item) => item.terminalId === binding.terminalId)?.index ?? null
    this.appendEvent(run, 'terminal_input_sent', { stepId, configuredTerminalIndex: terminalIndex, currentTerminalIndex, terminalId: binding.terminalId, launchId: binding.launchId, requestedDelivery: delivery, resolvedDelivery: resolved, ending })
  }

  private async capture(run: LiveRun, stepId: string, capture: CaptureSourceConfig): Promise<{ text: string; data: Record<string, unknown> }> {
    const binding = this.binding(run, capture.terminalIndex)
    const currentTerminalIndex = this.manager.indexMap(run.roomId).find((item) => item.terminalId === binding.terminalId)?.index ?? null
    if (capture.kind === 'agent-event') {
      const captured = await this.waitForAgentEventCapture(run, stepId, binding, capture.captureMode)
      const rawArtifactRef = this.writeSupplementalArtifact(run, stepId, 'agent_event_raw', 'agent-event-raw', JSON.stringify(captured.raw, null, 2) + '\n', 'json')
      return {
        text: captured.text,
        data: { captureKind: capture.kind, captureMode: capture.captureMode, configuredTerminalIndex: capture.terminalIndex, currentTerminalIndex, terminalId: binding.terminalId, launchId: binding.launchId, rawArtifactRef, agentEventIds: captured.events.map((event) => event.eventId) },
      }
    }
    const snapshot = this.manager.terminalSnapshot(this.manager.resolveTerminal(run.roomId, binding.terminalId))
    const text = snapshot.replay.join('')
    if (capture.kind === 'text-box') return { text, data: { captureKind: capture.kind, configuredTerminalIndex: capture.terminalIndex, currentTerminalIndex, terminalId: binding.terminalId, launchId: binding.launchId } }
    const captured = captureTerminalBuffer({ replay: snapshot.replay, maxChars: capture.maxChars })
    const rawArtifactRef = this.writeSupplementalArtifact(run, stepId, 'terminal_buffer_raw', 'capture-raw', captured.rawText)
    const normalizedArtifactRef = this.writeSupplementalArtifact(run, stepId, 'terminal_buffer_normalized', 'capture-normalized', captured.normalizedText)
    return {
      text: capture.mode === 'raw-stream-tail' ? captured.rawText : captured.normalizedText,
      data: {
        captureKind: capture.kind, mode: capture.mode, maxChars: capture.maxChars,
        configuredTerminalIndex: capture.terminalIndex, currentTerminalIndex, terminalId: binding.terminalId, launchId: binding.launchId,
        rawArtifactRef, normalizedArtifactRef, truncated: captured.truncated, rawCharsBeforeTail: captured.rawCharsBeforeTail,
        capturedChars: captured.capturedChars, strippedAnsi: captured.strippedAnsi,
      },
    }
  }

  private binding(run: LiveRun, index: number): FrozenTerminalBinding {
    const binding = run.bindings.get(index)
    if (!binding) throw new Error('frozen_terminal_binding_missing')
    if (!this.manager.hasTerminalLaunch(run.roomId, run.roomGeneration, binding.terminalId, binding.launchId)) throw new Error('frozen_terminal_launch_lost')
    return binding
  }

  private renderMessage(run: LiveRun, message: MessageSpec): string {
    return message.parts.map((part) => {
      if (part.kind === 'text') return part.text
      if (part.kind === 'template') return renderScopedTemplate(part.template, run.templateBindings.at(-1))
      return part.source ? this.artifact(run, part.source) : ''
    }).join('')
  }

  private renderScalar(run: LiveRun, value: TemplatableScalarText): string { return renderTemplatableScalar(value, run.templateBindings.at(-1)) }

  private artifact(run: LiveRun, source: FlowV2ArtifactSource): string {
    const value = run.artifacts.get(source.stepId)?.get(source.artifact)
    if (value === undefined) throw new Error('artifact_not_found')
    return value
  }

  private setArtifact(run: LiveRun, stepId: string, name: string, value: string): void {
    const outputs = run.artifacts.get(stepId) ?? new Map<string, string>()
    outputs.set(name, value)
    run.artifacts.set(stepId, outputs)
  }

  private persistArtifact(run: LiveRun, stepId: string, name: string, value: string, prefix: string, data: Record<string, unknown> = {}): string {
    const artifactRef = this.runStore.writeArtifact(run.runId, prefix, value)
    this.setArtifact(run, stepId, name, value)
    this.appendEvent(run, 'artifact_created', { stepId, artifact: name, artifactRef, chars: value.length, ...data })
    return artifactRef
  }

  private writeSupplementalArtifact(run: LiveRun, stepId: string, artifact: string, prefix: string, value: string, extension = 'txt'): string {
    const artifactRef = this.runStore.writeArtifact(run.runId, prefix, value, extension)
    this.appendEvent(run, 'artifact_created', { stepId, artifact, artifactRef, chars: value.length })
    return artifactRef
  }

  private async pauseRun(run: LiveRun, reason: string, stepId: string): Promise<void> {
    if (run.status !== 'paused') {
      run.status = 'paused'
      this.appendEvent(run, 'run_paused', { reason, stepId })
    }
    await this.checkpoint(run)
  }

  private async checkpoint(run: LiveRun): Promise<void> {
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

  private async waitWhilePaused(run: LiveRun): Promise<void> {
    while (run.status === 'paused') await new Promise<void>((resolve) => run.pauseWaiters.push(resolve))
  }

  private async waitDuration(run: LiveRun, durationMs: number): Promise<void> {
    let remaining = durationMs
    while (remaining > 0) {
      await this.checkpoint(run)
      const slice = Math.min(remaining, 50)
      await abortableDelay(slice, run.abortController.signal)
      remaining -= slice
    }
  }

  private async waitQuiet(run: LiveRun, terminalIndex: number, quietMs: number, maxMs: number, onTimeout: 'pause' | 'fail' | 'finish' | 'continue'): Promise<void> {
    const binding = this.binding(run, terminalIndex)
    let previous = this.manager.terminalOutputActivityRevision(run.roomId, run.roomGeneration, binding.terminalId, binding.launchId)
    let quiet = 0
    let elapsed = 0
    while (elapsed < maxMs) {
      const slice = Math.min(50, maxMs - elapsed)
      await this.waitDuration(run, slice)
      elapsed += slice
      const revision = this.manager.terminalOutputActivityRevision(run.roomId, run.roomGeneration, binding.terminalId, binding.launchId)
      quiet = revision === previous ? quiet + slice : 0
      previous = revision
      if (quiet >= quietMs) return
    }
    if (onTimeout === 'continue') return
    if (onTimeout === 'finish') throw new FlowSignal('finish')
    if (onTimeout === 'pause') { await this.pauseRun(run, 'terminal_quiet_timeout', run.currentNodeId ?? ''); return }
    throw new Error('terminal_quiet_timeout')
  }

  private initializeAgentEventBaselines(run: LiveRun): void {
    for (const target of this.agentCaptureTargets(run.definition.body)) {
      const binding = run.bindings.get(target.terminalIndex)
      if (!binding) continue
      for (const eventKind of agentEventKinds(target.captureMode)) {
        const match = this.agentEventMatch(run, binding, eventKind)
        run.agentEventBaselines.set(agentEventBaselineKey(target.stepId, eventKind), this.agentEvents.countMatching(match))
      }
    }
  }

  private agentCaptureTargets(nodes: FlowV2Node[]): Array<{ stepId: string; terminalIndex: number; captureMode: 'result_only' | 'prompt_only' | 'prompt_and_result' }> {
    const targets: Array<{ stepId: string; terminalIndex: number; captureMode: 'result_only' | 'prompt_only' | 'prompt_and_result' }> = []
    for (const node of nodes) {
      if (node.type === 'capture-source' && node.capture.kind === 'agent-event') targets.push({ stepId: node.id, terminalIndex: node.capture.terminalIndex, captureMode: node.capture.captureMode })
      if (node.type === 'if') {
        for (const branch of node.branches) targets.push(...this.agentCaptureTargets(branch.body))
        if (node.else) targets.push(...this.agentCaptureTargets(node.else))
      }
      if (node.type === 'for') targets.push(...this.agentCaptureTargets(node.body))
      if (node.type === 'parallel') for (const lane of node.lanes) for (const item of lane.body) {
        if (item.type === 'capture-source' && item.capture.kind === 'agent-event') targets.push({ stepId: item.id, terminalIndex: lane.terminalIndex, captureMode: item.capture.captureMode })
      }
      if ((node.type === 'break' || node.type === 'continue' || node.type === 'finish') && node.body) targets.push(...this.agentCaptureTargets(node.body))
    }
    return targets
  }

  private async waitForAgentEventCapture(run: LiveRun, stepId: string, binding: FrozenTerminalBinding, captureMode: 'result_only' | 'prompt_only' | 'prompt_and_result'): Promise<{ text: string; raw: unknown; events: AgentEvent[] }> {
    const timeoutMs = positiveTimeout(process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS, 600_000)
    let remaining = timeoutMs
    while (remaining > 0) {
      await this.checkpoint(run)
      const captured = this.agentEventsForCapture(run, stepId, binding, captureMode)
      if (captured) {
        for (const event of captured.events) run.consumedAgentEventIds.add(event.eventId)
        return captured
      }
      const slice = Math.min(100, remaining)
      await abortableDelay(slice, run.abortController.signal)
      remaining -= slice
    }
    throw new Error('agent_event_not_ready:' + binding.terminalId)
  }

  private agentEventsForCapture(run: LiveRun, stepId: string, binding: FrozenTerminalBinding, captureMode: 'result_only' | 'prompt_only' | 'prompt_and_result'): { text: string; raw: unknown; events: AgentEvent[] } | undefined {
    if (captureMode !== 'prompt_and_result') {
      const eventKind = captureMode === 'prompt_only' ? 'agent.prompt_submitted' : 'agent.output'
      const match = this.agentEventMatch(run, binding, eventKind)
      const event = this.agentEvents.nextMatching(match, run.agentEventBaselines.get(agentEventBaselineKey(stepId, eventKind)) ?? 0, run.consumedAgentEventIds)
      return event ? { text: event.capturedText ?? '', raw: event, events: [event] } : undefined
    }
    const promptKind = 'agent.prompt_submitted' as const
    const outputKind = 'agent.output' as const
    const prompts = this.agentEvents.matching(this.agentEventMatch(run, binding, promptKind)).slice(run.agentEventBaselines.get(agentEventBaselineKey(stepId, promptKind)) ?? 0).filter((event) => !run.consumedAgentEventIds.has(event.eventId))
    const outputs = this.agentEvents.matching(this.agentEventMatch(run, binding, outputKind)).slice(run.agentEventBaselines.get(agentEventBaselineKey(stepId, outputKind)) ?? 0).filter((event) => !run.consumedAgentEventIds.has(event.eventId))
    for (const prompt of prompts) {
      const output = outputs.find((candidate) => candidate.agentSessionId === prompt.agentSessionId && candidate.agentTurnId && candidate.agentTurnId === prompt.agentTurnId)
      if (!output) continue
      return { text: `===== user prompt =====\n${prompt.capturedText ?? ''}\n\n===== assistant result =====\n${output.capturedText ?? ''}`, raw: { promptEvent: prompt, outputEvent: output }, events: [prompt, output] }
    }
    return undefined
  }

  private agentEventMatch(run: LiveRun, binding: FrozenTerminalBinding, eventKind: 'agent.prompt_submitted' | 'agent.output'): AgentEventMatch {
    return {
      serverInstanceId: this.manager.serverInstanceId, roomId: run.roomId, roomGeneration: run.roomGeneration,
      terminalId: binding.terminalId, launchId: binding.launchId, agentKind: 'codex', eventKind,
      adapter: eventKind === 'agent.output' ? 'codex-stop-hook' : 'codex-user-prompt-submit-hook',
    }
  }

  private async waitForInput(run: LiveRun, prompt: string, defaultText = ''): Promise<string> {
    if (run.pendingInput) throw new Error('runner_input_already_pending')
    run.status = 'waiting_input'
    const result = await new Promise<PendingInputResult>((resolve) => {
      const invocationId = createGeneratedId('runnerInput')
      run.pendingInput = { invocationId, prompt, defaultText, draft: defaultText, inputRevision: 0, resolve }
      this.appendEvent(run, 'runner_input_requested', {
        invocationId,
        inputRevision: 0,
        hasDefaultText: defaultText.length > 0,
        promptChars: prompt.length,
      })
    })
    if (result.kind === 'cancelled') throw new Error('run_stopped')
    return result.value
  }

  private cancelPendingInput(run: LiveRun): void {
    const pending = run.pendingInput
    run.pendingInput = null
    pending?.resolve({ kind: 'cancelled' })
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

  private appendEvent(run: LiveRun, kind: string, data: Record<string, unknown> = {}): void {
    if (run.terminalized) return
    this.runStore.append(run.runId, kind, data)
    this.bumpAndPublish(run)
  }

  private bumpAndPublish(run: LiveRun): void {
    if (this.runs.get(run.roomId) !== run) return
    run.runtimeRevision = this.nextRuntimeRevision(run.roomId)
    this.schedulePublish(run)
  }

  private nextRuntimeRevision(roomId: string): number {
    const revision = (this.runtimeRevisions.get(roomId) ?? 0) + 1
    this.runtimeRevisions.set(roomId, revision)
    return revision
  }

  private publishSnapshot(run: LiveRun): void {
    try {
      const room = this.manager.roomSummaryById(run.roomId)
      if (room.roomGeneration !== run.roomGeneration || this.runs.get(run.roomId) !== run) return
      const snapshot = this.snapshot(run.roomId)
      const canSendDelta = run.publishedEventSeq >= snapshot.firstAvailableEventSeq - 1
      if (!canSendDelta) {
        this.manager.broadcastRoomMessage(run.roomId, { type: 'runner_snapshot', snapshot })
      } else {
        const delta: MacroRunnerDelta = {
          ...snapshot,
          events: snapshot.events.filter((event) => event.eventSeq > run.publishedEventSeq),
        }
        this.manager.broadcastRoomMessage(run.roomId, { type: 'runner_delta', delta })
      }
      run.publishedEventSeq = snapshot.lastEventSeq
    } catch {
      // Destroy closes mutation admission and owns final client teardown.
    }
  }

  private schedulePublish(run: LiveRun): void {
    if (run.publishTimer) return
    run.publishTimer = setTimeout(() => {
      run.publishTimer = null
      this.publishSnapshot(run)
    }, 25)
    run.publishTimer.unref?.()
  }

  private activeRun(roomId: string): LiveRun {
    const run = this.runs.get(roomId)
    if (!run || !['starting', 'running', 'paused', 'waiting_input', 'stopping'].includes(run.status)) throw new Error('run_not_active')
    return run
  }
}

function idleSnapshot(roomId: string, roomGeneration: string, runtimeRevision: number): MacroRunnerSnapshot {
  return {
    roomId,
    roomGeneration,
    runtimeRevision,
    runId: null,
    runningMacro: null,
    status: 'idle',
    currentNodeId: null,
    error: null,
    runtimeInput: null,
    events: [],
    firstAvailableEventSeq: 0,
    lastEventSeq: 0,
    totalEventCount: 0,
    discardedEventCount: 0,
  }
}

function matchesCondition(text: string, condition: TextMatchCondition): boolean {
  const values = condition.scope.kind === 'whole' ? [text] : text.split(/\r?\n/).filter((line) => condition.scope.kind !== 'lines' || condition.scope.includeEmptyLines || line.length > 0)
  const matches = (value: string) => condition.matcher.kind === 'regex'
    ? new RegExp(condition.matcher.pattern, condition.matcher.flags).test(value)
    : simpleMatch(value, condition.matcher.op, condition.matcher.text)
  if (condition.scope.kind === 'whole') return matches(text)
  if (condition.scope.mode === 'first') return matches(values[0] ?? '')
  if (condition.scope.mode === 'last') return matches(values.at(-1) ?? '')
  if (condition.scope.mode === 'all') return values.every(matches)
  return values.some(matches)
}

function simpleMatch(value: string, op: string, expected: string): boolean {
  if (op === 'contains') return value.includes(expected)
  if (op === 'not_contains') return !value.includes(expected)
  if (op === 'equals') return value === expected
  if (op === 'not_equals') return value !== expected
  if (op === 'starts_with') return value.startsWith(expected)
  return value.endsWith(expected)
}

function extractText(input: string, node: Extract<FlowV2Node, { type: 'extract_text' }>): string {
  let values = node.split.kind === 'lines'
    ? input.split(/\r?\n/)
    : input.split(new RegExp(node.split.pattern, node.split.flags))
  if (!node.split.keepEmpty) values = values.filter(Boolean)
  for (const filter of node.filters) values = values.filter((value) => {
    const match = filter.matcher.kind === 'regex' ? new RegExp(filter.matcher.pattern, filter.matcher.flags).test(value) : simpleMatch(value, filter.matcher.op, filter.matcher.text)
    return filter.kind === 'include' ? match : !match
  })
  if (node.select.mode === 'index') {
    const selected = values.at(node.select.index)
    values = selected === undefined ? [] : [selected]
  }
  else if (node.select.mode === 'range') values = values.slice(node.select.start, node.select.end)
  let output = values.join('\n')
  if (node.extract.kind === 'regex') {
    const match = new RegExp(node.extract.pattern, node.extract.flags).exec(output)
    output = match ? String(match.groups?.[String(node.extract.group)] ?? match[Number(node.extract.group)] ?? '') : ''
  }
  if (node.trim === 'left' || node.trim === 'both') output = output.trimStart()
  if (node.trim === 'right' || node.trim === 'both') output = output.trimEnd()
  return output
}

function agentEventKinds(captureMode: 'result_only' | 'prompt_only' | 'prompt_and_result'): Array<'agent.prompt_submitted' | 'agent.output'> {
  if (captureMode === 'prompt_only') return ['agent.prompt_submitted']
  if (captureMode === 'prompt_and_result') return ['agent.prompt_submitted', 'agent.output']
  return ['agent.output']
}

function agentEventBaselineKey(stepId: string, eventKind: 'agent.prompt_submitted' | 'agent.output'): string { return `${stepId}|${eventKind}` }

function positiveTimeout(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function isRunCancellation(run: LiveRun, error: unknown): boolean {
  return run.abortController.signal.aborted || errorMessage(error) === 'run_stopped'
}

function startFailureEvidenceCode(error: unknown): string {
  const code = errorMessage(error)
  if (code.startsWith('room_control_')) return 'room_control_lost_during_start'
  if (code === 'room_destroying' || code === 'room_not_found') return 'room_destroyed_during_start'
  return 'run_bootstrap_failed'
}
