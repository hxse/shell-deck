import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryStore } from '../../server/libraryStore'

const worker = join(import.meta.dir, '..', 'fixtures', 'libraryStore036Worker.ts')

test('separate processes read Library writes and exactly one same-revision update wins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-process-036-'))
  try {
    const store = new LibraryStore(root)
    const item = await store.create('note', { title: 'Shared', content: 'v1', description: '', tags: [] })
    expect(await runWorker(['read', root, 'note', item.itemId, ''])).toEqual({ ok: true, revision: 1, content: 'v1' })

    const results = await Promise.all([
      runWorker(['update', root, 'note', item.itemId, 'left']),
      runWorker(['update', root, 'note', item.itemId, 'right']),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'content_revision_conflict' }])
    expect(store.read('note', item.itemId)).toMatchObject({ revision: 2 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

async function runWorker(args: string[]): Promise<{ ok: boolean; error?: string; revision?: number; content?: string }> {
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
  if (exitCode !== 0) throw new Error(stderr || 'library_worker_failed')
  return JSON.parse(stdout)
}
