import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShellDeckServer } from '../../server/httpServer'
import { EvidenceStore } from '../../server/evidenceStore'
import { FakeTerminalBackend } from '../../server/fakeTerminalBackend'
import { MacroRunStore } from '../../server/macroRunStore'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { NotificationService } from '../../server/notificationService'
import { MacroRecordStore } from '../../server/sharedContentStore'
import { TerminalRoomManager } from '../../server/terminalRoomManager'
import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from '../../server/terminalBackend'
import { publishPrivateFileDelete, writePrivateFileAtomic } from '../../server/userDataRoot'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { MacroDefinitionV5, MacroRecord } from '../../src/lib/macro/macroDefinitionTypes'
import type { MacroRunnerSnapshot, RunManifestV1 } from '../../src/lib/macro/runnerTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import { roomControlHeaders, type RoomControlGrant } from '../../src/lib/roomControl'

import { roomGrant, waitFor } from './macroRuntime034.helpers'

test('durable Start never installs a run after controller loss or Room Destroy crosses a commit boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-boundary-034-'))
  try {
    const manager = new TerminalRoomManager()
    const records = new MacroRecordStore<MacroDefinitionV5>(root)
    const notification = new NotificationService(root)
    const agentEvents = new AgentEventStore(root)

    const lostRoom = manager.createRoom()
    const lostGrant = roomGrant(manager, lostRoom.roomId)
    const lostRecord = await records.create({ schemaVersion: 5, name: 'lost control', description: '', terminalLayout: [], body: [] })
    const lostStore = new MacroRunStore(root)
    const append = lostStore.append.bind(lostStore)
    let revoked = false
    lostStore.append = (runId, kind, data = {}) => {
      const event = append(runId, kind, data)
      if (kind === 'run_started' && !revoked) {
        revoked = true
        manager.disconnectClient(lostGrant.clientId)
      }
      return event
    }
    const lostRunner = new MacroRunnerService(manager, records, lostStore, notification, agentEvents)
    const lostTicket = manager.admitControlledBearer(lostGrant, lostRoom.roomId)
    await expect(lostRunner.start(lostTicket, lostRecord.id, 1, 0)).rejects.toThrow('room_control_lost')
    lostTicket.finish()
    expect(lostRunner.hasActiveRun(lostRoom.roomId, lostRoom.roomGeneration)).toBe(false)
    expect(manager.roomSnapshot(lostRoom.roomId).terminalStructureLocked).toBe(false)
    const lostTrace = lostStore.listTracesForRoom(lostRoom.roomId)[0]
    expect(lostTrace.status).toBe('failed')
    expect(lostTrace.events.at(-1)).toMatchObject({ kind: 'run_failed', data: { code: 'room_control_lost_during_start' } })

    const destroyedRoom = manager.createRoom()
    const destroyedGrant = roomGrant(manager, destroyedRoom.roomId)
    const destroyedRecord = await records.create({ schemaVersion: 5, name: 'destroyed', description: '', terminalLayout: [], body: [] })
    const destroyedStore = new MacroRunStore(root)
    const publish = destroyedStore.publishManifest.bind(destroyedStore)
    let destroying: Promise<void> | null = null
    destroyedStore.publishManifest = (manifest) => {
      const ref = publish(manifest)
      destroying = manager.destroyRoom(destroyedRoom.roomId, destroyedRoom.roomGeneration)
      return ref
    }
    const destroyedRunner = new MacroRunnerService(manager, records, destroyedStore, notification, agentEvents)
    const destroyedTicket = manager.admitControlledBearer(destroyedGrant, destroyedRoom.roomId)
    await expect(destroyedRunner.start(destroyedTicket, destroyedRecord.id, 1, 0)).rejects.toThrow('room_destroying')
    destroyedTicket.finish()
    await destroying
    expect(destroyedRunner.hasActiveRun(destroyedRoom.roomId, destroyedRoom.roomGeneration)).toBe(false)
    expect(destroyedStore.listTracesForRoom(destroyedRoom.roomId)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('tight forever flow cooperatively yields so Stop can terminalize within a deadline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-forever-yield-034-'))
  const manager = new TerminalRoomManager()
  const records = new MacroRecordStore<MacroDefinitionV5>(root)
  const store = new MacroRunStore(root)
  const runner = new MacroRunnerService(manager, records, store, new NotificationService(root), new AgentEventStore(root))
  manager.addDestroyHook((roomId, roomGeneration) => runner.destroyRoom(roomId, roomGeneration))
  try {
    const room = manager.createRoom()
    const grant = roomGrant(manager, room.roomId)
    const record = await records.create({
      schemaVersion: 5,
      name: 'cooperative forever',
      description: '',
      terminalLayout: [],
      body: [{ id: 'forever', type: 'for', range: { kind: 'forever' }, body: [{ id: 'continue', type: 'continue' }] }],
    })
    const ticket = manager.admitControlledBearer(grant, room.roomId)
    await runner.start(ticket, record.id, record.revision, 0)
    ticket.finish()

    await Bun.sleep(25)
    runner.stop(room.roomId)
    await waitFor(() => runner.snapshot(room.roomId).status === 'stopped', 1_000)
    expect(manager.roomSnapshot(room.roomId).terminalStructureLocked).toBe(false)
  } finally {
    await manager.destroyAllRooms()
    rmSync(root, { recursive: true, force: true })
  }
})
