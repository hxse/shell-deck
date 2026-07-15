import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MacroRecordStore } from '../../server/sharedContentStore'

const worker = join(import.meta.dir, '..', 'fixtures', 'sharedStorage032Worker.ts')

test('two server processes racing for one content edit lease have exactly one winner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-033-process-lease-'))
  try {
    const record = await new MacroRecordStore<Record<string, never>>(root).create({})
    const results = await Promise.all([
      runWorker(['lease-acquire', root, record.id, '0']),
      runWorker(['lease-acquire', root, record.id, '0']),
    ])
    expect(results.filter((result) => result.ok)).toEqual([{ ok: true, leaseEpoch: 1 }])
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'content_edit_lease_epoch_conflict' }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

async function runWorker(args: string[]): Promise<{ ok: boolean; error?: string; leaseEpoch?: number }> {
  const child = Bun.spawn(['bun', 'run', worker, ...args], {
    cwd: join(import.meta.dir, '..', '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || 'worker_failed')
  return JSON.parse(stdout)
}
