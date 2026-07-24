import type { TerminalRef } from '../../src/lib/terminalIdentity'
import { textTerminalHash } from '../../server/textTerminalHash'
import type { TerminalRoomManager } from '../../server/terminalRoomManager'

export function setTextTerminalContent(
  manager: TerminalRoomManager,
  roomId: string,
  ref: TerminalRef | string | number,
  content: string,
): void {
  const terminal = manager.resolveTerminal(roomId, ref)
  const result = manager.mutateTextContent(
    roomId,
    ref,
    terminal.textRevision,
    { kind: 'replace', content },
    textTerminalHash(content),
  )
  if (!result.ok) throw new Error(result.reason)
}
