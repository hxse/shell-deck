import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FakeTerminalBackend } from '../../server/fakeTerminalBackend'
import { startShellDeckServer } from '../../server/httpServer'
import type { TerminalBackendOptions } from '../../server/terminalBackend'
import { TerminalRoomManager } from '../../server/terminalRoomManager'
import { submitStructuredJson } from '../../scripts/submitStructuredJson'
import type {
  CaptureWaitLimit,
  MacroDefinitionV5,
} from '../../src/lib/macro/macroDefinitionTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import type { RoomControlGrant } from '../../src/lib/roomControl'
import { serviceTracesForRoom } from '../helpers/macroTrace'

test('structured JSON HTTP submission is Room-bound, schema-checked, single-consume, and typed', async () => {
  const harness = createHarness()
  try {
    const roomA = harness.server.manager.createRoom()
    const terminalA = harness.server.manager.createTerminal(roomA.roomId, { backend: 'fake' })
    const envA = harness.environment(terminalA.terminalId)
    expect(envA.SHELL_DECK_JUSTFILE)
      .toBe(realpathSync(resolve(import.meta.dir, '../..', 'justfile')))
    const malformedWithBadToken = await fetch(envA.SHELL_DECK_SUBMIT_JSON_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shell-deck-ingest-token': 'wrong-token',
      },
      body: '{',
    })
    expect(malformedWithBadToken.status).toBe(403)
    expect(await malformedWithBadToken.json()).toMatchObject({
      error: 'structured_json_ingest_token_invalid',
    })
    const malformed = await fetch(envA.SHELL_DECK_SUBMIT_JSON_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shell-deck-ingest-token': envA.SHELL_DECK_INGEST_TOKEN,
      },
      body: '{',
    })
    expect(malformed.status).toBe(422)
    expect(await malformed.json()).toMatchObject({
      error: 'structured_json_submission_invalid',
    })
    const malformedRoomUrl = new URL(
      '/api/rooms/room_bad/structured-results',
      harness.server.url,
    ).href
    const malformedRoomBadToken = await fetch(malformedRoomUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shell-deck-ingest-token': 'wrong-token',
      },
      body: '{',
    })
    expect(malformedRoomBadToken.status).toBe(403)
    expect(await malformedRoomBadToken.json()).toMatchObject({
      error: 'structured_json_ingest_token_invalid',
    })
    const malformedRoomBadBody = await fetch(malformedRoomUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shell-deck-ingest-token': envA.SHELL_DECK_INGEST_TOKEN,
      },
      body: '{',
    })
    expect(malformedRoomBadBody.status).toBe(422)
    expect(await malformedRoomBadBody.json()).toMatchObject({
      error: 'structured_json_submission_invalid',
    })
    const malformedRoomValidBody = await fetch(malformedRoomUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shell-deck-ingest-token': envA.SHELL_DECK_INGEST_TOKEN,
      },
      body: JSON.stringify({
        protocolVersion: 1,
        roomGeneration: envA.SHELL_DECK_ROOM_GENERATION,
        terminalId: envA.SHELL_DECK_TERMINAL_ID,
        launchId: envA.SHELL_DECK_LAUNCH_ID,
        value: {},
      }),
    })
    expect(malformedRoomValidBody.status).toBe(404)
    expect(await malformedRoomValidBody.json()).toMatchObject({
      error: 'structured_json_runtime_membership_mismatch',
    })
    const grantA = roomGrant(harness.server.manager, roomA.roomId)
    const started = await startRunner(harness, roomA.roomId, grantA, decisionDefinition({ kind: 'unbounded' }, true))
    await waitFor(() => harness.server.macroRunner.snapshot(roomA.roomId).currentNodeId === 'capture_decision')

    const roomB = harness.server.manager.createRoom()
    const terminalB = harness.server.manager.createTerminal(roomB.roomId, { backend: 'fake' })
    const envB = harness.environment(terminalB.terminalId)
    const crossRoom = await submitStructuredJson(
      '{"decision":"retry","confidence":0.9}',
      { ...envA, SHELL_DECK_SUBMIT_JSON_URL: envB.SHELL_DECK_SUBMIT_JSON_URL },
    )
    expect(crossRoom).toMatchObject({
      exitCode: 1,
      stderr: 'structured_json_runtime_membership_mismatch\n',
    })
    await harness.server.manager.destroyRoom(roomB.roomId, roomB.roomGeneration)
    expect(await submitStructuredJson('{"decision":"retry","confidence":0.9}', envB))
      .toMatchObject({
        exitCode: 1,
        stderr: 'structured_json_runtime_membership_mismatch\n',
      })

    const invalid = await submitStructuredJson('{"decision":"other"}', envA)
    expect(invalid.exitCode).toBe(1)
    expect(invalid.stderr).toContain('structured_json_schema_mismatch')
    expect(harness.server.macroRunner.snapshot(roomA.roomId)).toMatchObject({
      status: 'running',
      currentNodeId: 'capture_decision',
    })

    expect(await submitStructuredJson(
      '{"decision":"retry","confidence":0.9}',
      envA,
    )).toEqual({ exitCode: 0, stdout: 'structured_json_submitted\n', stderr: '' })
    expect(await submitStructuredJson(
      '{"decision":"continue","confidence":0.8}',
      envA,
    )).toMatchObject({
      exitCode: 1,
      stderr: 'structured_json_capture_not_waiting\n',
    })

    await waitFor(() => harness.server.macroRunner.snapshot(roomA.roomId).status === 'completed')
    expect(replay(harness.server.manager, roomA.roomId, terminalA.terminalId))
      .toContain('ECHO:FORWARD:{"confidence":0.9,"decision":"retry"}')

    const artifactDir = join(harness.root, 'runs', started.runId, 'artifacts')
    const jsonArtifact = readdirSync(artifactDir)
      .find((name) => name.startsWith('capture-structured-json-') && name.endsWith('.json'))
    expect(jsonArtifact).toBeTruthy()
    expect(readFileSync(join(artifactDir, jsonArtifact!), 'utf8'))
      .toBe('{\n  "confidence": 0.9,\n  "decision": "retry"\n}\n')
    const artifactEvent = serviceTracesForRoom(harness.server.macroRunner, roomA.roomId)[0].events
      .find((event) => event.kind === 'artifact_created' && event.data.artifact === 'captured_json')
    expect(artifactEvent?.data).toMatchObject({
      stepId: 'capture_decision',
      captureKind: 'structured-json',
      terminalId: terminalA.terminalId,
      launchId: terminalA.launchId,
    })
  } finally {
    await harness.dispose()
  }
})

