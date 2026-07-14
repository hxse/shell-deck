import { assertGeneratedId } from '../generatedId'

export const LIBRARY_ITEM_KINDS = ['macro-template', 'prompt', 'note'] as const
export type LibraryItemKind = (typeof LIBRARY_ITEM_KINDS)[number]

export type LibraryItem = {
  schemaVersion: 1
  itemId: string
  kind: LibraryItemKind
  revision: number
  title: string
  content: string
  description: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type LibraryItemSummary = Pick<LibraryItem, 'itemId' | 'kind' | 'revision' | 'title' | 'tags' | 'updatedAt'>

export type LibraryItemFields = Pick<LibraryItem, 'title' | 'content' | 'description' | 'tags'>

export function assertLibraryItemKind(value: unknown): LibraryItemKind {
  if (!LIBRARY_ITEM_KINDS.includes(value as LibraryItemKind)) throw new Error('invalid_library_item_kind')
  return value as LibraryItemKind
}

export function normalizeLibraryItemFields(value: unknown): LibraryItemFields {
  if (!isRecord(value)) throw new Error('invalid_library_item_fields')
  assertExactKeys(value, ['title', 'content', 'description', 'tags'], 'invalid_library_item_fields')
  if (typeof value.title !== 'string' || typeof value.content !== 'string' || typeof value.description !== 'string' || !Array.isArray(value.tags)) {
    throw new Error('invalid_library_item_fields')
  }
  const title = value.title.trim()
  if (!title) throw new Error('library_title_required')
  const tags: string[] = []
  const seen = new Set<string>()
  for (const raw of value.tags) {
    if (typeof raw !== 'string') throw new Error('invalid_library_item_tags')
    const tag = raw.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return { title, content: value.content, description: value.description, tags }
}

export function assertLibraryItem(value: unknown, expected?: { kind?: LibraryItemKind; itemId?: string }): LibraryItem {
  if (!isRecord(value)) throw new Error('invalid_library_item')
  assertExactKeys(value, ['schemaVersion', 'itemId', 'kind', 'revision', 'title', 'content', 'description', 'tags', 'createdAt', 'updatedAt'], 'invalid_library_item')
  if (value.schemaVersion !== 1) throw new Error('invalid_library_item')
  const kind = assertLibraryItemKind(value.kind)
  const itemId = assertGeneratedId(value.itemId, 'libraryItem')
  if (expected?.kind !== undefined && kind !== expected.kind) throw new Error('library_item_kind_mismatch')
  if (expected?.itemId !== undefined && itemId !== assertGeneratedId(expected.itemId, 'libraryItem')) throw new Error('library_item_id_mismatch')
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) throw new Error('invalid_library_item_revision')
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) throw new Error('invalid_library_item_timestamp')
  const fields = normalizeLibraryItemFields({ title: value.title, content: value.content, description: value.description, tags: value.tags })
  if (fields.title !== value.title || fields.tags.length !== (value.tags as unknown[]).length || fields.tags.some((tag, index) => tag !== (value.tags as string[])[index])) {
    throw new Error('invalid_library_item_normalization')
  }
  return value as LibraryItem
}

export function libraryItemSummary(item: LibraryItem): LibraryItemSummary {
  return {
    itemId: item.itemId,
    kind: item.kind,
    revision: item.revision,
    title: item.title,
    tags: [...item.tags],
    updatedAt: item.updatedAt,
  }
}

function assertExactKeys(value: Record<string, unknown>, keys: string[], error: string): void {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(error)
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new Date(value).toISOString() === value }
  catch { return false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
