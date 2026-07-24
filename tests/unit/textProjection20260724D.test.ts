import { expect, test } from 'bun:test'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { ServerMessage, TerminalSnapshot } from '../../src/lib/protocol'
import { sha256Text } from '../../src/lib/textHash'
import { TextTerminalProjectionCoordinator } from '../../src/lib/textTerminalProjectionCoordinator'
import type { TerminalRoomClient } from '../../src/lib/terminalRoomClient'
import { TerminalViewStateStore, type TerminalViewSnapshot } from '../../src/lib/terminalViewState'

const roomId = createGeneratedId('room')
const roomGeneration = createGeneratedId('roomGeneration')
const terminalId = createGeneratedId('terminal')
const launchId = createGeneratedId('terminalLaunch')

test('Text observer verifies mutation hashes, repairs once, and marks same-revision repair truth', async () => {
  const store = new TerminalViewStateStore()
  let terminal = store.mergeSnapshot(await snapshot(''))
  const sent: unknown[] = []
  const notices: string[] = []
  const client = {
    send(message: unknown) {
      sent.push(message)
      return true
    },
  } as TerminalRoomClient
  const coordinator = new TextTerminalProjectionCoordinator({
    roomGeneration: () => roomGeneration,
    client: () => client,
    terminal: (id) => id === terminalId ? terminal : undefined,
    install: (next) => { terminal = next },
    observeRoomRevision: () => {},
    notice: (reason) => notices.push(reason),
  })

  coordinator.validateTerminal(terminalId)
  await Bun.sleep(0)
  expect(sent).toEqual([])

  coordinator.applyMutation(mutationMessage('x', 'sha256:' + '0'.repeat(64)))
  await waitFor(() => sent.length === 1)
  expect(sent).toEqual([{ type: 'request_text_snapshot', terminalId }])
  expect(terminal.textRevision).toBe(0)

  coordinator.applySnapshot({
    type: 'terminal_text_snapshot',
    roomId,
    roomGeneration,
    terminalId,
    launchId,
    content: '',
    resultHash: await sha256Text(''),
    roomRevision: 1,
    terminalRevision: 1,
    textRevision: 0,
    outputActivityRevision: 0,
  })
  await waitFor(() => terminal.textRepairGeneration === 1)
  expect(terminal.textRevision).toBe(0)

  coordinator.applyMutation(mutationMessage('x', 'sha256:' + '1'.repeat(64)))
  await waitFor(() => notices.includes('text_sync_repair_failed'))
  expect(sent).toHaveLength(1)

  terminal = {
    ...await viewSnapshot('new launch'),
    launchId: createGeneratedId('terminalLaunch'),
    contentHash: await sha256Text('different'),
  }
  coordinator.applyMutation(mutationMessage('stale launch', 'sha256:' + '2'.repeat(64)))
  await Bun.sleep(0)
  expect(sent).toHaveLength(1)
  coordinator.validateTerminal(terminalId)
  await waitFor(() => sent.length === 2)
  expect(sent.at(-1)).toEqual({ type: 'request_text_snapshot', terminalId })
})

test('initial Text snapshot hash mismatch requests one full repair', async () => {
  let terminal: TerminalViewSnapshot = {
    ...await viewSnapshot('corrupt'),
    contentHash: await sha256Text('different'),
  }
  const sent: unknown[] = []
  const coordinator = new TextTerminalProjectionCoordinator({
    roomGeneration: () => roomGeneration,
    client: () => ({ send: (message: unknown) => (sent.push(message), true) }) as TerminalRoomClient,
    terminal: () => terminal,
    install: (next) => { terminal = next },
    observeRoomRevision: () => {},
    notice: () => {},
  })
  coordinator.validateTerminal(terminalId)
  await waitFor(() => sent.length === 1)
  coordinator.validateTerminal(terminalId)
  await Bun.sleep(0)
  expect(sent).toEqual([{ type: 'request_text_snapshot', terminalId }])
})

