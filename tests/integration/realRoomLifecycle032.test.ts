import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TerminalRoomManager } from '../../server/terminalRoomManager'

test('real PTY belongs to one Room and Destroy waits until its helper exits', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shell-deck-032-real-room-'))
  const manager = new TerminalRoomManager({ homeDirectory: home })
  manager.setTerminalEnvProvider(() => ({ HISTFILE: '/dev/null' }))
  try {
    const room = manager.createRoom()
    const terminal = manager.createTerminal(room.roomId, { backend: 'real' })
    manager.input(room.roomId, terminal.terminalId, 'printf __ROOM_032_REAL__\r')
    await waitFor(() => manager.roomSnapshot(room.roomId).terminals[0]?.replay.join('').includes('__ROOM_032_REAL__'), 5_000)
    await Promise.race([
      manager.destroyRoom(room.roomId, room.roomGeneration),
      Bun.sleep(5_000).then(() => { throw new Error('real_room_destroy_timeout') }),
    ])
    expect(manager.listRooms()).toEqual([])
  } finally {
    await manager.destroyAllRooms()
    rmSync(home, { recursive: true, force: true })
  }
}, 15_000)

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error('real_room_output_timeout')
}
