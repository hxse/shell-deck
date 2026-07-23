import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { TerminalBackendKind } from '../../src/lib/protocol'
import {
  admitRoomOperation,
  beginRoomDestruction,
  createRoomRuntime,
  finishRoomDestruction,
} from '../../server/roomLifecycleCoordinator'
import type { TerminalBackend } from '../../server/terminalBackend'
import {
  acquireTerminalStructureLock,
  commitTerminalClose,
  commitTerminalCreate,
  commitTerminalMove,
  commitTerminalRestart,
  releaseTerminalStructureLock,
  runSerializedTerminalStructureMutation,
} from '../../server/terminalMutationCoordinator'
import {
  advanceTerminalOutputActivity,
  appendTerminalReplay,
  createTerminalReplayFields,
  replaceTerminalReplay,
  terminalReplayChunks,
} from '../../server/terminalReplayBuffer'
import {
  advanceTerminalRuntimeRevision,
  createTerminalRuntimeState,
  restartTerminalRuntimeState,
} from '../../server/terminalRuntimeState'
import {
  projectRoomSnapshot,
  projectTerminalIndexMapMessage,
  projectTerminalSnapshot,
} from '../../server/terminalSnapshotProjection'
import { TerminalRoomManager } from '../../server/terminalRoomManager'

