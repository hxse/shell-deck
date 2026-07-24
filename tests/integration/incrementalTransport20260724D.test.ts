import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvidenceStore } from '../../server/evidenceStore'
import { startShellDeckServer } from '../../server/httpServer'
import { MacroRunStore } from '../../server/macroRunStore'
import { encodeEventCursor } from '../../server/macroRunTraceIndex'
import { TerminalRoomManager } from '../../server/terminalRoomManager'
import { textTerminalHash } from '../../server/textTerminalHash'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { MacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionTypes'
import type { RunManifestV1 } from '../../src/lib/macro/runnerTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import { roomControlHeaders, type RoomControlGrant } from '../../src/lib/roomControl'

const traceIndexWorker = join(import.meta.dir, '..', 'fixtures', 'traceIndexWorker.ts')

test('Text terminal commits only verified patches and external writes use the same delta protocol', () => {
  const manager = new TerminalRoomManager()
  const room = manager.createRoom()
  const first: ServerMessage[] = []
  const second: ServerMessage[] = []
  manager.connectClient(room.roomId, (message) => first.push(message))
  manager.connectClient(room.roomId, (message) => second.push(message))
  const terminal = manager.createTerminal(room.roomId, { backend: 'text' })
  first.length = 0
  second.length = 0

  const large = 'a'.repeat(2 * 1024 * 1024)
  expect(manager.mutateTextContent(
    room.roomId,
    terminal.terminalId,
    0,
    { kind: 'replace', content: large },
    textTerminalHash(large),
  )).toMatchObject({ ok: true })
  first.length = 0
  second.length = 0

  const candidate = large + 'b'
  const accepted = manager.mutateTextContent(
    room.roomId,
    terminal.terminalId,
    1,
    { kind: 'patch', start: large.length, deleteCount: 0, insert: 'b' },
    textTerminalHash(candidate),
  )
  expect(accepted).toMatchObject({ ok: true })
  expect(manager.terminalSnapshot(accepted.terminal).replay.join('')).toBe(candidate)
  for (const messages of [first, second]) {
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: 'terminal_text_mutation',
      textRevision: 2,
      mutation: { kind: 'patch', insert: 'b' },
    })
    expect(JSON.stringify(messages[0]).length).toBeLessThan(600)
  }

  first.length = 0
  const before = manager.terminalSnapshot(accepted.terminal)
  expect(manager.mutateTextContent(
    room.roomId,
    terminal.terminalId,
    2,
    { kind: 'patch', start: candidate.length, deleteCount: 0, insert: 'x' },
    textTerminalHash(candidate + 'wrong'),
  )).toMatchObject({ ok: false, reason: 'text_result_hash_mismatch' })
  expect(manager.terminalSnapshot(accepted.terminal)).toMatchObject({
    textRevision: before.textRevision,
    contentHash: before.contentHash,
  })
  expect(first).toEqual([])

  manager.input(room.roomId, terminal.terminalId, '\r')
  expect(first.at(-1)).toMatchObject({
    type: 'terminal_text_mutation',
    mutation: { kind: 'patch', start: candidate.length, deleteCount: 0, insert: '\n' },
    textRevision: 3,
  })
})

test('structure broadcasts are pre-encoded once, authoritative, and batched', async () => {
  const manager = new TerminalRoomManager()
  const room = manager.createRoom()
  const firstPayloads: string[] = []
  const secondPayloads: string[] = []
  manager.connectClient(room.roomId, () => {}, undefined, undefined, (payload) => firstPayloads.push(payload))
  manager.connectClient(room.roomId, () => {}, undefined, undefined, (payload) => secondPayloads.push(payload))
  const one = manager.createTerminal(room.roomId, { backend: 'text' })
  manager.createTerminal(room.roomId, { backend: 'text' })
  firstPayloads.length = 0
  secondPayloads.length = 0

  manager.moveTerminal(room.roomId, one.terminalId, 2)
  expect(firstPayloads).toEqual(secondPayloads)
  expect(firstPayloads.map(messageType)).toEqual(['terminal_index_map'])

  firstPayloads.length = 0
  secondPayloads.length = 0
  await manager.batchTerminalIndexMaps(room.roomId, () => {
    manager.createTerminal(room.roomId, { backend: 'text' })
    manager.moveTerminal(room.roomId, one.terminalId, 3)
  })
  expect(firstPayloads).toEqual(secondPayloads)
  expect(firstPayloads.map(messageType)).toEqual([
    'terminal_snapshot',
    'terminal_index_map',
  ])

  firstPayloads.length = 0
  secondPayloads.length = 0
  manager.closeTerminal(room.roomId, one.terminalId)
  expect(firstPayloads).toEqual(secondPayloads)
  expect(firstPayloads.map(messageType)).toEqual(['terminal_state', 'terminal_index_map'])
  expect(firstPayloads.some((payload) => JSON.parse(payload).type === 'room_snapshot')).toBe(false)
})

