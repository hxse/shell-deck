import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingestAgentEvent } from '../../server/agentEventIngest'
import { MacroRunStore } from '../../server/macroRunStore'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { NotificationService } from '../../server/notificationService'
import { MacroRecordStore } from '../../server/sharedContentStore'
import { TerminalRoomManager } from '../../server/terminalRoomManager'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import type { CaptureWaitLimit, MacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import type { RoomControlGrant } from '../../src/lib/roomControl'
import { serviceTracesForRoom } from '../helpers/macroTrace'

test('unbounded AgentEvent capture waits for a matching output and Stop still cancels it', async () => {
  const first = await createHarness({ kind: 'unbounded' })
  try {
    await waitFor(() => first.runner.snapshot(first.roomId).currentNodeId === 'capture')
    await delay(150)
    expect(first.runner.snapshot(first.roomId)).toMatchObject({ status: 'running', currentNodeId: 'capture' })
    expect(ingestAgentEvent(agentOutput(first, 'turn-one'), 'token', ingestOptions(first))).toMatchObject({ ok: true })
    await waitFor(() => first.runner.snapshot(first.roomId).status === 'completed')
    expect(first.runner.snapshot(first.roomId).error).toBeNull()
  } finally { await first.dispose() }

  const second = await createHarness({ kind: 'unbounded' })
  try {
    await waitFor(() => second.runner.snapshot(second.roomId).currentNodeId === 'capture')
    second.runner.stop(second.roomId)
    await waitFor(() => second.runner.snapshot(second.roomId).status === 'stopped')
    expect(second.manager.roomSnapshot(second.roomId).terminalStructureLocked).toBe(false)
  } finally { await second.dispose() }
})

test('explicit AgentEvent timeout fails once and a late output is baseline-isolated from the next run', async () => {
  const harness = await createHarness({ kind: 'timeout', timeoutMs: 30 })
  try {
    await waitFor(() => harness.runner.snapshot(harness.roomId).status === 'failed')
    expect(harness.runner.snapshot(harness.roomId).error).toBe('agent_event_capture_timeout:' + harness.terminalId)
    expect(serviceTracesForRoom(harness.runner, harness.roomId)[0].events.filter((event) => event.kind === 'run_failed')).toHaveLength(1)
    expect(ingestAgentEvent(agentOutput(harness, 'late-turn'), 'token', ingestOptions(harness))).toMatchObject({ ok: true })

    const nextRecord = await harness.records.create(definition({ kind: 'unbounded' }))
    const ticket = harness.manager.admitControlledBearer(harness.grant, harness.roomId)
    await harness.runner.start(ticket, nextRecord.id, nextRecord.revision, harness.manager.terminalStructureRevision(harness.roomId))
    ticket.finish()
    await waitFor(() => harness.runner.snapshot(harness.roomId).currentNodeId === 'capture')
    await delay(150)
    expect(harness.runner.snapshot(harness.roomId).status).toBe('running')
    expect(ingestAgentEvent(agentOutput(harness, 'fresh-turn'), 'token', ingestOptions(harness))).toMatchObject({ ok: true })
    await waitFor(() => harness.runner.snapshot(harness.roomId).status === 'completed')
  } finally { await harness.dispose() }
})

test('AgentEvent timeout clock stops while the run is paused', async () => {
  const harness = await createHarness({ kind: 'timeout', timeoutMs: 80 })
  try {
    await waitFor(() => harness.runner.snapshot(harness.roomId).currentNodeId === 'capture')
    harness.runner.pause(harness.roomId)
    await delay(180)
    expect(harness.runner.snapshot(harness.roomId).status).toBe('paused')
    harness.runner.resume(harness.roomId)
    await waitFor(() => harness.runner.snapshot(harness.roomId).status === 'failed')
    expect(harness.runner.snapshot(harness.roomId).error).toBe('agent_event_capture_timeout:' + harness.terminalId)
  } finally { await harness.dispose() }
})

test('a pause and resume fully inside one polling slice is excluded from the timeout clock', async () => {
  const harness = await createHarness({ kind: 'timeout', timeoutMs: 400 })
  try {
    await waitFor(() => harness.runner.snapshot(harness.roomId).currentNodeId === 'capture')
    await delay(20)
    harness.runner.pause(harness.roomId)
    await delay(70)
    harness.runner.resume(harness.roomId)
    await delay(330)
    expect(harness.runner.snapshot(harness.roomId).status).toBe('running')
    await waitFor(() => harness.runner.snapshot(harness.roomId).status === 'failed')
    expect(harness.runner.snapshot(harness.roomId).error).toBe('agent_event_capture_timeout:' + harness.terminalId)
  } finally { await harness.dispose() }
})

test('a matching AgentEvent hook error fails immediately instead of leaving an unbounded capture stuck', async () => {
  const harness = await createHarness({ kind: 'unbounded' })
  try {
    await waitFor(() => harness.runner.snapshot(harness.roomId).currentNodeId === 'capture')
    expect(ingestAgentEvent(agentError(harness), 'token', ingestOptions(harness))).toMatchObject({ ok: true })
    await waitFor(() => harness.runner.snapshot(harness.roomId).status === 'failed')
    expect(harness.runner.snapshot(harness.roomId).error).toBe('agent_event_hook_error:' + harness.terminalId)
  } finally { await harness.dispose() }
})

async function createHarness(waitLimit: CaptureWaitLimit) {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-agent-wait-038-'))
  const manager = new TerminalRoomManager()
  const room = manager.createRoom()
  const terminal = manager.createTerminal(room.roomId, { backend: 'fake' })
  const grant = roomGrant(manager, room.roomId)
  const records = new MacroRecordStore<MacroDefinitionV5>(root)
  const agentEvents = new AgentEventStore(root)
  const runner = new MacroRunnerService(manager, records, new MacroRunStore(root), new NotificationService(root), agentEvents)
  const record = await records.create(definition(waitLimit))
  const ticket = manager.admitControlledBearer(grant, room.roomId)
  await runner.start(ticket, record.id, record.revision, manager.terminalStructureRevision(room.roomId))
  ticket.finish()
  return {
    root,
    manager,
    roomId: room.roomId,
    roomGeneration: room.roomGeneration,
    terminalId: terminal.terminalId,
    launchId: terminal.launchId,
    grant,
    records,
    agentEvents,
    runner,
    async dispose() {
      if (runner.hasActiveRun(room.roomId, room.roomGeneration)) {
        runner.stop(room.roomId)
        await waitFor(() => !runner.hasActiveRun(room.roomId, room.roomGeneration))
      }
      await manager.destroyAllRooms()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

function definition(waitLimit: CaptureWaitLimit): MacroDefinitionV5 {
  return {
    schemaVersion: 5,
    name: 'Agent wait',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [{
      id: 'capture',
      type: 'capture-source',
      capture: { kind: 'agent-event', terminal: { kind: 'terminal_index', index: 1 }, agent: { kind: 'codex' }, captureMode: 'result_only', waitLimit },
    }],
  }
}

function ingestOptions(harness: Awaited<ReturnType<typeof createHarness>>) {
  return { roomId: harness.roomId, expectedToken: 'token', manager: harness.manager, store: harness.agentEvents }
}

function agentOutput(harness: Awaited<ReturnType<typeof createHarness>>, turnId: string) {
  return {
    protocolVersion: 1 as const,
    agentKind: 'codex' as const,
    eventKind: 'agent.output' as const,
    roomGeneration: harness.roomGeneration,
    terminalId: harness.terminalId,
    launchId: harness.launchId,
    agentSessionId: 'session-a',
    agentTurnId: turnId,
    adapterMetadata: { adapter: 'codex-stop-hook' as const, codexSessionId: 'session-a' },
    capturedText: 'done:' + turnId,
    raw: { source: 'codex.Stop', payload: {} },
  }
}

function agentError(harness: Awaited<ReturnType<typeof createHarness>>) {
  return {
    protocolVersion: 1 as const,
    agentKind: 'codex' as const,
    eventKind: 'agent.error' as const,
    roomGeneration: harness.roomGeneration,
    terminalId: harness.terminalId,
    launchId: harness.launchId,
    agentSessionId: 'session-a',
    adapterMetadata: { adapter: 'codex-hook-error' as const, codexSessionId: 'session-a' },
    raw: { source: 'codex.hook_receiver_failed', payload: {} },
    error: 'synthetic_hook_failure',
  }
}

function roomGrant(manager: TerminalRoomManager, roomId: string): RoomControlGrant {
  const messages: ServerMessage[] = []
  manager.connectClient(roomId, (message) => messages.push(message))
  const grant = messages.find((message): message is Extract<ServerMessage, { type: 'room_control' }> => message.type === 'room_control')?.grant
  if (!grant) throw new Error('missing_room_control_grant')
  return grant
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('wait_timeout')
    await delay(5)
  }
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }
