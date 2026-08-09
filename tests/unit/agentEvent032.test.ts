import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingestAgentEvent } from '../../server/agentEventIngest'
import { TerminalRoomManager } from '../../server/terminalRoomManager'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import { createGeneratedId } from '../../src/lib/generatedId'

test('AgentEvent ingest freezes Room path and validates generation, terminal and launch membership', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-agent-'))
  try {
    const manager = new TerminalRoomManager()
    const room = manager.createRoom()
    const terminal = manager.createTerminal(room.roomId, { backend: 'fake' })
    const store = new AgentEventStore(root)
    const input = agentOutput(room.roomGeneration, terminal.terminalId, terminal.launchId)
    expect(ingestAgentEvent(input, 'bad', { roomId: room.roomId, expectedToken: 'token', manager, store })).toMatchObject({ ok: false, status: 403 })
    expect(ingestAgentEvent({ ...input, roomId: createGeneratedId('room') }, 'token', { roomId: room.roomId, expectedToken: 'token', manager, store })).toMatchObject({ ok: false, status: 422 })
    expect(ingestAgentEvent({ ...input, adapterMetadata: { ...input.adapterMetadata, extra: true } }, 'token', { roomId: room.roomId, expectedToken: 'token', manager, store })).toMatchObject({ ok: false, status: 422 })
    expect(ingestAgentEvent({ ...input, roomGeneration: manager.createRoom().roomGeneration }, 'token', { roomId: room.roomId, expectedToken: 'token', manager, store })).toMatchObject({ ok: false, status: 404 })
    const accepted = ingestAgentEvent(input, 'token', { roomId: room.roomId, expectedToken: 'token', manager, store })
    expect(accepted).toMatchObject({ ok: true })
    if (!accepted.ok) return
    expect(accepted.event).toMatchObject({ serverInstanceId: manager.serverInstanceId, roomId: room.roomId, roomGeneration: room.roomGeneration })
    expect(store.latestMatching({
      serverInstanceId: manager.serverInstanceId,
      roomId: room.roomId,
      roomGeneration: room.roomGeneration,
      terminalId: terminal.terminalId,
      launchId: terminal.launchId,
      eventKind: 'agent.output',
    })?.capturedText).toBe('done')
    await manager.destroyAllRooms()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('external shell-deck codex wrapper fails before starting Codex when Room context is absent', () => {
  const result = Bun.spawnSync(['bun', 'run', 'scripts/shell-deck-codex.ts'], {
    cwd: join(import.meta.dir, '..', '..'),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SHELL_DECK_CODEX_BIN: '/definitely/not/codex' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('shell_deck_room_context_required')
})

test('just codex preserves the invocation directory as child cwd and PWD', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-codex-cwd-'))
  const targetCwd = join(root, 'caller-project')
  const fakeCodex = join(root, 'fake-codex')
  try {
    mkdirSync(targetCwd)
    writeFileSync(fakeCodex, '#!/usr/bin/env bash\npwd -P\nprintf \'%s\\n\' "$PWD"\nprintf \'%s\\n\' "$SHELL_DECK_TARGET_CWD"\n')
    chmodSync(fakeCodex, 0o700)
    const repoRoot = join(import.meta.dir, '..', '..')
    const result = Bun.spawnSync(['just', '--justfile', join(repoRoot, 'justfile'), 'codex'], {
      cwd: targetCwd,
      env: {
        ...process.env,
        SHELL_DECK_CODEX_BIN: fakeCodex,
        SHELL_DECK_DISABLE_HOOKS: '1',
        SHELL_DECK_SERVER_INSTANCE_ID: 'server-test',
        SHELL_DECK_ROOM_ID: 'room-test',
        SHELL_DECK_ROOM_GENERATION: 'generation-test',
        SHELL_DECK_TERMINAL_ID: 'terminal-test',
        SHELL_DECK_LAUNCH_ID: 'launch-test',
        SHELL_DECK_INGEST_URL: 'http://127.0.0.1/ingest',
        SHELL_DECK_INGEST_TOKEN: 'token-test',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(result.exitCode).toBe(0)
    const observedPaths = result.stdout.toString().trim().split('\n').slice(-3)
    expect(observedPaths).toEqual(Array(3).fill(realpathSync(targetCwd)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function agentOutput(roomGeneration: string, terminalId: string, launchId: string) {
  return {
    protocolVersion: 1 as const,
    agentKind: 'codex' as const,
    eventKind: 'agent.output' as const,
    roomGeneration,
    terminalId,
    launchId,
    agentSessionId: 'session-a',
    agentTurnId: 'turn-a',
    adapterMetadata: { adapter: 'codex-stop-hook' as const, codexSessionId: 'session-a' },
    capturedText: 'done',
    raw: { source: 'codex.Stop', payload: {} },
  }
}
