import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { startShellDeckServer, type ShellDeckServer } from '../../server/httpServer'
import { createGeneratedId } from '../../src/lib/generatedId'

let server: ShellDeckServer
let root: string

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'shell-deck-032-http-'))
  server = startShellDeckServer({ port: await freePort(), dataRoot: root })
})

afterAll(async () => {
  await server.stop()
  rmSync(root, { recursive: true, force: true })
})

test('Root, Home, New, stale Destroy and direct-token revisit follow canonical Room routing', async () => {
  const initial = await fetch(server.url + '/', { redirect: 'manual' })
  expect(initial.status).toBe(302)
  expect(initial.headers.get('cache-control')).toContain('no-store')
  const location = initial.headers.get('location')!
  expect(location).toMatch(/^\/room_[1-9A-HJ-NP-Za-km-z]{22}$/)

  const home = await fetch(server.url + '/', { redirect: 'manual' })
  expect(home.status).toBe(200)
  expect(await home.text()).toContain('<!doctype html>')
  const listed = await json(server.url + '/api/rooms')
  expect(listed.rooms).toHaveLength(1)
  const first = listed.rooms[0]

  const createdResponse = await fetch(server.url + '/api/rooms', { method: 'POST' })
  expect(createdResponse.status).toBe(201)
  const created = await createdResponse.json()
  expect(created.url).toBe('/' + created.room.roomId)

  const stale = await fetch(server.url + '/api/rooms/' + first.roomId, {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRoomGeneration: created.room.roomGeneration }),
  })
  expect(stale.status).toBe(409)
  expect((await stale.json()).error).toBe('room_generation_conflict')

  const removed = await fetch(server.url + '/api/rooms/' + first.roomId, {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRoomGeneration: first.roomGeneration }),
  })
  expect(removed.status).toBe(200)
  const revisit = await fetch(server.url + '/' + first.roomId, { redirect: 'manual' })
  expect(revisit.status).toBe(200)
  const revisited = (await json(server.url + '/api/rooms')).rooms.find((room: { roomId: string }) => room.roomId === first.roomId)
  expect(revisited.roomGeneration).not.toBe(first.roomGeneration)

  expect((await fetch(server.url + '/r/main')).status).toBe(404)
  expect((await fetch(server.url + '/api/configs/local/templates')).status).toBe(404)
  expect((await fetch(server.url + '/ws?configId=local')).status).toBe(404)
  expect((await fetch(server.url + '/?configId=local', { redirect: 'manual' })).status).toBe(404)
  expect((await fetch(server.url + '/' + first.roomId + '?configId=local')).status).toBe(404)
})

test('concurrent first entry has one creator and same token stays process-local', async () => {
  for (const room of server.manager.listRooms()) await server.manager.destroyRoom(room.roomId, room.roomGeneration)
  const entries = await Promise.all([
    fetch(server.url + '/', { redirect: 'manual' }),
    fetch(server.url + '/', { redirect: 'manual' }),
  ])
  expect(entries.map((response) => response.status).sort()).toEqual([200, 302])
  const room = (await json(server.url + '/api/rooms')).rooms[0]

  const second = startShellDeckServer({ port: await freePort(), dataRoot: root })
  try {
    expect((await fetch(second.url + '/' + room.roomId)).status).toBe(200)
    const isolated = (await json(second.url + '/api/rooms')).rooms[0]
    expect(isolated.roomId).toBe(room.roomId)
    expect(isolated.roomGeneration).not.toBe(room.roomGeneration)
    expect((await json(server.url + '/api/rooms')).rooms[0].roomGeneration).toBe(room.roomGeneration)
  } finally { await second.stop() }
})

test('HTTP capacity and exact-empty New body preserve zero-mutation failure boundaries', async () => {
  for (const room of server.manager.listRooms()) await server.manager.destroyRoom(room.roomId, room.roomGeneration)
  const invalidBody = await fetch(server.url + '/api/rooms', { method: 'POST', body: '{}' })
  expect(invalidBody.status).toBe(400)
  expect(server.manager.listRooms()).toHaveLength(0)
  for (let index = 0; index < server.manager.maxLiveRooms; index += 1) server.manager.createRoom()
  const before = server.manager.listRooms().map((room) => room.roomId)
  const fullNew = await fetch(server.url + '/api/rooms', { method: 'POST' })
  expect(fullNew.status).toBe(409)
  const direct = await fetch(server.url + '/' + createGeneratedId('room'))
  expect(direct.status).toBe(409)
  expect(server.manager.listRooms().map((room) => room.roomId)).toEqual(before)
  expect((await fetch(server.url + '/api/agent-events', { method: 'POST', body: '{}' })).status).toBe(404)
})

async function json(url: string) {
  const response = await fetch(url)
  expect(response.status).toBe(200)
  return await response.json() as any
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const socket = createServer()
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address()
      socket.close(() => address && typeof address === 'object' ? resolvePort(address.port) : reject(new Error('free_port_failed')))
    })
  })
}