test('structured JSON waiter survives Pause, clears on Stop, and uses active-time timeout', async () => {
  const harness = createHarness()
  try {
    const room = harness.server.manager.createRoom()
    const terminal = harness.server.manager.createTerminal(room.roomId, { backend: 'fake' })
    const env = harness.environment(terminal.terminalId)
    const grant = roomGrant(harness.server.manager, room.roomId)

    await startRunner(harness, room.roomId, grant, decisionDefinition({ kind: 'timeout', timeoutMs: 80 }))
    await waitFor(() => harness.server.macroRunner.snapshot(room.roomId).currentNodeId === 'capture_decision')
    harness.server.macroRunner.pause(room.roomId)
    await Bun.sleep(160)
    expect(harness.server.macroRunner.snapshot(room.roomId).status).toBe('paused')
    expect(await submitStructuredJson('{"decision":"continue","confidence":0.5}', env))
      .toMatchObject({ exitCode: 0 })
    await Bun.sleep(120)
    expect(harness.server.macroRunner.snapshot(room.roomId).status).toBe('paused')
    harness.server.macroRunner.resume(room.roomId)
    await waitFor(() => harness.server.macroRunner.snapshot(room.roomId).status === 'completed')

    await startRunner(harness, room.roomId, grant, decisionDefinition({ kind: 'unbounded' }))
    await waitFor(() => harness.server.macroRunner.snapshot(room.roomId).currentNodeId === 'capture_decision')
    harness.server.macroRunner.stop(room.roomId)
    expect(await submitStructuredJson('{"decision":"retry","confidence":0.7}', env))
      .toMatchObject({ exitCode: 1, stderr: 'structured_json_capture_not_waiting\n' })
    await waitFor(() => harness.server.macroRunner.snapshot(room.roomId).status === 'stopped')

    await startRunner(harness, room.roomId, grant, decisionDefinition({ kind: 'timeout', timeoutMs: 30 }))
    await waitFor(() => harness.server.macroRunner.snapshot(room.roomId).status === 'failed')
    expect(harness.server.macroRunner.snapshot(room.roomId).error)
      .toBe('structured_json_capture_timeout:' + terminal.terminalId)
  } finally {
    await harness.dispose()
  }
})

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-structured-json-'))
  const environments = new Map<string, Record<string, string>>()
  const manager = new TerminalRoomManager({
    backendFactory: (_kind, options) => {
      environments.set(options.terminalId!, definedEnvironment(options))
      return new FakeTerminalBackend(options)
    },
  })
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root, manager })
  return {
    root,
    server,
    environment(terminalId: string): Record<string, string> {
      const env = environments.get(terminalId)
      if (!env) throw new Error('terminal_environment_missing')
      return env
    },
    async dispose(): Promise<void> {
      await server.stop()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

async function startRunner(
  harness: ReturnType<typeof createHarness>,
  roomId: string,
  grant: RoomControlGrant,
  definition: MacroDefinitionV5,
): Promise<{ runId: string }> {
  const record = await harness.server.macroStore.create(definition)
  const ticket = harness.server.manager.admitControlledBearer(grant, roomId)
  try {
    const snapshot = await harness.server.macroRunner.start(
      ticket,
      record.id,
      record.revision,
      harness.server.manager.terminalStructureRevision(roomId),
    )
    if (!snapshot.runId) throw new Error('run_id_missing')
    return { runId: snapshot.runId }
  } finally {
    ticket.finish()
  }
}

function decisionDefinition(
  waitLimit: CaptureWaitLimit,
  withBranch = false,
): MacroDefinitionV5 {
  const body: MacroDefinitionV5['body'] = [{
    id: 'capture_decision',
    type: 'capture-source',
    capture: {
      kind: 'structured-json',
      terminal: { kind: 'terminal_index', index: 1 },
      schema: {
        type: 'object',
        required: ['decision', 'confidence'],
        additionalProperties: false,
        properties: {
          decision: { enum: ['continue', 'retry'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      waitLimit,
    },
  }]
  if (withBranch) body.push({
    id: 'branch',
    type: 'if',
    branches: [{
      kind: 'if',
      condition: {
        kind: 'json_match',
        source: {
          kind: 'step_artifact',
          stepId: 'capture_decision',
          artifact: 'captured_json',
        },
        pointer: '/decision',
        matcher: { kind: 'equals', value: 'retry' },
      },
      body: [{
        id: 'send_retry',
        type: 'send',
        terminal: { kind: 'terminal_index', index: 1 },
        message: {
          parts: [
            { kind: 'text', text: 'FORWARD:' },
            {
              kind: 'artifact',
              source: {
                kind: 'step_artifact',
                stepId: 'capture_decision',
                artifact: 'captured_json',
              },
            },
          ],
        },
        delivery: 'direct',
        ending: 'cr',
      }],
    }],
    else: [{
      id: 'send_continue',
      type: 'send',
      terminal: { kind: 'terminal_index', index: 1 },
      message: { parts: [{ kind: 'text', text: 'CONTINUE' }] },
      delivery: 'direct',
      ending: 'cr',
    }],
  })
  return {
    schemaVersion: 5,
    name: 'Structured decision',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body,
  }
}

function definedEnvironment(options: TerminalBackendOptions): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.env ?? {})) if (value !== undefined) result[key] = value
  return result
}

function roomGrant(manager: TerminalRoomManager, roomId: string): RoomControlGrant {
  const messages: ServerMessage[] = []
  manager.connectClient(roomId, (message) => messages.push(message))
  const grant = messages.find((message): message is Extract<ServerMessage, { type: 'room_control' }> => (
    message.type === 'room_control'
  ))?.grant
  if (!grant) throw new Error('missing_room_control_grant')
  return grant
}

function replay(manager: TerminalRoomManager, roomId: string, terminalId: string): string {
  return manager.roomSnapshot(roomId).terminals
    .find((terminal) => terminal.terminalId === terminalId)?.replay.join('') ?? ''
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('wait_timeout')
    await Bun.sleep(5)
  }
}
