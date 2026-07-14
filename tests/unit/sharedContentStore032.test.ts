import { expect, test } from 'bun:test'
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MacroRecordStore } from '../../server/sharedContentStore'
import { publishPrivateFileAtomic, publishPrivateFileDelete } from '../../server/userDataRoot'

test('generic MacroRecord metadata is server-owned and optimistic updates have one winner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-record-'))
  try {
    let tick = 0
    const now = () => `2026-07-15T00:00:0${tick++}.000Z`
    const firstProcess = new MacroRecordStore<{ value: string }>(root, { now })
    const secondProcess = new MacroRecordStore<{ value: string }>(root, { now })
    const created = await firstProcess.create({ value: 'a' })
    expect(created).toMatchObject({ revision: 1, definition: { value: 'a' } })
    expect(lstatSync(firstProcess.recordPath(created.id)).mode & 0o777).toBe(0o600)
    expect(secondProcess.read(created.id)).toEqual(created)

    const results = await Promise.allSettled([
      firstProcess.update(created.id, 1, { value: 'left' }),
      secondProcess.update(created.id, 1, { value: 'right' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(String(rejected.reason)).toContain('content_revision_conflict')
    expect(firstProcess.read(created.id).revision).toBe(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('MacroRecord create checks its commit guard inside the canonical transaction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-create-guard-'))
  try {
    const store = new MacroRecordStore<{ value: string }>(root)
    await expect(store.create({ value: 'denied' }, undefined, () => {
      throw new Error('room_control_lost')
    })).rejects.toThrow('room_control_lost')
    expect(store.list()).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('MacroRecord mutations reconcile authoritative truth after post-publish durability failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-published-record-'))
  try {
    const uncertain = { syncParentDirectory() { throw new Error('injected_directory_fsync_failure') } }
    const store = new MacroRecordStore<{ value: string }>(root, {
      replaceRecord: (path, bytes) => publishPrivateFileAtomic(path, bytes, uncertain),
      deleteRecord: (path) => publishPrivateFileDelete(path, uncertain),
    })
    const created = await store.create({ value: 'created' })
    expect(created).toMatchObject({ revision: 1, definition: { value: 'created' } })
    const updated = await store.update(created.id, 1, { value: 'updated' })
    expect(updated).toMatchObject({ revision: 2, definition: { value: 'updated' } })
    await store.delete(created.id, 2)
    expect(() => store.read(created.id)).toThrow('macro_record_not_found')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
