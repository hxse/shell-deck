import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShellDeckServer } from '../../server/httpServer'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { MacroRunStore } from '../../server/macroRunStore'
import { MacroRecordStore } from '../../server/sharedContentStore'
import { TerminalRoomManager } from '../../server/terminalRoomManager'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import type { NotificationDispatcher } from '../../server/notificationService'
import type { MacroDefinitionV5, MacroRecord } from '../../src/lib/macro/macroDefinitionTypes'
import type { MacroRunnerSnapshot } from '../../src/lib/macro/runnerTypes'
import { mergeMacroRunnerDelta, validateMacroRunnerSnapshot } from '../../src/lib/macro/runnerSnapshotMerge'
import type { ServerMessage } from '../../src/lib/protocol'
import { roomControlHeaders, type RoomControlGrant } from '../../src/lib/roomControl'

test('Room websocket pushes one authoritative run and runtime input across takeover and reconnect', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-runtime-sync-035-'))
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
  const sockets: WebSocket[] = []
  try {
    const room = server.manager.createRoom()
    server.manager.createTerminal(room.roomId, { backend: 'text' })
    const first = await connect(server.url, room.roomId)
    const second = await connect(server.url, room.roomId)
    sockets.push(first.ws, second.ws)
    const firstGrant = requiredGrant(first.messages)

    expect(await latestRunner(first.messages)).toMatchObject({ status: 'idle', runtimeRevision: 0, runningMacro: null })
    expect(await latestRunner(second.messages)).toMatchObject({ status: 'idle', runtimeRevision: 0, runningMacro: null })

    const created = await mutate(server.url, '/api/templates', firstGrant, { definition: waitingDefinition() })
    expect(created.status).toBe(201)
    const record = (created.body as { template: MacroRecord }).template
    await waitFor(() => contentChanges(first.messages, record.id).length === 1 && contentChanges(second.messages, record.id).length === 1)

    const started = await mutate(server.url, `/api/rooms/${room.roomId}/runner/start`, firstGrant, {
      templateId: record.id,
      expectedMacroRevision: record.revision,
      expectedTerminalStructureRevision: 1,
    })
    expect(started.status).toBe(201)
    expect(started.body).toMatchObject({
      ok: true,
      ack: { status: 'running', runtimeRevision: expect.any(Number) },
    })
    expect(Object.hasOwn(started.body, 'runner')).toBe(false)
    expect(Object.hasOwn(started.body.ack as object, 'events')).toBe(false)
    expect(Object.hasOwn(started.body.ack as object, 'runningMacro')).toBe(false)
    await waitFor(async () => (await latestRunner(first.messages)).status === 'waiting_input'
      && (await latestRunner(second.messages)).status === 'waiting_input')
    const waiting = await latestRunner(second.messages)
    expect(waiting.runningMacro).toMatchObject({ recordId: record.id, recordRevision: 1, definition: waitingDefinition() })
    expect(waiting.runningMacro?.definitionHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(waiting.runtimeInput).toMatchObject({ prompt: 'Shared prompt', defaultText: '', draft: '', inputRevision: 0, status: 'waiting' })

    const takeover = await fetch(server.url + `/api/rooms/${room.roomId}/control/take-over`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shell-deck-client-id': registered(second.messages).clientId },
      body: JSON.stringify({ expectedControlEpoch: 1, confirmed: true }),
    })
    expect(takeover.status).toBe(200)
    const secondGrant = (await takeover.json() as { grant: RoomControlGrant }).grant

    const draft = await mutate(server.url, `/api/rooms/${room.roomId}/runner/input-draft`, secondGrant, {
      invocationId: waiting.runtimeInput!.invocationId,
      value: 'shared draft',
      expectedInputRevision: 0,
    })
    expect(draft.status).toBe(200)
    expect(draft.body).toMatchObject({
      ok: true,
      ack: {
        status: 'waiting_input',
        runtimeInput: {
          invocationId: waiting.runtimeInput!.invocationId,
          inputRevision: 1,
          status: 'waiting',
        },
      },
    })
    expect(Object.hasOwn(draft.body, 'runner')).toBe(false)
    const draftInputAck = (draft.body as { ack: { runtimeInput: object } }).ack.runtimeInput
    expect(Object.hasOwn(draftInputAck, 'draft')).toBe(false)
    expect(Object.hasOwn(draftInputAck, 'prompt')).toBe(false)
    expect(Object.hasOwn(draftInputAck, 'defaultText')).toBe(false)
    await waitFor(async () => (await latestRunner(first.messages)).runtimeInput?.draft === 'shared draft'
      && (await latestRunner(second.messages)).runtimeInput?.draft === 'shared draft')
    expect((await latestRunner(first.messages)).runtimeInput?.inputRevision).toBe(1)

    const staleRevision = await mutate(server.url, `/api/rooms/${room.roomId}/runner/input-draft`, secondGrant, {
      invocationId: waiting.runtimeInput!.invocationId,
      value: 'stale',
      expectedInputRevision: 0,
    })
    expect(staleRevision).toMatchObject({ status: 409, body: { ok: false, error: 'runner_input_revision_conflict' } })
    const staleOwner = await mutate(server.url, `/api/rooms/${room.roomId}/runner/input-draft`, firstGrant, {
      invocationId: waiting.runtimeInput!.invocationId,
      value: 'old controller',
      expectedInputRevision: 1,
    })
    expect(staleOwner.status).toBe(409)
    expect((staleOwner.body.error as string).startsWith('room_control_')).toBe(true)

    const legacySubmit = await mutate(server.url, `/api/rooms/${room.roomId}/runner/input`, secondGrant, { value: 'legacy' })
    expect(legacySubmit.status).toBe(400)
    expect(legacySubmit.body.error).toBe('request_missing_field:invocationId')

    const submitted = await mutate(server.url, `/api/rooms/${room.roomId}/runner/input`, secondGrant, {
      invocationId: waiting.runtimeInput!.invocationId,
      value: 'shared draft',
      expectedInputRevision: 1,
    })
    expect(submitted.status).toBe(200)
    expect(submitted.body).toMatchObject({ ok: true, ack: { runtimeInput: null } })
    await waitFor(async () => (await latestRunner(first.messages)).status === 'completed'
      && (await latestRunner(second.messages)).status === 'completed')
    expect((await latestRunner(first.messages)).runId).toBe((await latestRunner(second.messages)).runId)
    expect(strictlyIncreasing(runnerRevisions(first.messages))).toBe(true)
    expect(strictlyIncreasing(runnerRevisions(second.messages))).toBe(true)
    expect(first.messages.filter((message) => message.type === 'runner_snapshot')).toHaveLength(2)
    expect(first.messages.some((message) => message.type === 'runner_delta')).toBe(true)
    const deltas = first.messages
      .filter((message): message is Extract<ServerMessage, { type: 'runner_delta' }> => message.type === 'runner_delta')
    for (const message of deltas) {
      expect(Object.hasOwn(message.delta, 'definition')).toBe(false)
      expect(Object.hasOwn(message.delta, 'runningMacro')).toBe(false)
      expect(message.delta.definitionHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
    const deliveredEventSeqs = deltas
      .flatMap((message) => message.delta.events.map((event) => event.eventSeq))
    expect(new Set(deliveredEventSeqs).size).toBe(deliveredEventSeqs.length)
    const inputRequested = (await latestRunner(first.messages)).events.find((event) => event.kind === 'runner_input_requested')
    expect(inputRequested?.data).toEqual({
      invocationId: waiting.runtimeInput!.invocationId,
      inputRevision: 0,
      hasDefaultText: false,
      promptChars: 'Shared prompt'.length,
    })
    expect(Object.hasOwn(inputRequested?.data ?? {}, 'prompt')).toBe(false)
    expect(Object.hasOwn(inputRequested?.data ?? {}, 'defaultText')).toBe(false)
    expect(Object.hasOwn(inputRequested?.data ?? {}, 'draft')).toBe(false)
    expect(Object.hasOwn(inputRequested?.data ?? {}, 'value')).toBe(false)

    const late = await connect(server.url, room.roomId)
    sockets.push(late.ws)
    expect(await latestRunner(late.messages)).toMatchObject({
      runId: (await latestRunner(first.messages)).runId,
      status: 'completed',
      runningMacro: { recordId: record.id, recordRevision: 1 },
      runtimeInput: null,
    })
  } finally {
    await Promise.allSettled(sockets.map(closeWebSocket))
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Notify executes Telegram once and broadcasts one browser message to every connected Room client', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notification-sync-035-'))
  try {
    const manager = new TerminalRoomManager()
    const room = manager.createRoom()
    const firstMessages: ServerMessage[] = []
    const secondMessages: ServerMessage[] = []
    manager.connectClient(room.roomId, (message) => firstMessages.push(message))
    manager.connectClient(room.roomId, (message) => secondMessages.push(message))
    const grant = requiredGrant(firstMessages)
    const records = new MacroRecordStore<MacroDefinitionV5>(root)
    const record = await records.create({
      schemaVersion: 5,
      name: 'Notify once',
      description: '',
      terminalLayout: [],
      body: [{
        id: 'notify',
        type: 'notify',
        level: 'success',
        title: 'Done',
        message: { parts: [{ kind: 'text', text: 'one server execution' }] },
        channels: [
          { kind: 'app', toast: true, sound: 'none', repeatCount: 3, repeatIntervalMs: 1000 },
          { kind: 'system' },
          { kind: 'telegram', profileId: 'default' },
        ],
        onFailure: 'fail',
      }],
    })
    let telegramCalls = 0
    const notification: NotificationDispatcher = {
      async sendTelegram(request) {
        telegramCalls += 1
        return { ok: true, profileId: request.profileId, status: 200 }
      },
    }
    const runner = new MacroRunnerService(manager, records, new MacroRunStore(root), notification, new AgentEventStore(root))
    const ticket = manager.admitControlledBearer(grant, room.roomId)
    await runner.start(ticket, record.id, record.revision, 0)
    ticket.finish()
    await waitFor(() => runner.snapshot(room.roomId).status === 'completed')

    expect(telegramCalls).toBe(1)
    const firstNotifications = firstMessages.filter((message) => message.type === 'macro_notification')
    const secondNotifications = secondMessages.filter((message) => message.type === 'macro_notification')
    expect(firstNotifications).toHaveLength(1)
    expect(secondNotifications).toHaveLength(1)
    expect(firstNotifications[0]).toEqual(secondNotifications[0])
    expect(firstNotifications[0]).toMatchObject({
      channels: [
        { kind: 'app', toast: true, sound: 'none', repeatCount: 3, repeatIntervalMs: 1000 },
        { kind: 'system' },
      ],
    })

    const lateMessages: ServerMessage[] = []
    manager.connectClient(room.roomId, (message) => lateMessages.push(message))
    expect(lateMessages.some((message) => message.type === 'macro_notification')).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function waitingDefinition(): MacroDefinitionV5 {
  return {
    schemaVersion: 5,
    name: 'Shared runtime',
    description: '',
    terminalLayout: [{ index: 1, type: 'text' }],
    body: [{
      id: 'input',
      type: 'input',
      terminal: { kind: 'terminal_index', index: 1 },
      prompt: 'Shared prompt',
      allowEmpty: false,
      delivery: 'direct',
      ending: 'none',
    }],
  }
}

async function connect(baseUrl: string, roomId: string) {
  const messages: ServerMessage[] = []
  const ws = new WebSocket(baseUrl.replace('http://', 'ws://') + '/ws/rooms/' + roomId)
  ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))))
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error('ws_error')), { once: true })
  })
  await waitFor(() => messages.some((message) => message.type === 'runner_snapshot') && messages.some((message) => message.type === 'room_control'))
  return { ws, messages }
}

