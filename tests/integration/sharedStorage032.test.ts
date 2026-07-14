import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MacroRecordStore } from '../../server/sharedContentStore'

const worker = join(import.meta.dir, '..', 'fixtures', 'sharedStorage032Worker.ts')

test('two processes updating one MacroRecord revision have exactly one winner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-process-record-'))
  try {
    const store = new MacroRecordStore<{ value: string }>(root)
    const record = await store.create({ value: 'initial' })
    const results = await Promise.all([
      runWorker(['update', root, record.id, 'left']),
      runWorker(['update', root, record.id, 'right']),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'content_revision_conflict' }])
    expect(store.read(record.id).revision).toBe(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a crashed lock owner releases the kernel lock and exactly one waiting writer wins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-process-crash-lock-'))
  try {
    const store = new MacroRecordStore<{ value: string }>(root)
    const record = await store.create({ value: 'initial' })
    const holder = Bun.spawn(['bun', 'run', worker, 'hold-record-lock', root, record.id, ''], {
      cwd: join(import.meta.dir, '..', '..'),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    await waitForReady(holder.stdout)

    const waiters = [
      runWorker(['update', root, record.id, 'left']),
      runWorker(['update', root, record.id, 'right']),
    ]
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    holder.kill('SIGKILL')
    await holder.exited

    const results = await Promise.all(waiters)
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'content_revision_conflict' }])
    expect(store.read(record.id).revision).toBe(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('different cwd legacy notification files racing for one target keep the loser source', async () => {
  const base = mkdtempSync(join(tmpdir(), 'shell-deck-032-process-notif-'))
  const root = join(base, 'root')
  const leftCwd = join(base, 'left')
  const rightCwd = join(base, 'right')
  try {
    const left = join(leftCwd, '.shell-deck', 'notification-profiles.json')
    const right = join(rightCwd, '.shell-deck', 'notification-profiles.json')
    for (const [path, content] of [[left, 'left-secret'], [right, 'right-secret']] as const) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      writeFileSync(path, content, { mode: 0o600 })
      chmodSync(path, 0o600)
    }
    const results = await Promise.all([
      runWorker(['notification', root, leftCwd, '']),
      runWorker(['notification', root, rightCwd, '']),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'notification_config_path_conflict' }])
    const target = join(root, 'notification-profiles.json')
    const winner = readFileSync(target, 'utf8')
    expect(['left-secret', 'right-secret']).toContain(winner)
    const loser = winner === 'left-secret' ? right : left
    const removedWinner = winner === 'left-secret' ? left : right
    expect(existsSync(loser)).toBe(true)
    expect(existsSync(removedWinner)).toBe(false)
  } finally { rmSync(base, { recursive: true, force: true }) }
})

async function runWorker(args: string[]): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  const child = Bun.spawn(['bun', 'run', worker, ...args], { cwd: join(import.meta.dir, '..', '..'), stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(stderr || 'worker_failed')
  return JSON.parse(stdout)
}

async function waitForReady(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  try {
    while (!output.includes('\n')) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error('lock_holder_exited_before_ready')
      output += decoder.decode(chunk.value, { stream: true })
    }
    expect(output.trim()).toBe('ready')
  } finally {
    reader.releaseLock()
  }
}
