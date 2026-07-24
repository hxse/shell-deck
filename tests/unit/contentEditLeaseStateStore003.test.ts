import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ContentResourceKey } from '../../src/lib/contentEditLease'
import { createGeneratedId } from '../../src/lib/generatedId'
import {
  assertLeaseState,
  availableState,
  ContentEditLeaseStateStore,
  type HeldLeaseState,
} from '../../server/contentEditLeaseStateStore'
import { ContentEditLeaseService } from '../../server/contentEditLeaseService'
import { ContentResourceTransactions } from '../../server/sharedContentStore'
import { canonicalResourceRelativePath, writePrivateFileAtomic } from '../../server/userDataRoot'

describe('content edit lease state storage extraction', () => {
  test('path, missing state, exact codec, expiry and record revision remain unchanged', () => {
    const root = mkdtempSync(join(tmpdir(), 'shell-deck-lease-state-003-'))
    const now = Date.parse('2026-07-23T00:00:30.000Z')
    try {
      const transactions = new ContentResourceTransactions(root)
      const key: ContentResourceKey = { kind: 'macro', itemId: createGeneratedId('macroTemplate') }
      const otherKey: ContentResourceKey = { kind: 'macro', itemId: createGeneratedId('macroTemplate') }
      const recordPath = join(transactions.paths.macros, key.itemId + '.json')
      const store = new ContentEditLeaseStateStore(transactions.paths.root, transactions.paths.locks, { now: () => now })
      const relative = canonicalResourceRelativePath(transactions.paths.root, recordPath)
      const digest = createHash('sha256').update(relative).digest('hex')
      expect(store.statePath(recordPath)).toBe(join(transactions.paths.locks, 'content-edit', digest + '.json'))

      expect(store.currentState(recordPath, key, now)).toEqual(availableState(key, 0, now))

      const held = heldState(key, now - 60_000)
      store.writeState(recordPath, held)
      expect(readFileSync(store.statePath(recordPath), 'utf8').endsWith('\n')).toBe(true)
      const expiryOrder: string[] = []
      const expired = store.currentState(recordPath, key, now, (editLeaseId) => {
        expect(editLeaseId).toBe(held.editLeaseId)
        expiryOrder.push('owned-cleared')
      })
      expiryOrder.push('returned')
      expect(expiryOrder).toEqual(['owned-cleared', 'returned'])
      expect(expired).toEqual(availableState(key, held.leaseEpoch, now))
      expect(store.readState(recordPath, key)).toEqual(expired)
      expect(() => store.readState(recordPath, otherKey)).toThrow('content_edit_lease_resource_mismatch')

      writePrivateFileAtomic(store.statePath(recordPath), JSON.stringify({ ...expired, extra: true }) + '\n')
      expect(() => store.readState(recordPath, key)).toThrow('invalid_content_edit_lease_state')

      writePrivateFileAtomic(recordPath, JSON.stringify({ revision: 7 }) + '\n')
      expect(store.readRecordRevision(recordPath)).toBe(7)
      writePrivateFileAtomic(recordPath, '{invalid')
      expect(() => store.readRecordRevision(recordPath)).toThrow('invalid_content_record')
      store.deleteState(recordPath)
      store.deleteState(recordPath)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('exact state validator retains available and held schemas', () => {
    const key: ContentResourceKey = { kind: 'macro', itemId: createGeneratedId('macroTemplate') }
    const now = Date.parse('2026-07-23T00:00:30.000Z')
    const available = availableState(key, 4, now)
    const held = heldState(key, now)
    expect(assertLeaseState(available, key)).toEqual(available)
    expect(assertLeaseState(held, key)).toEqual(held)
    expect(() => assertLeaseState({ ...held, leaseEpoch: -1 }, key)).toThrow('invalid_lease_epoch')
    expect(() => assertLeaseState({ ...held, expiresAt: 'not-iso' }, key)).toThrow('invalid_content_edit_lease_state')
  })

  test('service remains the only production consumer and transaction owner', () => {
    const serverRoot = resolve(import.meta.dir, '../../server')
    const service = readFileSync(resolve(serverRoot, 'contentEditLeaseService.ts'), 'utf8')
    const store = readFileSync(resolve(serverRoot, 'contentEditLeaseStateStore.ts'), 'utf8')
    const consumers = readdirSync(serverRoot)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /from ['"]\.\/contentEditLeaseStateStore['"]/.test(readFileSync(resolve(serverRoot, file), 'utf8')))

    expect(consumers).toEqual(['contentEditLeaseService.ts'])
    expect(service.match(/owned\s*=\s*new Map<string, OwnedLease>/g)).toHaveLength(1)
    expect(store).not.toContain('owned = new Map')
    expect(store).not.toContain('RoomControlContext')
    expect(store).not.toContain('assertAuthorized')
    expect(store).not.toContain('onChanged')
    expect(store).not.toMatch(/from ['"]\.\/contentEditLeaseService['"]/)
    expect(service).toContain('(editLeaseId) => this.owned.delete(editLeaseId)')
    expect(typeof ContentEditLeaseService.prototype.commit).toBe('function')
    const commit = service.slice(
      service.indexOf('  async commit<T>('),
      service.indexOf('  recordPath(resourceKey:', service.indexOf('  async commit<T>(')),
    )
    expectOrdered(commit, [
      'ticket.assertAuthorized()',
      'const tracked = this.owned.get(normalizedLeaseId)',
      'const state = this.currentState(recordPath, key, this.now())',
      'this.assertOwnedState(state, normalizedLeaseId, ticket.context)',
      'const currentRevision = this.stateStore.readRecordRevision(recordPath)',
      'if (currentRevision !== expected)',
      'ticket.assertAuthorized()',
      'const value = operation(recordPath, currentRevision)',
      "throw new Error('content_commit_operation_must_be_sync')",
    ])
    expectOrdered(commit, [
      'if (options.deleteRecord)',
      'this.owned.delete(normalizedLeaseId)',
      'this.stateStore.deleteState(recordPath)',
    ])
    expectOrdered(commit, [
      'const committedRevision = this.stateStore.readRecordRevision(recordPath)',
      'if (committedRevision !== currentRevision + 1)',
      'this.stateStore.writeState(recordPath, committedState)',
      'this.owned.delete(normalizedLeaseId)',
    ])
    expectOrdered(store, [
      'beforePersistExpired(state.editLeaseId)',
      'const available = availableState(resourceKey, state.leaseEpoch, now)',
      'this.writeState(recordPath, available)',
    ])
    for (const source of [service, store]) {
      expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(400)
    }
  })
})

function heldState(resourceKey: ContentResourceKey, acquiredAt: number): HeldLeaseState {
  return {
    schemaVersion: 1,
    resourceKey,
    mode: 'held',
    leaseEpoch: 3,
    editLeaseId: createGeneratedId('contentEditLease'),
    serverInstanceId: createGeneratedId('serverInstance'),
    roomId: createGeneratedId('room'),
    roomGeneration: createGeneratedId('roomGeneration'),
    clientId: createGeneratedId('client'),
    controlEpoch: 2,
    baseRevision: 1,
    acquiredAt: new Date(acquiredAt).toISOString(),
    expiresAt: new Date(acquiredAt + 30_000).toISOString(),
  }
}

function expectOrdered(source: string, needles: string[]): void {
  let offset = 0
  for (const needle of needles) {
    const index = source.indexOf(needle, offset)
    expect(index, `${needle} must remain after the previous phase`).toBeGreaterThanOrEqual(offset)
    offset = index + needle.length
  }
}
