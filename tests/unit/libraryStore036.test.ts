import { expect, test } from 'bun:test'
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryStore } from '../../server/libraryStore'
import { publishPrivateFileAtomic, publishPrivateFileDelete, writePrivateFileAtomic } from '../../server/userDataRoot'
import { createGeneratedId } from '../../src/lib/generatedId'
import { assertLibraryItem } from '../../src/lib/library/libraryTypes'

test('LibraryStore uses exact current records, canonical kind identity and normalized fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-036-'))
  const sharedId = createGeneratedId('libraryItem')
  let nowIndex = 0
  const store = new LibraryStore(root, {
    idFactory: () => sharedId,
    now: () => `2026-07-18T00:00:0${nowIndex++}.000Z`,
  })
  try {
    const prompt = await store.create('prompt', { title: '  Signals  ', content: 'Alpha body', description: 'desk', tags: [' alpha ', '', 'alpha', 'Beta'] })
    const note = await store.create('note', { title: 'Note', content: '{{old}} is plain text', description: '', tags: [] })
    expect(prompt).toMatchObject({ schemaVersion: 1, itemId: sharedId, kind: 'prompt', revision: 1, title: 'Signals', tags: ['alpha', 'Beta'] })
    expect(note.itemId).toBe(sharedId)
    expect(lstatSync(store.recordPath('prompt', sharedId)).mode & 0o777).toBe(0o600)
    expect(store.read('prompt', sharedId)).toEqual(prompt)
    expect(store.read('note', sharedId)).toEqual(note)
    expect(() => store.read('macro-template', sharedId)).toThrow('library_item_not_found')
    expect(() => assertLibraryItem({ ...prompt, scope: 'global' })).toThrow('invalid_library_item')
    expect(() => store.recordPath('prompt', 'lib_test')).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('LibraryStore search covers all fields and is stable by updatedAt then itemId', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-search-036-'))
  const ids = [createGeneratedId('libraryItem'), createGeneratedId('libraryItem'), createGeneratedId('libraryItem')]
  let idIndex = 0
  const timestamps = ['2026-07-18T00:00:00.000Z', '2026-07-18T00:00:02.000Z', '2026-07-18T00:00:02.000Z']
  let timestampIndex = 0
  const store = new LibraryStore(root, { idFactory: () => ids[idIndex++], now: () => timestamps[timestampIndex++] })
  try {
    await store.create('prompt', { title: 'Title signal', content: 'one', description: '', tags: [] })
    await store.create('prompt', { title: 'Two', content: 'body SIGNAL', description: '', tags: [] })
    await store.create('prompt', { title: 'Three', content: 'three', description: '', tags: ['signal-tag'] })
    const expected = [ids[1], ids[2]].sort((left, right) => left.localeCompare(right))
    expect(store.list('prompt', '  SIGNAL  ').map((item) => item.itemId)).toEqual([...expected, ids[0]])
    expect(store.list('prompt', '')).toHaveLength(3)
    expect(store.list('note', '')).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('LibraryStore scan isolates malformed records without hiding valid records', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-scan-038-'))
  const store = new LibraryStore(root)
  try {
    const valid = await store.create('macro-template', { title: 'Valid envelope', content: '{}', description: '', tags: [] })
    const invalidId = createGeneratedId('libraryItem')
    writePrivateFileAtomic(store.recordPath('macro-template', invalidId), '{')
    expect(store.scan('macro-template')).toEqual({
      records: [valid],
      invalidItems: [{ itemId: invalidId, error: 'invalid_library_item' }],
    })
    expect(() => store.list('macro-template')).toThrow('invalid_library_item')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('LibraryStore Create runs its authorization guard inside the canonical transaction before publishing bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-create-guard-036-'))
  const store = new LibraryStore(root)
  try {
    await expect(store.create('note', { title: 'Rejected', content: 'never written', description: '', tags: [] }, undefined, () => {
      throw new Error('room_control_lost')
    })).rejects.toThrow('room_control_lost')
    expect(store.list('note')).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('LibraryStore mutations reconcile authoritative truth after post-publish durability failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-published-036-'))
  const uncertain = { syncParentDirectory() { throw new Error('injected_directory_fsync_failure') } }
  const store = new LibraryStore(root, {
    replaceRecord: (path, bytes) => publishPrivateFileAtomic(path, bytes, uncertain),
    deleteRecord: (path) => publishPrivateFileDelete(path, uncertain),
  })
  try {
    const created = await store.create('note', { title: 'Published', content: 'v1', description: '', tags: [] })
    expect(created).toMatchObject({ revision: 1, content: 'v1' })
    const updated = await store.transactions.run(store.recordPath('note', created.itemId), () => (
      store.commitUpdate('note', created.itemId, 1, { title: 'Published', content: 'v2', description: '', tags: [] })
    ))
    expect(updated).toMatchObject({ revision: 2, content: 'v2' })
    await store.transactions.run(store.recordPath('note', created.itemId), () => store.commitDelete('note', created.itemId, 2))
    expect(() => store.read('note', created.itemId)).toThrow('library_item_not_found')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('two LibraryStore processes see writes and optimistic transaction commits without a permanent cache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-process-036-'))
  const first = new LibraryStore(root)
  const second = new LibraryStore(root)
  try {
    const item = await first.create('note', { title: 'Shared', content: 'v1', description: '', tags: [] })
    expect(second.read('note', item.itemId)).toEqual(item)
    const updated = await first.transactions.run(first.recordPath('note', item.itemId), () => first.commitUpdate('note', item.itemId, 1, { title: 'Shared', content: 'v2', description: '', tags: [] }))
    expect(updated.revision).toBe(2)
    expect(second.read('note', item.itemId).content).toBe('v2')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