describe('Terminal Room manager extraction', () => {
  test('manager remains the only production facade for single-state control and backend coordinators', () => {
    const serverRoot = resolve(import.meta.dir, '../../server')
    const managerSource = readFileSync(resolve(serverRoot, 'terminalRoomManager.ts'), 'utf8')
    const controlSource = readFileSync(resolve(serverRoot, 'roomControlCoordinator.ts'), 'utf8')
    const backendSource = readFileSync(resolve(serverRoot, 'terminalBackendCoordinator.ts'), 'utf8')
    const directConsumers = readdirSync(serverRoot)
      .filter((file) => file.endsWith('.ts') && file !== 'terminalRoomManager.ts')
      .filter((file) => /from ['"]\.\/(?:roomControlCoordinator|terminalBackendCoordinator)['"]/.test(readFileSync(resolve(serverRoot, file), 'utf8')))

    expect(directConsumers).toEqual([])
    expect((managerSource + controlSource + backendSource).match(/rooms\s*=\s*new Map/g)).toHaveLength(1)
    expect((managerSource + controlSource + backendSource).match(/clients\s*=\s*new Map/g)).toHaveLength(1)
    expect(managerSource).not.toContain('const pendingData: string[]')
    expect(managerSource).not.toContain('expiresAtMs = now +')
    expect(managerSource).toContain('return this.controlCoordinator.connectClient(roomId, send, close, ping)')
    expect(managerSource).toContain('return this.backendCoordinator.createTerminal(roomId, options)')

    const facadeMethods = [
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
      'assertRoomControlContext',
      'createTerminal',
      'input',
      'setTextContent',
      'resize',
      'resetTerminal',
      'moveTerminal',
      'closeTerminal',
      'roomSnapshot',
      'resolveTerminal',
      'terminalSnapshot',
      'destroyRoom',
    ] as const
    for (const method of facadeMethods) expect(typeof TerminalRoomManager.prototype[method]).toBe('function')
  })

  test('bounded replay keeps the exact UTF-8 tail while Text replacement stays unbounded', () => {
    const shell = { backendKind: 'fake' as const, ...createTerminalReplayFields(), outputActivityRevision: 0 }
    for (const chunk of ['old', '界', 'END']) {
      appendTerminalReplay(shell, chunk, 8)
      advanceTerminalOutputActivity(shell)
    }
    expect(terminalReplayChunks(shell)).toEqual(['界', 'END'])
    expect(shell.replayBytes).toBe(6)
    expect(shell.outputActivityRevision).toBe(3)

    const text = { backendKind: 'text' as const, ...createTerminalReplayFields() }
    replaceTerminalReplay(text, 'prefix😀multiline\nvalue')
    expect(terminalReplayChunks(text)).toEqual(['prefix😀multiline\nvalue'])
    expect(text.replayBytes).toBeGreaterThan(8)
  })

  test('Shell/Text runtime and pure projections preserve identity, revisions and wire shape', () => {
    const room = createRoomRuntime(createGeneratedId('room'), createGeneratedId('roomGeneration'))
    const shell = createTerminalRuntimeState({
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      terminalId: createGeneratedId('terminal'),
      launchId: createGeneratedId('terminalLaunch'),
      backend: stubBackend('fake'),
      backendKind: 'fake',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    })
    shell.status = 'running'
    appendTerminalReplay(shell, 'ready', 32)
    advanceTerminalRuntimeRevision(shell, { outputActivity: true })
    room.roomRevision = 2
    commitTerminalCreate(room, shell)

    const before = { roomRevision: room.roomRevision, terminalRevision: shell.terminalRevision }
    expect(projectTerminalSnapshot(room, shell)).toMatchObject({
      type: 'terminal_snapshot',
      terminalId: shell.terminalId,
      launchId: shell.launchId,
      terminalIndex: 1,
      backend: 'fake',
      cwd: '/tmp',
      replay: ['ready'],
      roomRevision: 3,
      terminalRevision: 2,
      outputActivityRevision: 1,
    })
    expect(projectRoomSnapshot(room)).toMatchObject({
      roomId: room.roomId,
      terminalStructureRevision: 1,
      indexMap: [{ index: 1, terminalId: shell.terminalId }],
      terminalPositions: [{ index: 1, type: 'shell', readiness: 'ready', cwd: '/tmp' }],
    })
    expect(projectTerminalIndexMapMessage(room)).toMatchObject({ type: 'terminal_index_map', terminalStructureLocked: false })
    expect({ roomRevision: room.roomRevision, terminalRevision: shell.terminalRevision }).toEqual(before)

    const restarted = restartTerminalRuntimeState(shell, {
      launchId: createGeneratedId('terminalLaunch'),
      backend: stubBackend('text'),
      backendKind: 'text',
      cwd: null,
    })
    expect(restarted).toMatchObject({
      terminalId: shell.terminalId,
      backendKind: 'text',
      cwd: null,
      status: 'starting',
      replay: [],
      terminalRevision: shell.terminalRevision + 1,
      textRevision: shell.textRevision + 1,
      outputActivityRevision: shell.outputActivityRevision + 1,
    })
  })

  test('lifecycle ticket observes active to destroying to destroyed and cleanup drains ownership once', async () => {
    const room = createRoomRuntime(createGeneratedId('room'), createGeneratedId('roomGeneration'))
    let current = true
    const ticket = admitRoomOperation(room, () => current)
    ticket.assertActive()
    const messages: unknown[] = []
    room.clients.set('client', {
      clientId: 'client',
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      send: (message) => messages.push(message),
      lastPongAtMs: 0,
      awaitingPong: false,
      lostControlEpoch: null,
    })

    beginRoomDestruction(room)
    expect(() => ticket.assertActive()).toThrow('room_destroying')
    ticket.finish()
    const removedClients: string[] = []
    const removedRooms: string[] = []
    await finishRoomDestruction(room, null, {
      controlLost: () => {},
      destroyHooks: () => [],
      closeTerminalResource: () => {},
      removeClient: (clientId) => removedClients.push(clientId),
      removeRoom: (roomId) => { current = false; removedRooms.push(roomId) },
    })

    expect(room.lifecycle).toBe('destroyed')
    expect(room.abortController.signal.aborted).toBe(true)
    expect(messages).toEqual([{ type: 'room_destroyed', roomId: room.roomId, roomGeneration: room.roomGeneration }])
    expect(removedClients).toEqual(['client'])
    expect(removedRooms).toEqual([room.roomId])
  })

  test('mutation coordinator preserves index, launch, structure revision and lock transitions', () => {
    const room = createRoomRuntime(createGeneratedId('room'), createGeneratedId('roomGeneration'))
    const first = runtime(room.roomId, room.roomGeneration, 'fake')
    const second = runtime(room.roomId, room.roomGeneration, 'text')
    commitTerminalCreate(room, first)
    commitTerminalCreate(room, second, 1)
    expect(room.store.indexMap()).toEqual([
      { index: 1, terminalId: second.terminalId },
      { index: 2, terminalId: first.terminalId },
    ])
    expect(room.terminalStructureRevision).toBe(2)

    expect(commitTerminalMove(room, first.terminalId, 1)).toBe(true)
    expect(commitTerminalMove(room, first.terminalId, 1)).toBe(false)
    const restarted = restartTerminalRuntimeState(first, {
      launchId: createGeneratedId('terminalLaunch'),
      backend: stubBackend('real'),
      backendKind: 'real',
      cwd: '/tmp',
    })
    commitTerminalRestart(room, restarted)
    expect(room.terminals.get(first.terminalId)?.launchId).toBe(restarted.launchId)

    const runId = createGeneratedId('run')
    acquireTerminalStructureLock(room, runId)
    expect(room.structureLockRunId).toBe(runId)
    expect(() => acquireTerminalStructureLock(room, createGeneratedId('run'))).toThrow('room_structure_locked_by_run')
    expect(releaseTerminalStructureLock(room, createGeneratedId('run'))).toBe(false)
    expect(releaseTerminalStructureLock(room, runId)).toBe(true)

    commitTerminalClose(room, second.terminalId)
    expect(room.store.indexMap()).toEqual([{ index: 1, terminalId: first.terminalId }])
    expect(room.terminalStructureRevision).toBe(5)
  })

  test('mutation coordinator keeps terminal structure work on the Room queue', async () => {
    const room = createRoomRuntime(createGeneratedId('room'), createGeneratedId('roomGeneration'))
    const trace: string[] = []
    let authorizeCount = 0
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    const ticket = {
      roomId: room.roomId,
      assertAuthorized: () => { authorizeCount += 1 },
    }

    const first = runSerializedTerminalStructureMutation(room, ticket, async () => {
      trace.push('first-start')
      markFirstStarted()
      await firstGate
      trace.push('first-end')
    })
    const second = runSerializedTerminalStructureMutation(room, ticket, () => {
      trace.push('second')
    })

    await firstStarted
    expect(trace).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(trace).toEqual(['first-start', 'first-end', 'second'])
    expect(authorizeCount).toBe(4)
  })
})

function runtime(roomId: string, roomGeneration: string, kind: TerminalBackendKind) {
  return createTerminalRuntimeState({
    roomId,
    roomGeneration,
    terminalId: createGeneratedId('terminal'),
    launchId: createGeneratedId('terminalLaunch'),
    backend: stubBackend(kind),
    backendKind: kind,
    cwd: kind === 'text' ? null : '/tmp',
    cols: 80,
    rows: 24,
  })
}

function stubBackend(kind: TerminalBackendKind): TerminalBackend {
  return {
    kind,
    inputChannel: 'helper-stdin-pipe',
    start() {},
    write() {},
    resize() {},
    close() {},
  }
}