test('an in-flight mutation hash cannot overwrite a reset launch or spend its repair budget', async () => {
  let terminal = await viewSnapshot('base')
  const sent: unknown[] = []
  const blocked = blockHash()
  const coordinator = new TextTerminalProjectionCoordinator({
    roomGeneration: () => roomGeneration,
    client: () => ({ send: (message: unknown) => (sent.push(message), true) }) as TerminalRoomClient,
    terminal: () => terminal,
    install: (next) => { terminal = next },
    observeRoomRevision: () => {},
    notice: () => {},
    hash: blocked.hash,
  })

  coordinator.applyMutation(mutationMessage('stale', await sha256Text('stalebase')))
  await blocked.started.promise
  const resetLaunchId = createGeneratedId('terminalLaunch')
  terminal = await viewSnapshot('reset truth', resetLaunchId)
  coordinator.validateTerminal(terminalId)
  blocked.release.resolve()
  await waitFor(() => blocked.calls() === 2)

  expect({ launchId: terminal.launchId, content: terminal.replay.join(''), sent }).toEqual({
    launchId: resetLaunchId,
    content: 'reset truth',
    sent: [],
  })
})

test('an in-flight repair hash cannot overwrite a same-revision projection after coordinator reset', async () => {
  let terminal = await viewSnapshot('base')
  const blocked = blockHash(2)
  const coordinator = new TextTerminalProjectionCoordinator({
    roomGeneration: () => roomGeneration,
    client: () => null,
    terminal: () => terminal,
    install: (next) => { terminal = next },
    observeRoomRevision: () => {},
    notice: () => {},
    hash: blocked.hash,
  })

  coordinator.validateTerminal(terminalId)
  await waitFor(() => blocked.calls() === 1)
  coordinator.applySnapshot({
    type: 'terminal_text_snapshot',
    roomId,
    roomGeneration,
    terminalId,
    launchId,
    content: 'stale repair',
    resultHash: await sha256Text('stale repair'),
    roomRevision: 1,
    terminalRevision: 1,
    textRevision: 0,
    outputActivityRevision: 0,
  })
  await blocked.started.promise
  coordinator.reset()
  terminal = await viewSnapshot('reconnect truth')
  coordinator.validateTerminal(terminalId)
  blocked.release.resolve()
  await waitFor(() => blocked.calls() === 3)

  expect(terminal.replay.join('')).toBe('reconnect truth')
})

function mutationMessage(
  insert: string,
  resultHash: string,
): Extract<ServerMessage, { type: 'terminal_text_mutation' }> {
  return {
    type: 'terminal_text_mutation',
    roomId,
    roomGeneration,
    terminalId,
    launchId,
    mutation: { kind: 'patch', start: 0, deleteCount: 0, insert },
    resultHash,
    roomRevision: 2,
    terminalRevision: 2,
    textRevision: 1,
    outputActivityRevision: 1,
  }
}

async function snapshot(content: string, terminalLaunchId = launchId): Promise<TerminalSnapshot> {
  return {
    type: 'terminal_snapshot',
    roomId,
    roomGeneration,
    terminalId,
    launchId: terminalLaunchId,
    terminalIndex: 1,
    visualOrder: 1,
    status: 'running',
    cols: 80,
    rows: 24,
    backend: 'text',
    cwd: null,
    replay: [content],
    contentHash: await sha256Text(content),
    exitCode: null,
    signal: null,
    roomRevision: 1,
    terminalRevision: 1,
    textRevision: 0,
    outputActivityRevision: 0,
  }
}

async function viewSnapshot(content: string, terminalLaunchId = launchId): Promise<TerminalViewSnapshot> {
  return new TerminalViewStateStore().mergeSnapshot(await snapshot(content, terminalLaunchId))
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timeout')
    await Bun.sleep(5)
  }
}

function blockHash(blockedCall = 1) {
  const started = deferred<void>()
  const release = deferred<void>()
  let callCount = 0
  return {
    started,
    release,
    calls: () => callCount,
    hash: async (content: string) => {
      callCount += 1
      if (callCount === blockedCall) {
        started.resolve()
        await release.promise
      }
      return await sha256Text(content)
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
