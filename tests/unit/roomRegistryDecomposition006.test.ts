import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_REPLAY_BYTE_LIMIT,
  MAX_LIVE_ROOMS,
  ROOM_CONTROL_HEARTBEAT_MS,
  ROOM_CONTROL_TTL_MS,
  TerminalRoomManager,
  defaultBackendFactory,
  resolveShellCwd,
} from '../../server/terminalRoomManager'

describe('Room registry lifecycle and public facade decomposition', () => {
  test('manager creates the only Room/client maps and registry owns only destroy single-flight state', () => {
    const serverRoot = resolve(import.meta.dir, '../../server')
    const manager = readFileSync(resolve(serverRoot, 'terminalRoomManager.ts'), 'utf8')
    const registry = readFileSync(resolve(serverRoot, 'roomRegistryLifecycleCoordinator.ts'), 'utf8')
    const productionFiles = readdirSync(serverRoot).filter((file) => file.endsWith('.ts'))

    expect(consumers(serverRoot, productionFiles, 'roomRegistryLifecycleCoordinator')).toEqual(['terminalRoomManager.ts'])
    expect(registry).not.toMatch(/from ['"]\.\/terminalRoomManager['"]/)
    expect(registry).not.toContain('RoomControlCoordinator')
    expect(registry).not.toContain('TerminalBackendCoordinator')
    expect((manager + registry).match(/rooms\s*=\s*new Map<string, RoomRuntime>/g)).toHaveLength(1)
    expect((manager + registry).match(/clients\s*=\s*new Map<string, RoomClient>/g)).toHaveLength(1)
    expect((manager + registry).match(/destroying\s*=\s*new Map<string, Promise<void>>/g)).toHaveLength(1)
    expect(manager).not.toContain('destroying = new Map')
    expect(manager.match(/rooms: this\.rooms/g)).toHaveLength(3)
    expect(manager.match(/clients: this\.clients/g)).toHaveLength(2)

    expect(manager).not.toContain('createRoomRuntime(')
    expect(manager).not.toContain('beginRoomDestruction(')
    expect(manager).not.toContain('finishRoomDestruction(')
    expect(manager).not.toContain('admitRoomOperation(')
    expect(manager).not.toContain('room_capacity_reached')
    expect(manager).toContain('return this.registryCoordinator.ensureRootRoom()')
    expect(manager).toContain('return this.registryCoordinator.admit(roomId)')
    expect(manager).toContain('await this.registryCoordinator.destroyRoom(roomId, expectedRoomGeneration)')

    for (const source of [manager, registry, readFileSync(import.meta.path, 'utf8')]) {
      expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(400)
    }
  })

  test('facade retains constants, helpers, public methods and async boundaries', () => {
    expect(MAX_LIVE_ROOMS).toBe(32)
    expect(ROOM_CONTROL_HEARTBEAT_MS).toBe(10_000)
    expect(ROOM_CONTROL_TTL_MS).toBe(30_000)
    expect(DEFAULT_REPLAY_BYTE_LIMIT).toBeGreaterThan(0)
    expect(typeof defaultBackendFactory).toBe('function')
    expect(typeof resolveShellCwd).toBe('function')

    const prototype = TerminalRoomManager.prototype as unknown as Record<string, Function>
    for (const method of [
      'setTerminalEnvProvider',
      'setActiveRunProvider',
      'setDestroyHook',
      'addDestroyHook',
      'setControlLostHook',
      'setControlHeartbeatHook',
      'ensureRootRoom',
      'createRoom',
      'ensureRoomFromRoute',
      'listRooms',
      'roomSummaryById',
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
      'admit',
      'runOperation',
      'createTerminal',
      'input',
      'setTextContent',
      'resize',
      'resetTerminal',
      'moveTerminal',
      'closeTerminal',
      'requestReplay',
      'roomSnapshot',
      'terminalPositions',
      'terminalStructureRevision',
      'runTerminalStructureOperation',
      'runTerminalStructureMutation',
      'acquireRunStructureLock',
      'releaseRunStructureLock',
      'indexMap',
      'hasTerminalLaunch',
      'terminalOutputActivityRevision',
      'resolveTerminal',
      'terminalSnapshot',
      'broadcastRoomMessage',
      'broadcastAllClients',
      'destroyRoom',
      'destroyAllRooms',
    ]) {
      expect(typeof prototype[method]).toBe('function')
    }
    for (const method of [
      'takeOverRoomControl',
      'releaseRoomControl',
      'runControlledClientOperation',
      'runControlledBearerOperation',
      'runControlledBearerPublishedOperation',
      'runOperation',
      'runTerminalStructureOperation',
      'runTerminalStructureMutation',
      'destroyRoom',
      'destroyAllRooms',
    ]) {
      expect(prototype[method].constructor.name).toBe('AsyncFunction')
    }
  })

  test('creation, lookup and summary keep exact shared guards and projection order', () => {
    const registry = readFileSync(resolve(import.meta.dir, '../../server/roomRegistryLifecycleCoordinator.ts'), 'utf8')
    expectOrdered(methodSource(registry, '  createRoom(', '  ensureRoomFromRoute('), [
      'this.assertCapacity()',
      'for (let attempt = 0; attempt < 8; attempt += 1)',
      "assertGeneratedId(this.options.roomIdFactory(), 'room')",
      'if (this.options.rooms.has(roomId)) continue',
      'return this.createRoomWithToken(roomId)',
      "throw new Error('room_id_collision')",
    ])
    expectOrdered(methodSource(registry, '  ensureRoomFromRoute(', '  listRooms('), [
      'const token = assertRoomRouteToken(roomId)',
      'const existing = this.options.rooms.get(token)',
      "if (existing.lifecycle !== 'active') throw new Error('room_destroying')",
      'return { room: this.roomSummary(existing), created: false }',
      'this.assertCapacity()',
      'return { room: this.createRoomWithToken(token), created: true }',
    ])
    expectOrdered(methodSource(registry, '  listRooms(', '  roomSummaryById('), [
      '[...this.options.rooms.values()]',
      ".filter((room) => room.lifecycle !== 'destroyed')",
      '.map((room) => this.roomSummary(room))',
      '.sort((left, right) => left.roomId.localeCompare(right.roomId))',
    ])
    expectOrdered(methodSource(registry, '  private createRoomWithToken(', '  private assertCapacity('), [
      "throw new Error('room_id_conflict')",
      'const roomGeneration = this.nextRoomGeneration()',
      'const room = createRoomRuntime(roomId, roomGeneration)',
      'this.options.rooms.set(roomId, room)',
      'return this.roomSummary(room)',
    ])
    expectOrdered(methodSource(registry, '  private roomSummary(', '  private nextRoomGeneration('), [
      'terminalCount: room.terminals.size',
      'connectedClientCount: room.clients.size',
      'hasActiveRun: this.activeRunProvider(room.roomId, room.roomGeneration)',
    ])
  })

  test('admission and Destroy retain validation, abort, drain and removal order', () => {
    const registry = readFileSync(resolve(import.meta.dir, '../../server/roomRegistryLifecycleCoordinator.ts'), 'utf8')
    expectOrdered(methodSource(registry, '  admit(', '  async destroyRoom('), [
      'const room = this.activeRoomOrThrow(roomId)',
      'return admitRoomOperation(room, () => this.options.rooms.get(room.roomId) === room)',
    ])
    expectOrdered(methodSource(registry, '  async destroyRoom(', '  async destroyAllRooms('), [
      'const token = assertRoomRouteToken(roomId)',
      "assertGeneratedId(expectedRoomGeneration, 'roomGeneration')",
      'const room = this.options.rooms.get(token)',
      "throw new Error('room_not_found')",
      "throw new Error('room_generation_conflict')",
      "throw new Error('room_destroying')",
      'const previousController = room.controller ? this.options.ownerContext(room.controller) : null',
      'beginRoomDestruction(room)',
      'const operation = finishRoomDestruction(room, previousController',
      'controlLost: (owner) => this.options.invokeControlLost(owner)',
      'destroyHooks: () => this.destroyHooks',
      'closeTerminalResource: (activeRoom, terminal) => this.options.closeTerminalResource(activeRoom, terminal)',
      'removeClient: (clientId) => { this.options.clients.delete(clientId) }',
      'removeRoom: (activeRoomId) => { this.options.rooms.delete(activeRoomId) }',
      'this.destroying.set(room.roomId, operation)',
      'try { await operation } finally { this.destroying.delete(room.roomId) }',
    ])
    expectOrdered(methodSource(registry, '  async destroyAllRooms(', '  private createRoomWithToken('), [
      "filter((room) => room.lifecycle === 'active')",
      'targets.map(async (room) => await this.destroyRoom(room.roomId, room.roomGeneration))',
      'await Promise.allSettled([...started, ...this.destroying.values()])',
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
