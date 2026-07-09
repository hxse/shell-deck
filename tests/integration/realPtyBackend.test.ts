import { hostname, userInfo } from 'node:os'
import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import { defaultRealShellCwd } from '../../server/realPtyBackend'
import { TerminalDeckManager } from '../../server/terminalDeckManager'

test('real shell backend uses stdin pipe and returns shell output', async () => {
  const manager = new TerminalDeckManager()
  const terminal = manager.createTerminal('local', { backend: 'real', terminalId: 'term_real_a' })
  const messages: ServerMessage[] = []
  manager.connectClient('local', (message) => messages.push(message), 'real-client')

  const expectedCwd = defaultRealShellCwd()
  await waitFor(() => homePromptVisible(outputText(messages, terminal.terminalId)), 5000)
  expect(outputText(messages, terminal.terminalId)).toContain('\x1b[1;92m')
  manager.input('local', terminal.terminalId, 'printf "__SD_PWD__%s__" "$PWD"\r')
  await waitFor(() => outputText(messages, terminal.terminalId).includes('__SD_PWD__'), 5000)
  expect(outputText(messages, terminal.terminalId)).toContain('__SD_PWD__' + expectedCwd + '__')

  manager.input('local', terminal.terminalId, 'alias ls\r')
  await waitFor(() => outputText(messages, terminal.terminalId).includes("alias ls='ls --color=auto'"), 5000)
  expect(outputText(messages, terminal.terminalId)).toContain("alias ls='ls --color=auto'")

  manager.input('local', terminal.terminalId, 'printf __SD_OK__\r')
  await waitFor(() => outputText(messages, terminal.terminalId).includes('__SD_OK__'), 5000)
  expect(outputText(messages, terminal.terminalId)).toContain('__SD_OK__')

  const longPaste = '__SD_LONG_' + 'x'.repeat(7000) + '_END__'
  manager.input('local', terminal.terminalId, 'printf ' + longPaste + '\r')
  await waitFor(() => outputText(messages, terminal.terminalId).includes('_END__'), 5000)
  expect(outputText(messages, terminal.terminalId)).toContain(longPaste)

  manager.resize('local', terminal.terminalId, 100, 30)
  expect(messages.some((message) => message.type === 'terminal_state' && message.cols === 100 && message.rows === 30)).toBe(true)

  manager.input('local', terminal.terminalId, 'stty size\r')
  await waitFor(() => outputText(messages, terminal.terminalId).includes('30 100'), 5000)
  expect(outputText(messages, terminal.terminalId)).toContain('30 100')

  manager.input('local', terminal.terminalId, 'sleep 5\r')
  await Bun.sleep(100)
  manager.input('local', terminal.terminalId, '\u0003')
  manager.input('local', terminal.terminalId, 'printf __AFTER_CTRL_C__\r')
  await waitFor(() => outputText(messages, terminal.terminalId).includes('__AFTER_CTRL_C__'), 5000)
  expect(outputText(messages, terminal.terminalId)).toContain('__AFTER_CTRL_C__')

  manager.input('local', terminal.terminalId, 'exit\r')
  await waitFor(() => messages.some((message) => message.type === 'terminal_state' && message.terminalId === terminal.terminalId && message.status === 'closed'), 5000)
  expect(messages.some((message) => message.type === 'terminal_state' && message.terminalId === terminal.terminalId && message.status === 'closed')).toBe(true)
})

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(25)
  }
  throw new Error('timeout')
}

function outputText(messages: ServerMessage[], terminalId: string) {
  return messages
    .filter((message): message is Extract<ServerMessage, { type: 'pty_output' }> => message.type === 'pty_output' && message.terminalId === terminalId)
    .map((message) => message.data)
    .join('')
}

function homePromptVisible(text: string) {
  const visibleText = stripAnsi(text)
  const user = userInfo().username
  const host = hostname().split('.')[0]
  return visibleText.includes('[' + user + '@' + host + ':~]$ ') || visibleText.includes('[' + user + '@' + host + ':~]# ')
}

function stripAnsi(text: string) {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}
