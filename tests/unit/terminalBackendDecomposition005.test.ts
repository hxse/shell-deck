import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ServerMessage, TerminalBackendKind } from '../../src/lib/protocol'
import type { TerminalBackend, TerminalBackendEvent } from '../../server/terminalBackend'
import {
  defaultBackendFactory,
  resolveShellCwd,
  TerminalBackendCoordinator,
} from '../../server/terminalBackendCoordinator'
import { TerminalRoomManager } from '../../server/terminalRoomManager'

describe('Terminal backend and CWD lifecycle decomposition', () => {
  test('facade composes one backend lifecycle and one cache-free CWD coordinator', () => {
    const serverRoot = resolve(import.meta.dir, '../../server')
    const names = [
      'terminalBackendCoordinator.ts',
      'terminalBackendLifecycle.ts',
      'terminalCwdCoordinator.ts',
    ] as const
    const sources = Object.fromEntries(names.map((name) => [
      name,
      readFileSync(resolve(serverRoot, name), 'utf8'),
    ])) as Record<(typeof names)[number], string>
    const productionFiles = readdirSync(serverRoot).filter((file) => file.endsWith('.ts'))
    const facade = sources['terminalBackendCoordinator.ts']
    const lifecycle = sources['terminalBackendLifecycle.ts']
    const cwd = sources['terminalCwdCoordinator.ts']

    expect(consumers(serverRoot, productionFiles, 'terminalBackendCoordinator')).toEqual(['terminalRoomManager.ts'])
    expect(consumers(serverRoot, productionFiles, 'terminalBackendLifecycle')).toEqual([
      'terminalBackendCoordinator.ts',
      'terminalCwdCoordinator.ts',
    ])
    expect(consumers(serverRoot, productionFiles, 'terminalCwdCoordinator')).toEqual(['terminalBackendCoordinator.ts'])
    expect(lifecycle).not.toMatch(/from ['"]\.\/terminalBackendCoordinator['"]/)
    expect(cwd).not.toMatch(/from ['"]\.\/terminalBackendCoordinator['"]/)

    expect(facade.match(/rooms: options\.rooms/g)).toHaveLength(2)
    expect([facade, lifecycle, cwd].join('\n')).not.toContain('new Map')
    expect(facade).not.toContain('pendingData:')
    expect(facade).not.toContain('setTimeout(')
    expect(facade).not.toContain('appendTerminalReplay')
    expect(lifecycle.match(/pendingData: string\[\]/g)).toHaveLength(1)
    expect(lifecycle).not.toContain('commitTerminal')
    expect(lifecycle).not.toContain('homeDirectory')
    expect(cwd).toContain('}, CWD_REFRESH_DEBOUNCE_MS)')
    expect(cwd).not.toContain('backendFactory')
    expect(cwd).not.toContain('commitTerminal')
    expect(cwd).not.toContain('appendTerminalReplay')

    for (const source of [...Object.values(sources), readFileSync(import.meta.path, 'utf8')]) {
      expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(400)
    }
  })

  test('facade retains exports and manager-facing method surface', () => {
    expect(typeof defaultBackendFactory).toBe('function')
    expect(typeof resolveShellCwd).toBe('function')
    const prototype = TerminalBackendCoordinator.prototype as unknown as Record<string, Function>
    for (const method of [
      'setTerminalEnvProvider',
      'createTerminal',
      'input',
      'setTextContent',
      'resize',
      'resetTerminal',
      'closeTerminal',
      'resolveTerminal',
      'terminalOrThrow',
      'terminalSnapshot',
      'roomSnapshot',
      'broadcastIndexMap',
      'cancelCwdRefresh',
      'beginBackendClose',
    ]) {
      expect(typeof prototype[method]).toBe('function')
    }
  })

  test('create, reset and close retain candidate and commit phase order', () => {
    const source = readFileSync(resolve(import.meta.dir, '../../server/terminalBackendCoordinator.ts'), 'utf8')
    expectOrdered(methodSource(source, '  createTerminal(', '  input('), [
      'const ticket = this.options.admit(roomId)',
      'room = this.options.activeRoomOrThrow(roomId)',
      'assertTerminalStructureMutable(room)',
      'const cwd =',
      'const terminalId = this.nextTerminalId(room)',
      'const launchId = this.nextLaunchId(room)',
      'backend = this.options.backendFactory',
      'const terminal = createTerminalRuntimeState({',
      'const candidate = this.backendLifecycle.startCandidate(terminal)',
      'ticket.assertActive()',
      'this.backendLifecycle.assertCandidateReady(candidate)',
      'commitTerminalCreate(room, terminal, options.insertAtIndex)',
      'this.backendLifecycle.commitCandidate(candidate)',
      "terminal.status = 'running'",
      'this.options.broadcast(room, this.terminalSnapshot(terminal))',
      'this.broadcastIndexMap(room)',
      'this.backendLifecycle.flushCandidate(candidate)',
      'return this.terminalSnapshot(terminal)',
      'if (backend) this.beginBackendClose(room, backend)',
      'ticket.finish()',
    ])

    expectOrdered(methodSource(source, '  resetTerminal(', '  closeTerminal('), [
      'const ticket = this.options.admit(roomId)',
      'room = this.options.roomOrThrow(roomId)',
      'assertTerminalStructureMutable(room)',
      'const oldTerminal = this.resolveTerminal(roomId, ref)',
      'backend = this.options.backendFactory',
      'const nextTerminal = restartTerminalRuntimeState(oldTerminal',
      'const candidate = this.backendLifecycle.startCandidate(nextTerminal)',
      'ticket.assertActive()',
      'this.backendLifecycle.assertCandidateReady(candidate)',
      'this.cancelCwdRefresh(oldTerminal)',
      'this.beginBackendClose(room, oldTerminal.backend)',
      'commitTerminalRestart(room, nextTerminal)',
      'this.backendLifecycle.commitCandidate(candidate)',
      "nextTerminal.status = 'running'",
      'this.options.broadcast(room, this.terminalSnapshot(nextTerminal))',
      'this.broadcastIndexMap(room)',
      'this.backendLifecycle.flushCandidate(candidate)',
      'return { ok: true as const }',
      'if (backend) this.beginBackendClose(room, backend)',
      'ticket.finish()',
    ])

    expectOrdered(methodSource(source, '  closeTerminal(', '  resolveTerminal('), [
      'const room = this.options.roomOrThrow(roomId)',
      'assertTerminalStructureMutable(room)',
      'const terminal = this.resolveTerminal(roomId, ref)',
      'this.cancelCwdRefresh(terminal)',
      'this.beginBackendClose(room, terminal.backend)',
      'commitTerminalClose(room, terminal.terminalId)',
      'this.broadcastIndexMap(room)',
      'this.options.broadcast(room, this.roomSnapshot(room))',
      'ticket.finish()',
    ])
  })

  test('candidate callbacks, stale guard and CWD timer retain exact internal order', () => {
    const serverRoot = resolve(import.meta.dir, '../../server')
    const lifecycle = readFileSync(resolve(serverRoot, 'terminalBackendLifecycle.ts'), 'utf8')
    const cwd = readFileSync(resolve(serverRoot, 'terminalCwdCoordinator.ts'), 'utf8')

    expectOrdered(methodSource(lifecycle, '  startCandidate(', '  assertCandidateReady('), [
      'committed: false',
      'pendingData: []',
      'terminal.backend.start({',
      'candidate.committed ? this.emitOutput(terminal, data) : candidate.pendingData.push(data)',
      'candidate.committed',
      'this.markClosed(terminal, exitCode, signal)',
      'candidate.pendingExit = { exitCode, signal }',
      'candidate.committed ? this.markFailed(terminal, error) : candidate.pendingError = error',
      'return candidate',
    ])
    expectOrdered(methodSource(lifecycle, '  flushCandidate(', '  beginBackendClose('), [
      'for (const data of candidate.pendingData) this.emitOutput(candidate.terminal, data)',
      'if (candidate.pendingError) this.markFailed(candidate.terminal, candidate.pendingError)',
      'if (candidate.pendingExit)',
      'this.markClosed(candidate.terminal, candidate.pendingExit.exitCode, candidate.pendingExit.signal)',
    ])
    expectOrdered(methodSource(lifecycle, '  private emitOutput(', '  private markClosed('), [
      'if (!isCurrentTerminal(this.options.rooms, terminal)) return',
      'appendTerminalReplay(terminal, data, this.options.replayByteLimit)',
      'this.options.advanceTerminalRevision(room, terminal, { outputActivity: true })',
      "type: 'pty_output'",
      'this.options.scheduleCwdRefresh(terminal)',
    ])
    expectOrdered(methodSource(cwd, '  scheduleCwdRefresh(', '  refreshTerminalCwd('), [
      'this.cancelCwdRefresh(terminal)',
      'terminal.cwdRefreshTimer = setTimeout(() => {',
      'terminal.cwdRefreshTimer = null',
      'if (isCurrentTerminal(this.options.rooms, terminal)) this.refreshTerminalCwd(terminal, true)',
      '}, CWD_REFRESH_DEBOUNCE_MS)',
    ])
    expectOrdered(methodSource(cwd, '  refreshTerminalCwd(', '  cancelCwdRefresh('), [
      'observed = terminal.backend.currentCwd()',
      'cwd = resolveShellCwd(observed)',
      'if (terminal.cwd === cwd) return cwd',
      'terminal.cwd = cwd',
      'if (isCurrentTerminal(this.options.rooms, terminal))',
      'this.options.advanceTerminalRevision(room, terminal)',
      "type: 'terminal_cwd'",
      'return cwd',
    ])
    expectOrdered(lifecycle.slice(lifecycle.indexOf('export function isCurrentTerminal(')), [
      "room?.lifecycle === 'active'",
      'room.roomGeneration === terminal.roomGeneration',
      'room.terminals.get(terminal.terminalId) === terminal',
    ])
  })

  test('callbacks from a replaced backend cannot mutate the current launch', async () => {
    const backends: RetainedBackend[] = []
    const messages: ServerMessage[] = []
    const manager = new TerminalRoomManager({
      backendFactory: (kind) => {
        const backend = new RetainedBackend(kind)
        backends.push(backend)
        return backend
      },
    })
    const room = manager.createRoom()
    manager.connectClient(room.roomId, (message) => messages.push(message))
    const terminal = manager.createTerminal(room.roomId, { backend: 'real' })
    expect(manager.resetTerminal(room.roomId, terminal.terminalId, 'real')).toEqual({ ok: true })
    const before = manager.roomSnapshot(room.roomId)
    const messageCount = messages.length

    backends[0].emit('stale-output')
    backends[0].fail(new Error('stale-error'))
    backends[0].exit(9, null)
    expect(manager.roomSnapshot(room.roomId)).toEqual(before)
    expect(messages).toHaveLength(messageCount)

    backends[1].emit('current-output')
    expect(manager.roomSnapshot(room.roomId).terminals[0].replay).toEqual(['current-output'])
    await manager.destroyAllRooms()
  })
})

class RetainedBackend implements TerminalBackend {
  readonly inputChannel = 'helper-stdin-pipe' as const
  private events: TerminalBackendEvent | null = null

  constructor(readonly kind: TerminalBackendKind) {}
  start(events: TerminalBackendEvent): void { this.events = events }
  write(): void {}
  resize(): void {}
  close(): void {}
  emit(data: string): void { this.events?.onData(data) }
  fail(error: Error): void { this.events?.onError(error) }
  exit(exitCode: number | null, signal: string | null): void { this.events?.onExit(exitCode, signal) }
}

function consumers(serverRoot: string, files: string[], moduleName: string): string[] {
  const pattern = new RegExp(`from ['"]\\./${moduleName}['"]`)
  return files
    .filter((file) => pattern.test(readFileSync(resolve(serverRoot, file), 'utf8')))
    .sort()
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
