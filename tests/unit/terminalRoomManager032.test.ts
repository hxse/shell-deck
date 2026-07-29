import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGeneratedId } from '../../src/lib/generatedId'
import { parseClientMessage, type ServerMessage } from '../../src/lib/protocol'
import { normalizeTerminalRef } from '../../src/lib/terminalIdentity'
import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from '../../server/terminalBackend'
import { MAX_LIVE_ROOMS, TerminalRoomManager } from '../../server/terminalRoomManager'
import { setTextTerminalContent } from '../helpers/textTerminal'

test('Room lifecycle keeps runtime isolated and revisiting a token creates a new generation', async () => {
  const manager = new TerminalRoomManager()
  const first = manager.ensureRootRoom()
  expect(first.kind).toBe('created')
  if (first.kind !== 'created') return
  expect(manager.ensureRootRoom().kind).toBe('home')
  manager.createTerminal(first.room.roomId, { backend: 'fake' })
  expect(manager.roomSnapshot(first.room.roomId).terminals).toHaveLength(1)
  await manager.destroyRoom(first.room.roomId, first.room.roomGeneration)
  expect(manager.listRooms()).toEqual([])
  const revisited = manager.ensureRoomFromRoute(first.room.roomId)
  expect(revisited.created).toBe(true)
  expect(revisited.room.roomGeneration).not.toBe(first.room.roomGeneration)
  expect(manager.roomSnapshot(first.room.roomId).terminals).toEqual([])
})

test('all Room creation paths share the exact capacity guard', () => {
  const manager = new TerminalRoomManager()
  for (let index = 0; index < MAX_LIVE_ROOMS; index += 1) manager.createRoom()
  expect(manager.listRooms()).toHaveLength(MAX_LIVE_ROOMS)
  expect(() => manager.createRoom()).toThrow('room_capacity_reached')
  expect(() => manager.ensureRoomFromRoute(createGeneratedId('room'))).toThrow('room_capacity_reached')
})

test('Destroy aborts admitted async work before removing the Room and prevents resurrection', async () => {
  const manager = new TerminalRoomManager()
  const room = manager.createRoom()
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const operation = manager.runOperation(room.roomId, async (ticket) => {
    await blocked
    ticket.assertActive()
    manager.createTerminal(room.roomId, { backend: 'fake' })
  })
  await Promise.resolve()
  const destroying = manager.destroyRoom(room.roomId, room.roomGeneration)
  release()
  await expect(operation).rejects.toThrow('room_destroying')
  await destroying
  expect(manager.listRooms()).toEqual([])
})

test('Destroy waits for asynchronous backend process cleanup before releasing the Room', async () => {
  let releaseClose!: () => void
  const closeBarrier = new Promise<void>((resolve) => { releaseClose = resolve })
  let closeStarted = false
  const manager = new TerminalRoomManager({
    backendFactory: () => ({
      kind: 'fake',
      inputChannel: 'helper-stdin-pipe',
      start() {},
      write() {},
      resize() {},
      close() { closeStarted = true; return closeBarrier },
    }),
  })
  const room = manager.createRoom()
  manager.createTerminal(room.roomId, { backend: 'fake' })
  let destroyed = false
  const destroying = manager.destroyRoom(room.roomId, room.roomGeneration).then(() => { destroyed = true })
  await Promise.resolve()
  expect(closeStarted).toBe(true)
  expect(destroyed).toBe(false)
  releaseClose()
  await destroying
  expect(manager.listRooms()).toEqual([])
})

