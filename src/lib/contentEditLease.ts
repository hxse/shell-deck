import { assertGeneratedId } from './generatedId'

export type ContentResourceKey = { kind: 'macro'; itemId: string }

export type ContentEditLeaseView =
  | { mode: 'available'; leaseEpoch: number }
  | { mode: 'held'; leaseEpoch: number; expiresAt: string }

export type ContentEditLeaseGrant = {
  resourceKey: ContentResourceKey
  editLeaseId: string
  leaseEpoch: number
  baseRevision: number
  expiresAt: string
}

export type ContentCommitLeaseOutcome =
  | { status: 'retained'; grant: ContentEditLeaseGrant }
  | { status: 'released' }
  | { status: 'lost'; reason: 'content_edit_lease_state_refresh_failed' }

export function assertContentResourceKey(value: unknown): ContentResourceKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_content_resource_key')
  const record = value as Record<string, unknown>
  if (record.kind === 'macro') {
    if (Object.keys(record).sort().join(',') !== 'itemId,kind') throw new Error('invalid_content_resource_key')
    return { kind: 'macro', itemId: assertGeneratedId(record.itemId, 'macroTemplate') }
  }
  throw new Error('invalid_content_resource_key')
}

export function contentResourceKeyString(key: ContentResourceKey): string {
  const normalized = assertContentResourceKey(key)
  return 'macro:' + normalized.itemId
}
