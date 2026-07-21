import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { assertGeneratedId, createGeneratedId } from '../src/lib/generatedId'
import {
  assertLibraryItem,
  assertLibraryItemKind,
  libraryItemSummary,
  normalizeLibraryItemFields,
  type LibraryItem,
  type LibraryItemFields,
  type LibraryItemKind,
  type LibraryItemSummary,
} from '../src/lib/library/libraryTypes'
import { ContentResourceTransactions, type SharedContentStoreOptions } from './sharedContentStore'
import {
  ensurePrivateDirectory,
  publishPrivateFileAtomic,
  publishPrivateFileDelete,
  readPrivateFile,
  type PublishedFileMutationReceipt,
} from './userDataRoot'

export class LibraryStore {
  readonly transactions: ContentResourceTransactions
  private readonly now: () => string
  private readonly idFactory: () => string
  private readonly replaceRecordFile: (path: string, bytes: string) => PublishedFileMutationReceipt
  private readonly deleteRecordFile: (path: string) => PublishedFileMutationReceipt

  constructor(root?: string, options: SharedContentStoreOptions = {}) {
    this.transactions = new ContentResourceTransactions(root)
    this.now = options.now ?? (() => new Date().toISOString())
    this.idFactory = options.idFactory ?? (() => createGeneratedId('libraryItem'))
    this.replaceRecordFile = options.replaceRecord ?? publishPrivateFileAtomic
    this.deleteRecordFile = options.deleteRecord ?? publishPrivateFileDelete
    for (const kind of ['macro-template', 'prompt', 'note'] as const) ensurePrivateDirectory(this.kindDirectory(kind))
  }

  list(kindValue: unknown, query = ''): LibraryItemSummary[] {
    const result = this.scan(kindValue, query)
    if (result.invalidItems.length > 0) throw new Error('invalid_library_item')
    return result.records.map(libraryItemSummary)
  }

  scan(kindValue: unknown, query = ''): {
    records: LibraryItem[]
    invalidItems: Array<{ itemId: string; error: 'invalid_library_item' }>
  } {
    const kind = assertLibraryItemKind(kindValue)
    const normalizedQuery = query.trim().toLowerCase()
    const records: LibraryItem[] = []
    const invalidItems: Array<{ itemId: string; error: 'invalid_library_item' }> = []
    for (const entry of readdirSync(this.kindDirectory(kind), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const itemId = entry.name.slice(0, -5)
      try { records.push(this.read(kind, itemId)) }
      catch (error) {
        if (error instanceof Error && error.message.startsWith('library_item_not_found:')) continue
        if (isInvalidLibraryItemData(error)) {
          invalidItems.push({ itemId, error: 'invalid_library_item' })
          continue
        }
        throw error
      }
    }
    const filtered = records
      .filter((item) => !normalizedQuery || searchableText(item).toLowerCase().includes(normalizedQuery))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.itemId.localeCompare(right.itemId))
    invalidItems.sort((left, right) => left.itemId.localeCompare(right.itemId))
    return { records: filtered, invalidItems }
  }

  read(kindValue: unknown, itemIdValue: unknown): LibraryItem {
    const kind = assertLibraryItemKind(kindValue)
    const itemId = assertGeneratedId(itemIdValue, 'libraryItem')
    const path = this.recordPath(kind, itemId)
    if (!existsSync(path)) throw new Error('library_item_not_found:' + kind + ':' + itemId)
    try { return assertLibraryItem(JSON.parse(readPrivateFile(path).toString('utf8')), { kind, itemId }) }
    catch (error) {
      if (isNodeError(error, 'ENOENT')) throw new Error('library_item_not_found:' + kind + ':' + itemId)
      throw error
    }
  }

  async create(
    kindValue: unknown,
    fieldsValue: unknown,
    signal?: AbortSignal,
    beforeCommit: () => void = () => {},
  ): Promise<LibraryItem> {
    const kind = assertLibraryItemKind(kindValue)
    const fields = normalizeLibraryItemFields(fieldsValue)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const itemId = assertGeneratedId(this.idFactory(), 'libraryItem')
      const path = this.recordPath(kind, itemId)
      const created = await this.transactions.run(path, () => {
        if (existsSync(path)) return null
        beforeCommit()
        const now = this.now()
        const item: LibraryItem = { schemaVersion: 1, itemId, kind, revision: 1, ...fields, createdAt: now, updatedAt: now }
        this.publishItem(path, item)
        return item
      }, signal)
      if (created) return created
    }
    throw new Error('library_item_id_collision')
  }

  commitUpdate(kindValue: unknown, itemIdValue: unknown, currentRevision: number, fieldsValue: unknown): LibraryItem {
    const kind = assertLibraryItemKind(kindValue)
    const itemId = assertGeneratedId(itemIdValue, 'libraryItem')
    const existing = this.read(kind, itemId)
    if (existing.revision !== currentRevision) throw new Error('content_revision_conflict')
    const fields = normalizeLibraryItemFields(fieldsValue)
    const item: LibraryItem = { ...existing, ...fields, revision: currentRevision + 1, updatedAt: this.now() }
    this.publishItem(this.recordPath(kind, itemId), item)
    return item
  }

  commitDelete(kindValue: unknown, itemIdValue: unknown, currentRevision: number): void {
    const kind = assertLibraryItemKind(kindValue)
    const itemId = assertGeneratedId(itemIdValue, 'libraryItem')
    const existing = this.read(kind, itemId)
    if (existing.revision !== currentRevision) throw new Error('content_revision_conflict')
    const path = this.recordPath(kind, itemId)
    const receipt = this.deleteRecordFile(path)
    if (receipt.durability === 'uncertain' && existsSync(path)) throw new Error('content_record_publish_state_unknown')
  }

  recordPath(kindValue: unknown, itemIdValue: unknown): string {
    const kind = assertLibraryItemKind(kindValue)
    const itemId = assertGeneratedId(itemIdValue, 'libraryItem')
    const path = join(this.kindDirectory(kind), itemId + '.json')
    if (basename(path) !== itemId + '.json') throw new Error('invalid_library_item_path')
    return path
  }

  kindDirectory(kindValue: unknown): string {
    const kind = assertLibraryItemKind(kindValue)
    return join(this.transactions.paths.library, kind)
  }

  private publishItem(path: string, item: LibraryItem): void {
    const bytes = serialize(item)
    const receipt = this.replaceRecordFile(path, bytes)
    if (receipt.durability === 'confirmed') return
    let published: Buffer
    try { published = readPrivateFile(path) }
    catch { throw new Error('content_record_publish_state_unknown') }
    if (!published.equals(Buffer.from(bytes))) throw new Error('content_record_publish_state_unknown')
  }
}

function searchableText(item: LibraryItem): string {
  return [item.title, item.description, ...item.tags, item.content].join('\n')
}

function serialize(item: LibraryItem): string { return JSON.stringify(item, null, 2) + '\n' }

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function isInvalidLibraryItemData(error: unknown): boolean {
  if (error instanceof SyntaxError) return true
  if (!(error instanceof Error)) return false
  return error.message === 'invalid_library_item'
    || error.message === 'invalid_library_item_fields'
    || error.message === 'invalid_library_item_tags'
    || error.message === 'invalid_library_item_revision'
    || error.message === 'invalid_library_item_timestamp'
    || error.message === 'invalid_library_item_normalization'
    || error.message === 'library_item_kind_mismatch'
    || error.message === 'library_item_id_mismatch'
    || error.message === 'invalid_libraryItem_id'
    || error.message === 'invalid_generated_id_suffix'
    || error.message === 'invalid_library_item_path'
}