test('Prepare returns one final snapshot and coalesces intermediate structure maps', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-prepare-20260724D-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const room = server.manager.createRoom()
    const messages: ServerMessage[] = []
    server.manager.connectClient(room.roomId, (message) => messages.push(message))
    const grant = requiredGrant(messages)
    const originalSnapshot = server.manager.roomSnapshot.bind(server.manager)
    let snapshotCalls = 0
    server.manager.roomSnapshot = (roomId) => {
      snapshotCalls += 1
      return originalSnapshot(roomId)
    }
    messages.length = 0
    const response = await fetch(`${server.url}/api/rooms/${room.roomId}/terminals/prepare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...roomControlHeaders(grant) },
      body: JSON.stringify({
        terminalLayout: [{ index: 1, type: 'text' }, { index: 2, type: 'text' }],
        expectedTerminalStructureRevision: 0,
      }),
    })
    expect(response.status).toBe(200)
    expect(snapshotCalls).toBe(1)
    expect(messages.filter((message) => message.type === 'terminal_snapshot')).toHaveLength(2)
    expect(messages.filter((message) => message.type === 'terminal_index_map')).toHaveLength(1)
    expect(messages.some((message) => message.type === 'room_snapshot')).toBe(false)
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Trace pages use opaque room/run cursors and terminal cache eviction returns to durable reads', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-trace-20260724D-'))
  try {
    class CountingEvidenceStore extends EvidenceStore {
      pageRunIds: string[] = []
      windowReads = 0
      override page(runId: string, afterEventSeq: number, limit: number) {
        this.pageRunIds.push(runId)
        return super.page(runId, afterEventSeq, limit)
      }
      override window(runId: string) {
        this.windowReads += 1
        return super.window(runId)
      }
    }
    const segmentReads: number[] = []
    let segmentLists = 0
    const evidence = new CountingEvidenceStore(root, undefined, {
      onSegmentRead: (_runId, start) => segmentReads.push(start),
      onSegmentList: () => { segmentLists += 1 },
    })
    const store = new MacroRunStore(root, undefined, () => createGeneratedId('run'), evidence)
    const roomA = createGeneratedId('room')
    const roomB = createGeneratedId('room')
    const first = createRun(store, roomA, '2026-07-24T00:00:01.000Z', 250)
    const second = createRun(store, roomA, '2026-07-24T00:00:02.000Z', 2)
    createRun(store, roomB, '2026-07-24T00:00:03.000Z', 1)
    segmentReads.length = 0
    segmentLists = 0

    const pageOne = store.traceSummariesForRoom(roomA, 1, null)
    expect(pageOne.items.map((item) => item.runId)).toEqual([second])
    expect(pageOne.nextCursor).toBeTruthy()
    const pageTwo = store.traceSummariesForRoom(roomA, 1, pageOne.nextCursor)
    expect(pageTwo.items.map((item) => item.runId)).toEqual([first])
    expect(() => store.traceSummariesForRoom(roomB, 1, pageOne.nextCursor)).toThrow('invalid_trace_cursor')
    expect({ segmentReads, segmentLists }).toEqual({ segmentReads: [], segmentLists: 0 })

    const eventsOne = store.traceEventsForRoom(roomA, first, 1, null)
    expect(eventsOne.events).toHaveLength(1)
    expect(eventsOne.nextCursor).toBeTruthy()
    const eventsTwo = store.traceEventsForRoom(roomA, first, 1, eventsOne.nextCursor)
    expect(eventsTwo.events).toHaveLength(1)
    expect(evidence.pageRunIds).toEqual([first, first])
    expect(segmentReads).toEqual([1, 1])
    expect(segmentLists).toBe(0)

    segmentReads.length = 0
    const middle = store.traceEventsForRoom(roomA, first, 10, encodeEventCursor(first, 150))
    expect(middle.events.map((event) => event.eventSeq)).toEqual([151, 152, 153, 154, 155, 156, 157, 158, 159, 160])
    expect(segmentReads).toEqual([101])
    expect(segmentLists).toBe(0)
    segmentReads.length = 0
    expect(() => store.traceEventsForRoom(roomA, first, 10, encodeEventCursor(first, 251)))
      .toThrow('invalid_trace_event_cursor')
    expect(segmentReads).toEqual([])

    store.readEventWindowView(first)
    evidence.windowReads = 0
    store.releaseLiveRun(first)
    store.readEventWindow(first)
    expect(evidence.windowReads).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Trace index merges concurrent process writers and loaded readers observe atomic replacement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-trace-process-20260724D-'))
  try {
    const roomId = createGeneratedId('room')
    const observer = new MacroRunStore(root)
    expect(observer.traceSummariesForRoom(roomId, 20, null).items).toEqual([])
    const runIds = [createGeneratedId('run'), createGeneratedId('run')]
    const children = runIds.map((runId, index) => startTraceWorker([
      root,
      roomId,
      runId,
      `2026-07-24T00:00:0${index + 1}.000Z`,
    ]))
    await waitFor(() => runIds.every((runId) => existsSync(join(root, 'ready-' + runId))))
    writeFileSync(join(root, 'trace-go'), '')
    expect(await Promise.all(children)).toEqual(runIds.map((runId) => ({ runId, ok: true })))

    expect(observer.traceSummariesForRoom(roomId, 20, null).items.map((item) => item.runId).sort())
      .toEqual([...runIds].sort())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function createRun(store: MacroRunStore, roomId: string, createdAt: string, eventCount: number): string {
  const runId = store.reserveRunId()
  store.publishManifest(manifest(runId, roomId, createdAt))
  store.append(runId, 'run_started')
  for (let index = 2; index < eventCount; index += 1) store.append(runId, 'step_completed', { index })
  store.append(runId, 'run_completed')
  return runId
}

function manifest(runId: string, roomId: string, createdAt: string): RunManifestV1 {
  const definition: MacroDefinitionV5 = {
    schemaVersion: 5,
    name: 'trace',
    description: '',
    terminalLayout: [],
    body: [],
  }
  return {
    schemaVersion: 1,
    runId,
    createdAt,
    macroRecord: { id: createGeneratedId('macroTemplate'), revision: 1 },
    definition,
    definitionHash: { algorithm: 'sha256', value: '0'.repeat(64) },
    runtime: {
      serverInstanceId: createGeneratedId('serverInstance'),
      roomId,
      roomGeneration: createGeneratedId('roomGeneration'),
      terminalStructureRevision: 0,
    },
    terminalBindings: [],
  }
}

function requiredGrant(messages: ServerMessage[]): RoomControlGrant {
  const message = messages.find((candidate) => candidate.type === 'room_control' && candidate.grant)
  if (!message || message.type !== 'room_control' || !message.grant) throw new Error('missing grant')
  return message.grant
}

function messageType(payload: string): string {
  return (JSON.parse(payload) as { type: string }).type
}

function startTraceWorker(args: string[]): Promise<{ runId: string; ok: boolean }> {
  const child = Bun.spawn(['bun', 'run', traceIndexWorker, ...args], {
    cwd: join(import.meta.dir, '..', '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, exitCode]) => {
    if (exitCode !== 0) throw new Error(stderr || 'trace_index_worker_failed')
    return JSON.parse(stdout)
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timeout')
    await Bun.sleep(5)
  }
}
