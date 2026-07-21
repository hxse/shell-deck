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

import { deferredGate, request, roomGrant, waitFor } from './macroRuntime034.helpers'

test('run structure lock transitions advance the monotonic Room revision', () => {
  const manager = new TerminalRoomManager()
  const room = manager.createRoom()
  const runId = createGeneratedId('run')
  const before = manager.roomSnapshot(room.roomId)

  manager.acquireRunStructureLock(room.roomId, runId)
  const locked = manager.roomSnapshot(room.roomId)
  expect(locked.terminalStructureLocked).toBe(true)
  expect(locked.roomRevision).toBe(before.roomRevision + 1)

  manager.releaseRunStructureLock(room.roomId, runId)
  const released = manager.roomSnapshot(room.roomId)
  expect(released.terminalStructureLocked).toBe(false)
  expect(released.roomRevision).toBe(locked.roomRevision + 1)
})

test('Prepare is explicit, revision-bound and keeps partial Room identity instead of rebuilding terminals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-prepare-034-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const room = server.manager.createRoom()
    const text = server.manager.createTerminal(room.roomId, { backend: 'text' })
    const shell = server.manager.createTerminal(room.roomId, { backend: 'fake' })
    const grant = roomGrant(server.manager, room.roomId)
    const before = server.manager.roomSnapshot(room.roomId)

    const stale = await request(server.url, `/api/rooms/${room.roomId}/terminals/prepare`, grant, {
      terminalLayout: [{ index: 1, type: 'shell' }, { index: 2, type: 'text' }],
      expectedTerminalStructureRevision: before.terminalStructureRevision - 1,
    })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ ok: false, error: 'terminal_structure_revision_conflict' })
    expect(server.manager.indexMap(room.roomId)).toEqual([{ index: 1, terminalId: text.terminalId }, { index: 2, terminalId: shell.terminalId }])

    const prepared = await request(server.url, `/api/rooms/${room.roomId}/terminals/prepare`, grant, {
      terminalLayout: [{ index: 1, type: 'shell' }, { index: 2, type: 'text' }],
      expectedTerminalStructureRevision: before.terminalStructureRevision,
    })
    expect(prepared.status).toBe(200)
    expect(prepared.body).toMatchObject({ ok: true, snapshot: { terminalPositions: [{ index: 1, type: 'shell', terminalId: shell.terminalId }, { index: 2, type: 'text', terminalId: text.terminalId }] } })
    expect(server.manager.indexMap(room.roomId)).toEqual([{ index: 1, terminalId: shell.terminalId }, { index: 2, terminalId: text.terminalId }])
    const preparedRevision = server.manager.terminalStructureRevision(room.roomId)
    server.manager.input(room.roomId, shell.terminalId, 'exit\r')
    expect(server.manager.terminalPositions(room.roomId)[0]).toMatchObject({ terminalId: shell.terminalId, readiness: 'exited' })
    expect(server.manager.terminalStructureRevision(room.roomId)).toBe(preparedRevision)

    const invalidRequest = await fetch(server.url + '/api/templates', { method: 'POST', headers: { ...roomControlHeaders(grant), 'content-type': 'application/json' }, body: '{' })
    expect(invalidRequest.status).toBe(400)
    expect(await invalidRequest.json()).toEqual({ ok: false, error: 'invalid_request_json' })

    const legacy = await request(server.url, '/api/templates', grant, { definition: { schemaVersion: 2, id: 'old', body: [] } })
    expect(legacy.status).toBe(400)
    expect(legacy.body).toMatchObject({ ok: false, error: 'invalid_macro_definition' })
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Prepare reports the authoritative partial Room when a real backend create fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-prepare-partial-034-'))
  let shellCreates = 0
  const manager = new TerminalRoomManager({
    backendFactory: (kind, options) => {
      if (kind !== 'real') throw new Error('unexpected_backend')
      shellCreates += 1
      if (shellCreates === 2) return {
        kind: 'real',
        inputChannel: 'helper-stdin-pipe',
        start(events) { events.onError(new Error('synthetic_backend_failure')) },
        write() {},
        resize() {},
        close() {},
      }
      return new FakeTerminalBackend(options)
    },
  })
  const server = startShellDeckServer({ port: 0, dataRoot: root, manager })
  try {
    const room = manager.createRoom()
    const grant = roomGrant(manager, room.roomId)
    const result = await request(server.url, `/api/rooms/${room.roomId}/terminals/prepare`, grant, {
      terminalLayout: [{ index: 1, type: 'shell' }, { index: 2, type: 'shell' }],
      expectedTerminalStructureRevision: 0,
    })
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({
      ok: false,
      error: 'terminal_prepare_backend_failed',
      failedIndex: 2,
      operation: 'create',
      snapshot: { terminalStructureRevision: 1, terminalPositions: [{ index: 1, type: 'shell', readiness: 'ready' }] },
    })
    expect(manager.terminalPositions(room.roomId)).toHaveLength(1)
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Macro Create rechecks Room control inside the canonical record transaction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-create-control-boundary-034-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const room = server.manager.createRoom()
    const grant = roomGrant(server.manager, room.roomId)
    const originalCreate = server.macroStore.create.bind(server.macroStore)
    const entered = deferredGate()
    const release = deferredGate()
    server.macroStore.create = async (definition, signal, beforeCommit) => {
      entered.release()
      await release.wait
      return await originalCreate(definition, signal, beforeCommit)
    }

    const pending = request(server.url, '/api/templates', grant, {
      definition: { schemaVersion: 5, name: 'must not persist', description: '', terminalLayout: [], body: [] },
    })
    await entered.wait
    server.manager.disconnectClient(grant.clientId)
    release.release()

    const response = await pending
    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ ok: false, error: 'room_control_lost' })
    expect(server.macroStore.list()).toEqual([])
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('persistable unassigned references round-trip through Macro CRUD but Start fails before installing a run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-unassigned-037-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const room = server.manager.createRoom()
    const grant = roomGrant(server.manager, room.roomId)
    const definition: MacroDefinitionV5 = {
      schemaVersion: 5,
      name: 'Unassigned draft',
      description: '',
      terminalLayout: [],
      body: [{
        id: 'send',
        type: 'send',
        terminal: { kind: 'unassigned' },
        message: { parts: [{ kind: 'artifact', source: { kind: 'unassigned' } }] },
        delivery: 'auto',
        ending: 'cr',
      }],
    }
    const created = await request(server.url, '/api/templates', grant, { definition })
    expect(created.status).toBe(201)
    const record = (created.body as { template: MacroRecord }).template
    expect(record.definition).toEqual(definition)
    expect(server.macroStore.read(record.id).definition).toEqual(definition)

    const expectedIssues = [
      { code: 'unassigned_artifact_reference', path: 'body[0].message.parts[0].source', message: 'artifact source must be assigned before Start' },
      { code: 'unassigned_terminal_reference', path: 'body[0].terminal', message: 'terminal target must be assigned before Start' },
    ]

    const staleStructure = await request(server.url, `/api/rooms/${room.roomId}/runner/start`, grant, {
      templateId: record.id,
      expectedMacroRevision: record.revision,
      expectedTerminalStructureRevision: 99,
    })
    expect(staleStructure.body).toEqual({ ok: false, error: 'macro_not_runnable', issues: expectedIssues })

    const staleBearerRoom = server.manager.createRoom()
    const staleBearer = roomGrant(server.manager, staleBearerRoom.roomId)
    server.manager.disconnectClient(staleBearer.clientId)
    const staleControl = await request(server.url, `/api/rooms/${staleBearerRoom.roomId}/runner/start`, staleBearer, {
      templateId: record.id,
      expectedMacroRevision: record.revision,
      expectedTerminalStructureRevision: 0,
    })
    expect(staleControl.body).toEqual({ ok: false, error: 'macro_not_runnable', issues: expectedIssues })

    const activeRoom = server.manager.createRoom()
    const activeGrant = roomGrant(server.manager, activeRoom.roomId)
    const activeRecordResponse = await request(server.url, '/api/templates', activeGrant, {
      definition: { schemaVersion: 5, name: 'active', description: '', terminalLayout: [], body: [{ id: 'wait', type: 'wait', mode: 'duration', durationMs: 5_000 }] },
    })
    const activeRecord = (activeRecordResponse.body as { template: MacroRecord }).template
    await request(server.url, `/api/rooms/${activeRoom.roomId}/runner/start`, activeGrant, {
      templateId: activeRecord.id,
      expectedMacroRevision: activeRecord.revision,
      expectedTerminalStructureRevision: 0,
    })
    await waitFor(() => server.macroRunner.snapshot(activeRoom.roomId).status === 'running')
    const activeConflict = await request(server.url, `/api/rooms/${activeRoom.roomId}/runner/start`, activeGrant, {
      templateId: record.id,
      expectedMacroRevision: record.revision,
      expectedTerminalStructureRevision: 0,
    })
    expect(activeConflict.body).toEqual({ ok: false, error: 'macro_not_runnable', issues: expectedIssues })
    await request(server.url, `/api/rooms/${activeRoom.roomId}/runner/stop`, activeGrant, {})

    const before = server.manager.roomSnapshot(room.roomId)
    const started = await request(server.url, `/api/rooms/${room.roomId}/runner/start`, grant, {
      templateId: record.id,
      expectedMacroRevision: record.revision,
      expectedTerminalStructureRevision: before.terminalStructureRevision,
    })
    expect(started.status).toBe(400)
    expect(started.body).toEqual({
      ok: false,
      error: 'macro_not_runnable',
      issues: expectedIssues,
    })
    expect(server.macroRunner.hasActiveRun(room.roomId, room.roomGeneration)).toBe(false)
    expect(server.macroRunner.traces(room.roomId)).toEqual([])
    expect(server.manager.roomSnapshot(room.roomId)).toEqual(before)
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
