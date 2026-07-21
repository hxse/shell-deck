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

import { acquireMacroLease, replayFromManager, request, roomGrant, waitFor } from './macroRuntime034.helpers'

test('published runner events stay successful when summary maintenance fails after commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-maintenance-debt-034-'))
  const manager = new TerminalRoomManager()
  const records = new MacroRecordStore<MacroDefinitionV5>(root)
  const failKinds = new Set<string>()
  let failSequence100 = true
  const evidence = new EvidenceStore(root, () => new Date().toISOString(), {
    writeSummary(path, bytes) {
      const summary = JSON.parse(bytes) as { lastEventSeq: number; lastEventKind: string }
      if (failKinds.delete(summary.lastEventKind)) throw new Error('injected_summary_maintenance_failure')
      if (summary.lastEventSeq === 100 && failSequence100) {
        failSequence100 = false
        throw new Error('injected_checkpoint_maintenance_failure')
      }
      writePrivateFileAtomic(path, bytes)
    },
  })
  const store = new MacroRunStore(root, () => new Date().toISOString(), () => createGeneratedId('run'), evidence)
  const runner = new MacroRunnerService(manager, records, store, new NotificationService(root), new AgentEventStore(root))
  try {
    const terminalRoom = manager.createRoom()
    const terminalGrant = roomGrant(manager, terminalRoom.roomId)
    const terminalRecord = await records.create({ schemaVersion: 5, name: 'terminal debt', description: '', terminalLayout: [], body: [] })
    failKinds.add('run_started')
    failKinds.add('run_completed')
    const terminalTicket = manager.admitControlledBearer(terminalGrant, terminalRoom.roomId)
    try { await runner.start(terminalTicket, terminalRecord.id, terminalRecord.revision, 0) }
    finally { terminalTicket.finish() }
    await waitFor(() => runner.snapshot(terminalRoom.roomId).status === 'completed')
    const terminalRunId = runner.snapshot(terminalRoom.roomId).runId!
    expect(store.readEvents(terminalRunId).map((event) => event.kind)).toEqual(['run_started', 'run_completed'])
    expect(store.listTracesForRoom(terminalRoom.roomId)[0]).toMatchObject({ status: 'completed' })

    const checkpointRoom = manager.createRoom()
    const checkpointGrant = roomGrant(manager, checkpointRoom.roomId)
    const checkpointRecord = await records.create({
      schemaVersion: 5,
      name: 'checkpoint debt',
      description: '',
      terminalLayout: [],
      body: Array.from({ length: 50 }, (_, index) => ({ id: `wait_${index + 1}`, type: 'wait' as const, mode: 'duration' as const, durationMs: 1 })),
    })
    const checkpointTicket = manager.admitControlledBearer(checkpointGrant, checkpointRoom.roomId)
    try { await runner.start(checkpointTicket, checkpointRecord.id, checkpointRecord.revision, 0) }
    finally { checkpointTicket.finish() }
    await waitFor(() => runner.snapshot(checkpointRoom.roomId).status === 'completed')
    expect(failSequence100).toBe(false)
    expect(store.listTracesForRoom(checkpointRoom.roomId)[0]).toMatchObject({ status: 'completed' })

    const inputRoom = manager.createRoom()
    const inputTerminal = manager.createTerminal(inputRoom.roomId, { backend: 'text' })
    const inputGrant = roomGrant(manager, inputRoom.roomId)
    const inputRecord = await records.create({
      schemaVersion: 5,
      name: 'input debt',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [{ id: 'input', type: 'input', terminal: { kind: 'terminal_index', index: 1 }, prompt: 'Value', allowEmpty: true, delivery: 'direct', ending: 'none' }],
    })
    const inputTicket = manager.admitControlledBearer(inputGrant, inputRoom.roomId)
    try { await runner.start(inputTicket, inputRecord.id, inputRecord.revision, 1) }
    finally { inputTicket.finish() }
    await waitFor(() => runner.snapshot(inputRoom.roomId).status === 'waiting_input')
    const inputRunId = runner.snapshot(inputRoom.roomId).runId!
    while (store.readEventWindow(inputRunId).lastEventSeq < 99) {
      const next = store.readEventWindow(inputRunId).lastEventSeq + 1
      store.append(inputRunId, 'maintenance_probe', { next })
    }
    failKinds.add('runner_input_submitted')
    const runtimeInput = runner.snapshot(inputRoom.roomId).runtimeInput!
    expect(() => runner.submitInput(inputRoom.roomId, runtimeInput.invocationId, 'submitted', runtimeInput.inputRevision)).not.toThrow()
    await waitFor(() => runner.snapshot(inputRoom.roomId).status === 'completed')
    expect(replayFromManager(manager, inputRoom.roomId, inputTerminal.terminalId)).toBe('submitted')
    expect(store.listTracesForRoom(inputRoom.roomId)[0]).toMatchObject({ status: 'completed' })

    const stopRoom = manager.createRoom()
    manager.createTerminal(stopRoom.roomId, { backend: 'text' })
    const stopGrant = roomGrant(manager, stopRoom.roomId)
    const stopTicket = manager.admitControlledBearer(stopGrant, stopRoom.roomId)
    try { await runner.start(stopTicket, inputRecord.id, inputRecord.revision, 1) }
    finally { stopTicket.finish() }
    await waitFor(() => runner.snapshot(stopRoom.roomId).status === 'waiting_input')
    failKinds.add('run_stopped')
    expect(() => runner.stop(stopRoom.roomId)).not.toThrow()
    await waitFor(() => runner.snapshot(stopRoom.roomId).status === 'stopped')
    expect(store.listTracesForRoom(stopRoom.roomId)[0]).toMatchObject({ status: 'stopped' })
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

test('published Macro create/update/delete stay successful after record or lease maintenance faults', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-macro-published-034-'))
  let failRecordReplace = true
  let failRecordDelete = false
  let failWrite = false
  let failDelete = false
  const server = startShellDeckServer({
    port: 0,
    dataRoot: root,
    macroStoreOptions: {
      replaceRecord(path, content) {
        writePrivateFileAtomic(path, content)
        if (failRecordReplace) {
          failRecordReplace = false
          return { published: true, durability: 'uncertain', postPublishError: new Error('injected_record_directory_fsync_failure') }
        }
        return { published: true, durability: 'confirmed' }
      },
      deleteRecord(path) {
        publishPrivateFileDelete(path)
        if (failRecordDelete) {
          failRecordDelete = false
          return { published: true, durability: 'uncertain', postPublishError: new Error('injected_record_directory_fsync_failure') }
        }
        return { published: true, durability: 'confirmed' }
      },
    },
    contentEditLeaseOptions: {
      writeLeaseState(path, content) {
        if (failWrite) throw new Error('injected_lease_state_write_failure')
        writePrivateFileAtomic(path, content)
      },
      deleteLeaseState(path) {
        if (failDelete) throw new Error('injected_lease_state_delete_failure')
        unlinkSync(path)
      },
    },
  })
  try {
    const room = server.manager.createRoom()
    const grant = roomGrant(server.manager, room.roomId)
    const broadcasts: ServerMessage[] = []
    server.manager.connectClient(room.roomId, (message) => broadcasts.push(message))
    const definition: MacroDefinitionV5 = { schemaVersion: 5, name: 'published', description: '', terminalLayout: [], body: [] }

    const created = await request(server.url, '/api/templates', grant, { definition })
    expect(created.status).toBe(201)
    const first = (created.body as { template: MacroRecord }).template
    const firstLease = await acquireMacroLease(server.url, grant, first.id)
    failRecordReplace = true
    broadcasts.length = 0
    failWrite = true
    const updateResponse = await fetch(server.url + '/api/templates/' + first.id, {
      method: 'PUT',
      headers: { ...roomControlHeaders(grant), 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, editLeaseId: firstLease.editLeaseId, definition: { ...definition, name: 'published r2' } }),
    })
    expect(updateResponse.status).toBe(200)
    expect(await updateResponse.json()).toMatchObject({
      ok: true,
      template: { id: first.id, revision: 2, definition: { name: 'published r2' } },
      leaseOutcome: { status: 'lost', reason: 'content_edit_lease_state_refresh_failed' },
    })
    const saved = await fetch(server.url + '/api/templates/' + first.id)
    expect(await saved.json()).toMatchObject({ ok: true, template: { revision: 2, definition: { name: 'published r2' } } })
    expect(broadcasts).toContainEqual(expect.objectContaining({
      type: 'content_record_changed',
      resourceKey: { kind: 'macro', itemId: first.id },
      operation: 'saved',
      revision: 2,
    }))

    failWrite = false
    const secondCreated = await request(server.url, '/api/templates', grant, { definition: { ...definition, name: 'delete published' } })
    const second = (secondCreated.body as { template: MacroRecord }).template
    const secondLease = await acquireMacroLease(server.url, grant, second.id)
    failRecordDelete = true
    broadcasts.length = 0
    failDelete = true
    const deleteResponse = await fetch(server.url + '/api/templates/' + second.id, {
      method: 'DELETE',
      headers: { ...roomControlHeaders(grant), 'If-Match': '1', 'X-Shell-Deck-Content-Edit-Lease': secondLease.editLeaseId },
    })
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toMatchObject({ ok: true, leaseOutcome: { status: 'lost', reason: 'content_edit_lease_state_refresh_failed' } })
    expect((await fetch(server.url + '/api/templates/' + second.id)).status).toBe(404)
    expect(broadcasts).toContainEqual(expect.objectContaining({
      type: 'content_record_changed',
      resourceKey: { kind: 'macro', itemId: second.id },
      operation: 'deleted',
      revision: null,
    }))
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
