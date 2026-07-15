import { assertGeneratedId } from './generatedId'

export type LibraryItemKind = 'macro-template' | 'prompt' | 'note'

export type ContentResourceKey =
  | { kind: 'macro'; itemId: string }
  | { kind: 'library'; itemKind: LibraryItemKind; itemId: string }

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

export function assertContentResourceKey(value: unknown): ContentResourceKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_content_resource_key')
  const record = value as Record<string, unknown>
  if (record.kind === 'macro') {
    if (Object.keys(record).sort().join(',') !== 'itemId,kind') throw new Error('invalid_content_resource_key')
    return { kind: 'macro', itemId: assertGeneratedId(record.itemId, 'macroTemplate') }
  }
  if (record.kind === 'library') {
    if (Object.keys(record).sort().join(',') !== 'itemId,itemKind,kind') throw new Error('invalid_content_resource_key')
    if (record.itemKind !== 'macro-template' && record.itemKind !== 'prompt' && record.itemKind !== 'note') {
      throw new Error('invalid_library_item_kind')
    }
    return {
      kind: 'library',
      itemKind: record.itemKind,
      itemId: assertGeneratedId(record.itemId, 'libraryItem'),
    }
  }
  throw new Error('invalid_content_resource_key')
}

export function contentResourceKeyString(key: ContentResourceKey): string {
  const normalized = assertContentResourceKey(key)
  return normalized.kind === 'macro'
    ? 'macro:' + normalized.itemId
    : 'library:' + normalized.itemKind + ':' + normalized.itemId
}
