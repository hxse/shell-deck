import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { assertGeneratedId, createGeneratedId } from '../src/lib/generatedId'
import {
  canonicalResourceRelativePath,
  initializeUserDataRoot,
  publishPrivateFileAtomic,
  publishPrivateFileDelete,
  readPrivateFile,
  resourceLockPath,
  type PublishedFileMutationReceipt,
  type UserDataPaths,
  withFileLock,
} from './userDataRoot'

export type MacroRecord<TDefinition> = {
  id: string
  revision: number
  createdAt: string
  updatedAt: string
  definition: TDefinition
}

export type SharedContentStoreOptions = {
  now?: () => string
  idFactory?: () => string
  replaceRecord?: (path: string, bytes: string) => PublishedFileMutationReceipt
  deleteRecord?: (path: string) => PublishedFileMutationReceipt
}

export type InvalidMacroRecordEntry = {
  recordId: string
  error: 'invalid_macro_record'
}

export type MacroRecordScan<TDefinition> = {
  records: MacroRecord<TDefinition>[]
  invalidRecords: InvalidMacroRecordEntry[]
}

export class ContentResourceTransactions {
  readonly paths: UserDataPaths

  constructor(root?: string) {
    this.paths = initializeUserDataRoot(root)
  }

  async run<T>(recordPath: string, operation: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
    const resource = canonicalResourceRelativePath(this.paths.root, recordPath)
    return await withFileLock(resourceLockPath(this.paths, resource), operation, { signal })
  }
}

export class MacroRecordStore<TDefinition> {
  readonly transactions: ContentResourceTransactions
  private readonly now: () => string
  private readonly idFactory: () => string
  private readonly replaceRecordFile: (path: string, bytes: string) => PublishedFileMutationReceipt
  private readonly deleteRecordFile: (path: string) => PublishedFileMutationReceipt

  constructor(root?: string, options: SharedContentStoreOptions = {}) {
    this.transactions = new ContentResourceTransactions(root)
    this.now = options.now ?? (() => new Date().toISOString())
    this.idFactory = options.idFactory ?? (() => createGeneratedId('macroTemplate'))
    this.replaceRecordFile = options.replaceRecord ?? publishPrivateFileAtomic
    this.deleteRecordFile = options.deleteRecord ?? publishPrivateFileDelete
  }

  list(): MacroRecord<TDefinition>[] {
    const result = this.scan()
    if (result.invalidRecords.length > 0) throw new Error('invalid_macro_record')
    return result.records
  }

  scan(): MacroRecordScan<TDefinition> {
    const dir = this.transactions.paths.macros
    const records: MacroRecord<TDefinition>[] = []
    const invalidRecords: InvalidMacroRecordEntry[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    ) {
      const recordId = entry.name.slice(0, -5)
      try { records.push(this.read(recordId)) }
      catch (error) {
        if (error instanceof Error && error.message.startsWith('macro_record_not_found:')) continue
        if (isInvalidMacroRecordData(error)) {
          invalidRecords.push({ recordId, error: 'invalid_macro_record' })
          continue
        }
        throw error
      }
    }
    records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    invalidRecords.sort((left, right) => left.recordId.localeCompare(right.recordId))
    return { records, invalidRecords }
  }

  read(id: string): MacroRecord<TDefinition> {
    const path = this.recordPath(id)
    if (!existsSync(path)) throw new Error('macro_record_not_found:' + id)
    try { return assertMacroRecord<TDefinition>(JSON.parse(readPrivateFile(path).toString('utf8')), id) }
    catch (error) {
      if (isNodeError(error, 'ENOENT')) throw new Error('macro_record_not_found:' + id)
      throw error
    }
  }

