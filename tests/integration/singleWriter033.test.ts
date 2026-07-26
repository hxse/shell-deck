import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShellDeckServer } from '../../server/httpServer'
import { writePrivateFileAtomic } from '../../server/userDataRoot'
import type { ContentResourceKey } from '../../src/lib/contentEditLease'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { ServerMessage } from '../../src/lib/protocol'
import { roomControlHeaders, type RoomControlGrant } from '../../src/lib/roomControl'

test('same-Room observer is rejected server-side and explicit takeover revokes the old writer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-single-writer-http-'))
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
  const sockets: WebSocket[] = []
  try {
    const room = server.manager.createRoom()
    const terminal = server.manager.createTerminal(room.roomId, { backend: 'fake' })
    const first = await connect(server.url, room.roomId)
    const second = await connect(server.url, room.roomId)
    sockets.push(first.ws, second.ws)

    expect(latestControl(first.messages).view.mode).toBe('controller')
    expect(latestControl(first.messages).grant).toBeDefined()
    expect(latestControl(second.messages).view.mode).toBe('observer')
    expect(latestControl(second.messages).grant).toBeUndefined()

    second.ws.send(JSON.stringify({ type: 'terminal_input', terminalId: terminal.terminalId, data: 'blocked\r' }))
    await waitFor(() => hasError(second.messages, 'room_control_required'))
    expect(outputText(first.messages, terminal.terminalId)).not.toContain('blocked')

    first.ws.send(JSON.stringify({ type: 'terminal_input', terminalId: terminal.terminalId, data: 'first\r' }))
    await waitFor(() => outputText(second.messages, terminal.terminalId).includes('ECHO:first'))

    const secondClientId = registered(second.messages).clientId
    const missingConfirmation = await fetch(server.url + '/api/rooms/' + room.roomId + '/control/take-over', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shell-deck-client-id': secondClientId },
      body: JSON.stringify({ expectedControlEpoch: 1, confirmed: false }),
    })
    expect(missingConfirmation.status).toBe(409)
    expect(await missingConfirmation.json()).toMatchObject({ ok: false, error: 'room_control_takeover_confirmation_required' })

    const takeoverResponse = await fetch(server.url + '/api/rooms/' + room.roomId + '/control/take-over', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shell-deck-client-id': secondClientId },
      body: JSON.stringify({ expectedControlEpoch: 1, confirmed: true }),
    })
    const takeover = await takeoverResponse.json() as { ok: boolean; grant: RoomControlGrant }
    expect(takeoverResponse.status).toBe(200)
    expect(takeover.grant.controlEpoch).toBe(2)
    await waitFor(() => first.messages.some((message) => message.type === 'room_control_lost'))

    first.ws.send(JSON.stringify({ type: 'terminal_input', terminalId: terminal.terminalId, data: 'stale\r' }))
    await waitFor(() => hasError(first.messages, 'room_control_lost'))
    second.ws.send(JSON.stringify({ type: 'terminal_input', terminalId: terminal.terminalId, data: 'second\r' }))
    await waitFor(() => outputText(first.messages, terminal.terminalId).includes('ECHO:second'))
    expect(outputText(first.messages, terminal.terminalId)).not.toContain('ECHO:stale')

    const release = await fetch(server.url + '/api/rooms/' + room.roomId + '/control', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', ...roomControlHeaders(takeover.grant) },
      body: '{}',
    })
    expect(release.status).toBe(200)
    await waitFor(() => latestControl(second.messages).view.mode === 'available')

    const acquire = await fetch(server.url + '/api/rooms/' + room.roomId + '/control/acquire', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shell-deck-client-id': registered(first.messages).clientId },
      body: JSON.stringify({ expectedControlEpoch: 2 }),
    })
    expect(acquire.status).toBe(200)
    expect(await acquire.json()).toMatchObject({ ok: true, grant: { controlEpoch: 3 } })
    const removedAlias = await fetch(server.url + '/api/rooms/' + room.roomId + '/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shell-deck-client-id': registered(second.messages).clientId },
      body: JSON.stringify({ expectedControlEpoch: 3 }),
    })
    expect(removedAlias.status).toBe(405)
  } finally {
    await Promise.allSettled(sockets.map(closeWebSocket))
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('content lease HTTP API excludes the same record across Rooms while different records remain independent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-content-http-'))
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
  const sockets: WebSocket[] = []
  try {
    const firstRoom = server.manager.createRoom()
    const secondRoom = server.manager.createRoom()
    const first = await connect(server.url, firstRoom.roomId)
    const second = await connect(server.url, secondRoom.roomId)
    sockets.push(first.ws, second.ws)
    const firstGrant = requiredGrant(first.messages)
    const secondGrant = requiredGrant(second.messages)
    const key = macroKey()
    const otherKey = macroKey()
    writeRecord(server.contentEditLeases.recordPath(key), key.itemId)
    writeRecord(server.contentEditLeases.recordPath(otherKey), otherKey.itemId)

    const bypass = await fetch(server.url + '/api/content-edit-leases/acquire', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceKey: key, expectedLeaseEpoch: 0 }),
    })
    expect(bypass.status).toBe(409)
    expect(await bypass.json()).toMatchObject({ ok: false, error: 'room_control_required' })

    const acquired = await contentRequest(server.url, '/api/content-edit-leases/acquire', firstGrant, {
      resourceKey: key,
      expectedLeaseEpoch: 0,
    })
    expect(acquired.status).toBe(200)
    const acquiredBody = acquired.body as { grant: { editLeaseId: string; leaseEpoch: number } }
    expect(acquiredBody.grant.leaseEpoch).toBe(1)

    const held = await contentRequest(server.url, '/api/content-edit-leases/acquire', secondGrant, {
      resourceKey: key,
      expectedLeaseEpoch: 1,
    })
    expect(held.status).toBe(409)
    expect(held.body).toMatchObject({ ok: false, error: 'content_edit_lease_held' })

    const independent = await contentRequest(server.url, '/api/content-edit-leases/acquire', secondGrant, {
      resourceKey: otherKey,
      expectedLeaseEpoch: 0,
    })
    expect(independent.status).toBe(200)

    const takeover = await contentRequest(server.url, '/api/content-edit-leases/take-over', secondGrant, {
      resourceKey: key,
      expectedLeaseEpoch: 1,
      confirmed: true,
    })
    expect(takeover.status).toBe(200)
    expect(takeover.body).toMatchObject({ grant: { leaseEpoch: 2 } })

    const staleRelease = await fetch(server.url + '/api/content-edit-leases/' + acquiredBody.grant.editLeaseId, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', ...roomControlHeaders(firstGrant) },
      body: '{}',
    })
    expect(staleRelease.status).toBe(409)
    expect(await staleRelease.json()).toMatchObject({ ok: false, error: 'content_edit_lease_lost' })

    await server.manager.destroyRoom(secondRoom.roomId, secondRoom.roomGeneration)
    expect(await server.contentEditLeases.view(key)).toEqual({ mode: 'available', leaseEpoch: 2 })
    expect(await server.contentEditLeases.view(otherKey)).toEqual({ mode: 'available', leaseEpoch: 1 })
  } finally {
    await Promise.allSettled(sockets.map(closeWebSocket))
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

async function connect(baseUrl: string, roomId: string) {
  const messages: ServerMessage[] = []
  const ws = new WebSocket(baseUrl.replace('http://', 'ws://') + '/ws/rooms/' + roomId)
  ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))))
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error('ws_error')), { once: true })
  })
  await waitFor(() => messages.some((message) => message.type === 'room_snapshot') && messages.some((message) => message.type === 'room_control'))
  return { ws, messages }
}

