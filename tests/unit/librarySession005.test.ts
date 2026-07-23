import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ContentEditLeaseGrant } from '../../src/lib/contentEditLease'
import { LibraryInvalidationQueue, type SequencedContentRecordChange } from '../../src/lib/library/libraryInvalidationQueue'
import { LibraryListCoordinator } from '../../src/lib/library/libraryListCoordinator'
import type { LibraryMutationWorkflow } from '../../src/lib/library/libraryMutationWorkflow'
import { LibraryNavigationCoordinator, type CurrentLibraryOperationState, type LibraryOperationIdentity } from '../../src/lib/library/libraryNavigationCoordinator'
import type { LibraryItem, LibraryItemFields, LibraryItemListResult } from '../../src/lib/library/libraryTypes'

describe('Library session coordinators', () => {
  test('navigation shares one generation and checks draft, selection, controller, and released lease identity', () => {
    const pending: boolean[] = []
    const coordinator = new LibraryNavigationCoordinator((value) => pending.push(value))
    const draft = fields('draft')
    const lease = editLease('lease-a')
    const identity: LibraryOperationIdentity = {
      kind: 'prompt',
      selectedKey: 'prompt:item-a',
      selectedRevision: 2,
      draft,
      draftRevision: 7,
      editLeaseId: lease.editLeaseId,
    }
    const operation = coordinator.begin(identity, 12)
    const current = operationState(draft, lease)

    expect(pending).toEqual([true])
    expect(coordinator.canCommit(operation, current)).toBe(true)
    expect(coordinator.canCommit(operation, { ...current, controlEpoch: 13 })).toBe(false)
    expect(coordinator.canCommit(operation, { ...current, draft: fields('newer') })).toBe(false)
    expect(coordinator.canCommit(operation, { ...current, editLease: null })).toBe(false)
    expect(coordinator.canCommit(operation, { ...current, editLease: null }, true)).toBe(true)

    const newer = coordinator.begin(identity, 12)
    expect(coordinator.isTokenCurrent(operation, 12)).toBe(false)
    expect(coordinator.end(operation)).toBe(false)
    expect(coordinator.end(newer)).toBe(true)
    expect(pending).toEqual([true, true, false])
  })

  test('invalidation retains unconsumed events and classifies ack, higher revision, delete, and retry', () => {
    const queue = new LibraryInvalidationQueue()
    const item = libraryItem(2)
    const changes = [
      change(1, 'saved', 2),
      change(2, 'saved', 3),
    ]

    expect(queue.observe(changes)).toBe(true)
    expect(queue.observe(changes)).toBe(false)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([1, 2])
    expect(queue.classify([changes[0]], item)).toEqual({ kind: 'own_ack', revision: 2 })
    expect(queue.classify([changes[1]], item)).toEqual({ kind: 'higher_revision', revision: 3 })
    expect(queue.classify([change(3, 'deleted', null)], item)).toEqual({ kind: 'deleted' })
    expect(queue.classify([change(4, 'saved', 8, 'note', 'other')], item)).toEqual({ kind: 'unrelated' })

    expect([queue.nextRetryDelay(), queue.nextRetryDelay(), queue.nextRetryDelay(), queue.nextRetryDelay()])
      .toEqual([100, 300, 800, null])
    expect(queue.batch()).toHaveLength(2)
    queue.consumeThrough(1)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([2])
    queue.resetRetry()
    expect(queue.nextRetryDelay()).toBe(100)
  })

  test('list coordinator rejects an older generation without caching list state', async () => {
    const first = deferred<LibraryItemListResult>()
    const second = deferred<LibraryItemListResult>()
    const requests = [first, second]
    let query = 'first'
    const outcomes: string[] = []
    const coordinator = new LibraryListCoordinator({
      mutations: {
        list: async () => await requests.shift()!.promise,
      } as unknown as LibraryMutationWorkflow,
      kind: () => 'prompt',
      searchText: () => query,
      commitSearch: (value) => { query = value },
      commitList: (outcome) => {
        outcomes.push(outcome.kind)
        return outcome.kind === 'applied'
          ? { outcome: 'applied', records: outcome.result.items }
          : { outcome: outcome.kind }
      },
    })

    const older = coordinator.reload(false)
    query = 'second'
    const newer = coordinator.reload(false)
    second.resolve(listResult('second'))
    expect(await newer).toEqual({ outcome: 'applied', records: [] })
    first.resolve(listResult('first'))
    expect(await older).toEqual({ outcome: 'stale' })
    expect(outcomes).toEqual(['applied', 'stale'])
    coordinator.dispose()
  })

  test('factory remains the sole rune owner and production assembly point', () => {
    const sourceRoot = resolve(import.meta.dir, '../../src')
    const libraryRoot = resolve(sourceRoot, 'lib/library')
    const names = [
      'librarySession.svelte.ts',
      'libraryMutationWorkflow.ts',
      'libraryRemoteSyncCoordinator.ts',
      'libraryNavigationCoordinator.ts',
      'libraryListCoordinator.ts',
      'libraryEditOrchestrator.ts',
    ] as const
    const sources = Object.fromEntries(names.map((name) => [
      name,
      readFileSync(resolve(libraryRoot, name), 'utf8'),
    ])) as Record<(typeof names)[number], string>
    const files = readdirSync(libraryRoot).filter((file) => file.endsWith('.ts'))
    const sessionSource = sources['librarySession.svelte.ts']
    const listSource = sources['libraryListCoordinator.ts']
    const editSource = sources['libraryEditOrchestrator.ts']

    expect(consumers(libraryRoot, files, 'libraryListCoordinator')).toEqual([
      'libraryEditOrchestrator.ts',
      'librarySession.svelte.ts',
    ])
    expect(consumers(libraryRoot, files, 'libraryEditOrchestrator')).toEqual([
      'librarySession.svelte.ts',
    ])
    expect(consumers(libraryRoot, files, 'libraryMutationWorkflow')).toEqual([
      'libraryEditOrchestrator.ts',
      'libraryListCoordinator.ts',
      'librarySession.svelte.ts',
    ])
    expect(consumers(libraryRoot, files, 'libraryNavigationCoordinator')).toEqual([
      'libraryEditOrchestrator.ts',
      'librarySession.svelte.ts',
    ])
    expect(consumers(libraryRoot, files, 'libraryRemoteSyncCoordinator')).toEqual([
      'libraryListCoordinator.ts',
      'librarySession.svelte.ts',
    ])
    expect(sessionSource).toContain('new LibraryNavigationCoordinator')
    expect(sessionSource).toContain('new LibraryMutationWorkflow')
    expect(sessionSource).toContain('new LibraryRemoteSyncCoordinator')
    expect(sessionSource).toContain('new LibraryListCoordinator')
    expect(sessionSource).toContain('new LibraryEditOrchestrator')
    expect(sessionSource).toContain('export function createLibrarySession')
    expect(runeNames(sessionSource)).toEqual([
      'kind',
      'searchText',
      'items',
      'selectedItem',
      'draft',
      'editing',
      'editLease',
      'leaseView',
      'leaseLost',
      'publishedCreateBufferPreserved',
      'dirty',
      'draftRevision',
      'operationPending',
      'statusText',
      'errorText',
      'listProblem',
      'remoteNotice',
    ])
    expect(sessionSource.match(/\$effect\(/g)).toHaveLength(4)
    for (const coordinator of Object.values(sources).slice(1)) {
      expect(coordinator).not.toMatch(/\$(?:state|derived|effect)\b/)
    }
    expect(listSource).not.toMatch(/#(?:items|selectedItem|draft|editLease|leaseView)\s*=/)
    expect(editSource).not.toMatch(/#(?:items|selectedItem|draft|editLease|leaseView)\s*=/)
    expect(sessionSource).not.toContain('new LibraryClient')
    expect(sessionSource).not.toContain('new LibraryInvalidationQueue')
    expect(sessionSource).not.toContain('async function handleRemoteContent')
    expect(sessionSource).not.toContain('async function changeKind')
    expect(sessionSource).not.toContain('async function saveItem')
    expect(Object.values(sources).join('\n')).not.toContain('GenericContentSession')
    expect(listSource + editSource).not.toContain('macroRecordSession')

    for (const source of [...Object.values(sources), readFileSync(import.meta.path, 'utf8')]) {
      expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(400)
    }
  })

  test('freezes list generation, edit outcomes, and the public return surface', () => {
    const libraryRoot = resolve(import.meta.dir, '../../src/lib/library')
    const session = readFileSync(resolve(libraryRoot, 'librarySession.svelte.ts'), 'utf8')
    const list = readFileSync(resolve(libraryRoot, 'libraryListCoordinator.ts'), 'utf8')
    const edit = readFileSync(resolve(libraryRoot, 'libraryEditOrchestrator.ts'), 'utf8')
    const returned = session.slice(session.lastIndexOf('  return {'))

    expectOrdered(methodSource(list, '  updateSearch(', '  cancelScheduledSearch('), [
      'this.#options.commitSearch(value)',
      'this.cancelScheduledSearch()',
      'setTimeout(',
      'void this.reload(false)',
      '}, 180)',
    ])
    expectOrdered(methodSource(list, '  async reload(', '\n  }\n}'), [
      'const generation = ++this.#generation',
      'const requestKind = this.#options.kind()',
      'const requestQuery = this.#options.searchText()',
      'this.#options.mutations.list(requestKind, requestQuery)',
      'generation === this.#generation',
      'requestKind === this.#options.kind()',
      'requestQuery === this.#options.searchText()',
      'this.#options.commitList(',
    ])
    expectOrdered(methodSource(edit, '  async saveItem(', '  async cancelEdit('), [
      'this.#requireNoPendingOperation()',
      'this.#requireSharedMutation()',
      'cloneLibraryFields(draft)',
      'parseAndValidateMacroDefinitionJson(fields.content)',
      'const operation = options.beginOperation()',
      'options.mutations.persist(',
      '() => options.canCommitLibraryOperation(operation)',
      'options.commitPersistOutcome(committed, operation)',
      'options.list.reload(false, false)',
      'options.completeSave(operation)',
      'options.endOperation(operation)',
    ])
    for (const outcome of [
      "'change_kind'",
      "'select_item'",
      "'new_item'",
      "'begin_edit'",
      "'discard_preserved'",
      "'discard_preserved_missing'",
      "'cancel_edit'",
      "'remove_item'",
      "'load_into_macro'",
    ]) {
      expect(edit).toContain(outcome)
    }
    for (const member of [
      'kind', 'searchText', 'items', 'selectedItem', 'selectedKey', 'draft', 'editing',
      'editLease', 'leaseView', 'leaseLost', 'publishedCreateBufferPreserved', 'dirty',
      'operationPending', 'statusText', 'errorText', 'listProblem', 'remoteNotice',
      'mount', 'changeKind', 'updateSearch', 'selectByKey', 'newItem', 'beginEdit',
      'saveItem', 'cancelEdit', 'removeItem', 'refreshLibrary', 'loadIntoMacro',
      'updateDraft', 'setTags', 'deny', 'setErrorText',
    ]) {
      expect(returned).toContain(member)
    }
  })
})

function consumers(root: string, files: string[], moduleName: string): string[] {
  const pattern = new RegExp(`from ['"]\\./${moduleName}['"]`)
  return files.filter((file) => pattern.test(readFileSync(resolve(root, file), 'utf8'))).sort()
}

function runeNames(source: string): string[] {
  return source.split('\n').flatMap((line) => {
    const match = line.match(/^\s*let (\w+) = \$state(?:<.*>)?\(/)
    return match ? [match[1]] : []
  })
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

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolveValue) => { resolvePromise = resolveValue })
  return { promise, resolve: resolvePromise }
}

function listResult(query: string): LibraryItemListResult {
  void query
  return { items: [], invalidItems: [] }
}

function fields(content: string): LibraryItemFields {
  return { title: 'Title', content, description: '', tags: [] }
}

function editLease(editLeaseId: string): ContentEditLeaseGrant {
  return {
    resourceKey: { kind: 'library', itemKind: 'prompt', itemId: 'item-a' },
    editLeaseId,
    leaseEpoch: 4,
    baseRevision: 2,
    expiresAt: '2026-07-21T00:00:00.000Z',
  }
}

function operationState(draft: LibraryItemFields, editLeaseValue: ContentEditLeaseGrant | null): CurrentLibraryOperationState {
  return {
    kind: 'prompt',
    selectedKey: 'prompt:item-a',
    selectedItem: libraryItem(2),
    draft,
    draftRevision: 7,
    editLease: editLeaseValue,
    controlEpoch: 12,
  }
}

function libraryItem(revision: number): LibraryItem {
  return {
    schemaVersion: 1,
    itemId: 'item-a',
    kind: 'prompt',
    revision,
    ...fields('saved'),
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  }
}

function change(
  sequence: number,
  operation: 'saved' | 'deleted',
  revision: number | null,
  itemKind: 'macro-template' | 'prompt' | 'note' = 'prompt',
  itemId = 'item-a',
): SequencedContentRecordChange {
  return {
    type: 'content_record_changed',
    resourceKey: { kind: 'library', itemKind, itemId },
    operation,
    revision,
    sequence,
  }
}
