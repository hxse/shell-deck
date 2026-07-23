import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ROOM_CONTROL_HEARTBEAT_MS,
  ROOM_CONTROL_TTL_MS,
  RoomControlCoordinator,
} from '../../server/roomControlCoordinator'

describe('Room control presence and lease decomposition', () => {
  test('facade composes one shared-map presence owner and one controller transition owner', () => {
    const serverRoot = resolve(import.meta.dir, '../../server')
    const names = [
      'roomControlCoordinator.ts',
      'roomClientPresenceCoordinator.ts',
      'roomControllerLeaseCoordinator.ts',
    ] as const
    const sources = Object.fromEntries(names.map((name) => [
      name,
      readFileSync(resolve(serverRoot, name), 'utf8'),
    ])) as Record<(typeof names)[number], string>
    const productionFiles = readdirSync(serverRoot).filter((file) => file.endsWith('.ts'))
    const facade = sources['roomControlCoordinator.ts']
    const presence = sources['roomClientPresenceCoordinator.ts']
    const lease = sources['roomControllerLeaseCoordinator.ts']

    expect(consumers(serverRoot, productionFiles, 'roomControlCoordinator')).toEqual(['terminalRoomManager.ts'])
    expect(consumers(serverRoot, productionFiles, 'roomClientPresenceCoordinator')).toEqual(['roomControlCoordinator.ts'])
    expect(consumers(serverRoot, productionFiles, 'roomControllerLeaseCoordinator')).toEqual([
      'roomClientPresenceCoordinator.ts',
      'roomControlCoordinator.ts',
    ])
    expect(presence).not.toMatch(/from ['"]\.\/roomControlCoordinator['"]/)
    expect(lease).not.toMatch(/from ['"]\.\/roomControlCoordinator['"]/)

    expect(facade).toContain('rooms: options.rooms')
    expect(facade.match(/clients: options\.clients/g)).toHaveLength(2)
    expect([facade, presence, lease].join('\n')).not.toContain('new Map')
    expect(presence).not.toContain('room.controller')
    expect(presence).not.toContain('controlEpoch')
    expect(presence).not.toContain('controlLeaseIdFactory')
    expect(lease).not.toContain('clientIdFactory')
    expect(lease).not.toContain('roomSnapshot')
    expect(facade).not.toContain('room.controller')
    expect(lease).toContain('room.controlEpoch += 1')
    expect(lease).toContain('room.controller = null')

    for (const source of [...Object.values(sources), readFileSync(import.meta.path, 'utf8')]) {
      expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(400)
    }
  })

  test('facade retains constants, methods and async public boundaries', () => {
    expect(ROOM_CONTROL_HEARTBEAT_MS).toBe(10_000)
    expect(ROOM_CONTROL_TTL_MS).toBe(30_000)
    const prototype = RoomControlCoordinator.prototype as unknown as Record<string, Function>
    for (const method of [
      'setControlLostHook',
      'setControlHeartbeatHook',
      'connectClient',
      'disconnectClient',
      'noteClientPong',
      'heartbeatSweep',
      'roomControlView',
      'acquireRoomControl',
      'takeOverRoomControl',
      'releaseRoomControl',
      'admitControlledClient',
      'admitControlledBearer',
      'runControlledClientMutation',
      'runControlledClientOperation',
      'runControlledBearerOperation',
      'runControlledBearerPublishedOperation',
      'assertRoomControlContext',
      'ownerContext',
      'invokeControlLost',
    ]) {
      expect(typeof prototype[method]).toBe('function')
    }
    for (const method of [
      'takeOverRoomControl',
      'releaseRoomControl',
      'runControlledClientOperation',
      'runControlledBearerOperation',
      'runControlledBearerPublishedOperation',
    ]) {
      expect(prototype[method].constructor.name).toBe('AsyncFunction')
    }
  })

  test('connect, disconnect, pong and heartbeat phases retain source order', () => {
    const serverRoot = resolve(import.meta.dir, '../../server')
    const presence = readFileSync(resolve(serverRoot, 'roomClientPresenceCoordinator.ts'), 'utf8')
    const lease = readFileSync(resolve(serverRoot, 'roomControllerLeaseCoordinator.ts'), 'utf8')

    expectOrdered(methodSource(presence, '  connectClient(', '  disconnectClient('), [
      'room.clients.set(clientId, client)',
      'this.options.clients.set(clientId, client)',
      "send({ type: 'client_registered'",
      'this.controller.connectClient(room, client, now)',
      'send(this.options.roomSnapshot(room.roomId))',
      'room.clients.delete(clientId)',
      'this.options.clients.delete(clientId)',
    ])
    expectOrdered(methodSource(presence, '  disconnectClient(', '  noteClientPong('), [
      'this.options.clients.delete(clientId)',
      'const room = this.options.rooms.get(client.roomId)',
      'room?.clients.delete(clientId)',
      'this.controller.disconnectClient(room, clientId)',
    ])
    expectOrdered(methodSource(presence, '  noteClientPong(', '  heartbeatSweep('), [
      'client.awaitingPong = false',
      'client.lastPongAtMs = now',
      'this.controller.noteClientPong(room, client, now)',
    ])
    expectOrdered(methodSource(lease, '  noteClientPong(', '  expireControllerIfNeeded('), [
      'this.expireControllerIfNeeded(room, now)',
      'if (room.controller?.clientId !== client.clientId) return',
      'room.controller.expiresAtMs = now + ROOM_CONTROL_TTL_MS',
      'const context = this.ownerContext(room.controller)',
      'this.broadcastControlState(room)',
      'this.controlHeartbeatHook(context)',
    ])
    expectOrdered(methodSource(presence, '  heartbeatSweep(', '\n  }\n}'), [
      'for (const room of this.options.rooms.values())',
      'this.controller.expireControllerIfNeeded(room, now)',
      'for (const client of [...this.options.clients.values()])',
      'this.disconnectClient(client.clientId)',
      "client.close?.(4002, 'room_control_heartbeat_timeout')",
      'client.awaitingPong = true',
      'client.ping()',
      "client.close?.(4002, 'room_control_heartbeat_failed')",
    ])
  })

  test('takeover and controlled operation authorization phases stay explicit', () => {
    const lease = readFileSync(resolve(import.meta.dir, '../../server/roomControllerLeaseCoordinator.ts'), 'utf8')
    const takeover = methodSource(lease, '  async takeOverRoomControl(', '  async releaseRoomControl(')
    expectOrdered(takeover, [
      "throw new Error('room_control_takeover_confirmation_required')",
      'const client = this.clientOrThrow(clientId)',
      'const lifecycle = this.options.admit(client.roomId)',
      'this.expireControllerIfNeeded(room, now)',
      'if (room.controlEpoch !== expected)',
      'const previous = this.ownerContext(room.controller)',
      'const grant = this.assignControllerState(room, client, now)',
      'await Promise.resolve(this.controlLostHook(previous)).catch(() => {})',
      'lifecycle.assertActive()',
      'this.assertRoomControlContext(nextContext)',
      "type: 'room_control_lost'",
      'this.broadcastControlState(room, true)',
      'return grant',
      'lifecycle.finish()',
    ])

    const ordinary = methodSource(lease, '  async runControlledBearerOperation<', '  async runControlledBearerPublishedOperation<')
    expectOrdered(ordinary, [
      'ticket.assertAuthorized()',
      'const result = await operation(ticket)',
      'ticket.assertAuthorized()',
      'return result',
      'ticket.finish()',
    ])
    const published = methodSource(lease, '  async runControlledBearerPublishedOperation<', '  assertRoomControlContext(')
    expect(published.match(/ticket\.assertAuthorized\(\)/g)).toHaveLength(1)
    expectOrdered(published, [
      'ticket.assertAuthorized()',
      'return await operation(ticket)',
      'ticket.finish()',
    ])
  })
})

function consumers(serverRoot: string, files: string[], moduleName: string): string[] {
  const pattern = new RegExp(`from ['"]\\./${moduleName}['"]`)
  return files
    .filter((file) => pattern.test(readFileSync(resolve(serverRoot, file), 'utf8')))
    .sort()
}

function methodSource(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex, `missing method start: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `missing method end: ${end}`).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

function expectOrdered(source: string, needles: string[]): void {
  let offset = 0
  for (const needle of needles) {
    const index = source.indexOf(needle, offset)
    expect(index, `${needle} must remain after the previous phase`).toBeGreaterThanOrEqual(offset)
    offset = index + needle.length
  }
}
