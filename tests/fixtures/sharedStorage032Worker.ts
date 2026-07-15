import { relocateNotificationConfig } from '../../server/notificationConfigRelocation'
import { ContentEditLeaseService } from '../../server/contentEditLeaseService'
import { MacroRecordStore } from '../../server/sharedContentStore'
import { TerminalRoomManager } from '../../server/terminalRoomManager'

const [mode, root, value, extra] = process.argv.slice(2)
try {
  if (mode === 'update') {
    const record = await new MacroRecordStore<{ value: string }>(root).update(value, 1, { value: extra })
    process.stdout.write(JSON.stringify({ ok: true, revision: record.revision, value: record.definition.value }))
  } else if (mode === 'hold-record-lock') {
    const store = new MacroRecordStore<{ value: string }>(root)
    await store.transactions.run(store.recordPath(value), async () => {
      process.stdout.write('ready\n')
      await new Promise(() => {})
    })
  } else if (mode === 'notification') {
    const result = relocateNotificationConfig({ env: { HOME: root }, root, cwd: value })
    process.stdout.write(JSON.stringify({ ok: true, state: result.state }))
  } else if (mode === 'lease-acquire') {
    const manager = new TerminalRoomManager()
    const room = manager.createRoom()
    const client = manager.connectClient(room.roomId, () => {})
    const ticket = manager.admitControlledClient(client.clientId)
    try {
      const service = new ContentEditLeaseService(root, manager)
      const result = await service.acquire(ticket, { kind: 'macro', itemId: value }, Number(extra))
      process.stdout.write(JSON.stringify({ ok: true, leaseEpoch: result.grant.leaseEpoch }))
    } finally {
      ticket.finish()
    }
  } else {
    throw new Error('unknown_worker_mode')
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
}
