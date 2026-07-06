import { expect, test } from 'bun:test'
import type { ServerMessage } from '../../src/lib/protocol'
import { startShellDeckServer } from '../../server/httpServer'

test('default seed creates two shell terminals and one text deck slot', () => {
  const server = startShellDeckServer({ port: 0 })
  try {
    const snapshot = server.manager.deckSnapshot('local')
    expect(snapshot.terminals.map((terminal) => terminal.backend)).toEqual(['real', 'real', 'text'])
  } finally {
    server.stop()
  }
})

test('two websocket clients share terminal output, replay and reorder map', async () => {
  const server = startShellDeckServer({ port: 0, seed: false })
  try {
    server.manager.ensureConfig('local')
    const terminal = server.manager.createTerminal('local', { backend: 'fake', terminalId: 'term_ws_a' })
    const first = await connect(server.url, 'local')
    const second = await connect(server.url, 'local')

    first.ws.send(JSON.stringify({ type: 'terminal_input', terminalId: terminal.terminalId, data: 'hello-ws\r' }))
    await waitFor(() => outputText(first.messages, terminal.terminalId).includes('ECHO:hello-ws'), 1000)
    expect(outputText(second.messages, terminal.terminalId)).toContain('ECHO:hello-ws')

    const late = await connect(server.url, 'local')
    await waitFor(() => snapshotText(late.messages, terminal.terminalId).includes('ECHO:hello-ws'), 1000)
    expect(snapshotText(late.messages, terminal.terminalId)).toContain('ECHO:hello-ws')

    first.ws.send(JSON.stringify({ type: 'create_terminal', backend: 'fake' }))
    await waitFor(() => latestIndexMap(first.messages).length === 2, 1000)
    const created = latestIndexMap(first.messages).find((item: { terminalId: string }) => item.terminalId !== terminal.terminalId)
    expect(created).toBeDefined()
    first.ws.send(JSON.stringify({ type: 'reorder_terminal', terminalId: created!.terminalId, newIndex: 1 }))
    await waitFor(() => latestIndexMap(second.messages)[0]?.terminalId === created!.terminalId, 1000)
    expect(latestIndexMap(second.messages)).toEqual([
      { index: 1, terminalId: created!.terminalId, terminalAlias: created!.terminalAlias },
      { index: 2, terminalId: terminal.terminalId, terminalAlias: terminal.terminalAlias },
    ])

    first.ws.send(JSON.stringify({ type: 'close_terminal', terminalId: created!.terminalId }))
    await waitFor(() => latestIndexMap(second.messages).length === 1, 1000)
    expect(latestIndexMap(second.messages)).toEqual([
      { index: 1, terminalId: terminal.terminalId, terminalAlias: terminal.terminalAlias },
    ])

    first.ws.close()
    second.ws.close()
    late.ws.close()
  } finally {
    server.stop()
  }
})

async function connect(baseUrl: string, configId: string) {
  const messages: ServerMessage[] = []
  const ws = new WebSocket(baseUrl.replace('http://', 'ws://') + '/ws?configId=' + configId)
  ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))))
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error('ws_error')), { once: true })
  })
  await waitFor(() => messages.some((message) => message.type === 'deck_snapshot'), 1000)
  return { ws, messages }
}

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('timeout')
}

function outputText(messages: ServerMessage[], terminalId: string) {
  return messages
    .filter((message): message is Extract<ServerMessage, { type: 'pty_output' }> => message.type === 'pty_output' && message.terminalId === terminalId)
    .map((message) => message.data)
    .join('')
}

function snapshotText(messages: ServerMessage[], terminalId: string) {
  return messages
    .filter((message) => message.type === 'deck_snapshot')
    .flatMap((message) => message.terminals)
    .filter((terminal) => terminal.terminalId === terminalId)
    .map((terminal) => terminal.replay.join(''))
    .at(-1) ?? ''
}

function latestIndexMap(messages: ServerMessage[]) {
  const maps = messages
    .filter((message) => message.type === 'terminal_index_map')
    .map((message) => message.items)
  if (maps.length > 0) return maps.at(-1)!
  const snapshot = messages.findLast((message) => message.type === 'deck_snapshot')
  return snapshot?.type === 'deck_snapshot' ? snapshot.indexMap : []
}