  async create(
    definition: TDefinition,
    signal?: AbortSignal,
    beforeCommit: () => void = () => {},
  ): Promise<MacroRecord<TDefinition>> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = assertGeneratedId(this.idFactory(), 'macroTemplate')
      const path = this.recordPath(id)
      const created = await this.transactions.run(path, () => {
        if (existsSync(path)) return null
        beforeCommit()
        const now = this.now()
        const record: MacroRecord<TDefinition> = { id, revision: 1, createdAt: now, updatedAt: now, definition }
        this.publishRecord(path, record)
        return record
      }, signal)
      if (created) return created
    }
    throw new Error('macro_record_id_collision')
  }

  async update(id: string, expectedRevision: number, definition: TDefinition, signal?: AbortSignal): Promise<MacroRecord<TDefinition>> {
    const path = this.recordPath(id)
    return await this.transactions.run(path, () => {
      const existing = this.read(id)
      if (existing.revision !== expectedRevision) throw new Error('content_revision_conflict')
      const record: MacroRecord<TDefinition> = {
        ...existing,
        revision: existing.revision + 1,
        updatedAt: this.now(),
        definition,
      }
      this.publishRecord(path, record)
      return record
    }, signal)
  }

  async delete(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void> {
    const path = this.recordPath(id)
    await this.transactions.run(path, () => {
      const existing = this.read(id)
      if (existing.revision !== expectedRevision) throw new Error('content_revision_conflict')
      const receipt = this.deleteRecordFile(path)
      if (receipt.durability === 'uncertain' && existsSync(path)) throw new Error('content_record_publish_state_unknown')
    }, signal)
  }

  commitUpdate(id: string, currentRevision: number, definition: TDefinition): MacroRecord<TDefinition> {
    const path = this.recordPath(id)
    const existing = this.read(id)
    if (existing.revision !== currentRevision) throw new Error('content_revision_conflict')
    const record: MacroRecord<TDefinition> = {
      ...existing,
      revision: currentRevision + 1,
      updatedAt: this.now(),
      definition,
    }
    this.publishRecord(path, record)
    return record
  }

  commitDelete(id: string, currentRevision: number): void {
    const existing = this.read(id)
    if (existing.revision !== currentRevision) throw new Error('content_revision_conflict')
    const path = this.recordPath(id)
    const receipt = this.deleteRecordFile(path)
    if (receipt.durability === 'uncertain' && existsSync(path)) throw new Error('content_record_publish_state_unknown')
  }

  recordPath(id: string): string {
    const normalized = assertGeneratedId(id, 'macroTemplate')
    const path = join(this.transactions.paths.macros, normalized + '.json')
    if (basename(path) !== normalized + '.json') throw new Error('invalid_macro_record_path')
    return path
  }

  private publishRecord(path: string, record: MacroRecord<TDefinition>): void {
    const bytes = JSON.stringify(record, null, 2) + '\n'
    const receipt = this.replaceRecordFile(path, bytes)
    if (receipt.durability === 'confirmed') return
    let published: Buffer
    try { published = readPrivateFile(path) }
    catch { throw new Error('content_record_publish_state_unknown') }
    if (!published.equals(Buffer.from(bytes))) throw new Error('content_record_publish_state_unknown')
  }
}

export function assertMacroRecord<TDefinition>(value: unknown, expectedId?: string): MacroRecord<TDefinition> {
  if (!isRecord(value)) throw new Error('invalid_macro_record')
  const keys = Object.keys(value).sort().join(',')
  if (keys !== 'createdAt,definition,id,revision,updatedAt') throw new Error('invalid_macro_record')
  const id = assertGeneratedId(value.id, 'macroTemplate')
  if (expectedId !== undefined && id !== assertGeneratedId(expectedId, 'macroTemplate')) throw new Error('macro_record_id_mismatch')
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) throw new Error('invalid_macro_record_revision')
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) throw new Error('invalid_macro_record_timestamp')
  return value as MacroRecord<TDefinition>
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new Date(value).toISOString() === value }
  catch { return false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function isInvalidMacroRecordData(error: unknown): boolean {
  if (error instanceof SyntaxError) return true
  if (!(error instanceof Error)) return false
  return error.message === 'invalid_macro_record'
    || error.message === 'invalid_macro_record_revision'
    || error.message === 'invalid_macro_record_timestamp'
    || error.message === 'macro_record_id_mismatch'
    || error.message === 'invalid_macroTemplate_id'
    || error.message === 'invalid_generated_id_suffix'
    || error.message === 'invalid_macro_record_path'
}