test('Shell cwd belongs to a terminal, defaults to HOME and survives drag without following index', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-cwd-'))
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    mkdirSync(left)
    mkdirSync(right)
    const manager = new TerminalRoomManager({ homeDirectory: left })
    const room = manager.createRoom()
    const first = manager.createTerminal(room.roomId, { backend: 'fake' })
    const second = manager.createTerminal(room.roomId, { backend: 'fake', cwd: right })
    expect(first.cwd).toBe(left)
    expect(second.cwd).toBe(right)
    manager.moveTerminal(room.roomId, second.terminalId, 1)
    const moved = manager.roomSnapshot(room.roomId).terminals
    expect(moved[0]).toMatchObject({ terminalId: second.terminalId, cwd: right, terminalIndex: 1 })
    expect(moved[1]).toMatchObject({ terminalId: first.terminalId, cwd: left, terminalIndex: 2 })
    expect(() => manager.createTerminal(room.roomId, { backend: 'text', cwd: left })).toThrow('text_terminal_cwd_not_supported')
    await manager.destroyAllRooms()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('live Shell cwd is broadcast and server-side New shell inheritance skips trailing Text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-live-cwd-'))
  try {
    const left = join(root, 'left')
    const right = join(root, 'right')
    mkdirSync(left)
    mkdirSync(right)
    const backends: MutableCwdBackend[] = []
    const optionsSeen: TerminalBackendOptions[] = []
    const manager = new TerminalRoomManager({
      homeDirectory: left,
      backendFactory: (kind, options) => {
        optionsSeen.push(options)
        const backend = new MutableCwdBackend(kind, options.cwd ?? null)
        backends.push(backend)
        return backend
      },
    })
    const room = manager.createRoom()
    const messages: ServerMessage[] = []
    manager.connectClient(room.roomId, (message) => messages.push(message))
    const shell = manager.createTerminal(room.roomId, { backend: 'real', cwd: left })
    manager.createTerminal(room.roomId, { backend: 'text' })
    const structureRevision = manager.roomSnapshot(room.roomId).roomRevision

    backends[0].cwd = right
    backends[0].emit('prompt')
    await Bun.sleep(90)
    expect(messages).toContainEqual(expect.objectContaining({ type: 'terminal_cwd', terminalId: shell.terminalId, cwd: right }))
    expect(manager.roomSnapshot(room.roomId).roomRevision).toBeGreaterThan(structureRevision)

    const inherited = manager.createTerminal(room.roomId, { backend: 'real', cwdSource: 'last-shell' })
    expect(inherited.cwd).toBe(right)
    expect(optionsSeen.at(-1)?.cwd).toBe(right)
    await manager.destroyAllRooms()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('terminal revisions distinguish equal-length output activity and Text writes', async () => {
  const backends: MutableCwdBackend[] = []
  const manager = new TerminalRoomManager({
    replayByteLimit: 8,
    backendFactory: (kind, options) => {
      const backend = new MutableCwdBackend(kind, options.cwd ?? null)
      backends.push(backend)
      return backend
    },
  })
  const room = manager.createRoom()
  const shell = manager.createTerminal(room.roomId, { backend: 'fake' })
  backends[0].emit('12345678')
  const first = manager.roomSnapshot(room.roomId).terminals[0]
  backends[0].emit('abcdefgh')
  const second = manager.roomSnapshot(room.roomId).terminals[0]
  expect(second.replay.join('')).toBe('abcdefgh')
  expect(second.outputActivityRevision).toBeGreaterThan(first.outputActivityRevision)
  expect(manager.terminalOutputActivityRevision(room.roomId, room.roomGeneration, shell.terminalId, shell.launchId)).toBe(second.outputActivityRevision)

  const text = manager.createTerminal(room.roomId, { backend: 'text' })
  setTextTerminalContent(manager, room.roomId, text.terminalId, 'a')
  const textA = manager.roomSnapshot(room.roomId).terminals[1]
  setTextTerminalContent(manager, room.roomId, text.terminalId, 'ab')
  const textAb = manager.roomSnapshot(room.roomId).terminals[1]
  expect(textAb.textRevision).toBe(textA.textRevision + 1)
  expect(textAb.terminalRevision).toBeGreaterThan(textA.terminalRevision)
  await manager.destroyAllRooms()
})

test('terminal identity is only dynamic index plus runtime id; alias and rename fail loudly', async () => {
  const manager = new TerminalRoomManager()
  const room = manager.createRoom()
  const terminal = manager.createTerminal(room.roomId, { backend: 'text' })
  expect(Object.hasOwn(terminal, 'terminalAlias')).toBe(false)
  expect(manager.indexMap(room.roomId)).toEqual([{ index: 1, terminalId: terminal.terminalId }])
  expect(normalizeTerminalRef(terminal.terminalId)).toEqual({ kind: 'id', value: terminal.terminalId })
  expect(() => normalizeTerminalRef('text_1')).toThrow('invalid_terminal_id')
  expect(() => parseClientMessage(JSON.stringify({ type: 'terminal_input', terminalAlias: 'text_1', data: 'x' }))).toThrow('client_message_unknown_field:terminalAlias')
  expect(() => parseClientMessage(JSON.stringify({ type: 'rename_terminal', terminalId: terminal.terminalId, terminalAlias: 'renamed' }))).toThrow('invalid_client_message_type')
  expect(() => parseClientMessage(JSON.stringify({ type: 'create_terminal', cols: '80' }))).toThrow('invalid_terminal_size')
  expect(parseClientMessage(JSON.stringify({ type: 'create_terminal', backend: 'real', cwdSource: 'last-shell' }))).toMatchObject({ cwdSource: 'last-shell' })
  expect(() => parseClientMessage(JSON.stringify({ type: 'create_terminal', cwd: '/tmp', cwdSource: 'last-shell' }))).toThrow('terminal_cwd_source_conflict')
  expect(() => parseClientMessage(JSON.stringify({ type: 'create_terminal', cwdSource: 'active-tab' }))).toThrow('invalid_terminal_cwd_source')
  expect(() => parseClientMessage(JSON.stringify({ type: 'close_terminal', terminalIndex: 0 }))).toThrow('invalid_terminal_index')
  expect(parseClientMessage(JSON.stringify({ type: 'close_all_terminals' }))).toEqual({ type: 'close_all_terminals' })
  expect(() => parseClientMessage(JSON.stringify({ type: 'close_all_terminals', terminalId: terminal.terminalId }))).toThrow('client_message_unknown_field:terminalId')
  expect(() => manager.createTerminal(room.roomId, { backend: 'fake', cols: 1 })).toThrow('invalid_terminal_size')
  await manager.destroyAllRooms()
})

class MutableCwdBackend implements TerminalBackend {
  readonly inputChannel = 'helper-stdin-pipe' as const
  #events: TerminalBackendEvent | null = null

  constructor(readonly kind: 'fake' | 'real' | 'text', public cwd: string | null) {}
  start(events: TerminalBackendEvent): void { this.#events = events }
  emit(data: string): void { this.#events?.onData(data) }
  write(): void {}
  resize(): void {}
  currentCwd(): string | null { return this.kind === 'text' ? null : this.cwd }
  close(): void {}
}
