import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ContentEditLeaseService } from '../../server/contentEditLeaseService'
import { EvidenceStore } from '../../server/evidenceStore'
import { MacroRunTraceIndex } from '../../server/macroRunTraceIndex'
import { TerminalRoomManager, type RoomControlledOperationTicket } from '../../server/terminalRoomManager'
import { initializeUserDataRoot, writePrivateFileAtomic } from '../../server/userDataRoot'
import type { ContentResourceKey } from '../../src/lib/contentEditLease'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { RunManifestV1 } from '../../src/lib/macro/runnerTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import type { RoomControlContext } from '../../src/lib/roomControl'

test('cold direct Trace event pages repair stale summaries before range reads', () => {
  const root = temporaryRoot('trace-freshness')
  try {
    const writer = new EvidenceStore(root)
    const runId = writer.createRun(provenance())
    writer.append(runId, 'step_completed', { stepId: 'one' })
    expect(readSummaryLastEventSeq(root, runId)).toBe(1)

    const segmentReads: number[] = []
    let segmentLists = 0
    const reader = new EvidenceStore(root, undefined, {
      onSegmentRead: (_id, start) => segmentReads.push(start),
      onSegmentList: () => { segmentLists += 1 },
    })
    const first = reader.page(runId, 0, 10)
    expect(first.summary.lastEventSeq).toBe(2)
    expect(first.events.map((event) => event.eventSeq)).toEqual([1, 2])
    expect(readSummaryLastEventSeq(root, runId)).toBe(2)
    expect({ segmentLists, segmentReads }).toEqual({ segmentLists: 1, segmentReads: [1, 1] })

    segmentLists = 0
    segmentReads.length = 0
    expect(reader.page(runId, 1, 10).events.map((event) => event.eventSeq)).toEqual([2])
    expect({ segmentLists, segmentReads }).toEqual({ segmentLists: 0, segmentReads: [1] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Trace index uses the canonical User Data Root .locks directory', () => {
  const root = temporaryRoot('trace-lock')
  try {
    const paths = initializeUserDataRoot(root)
    const index = new MacroRunTraceIndex(paths.runs)
    index.recordManifest(manifest())
    expect(existsSync(join(paths.locks, 'trace-index.lock'))).toBe(true)
    expect(existsSync(join(root, 'locks'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Room client registration rejects stale generations before mutation and rolls back failed first-client control', async () => {
  let allocatedClientIds = 0
  const manager = new TerminalRoomManager({
    clientIdFactory: () => {
      allocatedClientIds += 1
      return createGeneratedId('client')
    },
  })
  const original = manager.createRoom()
  await manager.destroyRoom(original.roomId, original.roomGeneration)
  const current = manager.ensureRoomFromRoute(original.roomId).room
  const runtime = manager.rooms.get(current.roomId)!

  expect(() => manager.connectClient(
    current.roomId,
    () => {},
    undefined,
    undefined,
    undefined,
    original.roomGeneration,
  )).toThrow('room_generation_conflict')
  expect(allocatedClientIds).toBe(0)
  expect({ global: manager.clients.size, room: runtime.clients.size }).toEqual({ global: 0, room: 0 })
  expect({ controller: runtime.controller, epoch: runtime.controlEpoch }).toEqual({ controller: null, epoch: 0 })

  for (const failedType of ['room_control', 'room_snapshot'] as const) {
    expect(() => manager.connectClient(
      current.roomId,
      (message) => {
        if (message.type === failedType) throw new Error('injected_' + failedType + '_send_failure')
      },
      undefined,
      undefined,
      undefined,
      current.roomGeneration,
    )).toThrow('injected_' + failedType + '_send_failure')
    expect({ global: manager.clients.size, room: runtime.clients.size }).toEqual({ global: 0, room: 0 })
    expect({ controller: runtime.controller, epoch: runtime.controlEpoch }).toEqual({ controller: null, epoch: 0 })
  }

  const messages: ServerMessage[] = []
  manager.connectClient(
    current.roomId,
    (message) => messages.push(message),
    undefined,
    undefined,
    undefined,
    current.roomGeneration,
  )
  expect(messages.find((message) => message.type === 'room_control')).toMatchObject({
    type: 'room_control',
    grant: { controlEpoch: 1 },
  })
  const transport = readFileSync(resolve(import.meta.dir, '../../server/roomWebSocketTransport.ts'), 'utf8')
  expect(transport).toContain('(payload) => sender.send(payload),\n          ws.data.roomGeneration,')
  expect(transport).not.toContain('client.roomGeneration !== ws.data.roomGeneration')
  await manager.destroyAllRooms()
})

test('post-publish authorization loss rolls back exact acquire and takeover leases', async () => {
  const root = temporaryRoot('lease-rollback')
  const manager = new TerminalRoomManager()
  const leaseIds = [
    createGeneratedId('contentEditLease'),
    createGeneratedId('contentEditLease'),
    createGeneratedId('contentEditLease'),
    createGeneratedId('contentEditLease'),
  ]
  const changes: unknown[] = []
  const service = new ContentEditLeaseService(root, manager, {
    editLeaseIdFactory: () => leaseIds.shift()!,
    onChanged: (_key, view) => changes.push(view),
  })
  try {
    const failedAcquireKey = macroKey()
    writeRecord(service.recordPath(failedAcquireKey), failedAcquireKey.itemId)
    await expect(service.acquire(failingPostPublishTicket(controlContext()), failedAcquireKey, 0))
      .rejects.toThrow('room_control_lost')
    expect(await service.view(failedAcquireKey)).toEqual({ mode: 'available', leaseEpoch: 1 })

    const takeoverKey = macroKey()
    writeRecord(service.recordPath(takeoverKey), takeoverKey.itemId)
    const originalTicket = authorizedTicket(controlContext())
    const original = await service.acquire(originalTicket, takeoverKey, 0)
    await expect(service.takeOver(failingPostPublishTicket(controlContext()), takeoverKey, 1, true))
      .rejects.toThrow('room_control_lost')
    expect(await service.view(takeoverKey)).toEqual({ mode: 'available', leaseEpoch: 2 })
    await expect(service.release(originalTicket, original.grant.editLeaseId))
      .rejects.toThrow('content_edit_lease_lost')

    const replacementLeaseId = createGeneratedId('contentEditLease')
    const concurrentKey = macroKey()
    const concurrentRecordPath = service.recordPath(concurrentKey)
    writeRecord(concurrentRecordPath, concurrentKey.itemId)
    const statePath = leaseStatePath(service, concurrentRecordPath)
    await expect(service.acquire(failingPostPublishTicket(controlContext(), () => {
      const published = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
      writePrivateFileAtomic(statePath, JSON.stringify({
        ...published,
        leaseEpoch: 2,
        editLeaseId: replacementLeaseId,
      }, null, 2) + '\n')
    }), concurrentKey, 0)).rejects.toThrow('room_control_lost')
    expect(await service.view(concurrentKey)).toEqual(expect.objectContaining({ mode: 'held', leaseEpoch: 2 }))
    expect(JSON.parse(readFileSync(statePath, 'utf8')).editLeaseId).toBe(replacementLeaseId)

    expect(changes).toContainEqual({ mode: 'available', leaseEpoch: 1 })
    expect(changes).toContainEqual({ mode: 'available', leaseEpoch: 2 })
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

function temporaryRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `shell-deck-20260725b-${label}-`))
}

function provenance() {
  return {
    serverInstanceId: createGeneratedId('serverInstance'),
    roomId: createGeneratedId('room'),
    roomGeneration: createGeneratedId('roomGeneration'),
  }
}

function manifest(): RunManifestV1 {
  const runtime = { ...provenance(), terminalStructureRevision: 0 }
  return {
    schemaVersion: 1,
    runId: createGeneratedId('run'),
    createdAt: '2026-07-25T00:00:00.000Z',
    macroRecord: { id: createGeneratedId('macroTemplate'), revision: 1 },
    definition: { schemaVersion: 5, name: 'trace', description: '', terminalLayout: [], body: [] },
    definitionHash: { algorithm: 'sha256', value: '0'.repeat(64) },
    runtime,
    terminalBindings: [],
  }
}

function readSummaryLastEventSeq(root: string, runId: string): number {
  const summary = JSON.parse(readFileSync(join(root, 'runs', runId, 'summary.json'), 'utf8')) as {
    lastEventSeq: number
  }
  return summary.lastEventSeq
}

function macroKey(): Extract<ContentResourceKey, { kind: 'macro' }> {
  return { kind: 'macro', itemId: createGeneratedId('macroTemplate') }
}

function writeRecord(path: string, id: string): void {
  writePrivateFileAtomic(path, JSON.stringify({
    id,
    revision: 1,
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    definition: {},
  }) + '\n')
}

function controlContext(): RoomControlContext {
  return {
    ...provenance(),
    clientId: createGeneratedId('client'),
    controlLeaseId: createGeneratedId('roomControlLease'),
    controlEpoch: 1,
  }
}

function authorizedTicket(context: RoomControlContext): RoomControlledOperationTicket {
  return {
    roomId: context.roomId,
    roomGeneration: context.roomGeneration,
    signal: new AbortController().signal,
    context,
    assertActive() {},
    assertAuthorized() {},
    finish() {},
  }
}

function failingPostPublishTicket(
  context: RoomControlContext,
  beforeFailure: () => void = () => {},
): RoomControlledOperationTicket {
  let checks = 0
  return {
    ...authorizedTicket(context),
    assertAuthorized() {
      checks += 1
      if (checks > 1) {
        beforeFailure()
        throw new Error('room_control_lost')
      }
    },
  }
}

function leaseStatePath(service: ContentEditLeaseService, recordPath: string): string {
  return (service as unknown as {
    stateStore: { statePath(path: string): string }
  }).stateStore.statePath(recordPath)
}
