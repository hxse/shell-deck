import { LibraryStore } from '../../server/libraryStore'

const [action, root, kind, itemId, value] = Bun.argv.slice(2)

try {
  const store = new LibraryStore(root)
  if (action === 'read') {
    const item = store.read(kind, itemId)
    console.log(JSON.stringify({ ok: true, revision: item.revision, content: item.content }))
  } else if (action === 'update') {
    const item = await store.transactions.run(store.recordPath(kind, itemId), () => {
      const current = store.read(kind, itemId)
      return store.commitUpdate(kind, itemId, 1, {
        title: current.title,
        content: value,
        description: current.description,
        tags: current.tags,
      })
    })
    console.log(JSON.stringify({ ok: true, revision: item.revision, content: item.content }))
  } else throw new Error('unknown_library_worker_action')
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
}
