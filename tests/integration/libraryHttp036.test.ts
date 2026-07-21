import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShellDeckServer, type ShellDeckServer } from '../../server/httpServer'
import type { ContentEditLeaseGrant } from '../../src/lib/contentEditLease'
import type { MacroRecord } from '../../src/lib/macro/macroDefinitionTypes'
import type { ServerMessage } from '../../src/lib/protocol'
import { roomControlHeaders, type RoomControlGrant } from '../../src/lib/roomControl'
import { publishPrivateFileDelete, writePrivateFileAtomic } from '../../server/userDataRoot'

test('Library HTTP CRUD is controller/revision/lease guarded and broadcasts canonical kind identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-http-036-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const controller = connectController(server)
    const created = await jsonRequest(server.url + '/api/library/items', {
      method: 'POST', headers: controlJson(controller.grant),
      body: JSON.stringify({ kind: 'prompt', title: ' Signal ', content: 'body', description: 'desc', tags: ['one', 'one'] }),
    })
    expect(created.status).toBe(201)
    const item = created.body.item as { itemId: string; revision: number }
    expect(item).toMatchObject({ revision: 1 })
    expect(controller.messages.some((message) => message.type === 'content_record_changed'
      && message.resourceKey.kind === 'library' && message.resourceKey.itemKind === 'prompt' && message.resourceKey.itemId === item.itemId)).toBe(true)

    const searched = await jsonRequest(server.url + '/api/library/items?kind=prompt&q=SIGNAL')
    expect(searched.body).toMatchObject({ ok: true, items: [{ itemId: item.itemId, title: 'Signal' }] })
    const lease = await acquireLease(server, controller.grant, { kind: 'library', itemKind: 'prompt', itemId: item.itemId })
    const updated = await jsonRequest(server.url + `/api/library/items/prompt/${item.itemId}`, {
      method: 'PUT', headers: controlJson(controller.grant),
      body: JSON.stringify({ title: 'Signal 2', content: 'updated', description: '', tags: [], expectedRevision: 1, editLeaseId: lease.editLeaseId }),
    })
    expect(updated.body).toMatchObject({ ok: true, item: { revision: 2, content: 'updated' } })

    const stale = await jsonRequest(server.url + `/api/library/items/prompt/${item.itemId}`, {
      method: 'PUT', headers: controlJson(controller.grant),
      body: JSON.stringify({ title: 'stale', content: '', description: '', tags: [], expectedRevision: 1, editLeaseId: lease.editLeaseId }),
    })
    expect(stale).toMatchObject({ status: 409, body: { ok: false, error: 'content_revision_conflict' } })

    const deleted = await jsonRequest(server.url + `/api/library/items/prompt/${item.itemId}`, {
      method: 'DELETE', headers: { ...roomControlHeaders(controller.grant), 'If-Match': '2', 'X-Shell-Deck-Content-Edit-Lease': lease.editLeaseId },
    })
    expect(deleted.body).toMatchObject({ ok: true, leaseOutcome: { status: 'released' } })
    expect((await jsonRequest(server.url + `/api/library/items/prompt/${item.itemId}`)).status).toBe(404)
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('published Library update/delete remain authoritative when lease-state maintenance fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-published-036-'))
  let failWrite = false
  let failDelete = false
  let failRecordReplace = true
  let failRecordDelete = false
  const server = startShellDeckServer({
    port: 0,
    dataRoot: root,
    libraryStoreOptions: {
      replaceRecord(path, content) {
        writePrivateFileAtomic(path, content)
        if (failRecordReplace) {
          failRecordReplace = false
          return { published: true, durability: 'uncertain', postPublishError: new Error('injected_record_directory_fsync_failure') }
        }
        return { published: true, durability: 'confirmed' }
      },
      deleteRecord(path) {
        publishPrivateFileDelete(path)
        if (failRecordDelete) {
          failRecordDelete = false
          return { published: true, durability: 'uncertain', postPublishError: new Error('injected_record_directory_fsync_failure') }
        }
        return { published: true, durability: 'confirmed' }
      },
    },
    contentEditLeaseOptions: {
      writeLeaseState(path, content) {
        if (failWrite) throw new Error('injected_lease_state_write_failure')
        writePrivateFileAtomic(path, content)
      },
      deleteLeaseState(path) {
        if (failDelete) throw new Error('injected_lease_state_delete_failure')
        unlinkSync(path)
      },
    },
  })
  try {
    const controller = connectController(server)
    const create = async (title: string) => (await jsonRequest(server.url + '/api/library/items', {
      method: 'POST',
      headers: controlJson(controller.grant),
      body: JSON.stringify({ kind: 'note', title, content: 'v1', description: '', tags: [] }),
    })).body.item as { kind: 'note'; itemId: string; revision: number }

    const first = await create('Published update')
    const firstLease = await acquireLease(server, controller.grant, { kind: 'library', itemKind: 'note', itemId: first.itemId })
    controller.messages.length = 0
    failRecordReplace = true
    failWrite = true
    const updated = await jsonRequest(server.url + `/api/library/items/note/${first.itemId}`, {
      method: 'PUT',
      headers: controlJson(controller.grant),
      body: JSON.stringify({ title: 'Published update', content: 'v2', description: '', tags: [], expectedRevision: 1, editLeaseId: firstLease.editLeaseId }),
    })
    expect(updated).toMatchObject({
      status: 200,
      body: {
        ok: true,
        item: { itemId: first.itemId, revision: 2, content: 'v2' },
        leaseOutcome: { status: 'lost', reason: 'content_edit_lease_state_refresh_failed' },
      },
    })
    expect((await jsonRequest(server.url + `/api/library/items/note/${first.itemId}`)).body).toMatchObject({ item: { revision: 2, content: 'v2' } })
    expect(controller.messages).toContainEqual(expect.objectContaining({
      type: 'content_record_changed',
      resourceKey: { kind: 'library', itemKind: 'note', itemId: first.itemId },
      operation: 'saved',
      revision: 2,
    }))

    failWrite = false
    const second = await create('Published delete')
    const secondLease = await acquireLease(server, controller.grant, { kind: 'library', itemKind: 'note', itemId: second.itemId })
    controller.messages.length = 0
    failRecordDelete = true
    failDelete = true
    const deleted = await jsonRequest(server.url + `/api/library/items/note/${second.itemId}`, {
      method: 'DELETE',
      headers: { ...roomControlHeaders(controller.grant), 'If-Match': '1', 'X-Shell-Deck-Content-Edit-Lease': secondLease.editLeaseId },
    })
    expect(deleted).toMatchObject({
      status: 200,
      body: { ok: true, leaseOutcome: { status: 'lost', reason: 'content_edit_lease_state_refresh_failed' } },
    })
    expect((await jsonRequest(server.url + `/api/library/items/note/${second.itemId}`)).status).toBe(404)
    expect(controller.messages).toContainEqual(expect.objectContaining({
      type: 'content_record_changed',
      resourceKey: { kind: 'library', itemKind: 'note', itemId: second.itemId },
      operation: 'deleted',
      revision: null,
    }))
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('published Library Create and Load remain successful if Room control changes after commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-published-control-036-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const first = connectController(server)
    const second = server.manager.connectClient(first.roomId, () => {})
    const originalLibraryCreate = server.libraryStore.create.bind(server.libraryStore)
    const libraryPublished = deferred<void>()
    const releaseLibraryResponse = deferred<void>()
    server.libraryStore.create = async (...args: Parameters<typeof originalLibraryCreate>) => {
      const item = await originalLibraryCreate(...args)
      libraryPublished.resolve()
      await releaseLibraryResponse.promise
      return item
    }

    const createResponse = jsonRequest(server.url + '/api/library/items', {
      method: 'POST', headers: controlJson(first.grant),
      body: JSON.stringify({ kind: 'note', title: 'Published once', content: 'body', description: '', tags: [] }),
    })
    await libraryPublished.promise
    const secondGrant = await server.manager.takeOverRoomControl(second.clientId, first.grant.controlEpoch, true)
    releaseLibraryResponse.resolve()
    expect(await createResponse).toMatchObject({ status: 201, body: { ok: true, item: { title: 'Published once', revision: 1 } } })
    expect(server.libraryStore.list('note')).toHaveLength(1)
    server.libraryStore.create = originalLibraryCreate

    const source = await createLibraryMacro(server, secondGrant, JSON.stringify({
      schemaVersion: 5, name: 'Published source', description: '', terminalLayout: [], body: [],
    }))
    const sourceItem = source.body.item as { itemId: string; revision: number }
    const third = server.manager.connectClient(first.roomId, () => {})
    const originalMacroCreate = server.macroStore.create.bind(server.macroStore)
    const macroPublished = deferred<void>()
    const releaseMacroResponse = deferred<void>()
    server.macroStore.create = async (...args: Parameters<typeof originalMacroCreate>) => {
      const record = await originalMacroCreate(...args)
      macroPublished.resolve()
      await releaseMacroResponse.promise
      return record
    }

    const loadResponse = loadMacro(server, secondGrant, sourceItem)
    await macroPublished.promise
    await server.manager.takeOverRoomControl(third.clientId, secondGrant.controlEpoch, true)
    releaseMacroResponse.resolve()
    expect(await loadResponse).toMatchObject({ status: 201, body: { ok: true, template: { revision: 1 } } })
    expect(server.macroStore.list()).toHaveLength(1)
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Macro Library uses the single text gateway and Load creates fresh independent MacroRecords without Prepare', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-load-036-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const controller = connectController(server)
    const legacy = await server.libraryStore.create('macro-template', {
      title: 'Legacy hidden Macro',
      content: JSON.stringify({ schemaVersion: 4, name: 'Legacy hidden Macro', description: '', terminalLayout: [], body: [] }),
      description: '',
      tags: [],
    })
    const isolated = await jsonRequest(server.url + '/api/library/items?kind=macro-template')
    expect(isolated.body).toMatchObject({
      ok: true,
      items: [],
      invalidItems: [{ itemId: legacy.itemId, error: 'invalid_library_macro_definition' }],
    })
    expect(await jsonRequest(server.url + `/api/library/items/macro-template/${legacy.itemId}`)).toMatchObject({
      status: 400,
      body: { ok: false, error: 'invalid_library_macro_definition' },
    })
    expect(await loadMacro(server, controller.grant, legacy)).toMatchObject({
      status: 400,
      body: { ok: false, error: 'invalid_macro_definition' },
    })

    const invalidJson = await createLibraryMacro(server, controller.grant, '{')
    expect(invalidJson).toMatchObject({ status: 400, body: { ok: false, error: 'invalid_json', offset: 1, line: 1, column: 2 } })
    const invalidDefinition = await createLibraryMacro(server, controller.grant, JSON.stringify({ schemaVersion: 2, body: [] }))
    expect(invalidDefinition).toMatchObject({ status: 400, body: { ok: false, error: 'invalid_macro_definition' } })

    const definition = {
      schemaVersion: 5,
      name: 'Portable incomplete draft',
      description: '',
      terminalLayout: [],
      body: [{ id: 'send', type: 'send', terminal: { kind: 'unassigned' }, message: { parts: [{ kind: 'artifact', source: { kind: 'unassigned' } }] }, delivery: 'auto', ending: 'cr' }],
    }
    const source = await createLibraryMacro(server, controller.grant, JSON.stringify(definition, null, 2))
    const item = source.body.item as { itemId: string; revision: number }
    const beforeStructure = server.manager.terminalStructureRevision(controller.roomId)
    const first = await loadMacro(server, controller.grant, item)
    const second = await loadMacro(server, controller.grant, item)
    const firstRecord = first.body.template as MacroRecord
    const secondRecord = second.body.template as MacroRecord
    expect(firstRecord).toMatchObject({ revision: 1, definition })
    expect(secondRecord).toMatchObject({ revision: 1, definition })
    expect(secondRecord.id).not.toBe(firstRecord.id)
    expect(server.libraryStore.read('macro-template', item.itemId).revision).toBe(1)
    expect(server.manager.terminalStructureRevision(controller.roomId)).toBe(beforeStructure)
    const visible = await jsonRequest(server.url + '/api/library/items?kind=macro-template')
    expect(visible.body).toMatchObject({
      items: [{ itemId: item.itemId }],
      invalidItems: [{ itemId: legacy.itemId, error: 'invalid_library_macro_definition' }],
    })

    const unknown = await jsonRequest(server.url + '/api/templates/from-library', {
      method: 'POST', headers: controlJson(controller.grant), body: JSON.stringify({ itemId: item.itemId, expectedRevision: item.revision, roomId: controller.roomId }),
    })
    expect(unknown).toMatchObject({ status: 400, body: { error: 'request_unknown_field:roomId' } })
    for (const path of ['/api/library/global/items', '/api/library/items/duplicate', '/api/library/items/import']) {
      expect((await jsonRequest(server.url + path)).status).toBe(404)
    }
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Library and from-Library Create recheck Room control at the canonical commit boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-library-create-control-036-'))
  const server = startShellDeckServer({ port: 0, dataRoot: root })
  try {
    const first = connectController(server)
    const second = server.manager.connectClient(first.roomId, () => {})
    const libraryEntered = deferred<void>()
    const releaseLibrary = deferred<void>()
    const originalLibraryRun = server.libraryStore.transactions.run.bind(server.libraryStore.transactions)
    server.libraryStore.transactions.run = async function<T>(path: string, operation: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
      libraryEntered.resolve()
      await releaseLibrary.promise
      return await originalLibraryRun(path, operation, signal)
    }

    const staleLibraryCreate = jsonRequest(server.url + '/api/library/items', {
      method: 'POST', headers: controlJson(first.grant),
      body: JSON.stringify({ kind: 'note', title: 'Orphan', content: 'must not exist', description: '', tags: [] }),
    })
    await libraryEntered.promise
    const secondGrant = await server.manager.takeOverRoomControl(second.clientId, first.grant.controlEpoch, true)
    releaseLibrary.resolve()
    expect(await staleLibraryCreate).toMatchObject({ status: 409, body: { ok: false, error: 'room_control_lost' } })
    expect(server.libraryStore.list('note')).toEqual([])

    server.libraryStore.transactions.run = originalLibraryRun
    const source = await createLibraryMacro(server, secondGrant, JSON.stringify({ schemaVersion: 5, name: 'Source', description: '', terminalLayout: [], body: [] }))
    expect(source.status).toBe(201)
    const item = source.body.item as { itemId: string; revision: number }
    const third = server.manager.connectClient(first.roomId, () => {})
    const macroEntered = deferred<void>()
    const releaseMacro = deferred<void>()
    const originalMacroRun = server.macroStore.transactions.run.bind(server.macroStore.transactions)
    server.macroStore.transactions.run = async function<T>(path: string, operation: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
      macroEntered.resolve()
      await releaseMacro.promise
      return await originalMacroRun(path, operation, signal)
    }

    const staleLoad = loadMacro(server, secondGrant, item)
    await macroEntered.promise
    await server.manager.takeOverRoomControl(third.clientId, secondGrant.controlEpoch, true)
    releaseMacro.resolve()
    expect(await staleLoad).toMatchObject({ status: 409, body: { ok: false, error: 'room_control_lost' } })
    expect(server.macroStore.list()).toEqual([])
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

function connectController(server: ShellDeckServer) {
  const room = server.manager.createRoom()
  const messages: ServerMessage[] = []
  const client = server.manager.connectClient(room.roomId, (message) => messages.push(message))
  const control = messages.find((message): message is Extract<ServerMessage, { type: 'room_control' }> => message.type === 'room_control')
  if (!control?.grant) throw new Error('missing_control_grant')
  return { roomId: room.roomId, clientId: client.clientId, grant: control.grant, messages }
}

async function acquireLease(server: ShellDeckServer, grant: RoomControlGrant, resourceKey: unknown): Promise<ContentEditLeaseGrant> {
  const response = await jsonRequest(server.url + '/api/content-edit-leases/acquire', {
    method: 'POST', headers: controlJson(grant), body: JSON.stringify({ resourceKey, expectedLeaseEpoch: 0 }),
  })
  expect(response.status).toBe(200)
  return response.body.grant as ContentEditLeaseGrant
}

function createLibraryMacro(server: ShellDeckServer, grant: RoomControlGrant, content: string) {
  return jsonRequest(server.url + '/api/library/items', {
    method: 'POST', headers: controlJson(grant),
    body: JSON.stringify({ kind: 'macro-template', title: 'Template', content, description: '', tags: [] }),
  })
}

function loadMacro(server: ShellDeckServer, grant: RoomControlGrant, item: { itemId: string; revision: number }) {
  return jsonRequest(server.url + '/api/templates/from-library', {
    method: 'POST', headers: controlJson(grant), body: JSON.stringify({ itemId: item.itemId, expectedRevision: item.revision }),
  })
}

function controlJson(grant: RoomControlGrant): Record<string, string> {
  return { ...roomControlHeaders(grant), 'content-type': 'application/json' }
}

async function jsonRequest(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, init)
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
