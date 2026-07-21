import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShellDeckServer } from '../../server/httpServer'
import { EvidenceStore } from '../../server/evidenceStore'
import { FakeTerminalBackend } from '../../server/fakeTerminalBackend'
import { MacroRunStore } from '../../server/macroRunStore'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { NotificationService } from '../../server/notificationService'
import { MacroRecordStore } from '../../server/sharedContentStore'
import { TerminalRoomManager } from '../../server/terminalRoomManager'
import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from '../../server/terminalBackend'
import { publishPrivateFileDelete, writePrivateFileAtomic } from '../../server/userDataRoot'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { MacroDefinitionV5, MacroRecord } from '../../src/lib/macro/macroDefinitionTypes'
import type { MacroRunnerSnapshot, RunManifestV1 } from '../../src/lib/macro/runnerTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import { roomControlHeaders, type RoomControlGrant } from '../../src/lib/roomControl'

import { replayFromManager, roomGrant, StreamingTerminalBackend, waitFor } from './macroRuntime034.helpers'

test('terminal quiet observes output activity after the replay tail is full', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-quiet-revision-034-'))
  const manager = new TerminalRoomManager({
    replayByteLimit: 8,
    backendFactory: (_kind, options) => new StreamingTerminalBackend(options),
  })
  const records = new MacroRecordStore<MacroDefinitionV5>(root)
  const store = new MacroRunStore(root)
  const runner = new MacroRunnerService(manager, records, store, new NotificationService(root), new AgentEventStore(root))
  manager.addDestroyHook((roomId, roomGeneration) => runner.destroyRoom(roomId, roomGeneration))
  try {
    const room = manager.createRoom()
    manager.createTerminal(room.roomId, { backend: 'fake' })
    const grant = roomGrant(manager, room.roomId)
    const record = await records.create({
      schemaVersion: 5,
      name: 'quiet activity revision',
      description: '',
      terminalLayout: [{ index: 1, type: 'shell' }],
      body: [{ id: 'quiet', type: 'wait', mode: 'terminal-quiet', terminal: { kind: 'terminal_index', index: 1 }, quietMs: 100, maxMs: 400, onTimeout: 'finish' }],
    })
    const ticket = manager.admitControlledBearer(grant, room.roomId)
    try { await runner.start(ticket, record.id, record.revision, 1) }
    finally { ticket.finish() }

    await Bun.sleep(250)
    expect(runner.snapshot(room.roomId).status).toBe('running')
    await waitFor(() => runner.snapshot(room.roomId).status === 'completed', 1_000)
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Input submit append failure keeps the pending request retryable and never strands the structure lock', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-input-append-failure-034-'))
  const manager = new TerminalRoomManager()
  const records = new MacroRecordStore<MacroDefinitionV5>(root)
  const store = new MacroRunStore(root)
  const originalAppend = store.append.bind(store)
  let failSubmitted = true
  store.append = (runId, kind, data = {}) => {
    if (kind === 'runner_input_submitted' && failSubmitted) {
      failSubmitted = false
      throw new Error('injected_input_append_failure')
    }
    return originalAppend(runId, kind, data)
  }
  const runner = new MacroRunnerService(manager, records, store, new NotificationService(root), new AgentEventStore(root))
  try {
    const room = manager.createRoom()
    const text = manager.createTerminal(room.roomId, { backend: 'text' })
    const grant = roomGrant(manager, room.roomId)
    const record = await records.create({
      schemaVersion: 5,
      name: 'retry input append',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [{ id: 'input', type: 'input', terminal: { kind: 'terminal_index', index: 1 }, prompt: 'Value', allowEmpty: true, delivery: 'direct', ending: 'none' }],
    })
    const ticket = manager.admitControlledBearer(grant, room.roomId)
    await runner.start(ticket, record.id, record.revision, 1)
    ticket.finish()
    await waitFor(() => runner.snapshot(room.roomId).status === 'waiting_input')

    const pending = runner.snapshot(room.roomId).runtimeInput!
    expect(() => runner.submitInput(room.roomId, pending.invocationId, 'first', pending.inputRevision)).toThrow('injected_input_append_failure')
    expect(runner.snapshot(room.roomId).status).toBe('waiting_input')
    expect(manager.roomSnapshot(room.roomId).terminalStructureLocked).toBe(true)
    expect(replayFromManager(manager, room.roomId, text.terminalId)).toBe('')

    const retry = runner.snapshot(room.roomId).runtimeInput!
    runner.submitInput(room.roomId, retry.invocationId, 'second', retry.inputRevision)
    await waitFor(() => runner.snapshot(room.roomId).status === 'completed')
    expect(replayFromManager(manager, room.roomId, text.terminalId)).toBe('second')
    expect(manager.roomSnapshot(room.roomId).terminalStructureLocked).toBe(false)
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})
