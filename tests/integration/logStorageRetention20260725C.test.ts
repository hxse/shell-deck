import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShellDeckServer } from '../../server/httpServer'
import { LogStorageRetention } from '../../server/logStorageRetention'
import { MacroRunStore } from '../../server/macroRunStore'
import { initializeUserDataRoot, writePrivateFileAtomic } from '../../server/userDataRoot'
import type { MacroRunnerSnapshot } from '../../src/lib/macro/runnerTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import { request, roomGrant, waitFor } from './macroRuntime034.helpers'

const quotaWorker = join(import.meta.dir, '..', 'fixtures', 'logStorageQuotaWorker.ts')

test('current Room terminal run survives quota GC, HTTP snapshot, and WebSocket reconnect until Destroy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-current-run-pin-20260725c-'))
  const server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
  let socket: WebSocket | null = null
  try {
    const room = server.manager.createRoom()
    const grant = roomGrant(server.manager, room.roomId)
    const record = await server.macroStore.create({
      schemaVersion: 6,
      name: 'current run pin',
      description: '',
      terminalLayout: [],
      body: [],
    })
    const started = await request(server.url, `/api/rooms/${room.roomId}/runner/start`, grant, {
      templateId: record.id,
      expectedMacroRevision: record.revision,
      expectedTerminalStructureRevision: 0,
    })
    expect(started.status).toBe(201)
    await waitFor(() => server.macroRunner.snapshot(room.roomId).status === 'completed')
    const completed = server.macroRunner.snapshot(room.roomId)
    const runId = completed.runId!
    const paths = initializeUserDataRoot(root)
    expect(existsSync(join(paths.locks, 'log-storage-current-runs', runId + '.json'))).toBe(true)

    const measured = new LogStorageRetention(root, { limitBytes: Number.MAX_SAFE_INTEGER }).usageBytes()
    const constrained = new LogStorageRetention(root, { limitBytes: measured })
    new MacroRunStore(root, undefined, undefined, undefined, constrained)
    expect(() => constrained.enforce()).toThrow('log_storage_limit_reached')
    expect(existsSync(join(paths.runs, runId))).toBe(true)
    expect(server.macroRunner.snapshot(room.roomId)).toMatchObject({ runId, status: 'completed' })

    const httpSnapshot = await fetch(server.url + `/api/rooms/${room.roomId}/runner`)
    expect(httpSnapshot.status).toBe(200)
    expect(await httpSnapshot.json()).toMatchObject({ ok: true, runner: { runId, status: 'completed' } })

    const connected = await connectRunner(server.url, room.roomId)
    socket = connected.socket
    expect(connected.snapshot).toMatchObject({ runId, status: 'completed' })

    const replaced = await request(server.url, `/api/rooms/${room.roomId}/runner/start`, grant, {
      templateId: record.id,
      expectedMacroRevision: record.revision,
      expectedTerminalStructureRevision: 0,
    })
    expect(replaced.status).toBe(201)
    await waitFor(() => server.macroRunner.snapshot(room.roomId).status === 'completed'
      && server.macroRunner.snapshot(room.roomId).runId !== runId)
    const replacementRunId = server.macroRunner.snapshot(room.roomId).runId!
    expect(() => constrained.enforce()).toThrow('log_storage_limit_reached')
    expect(existsSync(join(paths.runs, runId))).toBe(false)
    expect(existsSync(join(paths.runs, replacementRunId))).toBe(true)

    socket.close()
    socket = null
    await server.manager.destroyRoom(room.roomId, room.roomGeneration)
    constrained.enforce()
    expect(existsSync(join(paths.runs, replacementRunId))).toBe(false)
  } finally {
    socket?.close()
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('two processes cannot both publish bytes admitted from the same shared-root baseline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-quota-process-20260725c-'))
  try {
    const paths = initializeUserDataRoot(root)
    const workers = [
      runQuotaWorker(root, 'left', 1_000, 600),
      runQuotaWorker(root, 'right', 1_000, 600),
    ]
    await waitFor(() => existsSync(join(paths.locks, 'quota-ready-left'))
      && existsSync(join(paths.locks, 'quota-ready-right')))
    writePrivateFileAtomic(join(paths.locks, 'quota-go'), 'go\n')
    const results = await Promise.all(workers)
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok))
      .toEqual([{ ok: false, error: 'log_storage_limit_reached' }])
    expect(new LogStorageRetention(root, { limitBytes: 1_000 }).usageBytes()).toBe(600)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

async function connectRunner(baseUrl: string, roomId: string): Promise<{
  socket: WebSocket
  snapshot: MacroRunnerSnapshot
}> {
  const messages: ServerMessage[] = []
  const socket = new WebSocket(baseUrl.replace('http://', 'ws://') + '/ws/rooms/' + roomId)
  socket.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))))
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('ws_error')), { once: true })
  })
  await waitFor(() => messages.some((message) => message.type === 'runner_snapshot'))
  const message = messages.find((candidate): candidate is Extract<ServerMessage, { type: 'runner_snapshot' }> => (
    candidate.type === 'runner_snapshot'
  ))
  if (!message) throw new Error('runner_snapshot_missing')
  return { socket, snapshot: message.snapshot }
}

async function runQuotaWorker(
  root: string,
  workerId: string,
  limitBytes: number,
  bytes: number,
): Promise<{ ok: boolean; error?: string }> {
  const child = Bun.spawn(
    ['bun', 'run', quotaWorker, root, workerId, String(limitBytes), String(bytes)],
    { cwd: join(import.meta.dir, '..', '..'), stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || 'quota_worker_failed')
  return JSON.parse(stdout)
}
