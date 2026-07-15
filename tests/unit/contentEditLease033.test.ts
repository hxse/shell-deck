import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentEditLeaseService } from '../../server/contentEditLeaseService'
import { TerminalRoomManager, type RoomControlledOperationTicket } from '../../server/terminalRoomManager'
import type { ContentResourceKey } from '../../src/lib/contentEditLease'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { ServerMessage } from '../../src/lib/protocol'
import { publishPrivateFileAtomic, publishPrivateFileDelete, writePrivateFileAtomic } from '../../server/userDataRoot'

test('content edit leases exclude the same record, allow different records, and combine lease with revision', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-content-lease-'))
  let now = 1_000
  const manager = new TerminalRoomManager({ now: () => now })
  const service = new ContentEditLeaseService(root, manager, { now: () => now })
  try {
    const first = connectController(manager)
    const second = connectController(manager)
    const key = macroKey()
    const otherKey = macroKey()
    writeRecord(service.recordPath(key), key.itemId, 1)
    writeRecord(service.recordPath(otherKey), otherKey.itemId, 1)

    const firstLease = await withTicket(manager, first.clientId, async (ticket) => await service.acquire(ticket, key, 0))
    expect(firstLease.grant.leaseEpoch).toBe(1)
    expect(firstLease.grant.baseRevision).toBe(1)
    await expect(withTicket(manager, second.clientId, async (ticket) => await service.acquire(ticket, key, 1))).rejects.toThrow('content_edit_lease_held')

    const parallel = await withTicket(manager, second.clientId, async (ticket) => await service.acquire(ticket, otherKey, 0))
    expect(parallel.grant.leaseEpoch).toBe(1)

    await expect(withTicket(manager, second.clientId, async (ticket) => await service.takeOver(ticket, key, 1, false))).rejects.toThrow('content_edit_takeover_confirmation_required')
    const takeover = await withTicket(manager, second.clientId, async (ticket) => await service.takeOver(ticket, key, 1, true))
    expect(takeover.grant.leaseEpoch).toBe(2)
    await expect(withTicket(manager, first.clientId, async (ticket) => await service.takeOver(ticket, key, 1, true))).rejects.toThrow('content_edit_lease_epoch_conflict')
    await expect(withTicket(manager, first.clientId, async (ticket) => await service.commit(
      ticket,
      key,
      firstLease.grant.editLeaseId,
      1,
      () => undefined,
    ))).rejects.toThrow('content_edit_lease_lost')

    writeRecord(service.recordPath(key), key.itemId, 2)
    await expect(withTicket(manager, second.clientId, async (ticket) => await service.commit(
      ticket,
      key,
      takeover.grant.editLeaseId,
      1,
      () => undefined,
    ))).rejects.toThrow('content_revision_conflict')

    await withTicket(manager, second.clientId, async (ticket) => await service.commit(
      ticket,
      key,
      takeover.grant.editLeaseId,
      2,
      (recordPath) => writeRecord(recordPath, key.itemId, 3),
    ))
    expect(readRevision(service.recordPath(key))).toBe(3)
    expect(readLeaseBaseRevision(root)).toBe(3)

    await withTicket(manager, second.clientId, async (ticket) => {
      await service.renewForController(ticket.context)
    })
    expect(readLeaseBaseRevision(root)).toBe(3)

    await withTicket(manager, second.clientId, async (ticket) => await service.commit(
      ticket,
      key,
      takeover.grant.editLeaseId,
      3,
      (recordPath) => writeRecord(recordPath, key.itemId, 4),
    ))
    expect(readRevision(service.recordPath(key))).toBe(4)
    expect(readLeaseBaseRevision(root)).toBe(4)

    const released = await withTicket(manager, second.clientId, async (ticket) => await service.release(ticket, takeover.grant.editLeaseId))
    expect(released).toEqual({ mode: 'available', leaseEpoch: 2 })
    now += 1
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a published record remains successful when lease-state refresh or cleanup fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-content-lease-published-'))
  let failWrite = false
  let failDelete = false
  const manager = new TerminalRoomManager()
  const service = new ContentEditLeaseService(root, manager, {
    writeLeaseState(path, content) {
      if (failWrite) throw new Error('injected_lease_state_write_failure')
      writePrivateFileAtomic(path, content)
    },
    deleteLeaseState(path) {
      if (failDelete) throw new Error('injected_lease_state_delete_failure')
      unlinkSync(path)
    },
  })
  try {
    const owner = connectController(manager)

    const updateKey = macroKey()
    writeRecord(service.recordPath(updateKey), updateKey.itemId, 1)
    const updateLease = await withTicket(manager, owner.clientId, async (ticket) => await service.acquire(ticket, updateKey, 0))
    failWrite = true
    const updated = await withTicket(manager, owner.clientId, async (ticket) => await service.commit(
      ticket,
      updateKey,
      updateLease.grant.editLeaseId,
      1,
      (recordPath) => writeRecord(recordPath, updateKey.itemId, 2),
    ))
    expect(updated.leaseOutcome).toEqual({ status: 'lost', reason: 'content_edit_lease_state_refresh_failed' })
    expect(readRevision(service.recordPath(updateKey))).toBe(2)
    await expect(withTicket(manager, owner.clientId, async (ticket) => await service.commit(
      ticket,
      updateKey,
      updateLease.grant.editLeaseId,
      2,
      (recordPath) => writeRecord(recordPath, updateKey.itemId, 3),
    ))).rejects.toThrow('content_edit_lease_lost')

    failWrite = false
    const deleteKey = macroKey()
    writeRecord(service.recordPath(deleteKey), deleteKey.itemId, 1)
    const deleteLease = await withTicket(manager, owner.clientId, async (ticket) => await service.acquire(ticket, deleteKey, 0))
    failDelete = true
    const deleted = await withTicket(manager, owner.clientId, async (ticket) => await service.commit(
      ticket,
      deleteKey,
      deleteLease.grant.editLeaseId,
      1,
      (recordPath) => unlinkSync(recordPath),
      { deleteRecord: true },
    ))
    expect(deleted.leaseOutcome).toEqual({ status: 'lost', reason: 'content_edit_lease_state_refresh_failed' })
    expect(existsSync(service.recordPath(deleteKey))).toBe(false)
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

test('content commit keeps authoritative success after record replace or delete crosses its publish point', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-content-record-published-'))
  const manager = new TerminalRoomManager()
  const service = new ContentEditLeaseService(root, manager)
  const uncertain = { syncParentDirectory() { throw new Error('injected_directory_fsync_failure') } }
  try {
    const owner = connectController(manager)

    const updateKey = macroKey()
    writeRecord(service.recordPath(updateKey), updateKey.itemId, 1)
    const updateLease = await withTicket(manager, owner.clientId, async (ticket) => await service.acquire(ticket, updateKey, 0))
    const updated = await withTicket(manager, owner.clientId, async (ticket) => await service.commit(
      ticket,
      updateKey,
      updateLease.grant.editLeaseId,
      1,
      (recordPath) => publishPrivateFileAtomic(recordPath, recordBytes(updateKey.itemId, 2), uncertain),
    ))
    expect(updated.value).toMatchObject({ published: true, durability: 'uncertain' })
    expect(updated.leaseOutcome).toMatchObject({ status: 'retained', grant: { baseRevision: 2 } })
    expect(readRevision(service.recordPath(updateKey))).toBe(2)

    const deleteKey = macroKey()
    writeRecord(service.recordPath(deleteKey), deleteKey.itemId, 1)
    const deleteLease = await withTicket(manager, owner.clientId, async (ticket) => await service.acquire(ticket, deleteKey, 0))
    const deleted = await withTicket(manager, owner.clientId, async (ticket) => await service.commit(
      ticket,
      deleteKey,
      deleteLease.grant.editLeaseId,
      1,
      (recordPath) => publishPrivateFileDelete(recordPath, uncertain),
      { deleteRecord: true },
    ))
    expect(deleted.value).toMatchObject({ published: true, durability: 'uncertain' })
    expect(deleted.leaseOutcome).toEqual({ status: 'released' })
    expect(existsSync(service.recordPath(deleteKey))).toBe(false)
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

test('filesystem lease state survives owner-process loss only until TTL and keeps its epoch across processes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-content-lease-process-'))
  let firstNow = 1_000
  let secondNow = 31_001
  const firstManager = new TerminalRoomManager({ now: () => firstNow })
  const secondManager = new TerminalRoomManager({ now: () => secondNow })
  const firstService = new ContentEditLeaseService(root, firstManager, { now: () => firstNow })
  const secondService = new ContentEditLeaseService(root, secondManager, { now: () => secondNow })
  try {
    const first = connectController(firstManager)
    const second = connectController(secondManager)
    const key = macroKey()
    writeRecord(firstService.recordPath(key), key.itemId, 1)

    const original = await withTicket(firstManager, first.clientId, async (ticket) => await firstService.acquire(ticket, key, 0))
    expect(original.grant.expiresAt).toBe(new Date(31_000).toISOString())
    const replacement = await withTicket(secondManager, second.clientId, async (ticket) => await secondService.acquire(ticket, key, 1))
    expect(replacement.grant.leaseEpoch).toBe(2)
    expect(await firstService.view(key)).toMatchObject({ mode: 'held', leaseEpoch: 2 })
    firstNow += 1
    secondNow += 1
  } finally {
    await firstManager.destroyAllRooms()
    await secondManager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

test('server-owned pong renews active edit leases and Room takeover releases them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-content-lease-heartbeat-'))
  let now = 0
  const manager = new TerminalRoomManager({ now: () => now })
  const service = new ContentEditLeaseService(root, manager, { now: () => now })
  manager.setControlHeartbeatHook(async (context) => await service.renewForController(context))
  manager.setControlLostHook(async (context) => await service.releaseForController(context))
  try {
    const room = manager.createRoom()
    const firstMessages: ServerMessage[] = []
    const secondMessages: ServerMessage[] = []
    const first = manager.connectClient(room.roomId, (message) => firstMessages.push(message))
    const second = manager.connectClient(room.roomId, (message) => secondMessages.push(message))
    const key = macroKey()
    writeRecord(service.recordPath(key), key.itemId, 1)
    const lease = await withTicket(manager, first.clientId, async (ticket) => await service.acquire(ticket, key, 0))
    expect(lease.grant.expiresAt).toBe(new Date(30_000).toISOString())

    now = 10_000
    manager.noteClientPong(first.clientId)
    await waitFor(async () => {
      const view = await service.view(key)
      return view.mode === 'held' && view.expiresAt === new Date(40_000).toISOString()
    })
    await manager.takeOverRoomControl(second.clientId, 1, true)
    expect(await service.view(key)).toEqual({ mode: 'available', leaseEpoch: 1 })
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

test('controller disconnect releases its active content edit leases without a browser renew path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-content-lease-disconnect-'))
  const manager = new TerminalRoomManager()
  const service = new ContentEditLeaseService(root, manager)
  manager.setControlLostHook(async (context) => await service.releaseForController(context))
  try {
    const owner = connectController(manager)
    const key = macroKey()
    writeRecord(service.recordPath(key), key.itemId, 1)
    await withTicket(manager, owner.clientId, async (ticket) => await service.acquire(ticket, key, 0))

    manager.disconnectClient(owner.clientId)
    await waitFor(async () => (await service.view(key)).mode === 'available')
    expect(await service.view(key)).toEqual({ mode: 'available', leaseEpoch: 1 })
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})

function connectController(manager: TerminalRoomManager) {
  const room = manager.createRoom()
  const messages: ServerMessage[] = []
  const client = manager.connectClient(room.roomId, (message) => messages.push(message))
  const control = messages.find((message): message is Extract<ServerMessage, { type: 'room_control' }> => message.type === 'room_control')
  if (!control?.grant) throw new Error('missing_control_grant')
  return { ...client, grant: control.grant }
}

async function withTicket<T>(
  manager: TerminalRoomManager,
  clientId: string,
  operation: (ticket: RoomControlledOperationTicket) => Promise<T>,
): Promise<T> {
  const ticket = manager.admitControlledClient(clientId)
  try { return await operation(ticket) }
  finally { ticket.finish() }
}

function macroKey(): Extract<ContentResourceKey, { kind: 'macro' }> {
  return { kind: 'macro', itemId: createGeneratedId('macroTemplate') }
}

function writeRecord(path: string, id: string, revision: number): void {
  writePrivateFileAtomic(path, recordBytes(id, revision))
}

function recordBytes(id: string, revision: number): string {
  return JSON.stringify({
    id,
    revision,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    definition: {},
  }) + '\n'
}

function readRevision(path: string): number {
  return (JSON.parse(readFileSync(path, 'utf8')) as { revision: number }).revision
}

function readLeaseBaseRevision(root: string): number {
  const directory = join(root, '.locks', 'content-edit')
  const entries = readdirSync(directory).filter((entry) => entry.endsWith('.json'))
  if (entries.length !== 2) throw new Error('unexpected_content_lease_file_count')
  const held = entries
    .map((entry) => JSON.parse(readFileSync(join(directory, entry), 'utf8')) as { mode: string; baseRevision?: number })
    .find((state) => state.mode === 'held' && state.baseRevision !== 1)
  if (!held?.baseRevision) throw new Error('held_content_lease_not_found')
  return held.baseRevision
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return
    await Bun.sleep(1)
  }
  throw new Error('timeout')
}
