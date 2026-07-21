import { expect } from 'bun:test'

import { startShellDeckServer } from '../../server/httpServer'

import { TerminalRoomManager } from '../../server/terminalRoomManager'

import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from '../../server/terminalBackend'

import type { MacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionTypes'

import type { ServerMessage } from '../../src/lib/protocol'

import { roomControlHeaders, type RoomControlGrant } from '../../src/lib/roomControl'

function runnableDefinition(second: string): MacroDefinitionV5 {
  return {
    schemaVersion: 5,
    name: 'immutable run',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [
      { id: 'send_one', type: 'send', terminal: { kind: 'terminal_index', index: 1 }, message: { parts: [{ kind: 'text', text: 'one' }] }, delivery: 'direct', ending: 'cr' },
      { id: 'wait', type: 'wait', mode: 'duration', durationMs: 400 },
      { id: 'send_two', type: 'send', terminal: { kind: 'terminal_index', index: 1 }, message: { parts: [{ kind: 'text', text: second }] }, delivery: 'direct', ending: 'cr' },
      { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'terminal_index', index: 1 }, mode: 'scrollback-tail', maxChars: 20_000 } },
    ],
  }
}

function roomGrant(manager: import('../../server/terminalRoomManager').TerminalRoomManager, roomId: string): RoomControlGrant {
  const messages: ServerMessage[] = []
  manager.connectClient(roomId, (message) => messages.push(message))
  const grant = messages.find((message): message is Extract<ServerMessage, { type: 'room_control' }> => message.type === 'room_control')?.grant
  if (!grant) throw new Error('missing_room_control_grant')
  return grant
}

async function request(baseUrl: string, path: string, grant: RoomControlGrant, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(baseUrl + path, { method: 'POST', headers: { ...roomControlHeaders(grant), 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

function replay(server: ReturnType<typeof startShellDeckServer>, roomId: string, terminalId: string): string {
  return server.manager.roomSnapshot(roomId).terminals.find((terminal) => terminal.terminalId === terminalId)?.replay.join('') ?? ''
}

function replayFromManager(manager: TerminalRoomManager, roomId: string, terminalId: string): string {
  return manager.roomSnapshot(roomId).terminals.find((terminal) => terminal.terminalId === terminalId)?.replay.join('') ?? ''
}

async function acquireMacroLease(baseUrl: string, grant: RoomControlGrant, itemId: string): Promise<{ editLeaseId: string }> {
  const result = await request(baseUrl, '/api/content-edit-leases/acquire', grant, {
    resourceKey: { kind: 'macro', itemId },
    expectedLeaseEpoch: 0,
  })
  expect(result.status).toBe(200)
  return (result.body as { grant: { editLeaseId: string } }).grant
}

class StreamingTerminalBackend implements TerminalBackend {
  readonly kind = 'fake' as const
  readonly inputChannel = 'helper-stdin-pipe' as const
  readonly cwd: string | null
  private timer: ReturnType<typeof setInterval> | null = null
  private events: TerminalBackendEvent | null = null

  constructor(options: TerminalBackendOptions) { this.cwd = options.cwd ?? null }
  start(events: TerminalBackendEvent): void { this.events = events; this.timer = setInterval(() => events.onData('abcd'), 10) }
  write(): void {}
  resize(): void {}
  currentCwd(): string | null { return this.cwd }
  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const events = this.events
    this.events = null
    events?.onExit(0, null)
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('wait_timeout')
    await Bun.sleep(10)
  }
}

function deferredGate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { wait, release }
}

export {
  runnableDefinition,
  roomGrant,
  request,
  replay,
  replayFromManager,
  acquireMacroLease,
  StreamingTerminalBackend,
  waitFor,
  deferredGate,
}
