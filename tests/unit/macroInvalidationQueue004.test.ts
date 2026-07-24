import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { MacroInvalidationQueue, type SequencedContentRecordChange } from '../../src/lib/macro/macroInvalidationQueue'

describe('MacroInvalidationQueue', () => {
  test('watermarks and consumes queued Macro changes', () => {
    const queue = new MacroInvalidationQueue()
    const changes = [
      change(1, 'macro-a', 'saved', 1),
      change(2, 'macro-b', 'saved', 1),
    ]

    expect(queue.observe(changes)).toBe(true)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([1, 2])
    expect(queue.observe(changes)).toBe(false)

    expect(queue.observe([...changes, change(3, 'macro-a', 'saved', 2)])).toBe(true)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([1, 2, 3])
    queue.consumeThrough(2)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([3])
  })

  test('classifies own acknowledgement, higher revision, delete, and unrelated records', () => {
    const queue = new MacroInvalidationQueue()

    expect(queue.classify([change(1, 'other', 'saved', 8)], 'macro-a', 2))
      .toEqual({ kind: 'unrelated' })
    expect(queue.classify([change(1, 'macro-a', 'saved', 2)], 'macro-a', 2))
      .toEqual({ kind: 'own_ack', revision: 2 })
    expect(queue.classify([change(1, 'macro-a', 'saved', 3)], 'macro-a', 2))
      .toEqual({ kind: 'higher_revision', revision: 3 })
    expect(queue.classify([change(1, 'macro-a', 'deleted', null)], 'macro-a', 2))
      .toEqual({ kind: 'deleted' })
  })

  test('provides the existing bounded retry sequence and resets it', () => {
    const queue = new MacroInvalidationQueue()

    expect([
      queue.nextRetryDelay(),
      queue.nextRetryDelay(),
      queue.nextRetryDelay(),
      queue.nextRetryDelay(),
    ]).toEqual([100, 300, 800, null])
    queue.resetRetry()
    expect(queue.nextRetryDelay()).toBe(100)
  })
})

