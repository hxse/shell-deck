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
import type { MacroDefinitionV6, MacroRecord } from '../../src/lib/macro/macroDefinitionTypes'
import type {
  MacroRunEventPage,
  MacroRunnerActionAck,
  MacroRunSummaryPage,
  RunManifestV1,
} from '../../src/lib/macro/runnerTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import { roomControlHeaders, type RoomControlGrant } from '../../src/lib/roomControl'
import { setTextTerminalContent } from '../helpers/textTerminal'

import { replay, request, roomGrant, runnableDefinition, waitFor } from './macroRuntime034.helpers'

test('Start freezes record and terminal binding, Pause resumes in-place, and artifacts remain read-only Trace evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-runner-034-'))
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
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
    const runId = ((started.body as { ack: MacroRunnerActionAck }).ack).runId
    await waitFor(() => replay(server, room.roomId, shell.terminalId).includes('ECHO:one'))

    expect(() => server.manager.moveTerminal(room.roomId, shell.terminalId, 1)).toThrow('room_structure_locked_by_run')
    const paused = await request(server.url, `/api/rooms/${room.roomId}/runner/pause`, grant, {})
    expect(paused.body).toMatchObject({ ok: true, ack: { status: 'paused', runId } })

    await server.macroStore.update(record.id, record.revision, runnableDefinition('CHANGED'))
    await Bun.sleep(500)
    expect(replay(server, room.roomId, shell.terminalId)).not.toContain('ECHO:two')
    expect(replay(server, room.roomId, shell.terminalId)).not.toContain('ECHO:CHANGED')

    const resumed = await request(server.url, `/api/rooms/${room.roomId}/runner/resume`, grant, {})
    expect(resumed.body).toMatchObject({ ok: true, ack: { status: 'running', runId } })
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
    const traceBody = await traceResponse.json() as { page: MacroRunSummaryPage }
    expect(traceBody.page.items[0]).toMatchObject({ runId, status: 'completed' })
    const eventResponse = await fetch(server.url + `/api/rooms/${room.roomId}/runner/traces/${runId}/events?limit=200`)
    expect(eventResponse.status).toBe(200)
    const eventBody = await eventResponse.json() as { page: MacroRunEventPage }
    expect(eventBody.page.events.some((event) => event.kind === 'artifact_created')).toBe(true)
    const sent = eventBody.page.events.find((event) => event.kind === 'terminal_input_sent')
    expect(sent?.data).toMatchObject({ configuredTerminalIndex: 1, currentTerminalIndex: 1, terminalId: shell.terminalId, launchId: shell.launchId })
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('input.defaultSource is exposed as editable live input without becoming persisted cursor state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-input-default-034-'))
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
  try {
    const room = server.manager.createRoom()
    const text = server.manager.createTerminal(room.roomId, { backend: 'text' })
    setTextTerminalContent(server.manager, room.roomId, text.terminalId, 'captured draft')
    const grant = roomGrant(server.manager, room.roomId)
    const definition: MacroDefinitionV6 = {
      schemaVersion: 6,
      name: 'input default',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [
        { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminal: { kind: 'terminal_index', index: 1 } } },
        { id: 'input', type: 'input', terminal: { kind: 'terminal_index', index: 1 }, prompt: 'Review', allowEmpty: false, defaultSource: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' }, delivery: 'direct', ending: 'none' },
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

test('Stop and Room Destroy cancel pending Input without terminal writes or duplicate terminal events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-input-cancel-034-'))
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
  try {
    const definition: MacroDefinitionV6 = {
      schemaVersion: 6,
      name: 'cancel input',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [
        { id: 'input', type: 'input', terminal: { kind: 'terminal_index', index: 1 }, prompt: 'Review', allowEmpty: true, delivery: 'direct', ending: 'cr' },
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
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
  try {
    const room = server.manager.createRoom()
    const text = server.manager.createTerminal(room.roomId, { backend: 'text' })
    setTextTerminalContent(server.manager, room.roomId, text.terminalId, 'first\nlast')
    const grant = roomGrant(server.manager, room.roomId)
    const definition: MacroDefinitionV6 = {
      schemaVersion: 6,
      name: 'negative select',
      description: '',
      terminalLayout: [{ index: 1, type: 'text' }],
      body: [
        { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminal: { kind: 'terminal_index', index: 1 } } },
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
        { id: 'send', type: 'send', terminal: { kind: 'terminal_index', index: 1 }, message: { parts: [{ kind: 'artifact', source: { kind: 'step_artifact', stepId: 'extract', artifact: 'extracted_text' } }] }, delivery: 'direct', ending: 'none' },
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
