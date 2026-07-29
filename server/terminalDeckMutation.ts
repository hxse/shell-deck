import type { TerminalRoomManager } from './terminalRoomManager'

export async function closeAllTerminals(manager: TerminalRoomManager, roomId: string): Promise<void> {
  const terminalIds = manager.terminalPositions(roomId).map(({ terminalId }) => terminalId)
  await manager.batchTerminalIndexMaps(roomId, () => {
    for (const terminalId of terminalIds) manager.closeTerminal(roomId, terminalId)
  })
}
