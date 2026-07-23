import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { MacroInvalidationQueue, type SequencedContentRecordChange } from '../../src/lib/macro/macroInvalidationQueue'

describe('MacroInvalidationQueue', () => {
  test('watermarks mixed content events and consumes only queued Macro changes', () => {
    const queue = new MacroInvalidationQueue()
    const changes = [
      change(1, 'library', 'library-a', 'saved', 1),
      change(2, 'macro', 'macro-a', 'saved', 1),
    ]

    expect(queue.observe(changes)).toBe(true)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([2])
    expect(queue.observe(changes)).toBe(false)

    expect(queue.observe([...changes, change(3, 'macro', 'macro-a', 'saved', 2)])).toBe(true)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([2, 3])
    queue.consumeThrough(2)
    expect(queue.batch().map(({ sequence }) => sequence)).toEqual([3])
  })

  test('classifies own acknowledgement, higher revision, delete, and unrelated records', () => {
    const queue = new MacroInvalidationQueue()

    expect(queue.classify([change(1, 'macro', 'other', 'saved', 8)], 'macro-a', 2))
      .toEqual({ kind: 'unrelated' })
    expect(queue.classify([change(1, 'macro', 'macro-a', 'saved', 2)], 'macro-a', 2))
      .toEqual({ kind: 'own_ack', revision: 2 })
    expect(queue.classify([change(1, 'macro', 'macro-a', 'saved', 3)], 'macro-a', 2))
      .toEqual({ kind: 'higher_revision', revision: 3 })
    expect(queue.classify([change(1, 'macro', 'macro-a', 'deleted', null)], 'macro-a', 2))
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
    const sessionSource = readFileSync(resolve(macroRoot, 'macroRecordSession.svelte.ts'), 'utf8')
    const mutationSource = readFileSync(resolve(macroRoot, 'macroRecordMutationWorkflow.ts'), 'utf8')
    const remoteSyncSource = readFileSync(resolve(macroRoot, 'macroRecordRemoteSyncCoordinator.ts'), 'utf8')
    const directConsumers = readdirSync(macroRoot)
      .filter((file) => file.endsWith('.ts') && file !== 'macroRecordSession.svelte.ts')
      .filter((file) => /from ['"]\.\/macroRecord(?:MutationWorkflow|RemoteSyncCoordinator)['"]/.test(
        readFileSync(resolve(macroRoot, file), 'utf8'),
      ))

    expect(directConsumers).toEqual([])
    expect(sessionSource).toContain('new MacroRecordMutationWorkflow')
    expect(sessionSource).toContain('new MacroRecordRemoteSyncCoordinator')
    expect(sessionSource).toContain('export function createMacroRecordSession')
    expect(sessionSource).toContain('$state')
    expect(mutationSource).not.toContain('$state')
    expect(mutationSource).not.toContain('$effect')
    expect(remoteSyncSource).not.toContain('$state')
    expect(remoteSyncSource).not.toContain('$effect')
    expect(sessionSource).not.toContain('contentChangeProcessing = Promise.resolve()')
    expect(sessionSource).not.toContain('async function handleMacroRecordChanges')
    expect(sessionSource).not.toContain('await recordClient.update')
  })
})

function change(
  sequence: number,
  kind: 'macro' | 'library',
  itemId: string,
  operation: 'saved' | 'deleted',
  revision: number | null,
): SequencedContentRecordChange {
  return {
    type: 'content_record_changed',
    resourceKey: kind === 'macro'
      ? { kind, itemId }
      : { kind, itemKind: 'note', itemId },
    operation,
    revision,
    sequence,
  }
}