async function contentRequest(baseUrl: string, path: string, grant: RoomControlGrant, body: object) {
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

function latestControl(messages: ServerMessage[]): Extract<ServerMessage, { type: 'room_control' }> {
  const message = messages.filter((candidate): candidate is Extract<ServerMessage, { type: 'room_control' }> => candidate.type === 'room_control').at(-1)
  if (!message) throw new Error('missing_room_control')
  return message
}

function requiredGrant(messages: ServerMessage[]): RoomControlGrant {
  const grant = latestControl(messages).grant
  if (!grant) throw new Error('missing_room_control_grant')
  return grant
}

function hasError(messages: ServerMessage[], reason: string): boolean {
  return messages.some((message) => message.type === 'terminal_error' && message.reason === reason)
}

function outputText(messages: ServerMessage[], terminalId: string): string {
  return messages.filter((message): message is Extract<ServerMessage, { type: 'pty_output' }> => message.type === 'pty_output' && message.terminalId === terminalId).map((message) => message.data).join('')
}

function macroKey(): Extract<ContentResourceKey, { kind: 'macro' }> {
  return { kind: 'macro', itemId: createGeneratedId('macroTemplate') }
}

function writeRecord(path: string, id: string): void {
  writePrivateFileAtomic(path, JSON.stringify({
    id,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    definition: {},
  }) + '\n')
}

function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1_000)
    socket.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.close()
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('timeout')
}
