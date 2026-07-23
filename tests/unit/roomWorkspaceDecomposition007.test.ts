import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RoomControlView } from '../../src/lib/roomControl'
import type { TerminalRoomClient } from '../../src/lib/terminalRoomClient'
import { RoomWorkspaceReconnectCoordinator } from '../../src/lib/roomWorkspaceReconnectCoordinator'

describe('Workspace message synchronization and reconnect decomposition', () => {
  test('factory remains the sole rune owner and both coordinators remain cache-free', () => {
    const libRoot = resolve(import.meta.dir, '../../src/lib')
    const names = [
      'roomWorkspaceState.svelte.ts',
      'roomWorkspaceMessageCoordinator.ts',
      'roomWorkspaceReconnectCoordinator.ts',
    ] as const
    const sources = Object.fromEntries(names.map((name) => [
      name,
      readFileSync(resolve(libRoot, name), 'utf8'),
    ])) as Record<(typeof names)[number], string>
    const productionFiles = readdirSync(libRoot).filter((file) => file.endsWith('.ts'))
    const factory = sources['roomWorkspaceState.svelte.ts']
    const message = sources['roomWorkspaceMessageCoordinator.ts']
    const reconnect = sources['roomWorkspaceReconnectCoordinator.ts']

    expect(consumers(libRoot, productionFiles, 'roomWorkspaceMessageCoordinator')).toEqual([
      'roomWorkspaceState.svelte.ts',
    ])
    expect(consumers(libRoot, productionFiles, 'roomWorkspaceReconnectCoordinator')).toEqual([
      'roomWorkspaceState.svelte.ts',
    ])
    for (const coordinator of [message, reconnect]) {
      expect(coordinator).not.toMatch(/\$(?:state|derived|effect)\b/)
      expect(coordinator).not.toContain('TerminalViewStateStore')
      expect(coordinator).not.toMatch(/#(?:terminals|runnerSnapshot|roomSnapshot)\b/)
    }
    expect(runeNames(factory, 'state')).toEqual([
      'active',
      'connected',
      'connectionGeneration',
      'reconnectNonce',
      'roomGeneration',
      'controlView',
      'controlPending',
      'client',
      'terminals',
      'terminalStructureRevision',
      'terminalPositions',
      'terminalStructureLocked',
      'runnerSnapshot',
      'contentRecordChanges',
      'contentEditLeaseChanges',
      'activeTerminalId',
      'draggingTerminalId',
    ])
    expect(runeNames(factory, 'derived')).toEqual(['activeTerminal', 'canMutateShared'])
    expect(factory.match(/\$effect\(/g)).toHaveLength(3)
    expect(factory).not.toContain('setTimeout(')
    expect(factory).not.toContain("fetch('/api/rooms')")
    expect(factory).not.toContain('controlMemoryKey')
    expect(message).not.toContain('new TerminalRoomClient')
    expect(message).not.toContain('$effect')
    expect(message).toContain('++this.#contentChangeSequence')
    expect(message).toContain('++this.#contentLeaseChangeSequence')
    expect(factory).toContain('contentRecordChanges.slice(-199)')
    expect(factory).toContain('contentEditLeaseChanges.slice(-199)')
    expect(reconnect).toContain("'shell-deck:room-control-intent:' + roomId")
    expect(reconnect).toContain('const ROOM_CONTROL_RECLAIM_WINDOW_MS = 5_000')
    expect(reconnect).toContain('const RECONNECT_DELAY_MS = 750')
    expect(reconnect).not.toContain('#continuationToken')
    expect(reconnect).not.toContain('#disposed')

    for (const source of [...Object.values(sources), readFileSync(import.meta.path, 'utf8')]) {
      expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(400)
    }
  })

  test('factory public surface and synchronization phase order stay frozen', () => {
    const libRoot = resolve(import.meta.dir, '../../src/lib')
    const factory = readFileSync(resolve(libRoot, 'roomWorkspaceState.svelte.ts'), 'utf8')
    const message = readFileSync(resolve(libRoot, 'roomWorkspaceMessageCoordinator.ts'), 'utf8')
    const reconnect = readFileSync(resolve(libRoot, 'roomWorkspaceReconnectCoordinator.ts'), 'utf8')
    const returned = factory.slice(factory.lastIndexOf('  return {'))

    for (const member of [
      'connected',
      'connectionGeneration',
      'controlView',
      'controlPending',
      'client',
      'terminals',
      'terminalStructureRevision',
      'terminalPositions',
      'terminalStructureLocked',
      'runnerSnapshot',
      'contentRecordChanges',
      'contentEditLeaseChanges',
      'activeTerminalId',
      'draggingTerminalId',
      'activeTerminal',
      'canMutateShared',
      'createShell',
      'createText',
      'takeControl',
      'applyRoomSnapshot',
      'selectTerminal',
      'closeTerminalTab',
      'startDrag',
      'dropOnTab',
      'finishTabDrag',
      'tabKeydown',
      'playNotificationSound',
      'dispose',
    ]) {
      expect(returned).toContain(member)
    }
    expectOrdered(factory.slice(factory.indexOf('    reconnectNonce')), [
      'terminalViews.clear()',
      'roomRevisionGate.reset()',
      'terminals = []',
      'terminalStructureRevision = 0',
      'terminalPositions = null',
      'terminalStructureLocked = false',
      'runnerSnapshot = null',
      'runnerRepair.resetForConnection(roomId)',
      'contentRecordChanges = []',
      'contentEditLeaseChanges = []',
      'notificationDelivery.clear()',
      'connected = false',
      'controlView = null',
      'controlPending = false',
      'const connection = new TerminalRoomClient',
    ])
    expectOrdered(methodSource(factory, '  function dispose(', '\n\n  return {'), [
      'active = false',
      'reconnect.dispose()',
      'runnerRepair.dispose()',
      'notificationDelivery.clear()',
      'client?.close()',
    ])
    expectOrdered(methodSource(message, '  handle(', '\n  }\n}'), [
      "message.type === 'client_registered'",
      'ports.setRoomGeneration(message.roomGeneration)',
      'ports.resetRoomRevision()',
      'ports.resumeRunnerRepair()',
      "'roomGeneration' in message",
      "message.type === 'room_control'",
      "message.type === 'room_snapshot'",
      "message.type === 'terminal_snapshot'",
      "message.type === 'pty_output'",
      "message.type === 'terminal_index_map'",
      "message.type === 'runner_snapshot'",
      "message.type === 'runner_delta'",
      "message.type === 'content_record_changed'",
      "message.type === 'content_edit_lease_changed'",
      "message.type === 'macro_notification'",
      "message.type === 'terminal_state'",
      "message.type === 'terminal_cwd'",
      "message.type === 'room_destroyed'",
    ])
    expectOrdered(methodSource(reconnect, '  handleOpen(', '  async handleClose('), [
      'this.#options.setConnected(true)',
      'this.#options.advanceConnectionGeneration()',
      'this.#clearReconnectTimer()',
      'this.#options.resumeRunnerRepair()',
    ])
    expectOrdered(methodSource(reconnect, '  async handleClose(', '  handleControlView('), [
      'this.armControlReclaim()',
      'this.#options.setConnected(false)',
      'this.#options.setControlView(null)',
      'this.#options.setControlPending(false)',
      "event?.code === 4001 || event?.reason === 'room_destroyed'",
      "this.#fetcher('/api/rooms')",
      '!response.ok || !body.ok || !this.#options.identity().active',
      'room.roomId === closedRoomId',
      'this.#options.enterHome()',
      'this.#scheduleReconnect(closedRoomId)',
    ])
  })

  test('an inactive workspace ignores the pending close-probe response', async () => {
    let resolveProbe!: (response: Response) => void
    const probe = new Promise<Response>((resolve) => { resolveProbe = resolve })
    const harness = reconnectHarness(async () => await probe)

    const closing = harness.coordinator.handleClose(closeEvent())
    harness.state.active = false
    harness.coordinator.dispose()
    resolveProbe(roomListResponse())
    await closing
    await nextTimer()

    expect(harness.reconnects()).toBe(0)
    expect(harness.homes()).toBe(0)
  })

  test('the parent close-probe failure matrix and exact Room result stay unchanged', async () => {
    const failedHttp = reconnectHarness(async () =>
      new Response(JSON.stringify({ ok: false }), { status: 503 }))
    await failedHttp.coordinator.handleClose(closeEvent())
    await nextTimer()
    expect(failedHttp.reconnects()).toBe(0)
    expect(failedHttp.homes()).toBe(0)
    failedHttp.coordinator.dispose()

    const failedNetwork = reconnectHarness(async () => {
      throw new Error('network_unavailable')
    })
    await failedNetwork.coordinator.handleClose(closeEvent())
    await nextTimer()
    expect(failedNetwork.reconnects()).toBe(1)
    expect(failedNetwork.homes()).toBe(0)
    failedNetwork.coordinator.dispose()

    const absent = reconnectHarness(async () =>
      new Response(JSON.stringify({ ok: true, rooms: [] }), { status: 200 }))
    await absent.coordinator.handleClose(closeEvent())
    await nextTimer()
    expect(absent.reconnects()).toBe(0)
    expect(absent.homes()).toBe(1)

    const live = reconnectHarness(async () => roomListResponse())
    await live.coordinator.handleClose(closeEvent())
    await nextTimer()
    expect(live.reconnects()).toBe(1)
    expect(live.homes()).toBe(0)
    live.coordinator.dispose()
  })
})

type HarnessState = {
  active: boolean
  connected: boolean
  roomId: string
  roomGeneration: string
  controlView: RoomControlView | null
  controlPending: boolean
  client: TerminalRoomClient | null
}

function reconnectHarness(fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  const state: HarnessState = {
    active: true,
    connected: true,
    roomId: 'room_test',
    roomGeneration: 'roomGeneration_test',
    controlView: null,
    controlPending: false,
    client: null,
  }
  let reconnectCount = 0
  let homeCount = 0
  let coordinator!: RoomWorkspaceReconnectCoordinator
  coordinator = new RoomWorkspaceReconnectCoordinator({
    roomId: state.roomId,
    identity: () => state,
    setConnected: (value) => { state.connected = value },
    setControlView: (value) => { state.controlView = value },
    setControlPending: (value) => { state.controlPending = value },
    advanceConnectionGeneration: () => {},
    requestReconnect: () => { reconnectCount += 1 },
    resumeRunnerRepair: () => {},
    enterHome: () => {
      homeCount += 1
      state.active = false
      coordinator.dispose()
    },
    notice: () => {},
    fetcher,
    reconnectDelayMs: 0,
  })
  return {
    coordinator,
    state,
    reconnects: () => reconnectCount,
    homes: () => homeCount,
  }
}

function roomListResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    rooms: [{ roomId: 'room_test', roomGeneration: 'roomGeneration_test' }],
  }), { status: 200 })
}

function closeEvent(): CloseEvent {
  return { code: 4000, reason: 'forced_reconnect' } as CloseEvent
}

async function nextTimer(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

function consumers(libRoot: string, files: string[], moduleName: string): string[] {
  const pattern = new RegExp(`from ['"]\\./${moduleName}['"]`)
  return files
    .filter((file) => pattern.test(readFileSync(resolve(libRoot, file), 'utf8')))
    .sort()
}

function runeNames(source: string, rune: 'state' | 'derived'): string[] {
  return source
    .split('\n')
    .flatMap((line) => {
      const match = line.match(new RegExp(`^\\s*let (\\w+) = \\$${rune}(?:<.*>)?\\(`))
      return match ? [match[1]] : []
    })
}

function methodSource(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex, `missing method start: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `missing method end: ${end}`).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

function expectOrdered(source: string, needles: string[]): void {
  let offset = 0
  for (const needle of needles) {
    const index = source.indexOf(needle, offset)
    expect(index, `${needle} must remain after the previous phase`).toBeGreaterThanOrEqual(offset)
    offset = index + needle.length
  }
}