describe('Macro record session extraction', () => {
  test('keeps the factory as the sole rune owner and sole production assembly point', () => {
    const macroRoot = resolve(import.meta.dir, '../../src/lib/macro')
    const names = [
      'macroRecordSession.svelte.ts',
      'macroRecordMutationWorkflow.ts',
      'macroRecordRemoteSyncCoordinator.ts',
      'macroRecordNavigationCoordinator.ts',
      'macroRecordEditOrchestrator.ts',
    ] as const
    const sources = Object.fromEntries(names.map((name) => [
      name,
      readFileSync(resolve(macroRoot, name), 'utf8'),
    ])) as Record<(typeof names)[number], string>
    const files = readdirSync(macroRoot).filter((file) => file.endsWith('.ts'))
    const sessionSource = sources['macroRecordSession.svelte.ts']
    const mutationSource = sources['macroRecordMutationWorkflow.ts']
    const remoteSyncSource = sources['macroRecordRemoteSyncCoordinator.ts']
    const navigationSource = sources['macroRecordNavigationCoordinator.ts']
    const editSource = sources['macroRecordEditOrchestrator.ts']

    expect(consumers(macroRoot, files, 'macroRecordNavigationCoordinator')).toEqual([
      'macroRecordEditOrchestrator.ts',
      'macroRecordSession.svelte.ts',
    ])
    expect(consumers(macroRoot, files, 'macroRecordEditOrchestrator')).toEqual([
      'macroRecordSession.svelte.ts',
    ])
    expect(consumers(macroRoot, files, 'macroRecordMutationWorkflow')).toEqual([
      'macroRecordEditOrchestrator.ts',
      'macroRecordNavigationCoordinator.ts',
      'macroRecordSession.svelte.ts',
    ])
    expect(consumers(macroRoot, files, 'macroRecordRemoteSyncCoordinator')).toEqual([
      'macroRecordEditOrchestrator.ts',
      'macroRecordNavigationCoordinator.ts',
      'macroRecordSession.svelte.ts',
    ])
    expect(sessionSource).toContain('new MacroRecordMutationWorkflow')
    expect(sessionSource).toContain('new MacroRecordRemoteSyncCoordinator')
    expect(sessionSource).toContain('new MacroRecordNavigationCoordinator')
    expect(sessionSource).toContain('new MacroRecordEditOrchestrator')
    expect(sessionSource).toContain('export function createMacroRecordSession')
    expect(runeNames(sessionSource)).toEqual([
      'templates',
      'selectedRecord',
      'baseDefinition',
      'draft',
      'draftRevision',
      'editorGeneration',
      'contentEditing',
      'leaseLost',
      'publishedCreateBufferPreserved',
      'editLease',
      'leaseView',
      'dirty',
      'operationGeneration',
      'operationPending',
      'errorText',
      'templateListProblem',
    ])
    expect(sessionSource.match(/\$effect\(/g)).toHaveLength(4)
    for (const coordinator of [mutationSource, remoteSyncSource, navigationSource, editSource]) {
      expect(coordinator).not.toMatch(/\$(?:state|derived|effect)\b/)
    }
    expect(navigationSource).not.toMatch(/#(?:selectedRecord|draft|editLease|leaseView)\s*=/)
    expect(editSource).not.toMatch(/#(?:selectedRecord|draft|editLease|leaseView)\s*=/)
    expect(navigationSource).not.toContain('prepare')
    expect(navigationSource).not.toContain('startRunner')
    expect(navigationSource).not.toContain('featureFlag')
    expect(editSource).not.toContain('GenericContentSession')
    expect(sessionSource).not.toContain('contentChangeProcessing = Promise.resolve()')
    expect(sessionSource).not.toContain('async function handleMacroRecordChanges')
    expect(sessionSource).not.toContain('await recordClient.update')

    for (const source of [...Object.values(sources), readFileSync(import.meta.path, 'utf8')]) {
      expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(400)
    }
  })

  test('freezes operation identity, outcome boundaries and public return surface', () => {
    const macroRoot = resolve(import.meta.dir, '../../src/lib/macro')
    const session = readFileSync(resolve(macroRoot, 'macroRecordSession.svelte.ts'), 'utf8')
    const navigation = readFileSync(resolve(macroRoot, 'macroRecordNavigationCoordinator.ts'), 'utf8')
    const edit = readFileSync(resolve(macroRoot, 'macroRecordEditOrchestrator.ts'), 'utf8')
    const returned = session.slice(session.lastIndexOf('  return {'))

    expectOrdered(typeSource(navigation, 'export type MacroOperationToken = {'), [
      'generation: number',
      'controlEpoch: number | null',
      'recordId: string | null',
      'recordRevision: number | null',
      'draftRevision: number',
      'jsonRevision: number',
      'editLeaseId: string | null',
    ])
    expectOrdered(methodSource(navigation, '  async selectTemplate(', '  async createTemplate('), [
      'options.operationPending() || options.jsonEditing()',
      "confirm('Discard unsaved macro changes?')",
      'const token = options.beginOperation()',
      'options.mutations.releaseEditLease(options.takeEditLease())',
      "kind: 'select_record'",
      "kind: 'clear_selection'",
      'options.commitNavigation(outcome, token)',
      'options.canCommit(token)',
      'options.endOperation(token)',
    ])
    expectOrdered(methodSource(edit, '  async #persist(', '  #context('), [
      'this.#options.mutations.persistDefinition(',
      '() => this.#options.definitionIsCurrent(context)',
      'committed = this.#options.acceptPersistOutcome(value, context)',
      "outcome.kind === 'discarded' ? null : committed",
    ])
    expectOrdered(methodSource(session, '  function reconcilePublishedCreate(', '  function installRecord('), [
      'operationGeneration === context.token.generation',
      'selectedRecord === null',
      "context.source === 'json'",
      'record.revision !== 1',
      'installRecord(record, false, true)',
      'draft = cloneJsonValue(context.definition)',
      'baseDefinition = cloneJsonValue(record.definition)',
      "errorText = 'macro_saved_but_edit_lease_not_retained:operation_context_changed'",
    ])
    for (const member of [
      'templates',
      'selectedRecord',
      'draft',
      'draftRevision',
      'editorGeneration',
      'contentEditing',
      'leaseLost',
      'publishedCreateBufferPreserved',
      'editLease',
      'dirty',
      'operationPending',
      'errorText',
      'templateListProblem',
      'mount',
      'selectTemplate',
      'createTemplate',
      'beginEdit',
      'cancelEdit',
      'saveTemplate',
      'deleteTemplate',
      'updateDraft',
      'startJsonBuffer',
      'saveJson',
      'captureStartRecordSnapshot',
      'resolveStartRecord',
      'beginOperation',
      'endOperation',
      'canCommit',
      'rejectMutation',
      'reportMutationError',
      'setErrorText',
    ]) {
      expect(returned).toContain(member)
    }
  })

})

function change(
  sequence: number,
  itemId: string,
  operation: 'saved' | 'deleted',
  revision: number | null,
): SequencedContentRecordChange {
  return {
    type: 'content_record_changed',
    resourceKey: { kind: 'macro', itemId },
    operation,
    revision,
    sequence,
  }
}

function consumers(root: string, files: string[], moduleName: string): string[] {
  const pattern = new RegExp(`from ['"]\\./${moduleName}['"]`)
  return files
    .filter((file) => pattern.test(readFileSync(resolve(root, file), 'utf8')))
    .sort()
}

function runeNames(source: string): string[] {
  return source
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^\s*let (\w+) = \$state(?:<.*>)?\(/)
      return match ? [match[1]] : []
    })
}

function typeSource(source: string, start: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf('\n}', startIndex)
  expect(startIndex, `missing type start: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `missing type end: ${start}`).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
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
