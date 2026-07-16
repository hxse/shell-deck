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
import type { MacroDefinitionV3, MacroRecord } from '../../src/lib/macro/macroDefinitionTypes'
import type { MacroRunnerSnapshot, RunManifestV1 } from '../../src/lib/macro/runnerTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import { roomControlHeaders, type RoomControlGrant } from '../../src/lib/roomControl'

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
      definition: { schemaVersion: 3, name: 'must not persist', description: '', terminalLayout: [], body: [] },
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

test('Start freezes record and terminal binding, Pause resumes in-place, and artifacts remain read-only Trace evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-runner-034-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const room = server.manager.createRoom()
    const shell = server.manager.createTerminal(room.roomId, { backend: 'fake' })
    const grant = roomGrant(server.manager, room.roomId)
    const definition = runnableDefinition('two')
    const created = await request(server.url, '/api/templates', grant, { definition })
    expect(created.status).toBe(201)
    const record = (created.body as { template: MacroRecord }).template
    const structureRevision = server.manager.terminalStructureRevision(room.roomId)

    const staleStart = await request(server.url, `/api/rooms/${room.roomId}/runner/start`, grant, { templateId: record.id, expectedMacroRevision: record.revision + 1, expectedTerminalStructureRevision: structureRevision })
    expect(staleStart.status).toBe(409)
    expect(staleStart.body).toMatchObject({ ok: false, error: 'macro_revision_conflict' })
    expect(server.macroRunner.hasActiveRun(room.roomId, room.roomGeneration)).toBe(false)

    const started = await request(server.url, `/api/rooms/${room.roomId}/runner/start`, grant, { templateId: record.id, expectedMacroRevision: record.revision, expectedTerminalStructureRevision: structureRevision })
    expect(started.status).toBe(201)
    const runId = ((started.body as { runner: MacroRunnerSnapshot }).runner).runId!
    await waitFor(() => replay(server, room.roomId, shell.terminalId).includes('ECHO:one'))

    expect(() => server.manager.moveTerminal(room.roomId, shell.terminalId, 1)).toThrow('room_structure_locked_by_run')
    const paused = await request(server.url, `/api/rooms/${room.roomId}/runner/pause`, grant, {})
    expect(paused.body).toMatchObject({ ok: true, runner: { status: 'paused', runId } })

    await server.macroStore.update(record.id, record.revision, runnableDefinition('CHANGED'))
    await Bun.sleep(500)
    expect(replay(server, room.roomId, shell.terminalId)).not.toContain('ECHO:two')
    expect(replay(server, room.roomId, shell.terminalId)).not.toContain('ECHO:CHANGED')

    const resumed = await request(server.url, `/api/rooms/${room.roomId}/runner/resume`, grant, {})
    expect(resumed.body).toMatchObject({ ok: true, runner: { status: 'running', runId } })
    await waitFor(() => server.macroRunner.snapshot(room.roomId).status === 'completed')
    const output = replay(server, room.roomId, shell.terminalId)
    expect(output).toContain('ECHO:two')
    expect(output).not.toContain('ECHO:CHANGED')

    const manifest = JSON.parse(readFileSync(join(root, 'runs', runId, 'manifest.json'), 'utf8')) as RunManifestV1
    expect(manifest.macroRecord).toEqual({ id: record.id, revision: 1 })
    expect(manifest.terminalBindings).toEqual([{ index: 1, type: 'shell', terminalId: shell.terminalId, launchId: shell.launchId }])
    const artifacts = readdirSync(join(root, 'runs', runId, 'artifacts'))
    expect(artifacts.some((name) => name.startsWith('capture-'))).toBe(true)
    expect(existsSync(join(root, 'runs', runId, 'summary.json'))).toBe(true)
    expect(existsSync(join(root, 'runs', runId, 'events', '000000000001.jsonl'))).toBe(true)

    const traceResponse = await fetch(server.url + `/api/rooms/${room.roomId}/runner/traces`)
    expect(traceResponse.status).toBe(200)
    const traceBody = await traceResponse.json() as { traces: Array<{ runId: string; status: string; events: Array<{ kind: string; data: Record<string, unknown> }> }> }
    expect(traceBody.traces[0]).toMatchObject({ runId, status: 'completed' })
    expect(traceBody.traces[0].events.some((event) => event.kind === 'artifact_created')).toBe(true)
    const sent = traceBody.traces[0].events.find((event) => event.kind === 'terminal_input_sent')
    expect(sent?.data).toMatchObject({ configuredTerminalIndex: 1, currentTerminalIndex: 1, terminalId: shell.terminalId, launchId: shell.launchId })
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('input.defaultSource is exposed as editable live input without becoming persisted cursor state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-input-default-034-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const room = server.manager.createRoom()
    const text = server.manager.createTerminal(room.roomId, { backend: 'text' })
    server.manager.setTextContent(room.roomId, text.terminalId, 'captured draft')
    const grant = roomGrant(server.manager, room.roomId)
    const definition: MacroDefinitionV3 = {
      schemaVersion: 3,
      name: 'input default',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [
        { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminalIndex: 1 } },
        { id: 'input', type: 'input', terminalIndex: 1, prompt: 'Review', allowEmpty: false, defaultSource: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' }, delivery: 'direct', ending: 'none' },
      ],
    }
    const created = await request(server.url, '/api/templates', grant, { definition })
    const record = (created.body as { template: MacroRecord }).template
    await request(server.url, `/api/rooms/${room.roomId}/runner/start`, grant, {
      templateId: record.id,
      expectedMacroRevision: 1,
      expectedTerminalStructureRevision: 1,
    })
    await waitFor(() => server.macroRunner.snapshot(room.roomId).status === 'waiting_input')
    const waiting = server.macroRunner.snapshot(room.roomId)
    expect(waiting).toMatchObject({ runtimeInput: { prompt: 'Review', defaultText: 'captured draft', draft: 'captured draft', inputRevision: 0 } })
    await request(server.url, `/api/rooms/${room.roomId}/runner/input`, grant, {
      invocationId: waiting.runtimeInput!.invocationId,
      value: 'edited text',
      expectedInputRevision: waiting.runtimeInput!.inputRevision,
    })
    await waitFor(() => server.macroRunner.snapshot(room.roomId).status === 'completed')
    expect(replay(server, room.roomId, text.terminalId)).toBe('captured draftedited text')
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Stop and Room Destroy cancel pending Input without PTY writes or duplicate terminal events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-input-cancel-034-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const definition: MacroDefinitionV3 = {
      schemaVersion: 3,
      name: 'cancel input',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [
        { id: 'input', type: 'input', terminalIndex: 1, prompt: 'Review', allowEmpty: true, delivery: 'direct', ending: 'cr' },
      ],
    }

    const stoppedRoom = server.manager.createRoom()
    const stoppedText = server.manager.createTerminal(stoppedRoom.roomId, { backend: 'text' })
    const stoppedGrant = roomGrant(server.manager, stoppedRoom.roomId)
    const created = await request(server.url, '/api/templates', stoppedGrant, { definition })
    const record = (created.body as { template: MacroRecord }).template
    await request(server.url, `/api/rooms/${stoppedRoom.roomId}/runner/start`, stoppedGrant, {
      templateId: record.id,
      expectedMacroRevision: 1,
      expectedTerminalStructureRevision: 1,
    })
    await waitFor(() => server.macroRunner.snapshot(stoppedRoom.roomId).status === 'waiting_input')
    const stoppedRunId = server.macroRunner.snapshot(stoppedRoom.roomId).runId!
    await request(server.url, `/api/rooms/${stoppedRoom.roomId}/runner/stop`, stoppedGrant, {})
    await waitFor(() => server.macroRunner.snapshot(stoppedRoom.roomId).status === 'stopped')
    expect(replay(server, stoppedRoom.roomId, stoppedText.terminalId)).toBe('')

    const runStore = new MacroRunStore(root)
    const stoppedEvents = runStore.readEvents(stoppedRunId)
    expect(stoppedEvents.some((event) => event.kind === 'terminal_input_sent')).toBe(false)
    expect(stoppedEvents.some((event) => event.kind === 'step_failed')).toBe(false)
    expect(stoppedEvents.filter((event) => ['run_completed', 'run_failed', 'run_stopped'].includes(event.kind)).map((event) => event.kind)).toEqual(['run_stopped'])

    const destroyedRoom = server.manager.createRoom()
    server.manager.createTerminal(destroyedRoom.roomId, { backend: 'text' })
    const destroyedGrant = roomGrant(server.manager, destroyedRoom.roomId)
    await request(server.url, `/api/rooms/${destroyedRoom.roomId}/runner/start`, destroyedGrant, {
      templateId: record.id,
      expectedMacroRevision: 1,
      expectedTerminalStructureRevision: 1,
    })
    await waitFor(() => server.macroRunner.snapshot(destroyedRoom.roomId).status === 'waiting_input')
    const destroyedRunId = server.macroRunner.snapshot(destroyedRoom.roomId).runId!
    await server.manager.destroyRoom(destroyedRoom.roomId, destroyedRoom.roomGeneration)
    await Bun.sleep(20)

    const destroyedEvents = runStore.readEvents(destroyedRunId)
    expect(destroyedEvents.at(-1)).toMatchObject({ kind: 'run_failed', data: { code: 'room_destroyed' } })
    expect(destroyedEvents.some((event) => event.kind === 'step_failed' || event.kind === 'run_stopped')).toBe(false)
    expect(destroyedEvents.filter((event) => ['run_completed', 'run_failed', 'run_stopped'].includes(event.kind))).toHaveLength(1)
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('extract_text keeps the current negative index syntax and sends the selected tail value', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-negative-select-034-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const room = server.manager.createRoom()
    const text = server.manager.createTerminal(room.roomId, { backend: 'text' })
    server.manager.setTextContent(room.roomId, text.terminalId, 'first\nlast')
    const grant = roomGrant(server.manager, room.roomId)
    const definition: MacroDefinitionV3 = {
      schemaVersion: 3,
      name: 'negative select',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [
        { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminalIndex: 1 } },
        {
          id: 'extract',
          type: 'extract_text',
          source: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' },
          split: { kind: 'lines', keepEmpty: false },
          filters: [],
          select: { mode: 'index', index: -1 },
          extract: { kind: 'none' },
          trim: 'none',
          onEmpty: 'fail',
        },
        { id: 'send', type: 'send', terminalIndex: 1, message: { parts: [{ kind: 'artifact', source: { kind: 'step_artifact', stepId: 'extract', artifact: 'extracted_text' } }] }, delivery: 'direct', ending: 'none' },
      ],
    }
    const created = await request(server.url, '/api/templates', grant, { definition })
    const record = (created.body as { template: MacroRecord }).template
    await request(server.url, `/api/rooms/${room.roomId}/runner/start`, grant, {
      templateId: record.id,
      expectedMacroRevision: 1,
      expectedTerminalStructureRevision: 1,
    })
    await waitFor(() => server.macroRunner.snapshot(room.roomId).status === 'completed')
    expect(replay(server, room.roomId, text.terminalId)).toBe('first\nlastlast')
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('durable Start never installs a run after controller loss or Room Destroy crosses a commit boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-boundary-034-'))
  try {
    const manager = new TerminalRoomManager()
    const records = new MacroRecordStore<MacroDefinitionV3>(root)
    const notification = new NotificationService(root)
    const agentEvents = new AgentEventStore(root)

    const lostRoom = manager.createRoom()
    const lostGrant = roomGrant(manager, lostRoom.roomId)
    const lostRecord = await records.create({ schemaVersion: 3, name: 'lost control', description: '', terminalLayout: [], body: [] })
    const lostStore = new MacroRunStore(root)
    const append = lostStore.append.bind(lostStore)
    let revoked = false
    lostStore.append = (runId, kind, data = {}) => {
      const event = append(runId, kind, data)
      if (kind === 'run_started' && !revoked) {
        revoked = true
        manager.disconnectClient(lostGrant.clientId)
      }
      return event
    }
    const lostRunner = new MacroRunnerService(manager, records, lostStore, notification, agentEvents)
    const lostTicket = manager.admitControlledBearer(lostGrant, lostRoom.roomId)
    await expect(lostRunner.start(lostTicket, lostRecord.id, 1, 0)).rejects.toThrow('room_control_lost')
    lostTicket.finish()
    expect(lostRunner.hasActiveRun(lostRoom.roomId, lostRoom.roomGeneration)).toBe(false)
    expect(manager.roomSnapshot(lostRoom.roomId).terminalStructureLocked).toBe(false)
    const lostTrace = lostStore.listTracesForRoom(lostRoom.roomId)[0]
    expect(lostTrace.status).toBe('failed')
    expect(lostTrace.events.at(-1)).toMatchObject({ kind: 'run_failed', data: { code: 'room_control_lost_during_start' } })

    const destroyedRoom = manager.createRoom()
    const destroyedGrant = roomGrant(manager, destroyedRoom.roomId)
    const destroyedRecord = await records.create({ schemaVersion: 3, name: 'destroyed', description: '', terminalLayout: [], body: [] })
    const destroyedStore = new MacroRunStore(root)
    const publish = destroyedStore.publishManifest.bind(destroyedStore)
    let destroying: Promise<void> | null = null
    destroyedStore.publishManifest = (manifest) => {
      const ref = publish(manifest)
      destroying = manager.destroyRoom(destroyedRoom.roomId, destroyedRoom.roomGeneration)
      return ref
    }
    const destroyedRunner = new MacroRunnerService(manager, records, destroyedStore, notification, agentEvents)
    const destroyedTicket = manager.admitControlledBearer(destroyedGrant, destroyedRoom.roomId)
    await expect(destroyedRunner.start(destroyedTicket, destroyedRecord.id, 1, 0)).rejects.toThrow('room_destroying')
    destroyedTicket.finish()
    await destroying
    expect(destroyedRunner.hasActiveRun(destroyedRoom.roomId, destroyedRoom.roomGeneration)).toBe(false)
    expect(destroyedStore.listTracesForRoom(destroyedRoom.roomId)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('tight forever flow cooperatively yields so Stop can terminalize within a deadline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-forever-yield-034-'))
  const manager = new TerminalRoomManager()
  const records = new MacroRecordStore<MacroDefinitionV3>(root)
  const store = new MacroRunStore(root)
  const runner = new MacroRunnerService(manager, records, store, new NotificationService(root), new AgentEventStore(root))
  manager.addDestroyHook((roomId, roomGeneration) => runner.destroyRoom(roomId, roomGeneration))
  try {
    const room = manager.createRoom()
    const grant = roomGrant(manager, room.roomId)
    const record = await records.create({
      schemaVersion: 3,
      name: 'cooperative forever',
      description: '',
      terminalLayout: [],
      body: [{ id: 'forever', type: 'for', range: { kind: 'forever' }, body: [{ id: 'continue', type: 'continue' }] }],
    })
    const ticket = manager.admitControlledBearer(grant, room.roomId)
    await runner.start(ticket, record.id, record.revision, 0)
    ticket.finish()

    await Bun.sleep(25)
    runner.stop(room.roomId)
    await waitFor(() => runner.snapshot(room.roomId).status === 'stopped', 1_000)
    expect(manager.roomSnapshot(room.roomId).terminalStructureLocked).toBe(false)
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

test('terminal quiet observes output activity after the replay tail is full', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-quiet-revision-034-'))
  const manager = new TerminalRoomManager({
    replayByteLimit: 8,
    backendFactory: (_kind, options) => new StreamingTerminalBackend(options),
  })
  const records = new MacroRecordStore<MacroDefinitionV3>(root)
  const store = new MacroRunStore(root)
  const runner = new MacroRunnerService(manager, records, store, new NotificationService(root), new AgentEventStore(root))
  manager.addDestroyHook((roomId, roomGeneration) => runner.destroyRoom(roomId, roomGeneration))
  try {
    const room = manager.createRoom()
    manager.createTerminal(room.roomId, { backend: 'fake' })
    const grant = roomGrant(manager, room.roomId)
    const record = await records.create({
      schemaVersion: 3,
      name: 'quiet activity revision',
      description: '',
      terminalLayout: [{ index: 1, type: 'shell' }],
      body: [{ id: 'quiet', type: 'wait', mode: 'terminal-quiet', terminalIndex: 1, quietMs: 100, maxMs: 400, onTimeout: 'finish' }],
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
  const records = new MacroRecordStore<MacroDefinitionV3>(root)
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
      schemaVersion: 3,
      name: 'retry input append',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [{ id: 'input', type: 'input', terminalIndex: 1, prompt: 'Value', allowEmpty: true, delivery: 'direct', ending: 'none' }],
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

test('published runner events stay successful when summary maintenance fails after commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-maintenance-debt-034-'))
  const manager = new TerminalRoomManager()
  const records = new MacroRecordStore<MacroDefinitionV3>(root)
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
    const terminalRecord = await records.create({ schemaVersion: 3, name: 'terminal debt', description: '', terminalLayout: [], body: [] })
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
      schemaVersion: 3,
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
      schemaVersion: 3,
      name: 'input debt',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [{ id: 'input', type: 'input', terminalIndex: 1, prompt: 'Value', allowEmpty: true, delivery: 'direct', ending: 'none' }],
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
    const definition: MacroDefinitionV3 = { schemaVersion: 3, name: 'published', description: '', terminalLayout: [], body: [] }

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

function runnableDefinition(second: string): MacroDefinitionV3 {
  return {
    schemaVersion: 3,
    name: 'immutable run',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [
      { id: 'send_one', type: 'send', terminalIndex: 1, message: { parts: [{ kind: 'text', text: 'one' }] }, delivery: 'direct', ending: 'cr' },
      { id: 'wait', type: 'wait', mode: 'duration', durationMs: 400 },
      { id: 'send_two', type: 'send', terminalIndex: 1, message: { parts: [{ kind: 'text', text: second }] }, delivery: 'direct', ending: 'cr' },
      { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminalIndex: 1, mode: 'scrollback-tail', maxChars: 20_000 } },
    ],
  }
}

function roomGrant(manager: import('../../server/terminalRoomManager').TerminalRoomManager, roomId: string): RoomControlGrant {
  const messages: ServerMessage[] = []
  manager.connectClient(roomId, (message) => messages.push(message))
  const grant = messages.find((message): message is Extract<ServerMessage, { type: 'room_control' }> => message.type === 'room_control')?.grant
  if (!grant) throw new Error('missing_room_control_grant')
  return grant
}

async function request(baseUrl: string, path: string, grant: RoomControlGrant, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(baseUrl + path, { method: 'POST', headers: { ...roomControlHeaders(grant), 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

function replay(server: ReturnType<typeof startShellDeckServer>, roomId: string, terminalId: string): string {
  return server.manager.roomSnapshot(roomId).terminals.find((terminal) => terminal.terminalId === terminalId)?.replay.join('') ?? ''
}

function replayFromManager(manager: TerminalRoomManager, roomId: string, terminalId: string): string {
  return manager.roomSnapshot(roomId).terminals.find((terminal) => terminal.terminalId === terminalId)?.replay.join('') ?? ''
}

async function acquireMacroLease(baseUrl: string, grant: RoomControlGrant, itemId: string): Promise<{ editLeaseId: string }> {
  const result = await request(baseUrl, '/api/content-edit-leases/acquire', grant, {
    resourceKey: { kind: 'macro', itemId },
    expectedLeaseEpoch: 0,
  })
  expect(result.status).toBe(200)
  return (result.body as { grant: { editLeaseId: string } }).grant
}

class StreamingTerminalBackend implements TerminalBackend {
  readonly kind = 'fake' as const
  readonly inputChannel = 'helper-stdin-pipe' as const
  readonly cwd: string | null
  private timer: ReturnType<typeof setInterval> | null = null
  private events: TerminalBackendEvent | null = null

  constructor(options: TerminalBackendOptions) { this.cwd = options.cwd ?? null }
  start(events: TerminalBackendEvent): void { this.events = events; this.timer = setInterval(() => events.onData('abcd'), 10) }
  write(): void {}
  resize(): void {}
  currentCwd(): string | null { return this.cwd }
  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const events = this.events
    this.events = null
    events?.onExit(0, null)
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('wait_timeout')
    await Bun.sleep(10)
  }
}

function deferredGate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { wait, release }
}
