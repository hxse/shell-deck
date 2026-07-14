import { hostname, userInfo } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import { defaultRealShellCwd } from '../../server/realPtyBackend'
import { TerminalRoomManager } from '../../server/terminalRoomManager'

test('real Shell in a Room uses the stdin pipe, HOME cwd, resize and Ctrl-C', async () => {
  const manager = new TerminalRoomManager()
  manager.setTerminalEnvProvider(() => ({ HISTFILE: '/dev/null' }))
  const room = manager.createRoom()
  const messages: ServerMessage[] = []
  manager.connectClient(room.roomId, (message) => messages.push(message))
  const terminal = manager.createTerminal(room.roomId, { backend: 'real' })

  try {
    await waitFor(() => homePromptVisible(renderedText(messages, terminal.terminalId)), 5000)
    expect(renderedText(messages, terminal.terminalId)).toContain('\x1b[1;92m')
    manager.input(room.roomId, terminal.terminalId, 'printf "__SD_PWD__%s__" "$PWD"\r')
    await waitFor(() => renderedText(messages, terminal.terminalId).includes('__SD_PWD__'), 5000)
    expect(renderedText(messages, terminal.terminalId)).toContain('__SD_PWD__' + defaultRealShellCwd() + '__')

    const longPaste = '__SD_LONG_' + 'x'.repeat(7000) + '_END__'
    manager.input(room.roomId, terminal.terminalId, 'printf ' + longPaste + '\r')
    await waitFor(() => renderedText(messages, terminal.terminalId).includes('_END__'), 5000)
    expect(renderedText(messages, terminal.terminalId)).toContain(longPaste)

    manager.resize(room.roomId, terminal.terminalId, 100, 30)
    manager.input(room.roomId, terminal.terminalId, 'stty size\r')
    await waitFor(() => renderedText(messages, terminal.terminalId).includes('30 100'), 5000)

    manager.input(room.roomId, terminal.terminalId, 'sleep 5\r')
    await Bun.sleep(100)
    manager.input(room.roomId, terminal.terminalId, '\u0003')
    manager.input(room.roomId, terminal.terminalId, 'printf __AFTER_CTRL_C__\r')
    await waitFor(() => renderedText(messages, terminal.terminalId).includes('__AFTER_CTRL_C__'), 5000)

    manager.input(room.roomId, terminal.terminalId, 'exit\r')
    await waitFor(() => messages.some((message) => message.type === 'terminal_state' && message.terminalId === terminal.terminalId && message.status === 'closed'), 5000)
  } finally {
    await manager.destroyAllRooms()
  }
})

test('real Shell cd updates live cwd and the next Shell inherits it server-side', async () => {
  const target = mkdtempSync(join(tmpdir(), 'shell-deck-live-cwd-'))
  const manager = new TerminalRoomManager()
  manager.setTerminalEnvProvider(() => ({ HISTFILE: '/dev/null' }))
  const room = manager.createRoom()
  const messages: ServerMessage[] = []
  manager.connectClient(room.roomId, (message) => messages.push(message))
  const first = manager.createTerminal(room.roomId, { backend: 'real' })

  try {
    await waitFor(() => homePromptVisible(renderedText(messages, first.terminalId)), 5000)
    manager.input(room.roomId, first.terminalId, 'cd -- ' + target + '\r')
    await waitFor(() => messages.some((message) => message.type === 'terminal_cwd' && message.terminalId === first.terminalId && message.cwd === target), 5000)

    manager.createTerminal(room.roomId, { backend: 'text' })
    const inherited = manager.createTerminal(room.roomId, { backend: 'real', cwdSource: 'last-shell' })
    expect(inherited.cwd).toBe(target)
    await waitFor(() => renderedText(messages, inherited.terminalId).length > 0, 5000)
    manager.input(room.roomId, inherited.terminalId, 'printf "__INHERITED_PWD__%s__" "$PWD"\r')
    await waitFor(() => renderedText(messages, inherited.terminalId).includes('__INHERITED_PWD__'), 5000)
    expect(renderedText(messages, inherited.terminalId)).toContain('__INHERITED_PWD__' + target + '__')
  } finally {
    await manager.destroyAllRooms()
    rmSync(target, { recursive: true, force: true })
  }
})

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(25)
  }
  throw new Error('timeout')
}

function renderedText(messages: ServerMessage[], terminalId: string): string {
  const snapshot = messages.filter((message) => message.type === 'terminal_snapshot' && message.terminalId === terminalId).at(-1)
  const initial = snapshot?.type === 'terminal_snapshot' ? snapshot.replay.join('') : ''
  const output = messages.filter((message): message is Extract<ServerMessage, { type: 'pty_output' }> => message.type === 'pty_output' && message.terminalId === terminalId).map((message) => message.data).join('')
  return initial + output
}

function homePromptVisible(text: string): boolean {
  const visibleText = text.replace(/\x1b\[[0-9;]*m/g, '')
  const user = userInfo().username
  const host = hostname().split('.')[0]
  return visibleText.includes('[' + user + '@' + host + ':~]$ ') || visibleText.includes('[' + user + '@' + host + ':~]# ')
}