async function mutate(baseUrl: string, path: string, grant: RoomControlGrant, body: object) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...roomControlHeaders(grant) },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

function registered(messages: ServerMessage[]): Extract<ServerMessage, { type: 'client_registered' }> {
  const message = messages.find((candidate): candidate is Extract<ServerMessage, { type: 'client_registered' }> => candidate.type === 'client_registered')
  if (!message) throw new Error('missing_client_registered')
  return message
}

function requiredGrant(messages: ServerMessage[]): RoomControlGrant {
  const message = messages.find((candidate): candidate is Extract<ServerMessage, { type: 'room_control' }> => candidate.type === 'room_control' && candidate.grant !== undefined)
  if (!message?.grant) throw new Error('missing_room_control_grant')
  return message.grant
}

async function latestRunner(messages: ServerMessage[]): Promise<MacroRunnerSnapshot> {
  let current: MacroRunnerSnapshot | null = null
  for (const message of messages) {
    if (message.type === 'runner_snapshot') {
      if (!current || current.roomGeneration !== message.snapshot.roomGeneration
        || message.snapshot.runtimeRevision > current.runtimeRevision) {
        const validated = await validateMacroRunnerSnapshot(message.snapshot)
        if (validated.kind !== 'applied') throw new Error('runner_snapshot_hash_mismatch')
        current = validated.snapshot
      }
      continue
    }
    if (message.type !== 'runner_delta') continue
    const merged = await mergeMacroRunnerDelta(current, message.delta)
    if (merged.kind === 'resync_required') throw new Error('runner_delta_gap')
    current = merged.snapshot
  }
  if (!current) throw new Error('missing_runner_snapshot')
  return current
}

function runnerRevisions(messages: ServerMessage[]): number[] {
  return messages.flatMap((message) => message.type === 'runner_snapshot'
    ? [message.snapshot.runtimeRevision]
    : message.type === 'runner_delta' ? [message.delta.runtimeRevision] : [])
}

function contentChanges(messages: ServerMessage[], itemId: string) {
  return messages.filter((message) => message.type === 'content_record_changed' && message.resourceKey.kind === 'macro' && message.resourceKey.itemId === itemId)
}

function strictlyIncreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1])
}

function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1_000)
    socket.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.close()
  })
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('timeout')
    await Bun.sleep(10)
  }
}
