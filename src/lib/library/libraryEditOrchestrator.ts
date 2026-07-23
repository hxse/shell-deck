import type { ContentEditLeaseGrant } from '../contentEditLease'
import { parseAndValidateMacroDefinitionJson } from '../macro/macroDefinitionValidation'
import {
  libraryKindLabel,
  type LibraryListCoordinator,
} from './libraryListCoordinator'
import {
  type LibraryFreshLeaseOutcome,
  type LibraryMutationWorkflow,
  type LibraryPersistOutcome,
} from './libraryMutationWorkflow'
import type { LibraryOperationSnapshot } from './libraryNavigationCoordinator'
import {
  cloneLibraryFields,
  cloneLibraryItem,
  type LibraryItem,
  type LibraryItemFields,
  type LibraryItemKind,
  type LibraryItemSummary,
} from './libraryTypes'

export type LibraryLoadResult = { selected: boolean; recordId: string }

export type LibraryEditCommitOutcome =
  | { kind: 'change_kind'; next: LibraryItemKind }
  | { kind: 'select_item'; item: LibraryItem }
  | { kind: 'new_item'; itemKind: LibraryItemKind; draft: LibraryItemFields }
  | { kind: 'begin_edit'; acquired: Extract<LibraryFreshLeaseOutcome, { kind: 'acquired' }> }
  | { kind: 'discard_preserved'; item: LibraryItem }
  | { kind: 'discard_preserved_missing' }
  | { kind: 'cancel_edit'; saved: LibraryItem | null; cancelledDirtyDraft: boolean }
  | { kind: 'remove_item' }
  | { kind: 'load_into_macro'; result: LibraryLoadResult }

type LibraryEditOrchestratorOptions = {
  mutations: LibraryMutationWorkflow
  list: LibraryListCoordinator
  roomClientPresent(): boolean
  canMutateShared(): boolean
  operationPending(): boolean
  kind(): LibraryItemKind
  items(): LibraryItemSummary[]
  selectedItem(): LibraryItem | null
  draft(): LibraryItemFields | null
  editLease(): ContentEditLeaseGrant | null
  leaseLost(): boolean
  dirty(): boolean
  publishedCreateBufferPreserved(): boolean
  beginOperation(requireController?: boolean): LibraryOperationSnapshot
  canCommitToken(operation: LibraryOperationSnapshot): boolean
  canCommitLibraryOperation(operation: LibraryOperationSnapshot): boolean
  endOperation(operation: LibraryOperationSnapshot): void
  commitReleasedLease(operation: LibraryOperationSnapshot): boolean
  commitOutcome(outcome: LibraryEditCommitOutcome, operation: LibraryOperationSnapshot): boolean
  commitPersistOutcome(
    outcome: Exclude<LibraryPersistOutcome, { kind: 'discarded' }>,
    operation: LibraryOperationSnapshot,
  ): void
  completeKindChange(operation: LibraryOperationSnapshot, next: LibraryItemKind): void
  completeSave(operation: LibraryOperationSnapshot): void
  takeEditLease(): ContentEditLeaseGrant | null
  onLoadIntoMacro(itemId: string, expectedRevision: number): Promise<LibraryLoadResult>
  setStatusText(value: string): void
  setErrorText(value: string): void
  setValidationText(value: string | null): void
  deny(reason: string): void
  reportError(error: unknown, formatted?: boolean): void
}

export class LibraryEditOrchestrator {
  readonly #options: LibraryEditOrchestratorOptions

  constructor(options: LibraryEditOrchestratorOptions) {
    this.#options = options
  }

  async changeKind(next: LibraryItemKind): Promise<void> {
    const options = this.#options
    if (next === options.kind()) return
    if (options.operationPending()) { options.deny('operation_pending'); return }
    if (!this.#confirmDiscard('Switch Library tab and discard the current draft?')) return
    const operation = options.beginOperation(false)
    try {
      if (!await this.#releaseNavigationLease(operation)) return
      options.list.cancelScheduledSearch()
      if (!options.commitOutcome({ kind: 'change_kind', next }, operation)) return
      await options.list.reload(true, false)
      options.completeKindChange(operation, next)
    } catch (error) {
      if (options.canCommitToken(operation)) options.reportError(error)
    } finally {
      options.endOperation(operation)
    }
  }

  async selectByKey(key: string): Promise<void> {
    const options = this.#options
    if (options.operationPending()) { options.deny('operation_pending'); return }
    const summary = options.items().find((item) => item.kind + ':' + item.itemId === key)
    if (!summary || summary.itemId === options.selectedItem()?.itemId) return
    if (!this.#confirmDiscard('Discard the current Library draft?')) return
    const operation = options.beginOperation(false)
    try {
      if (!await this.#releaseNavigationLease(operation)) return
      const item = await options.mutations.read(summary.kind, summary.itemId)
      options.commitOutcome({ kind: 'select_item', item }, operation)
    } catch (error) {
      if (options.canCommitToken(operation)) options.reportError(error)
    } finally {
      options.endOperation(operation)
    }
  }

  async newItem(): Promise<void> {
    const options = this.#options
    if (!this.#requireNoPendingOperation() || !this.#requireSharedMutation()) return
    if (!this.#confirmDiscard('Discard the current Library draft?')) return
    const operation = options.beginOperation()
    try {
      if (!await this.#releaseNavigationLease(operation)) return
      const itemKind = options.kind()
      options.commitOutcome({
        kind: 'new_item',
        itemKind,
        draft: {
          title: `New ${libraryKindLabel(itemKind)}`,
          content: itemKind === 'macro-template' ? emptyMacroJson() : '',
          description: '',
          tags: [],
        },
      }, operation)
    } catch (error) {
      if (options.canCommitToken(operation)) options.reportError(error)
    } finally {
      options.endOperation(operation)
    }
  }

  async beginEdit(): Promise<void> {
    const options = this.#options
    if (!this.#requireNoPendingOperation() || !this.#requireSharedMutation()) return
    const current = options.selectedItem()
    if (!current) { options.deny('no_saved_library_item_selected'); return }
    if (options.dirty() && !confirm('Reopen Edit and replace the local draft with the latest saved item?')) return
    const operation = options.beginOperation()
    try {
      const acquired = await this.#acquireLease(current, operation, 'edit')
      if (acquired) options.commitOutcome({ kind: 'begin_edit', acquired }, operation)
    } catch (error) {
      if (options.canCommitToken(operation)) options.reportError(error)
    } finally {
      options.endOperation(operation)
    }
  }

  async saveItem(): Promise<void> {
    const options = this.#options
    if (!this.#requireNoPendingOperation() || !this.#requireSharedMutation()) return
    const draft = options.draft()
    if (!draft) { options.deny('no_library_draft'); return }
    const fields = cloneLibraryFields(draft)
    if (!fields.title.trim()) { options.setErrorText('library_title_required'); return }
    if (options.kind() === 'macro-template') {
      const validation = parseAndValidateMacroDefinitionJson(fields.content)
      if (!validation.ok) {
        options.setValidationText(formatLibraryMacroValidation(validation))
        options.setErrorText(validation.error.code)
        return
      }
    }
    const current = options.selectedItem()
    const lease = options.editLease()
    if (current && !lease) {
      options.deny(options.leaseLost() ? 'content_edit_lease_lost' : 'content_edit_lease_required')
      return
    }
    const operation = options.beginOperation()
    try {
      const outcome = await options.mutations.persist(
        options.kind(),
        fields,
        current,
        lease,
        () => options.canCommitLibraryOperation(operation),
        (committed) => { options.commitPersistOutcome(committed, operation) },
      )
      if (outcome.kind !== 'persisted') return
      await options.list.reload(false, false)
      options.completeSave(operation)
    } catch (error) {
      if (options.canCommitToken(operation)) options.reportError(error, true)
    } finally {
      options.endOperation(operation)
    }
  }

  async cancelEdit(): Promise<void> {
    const options = this.#options
    if (options.operationPending()) return
    const current = options.selectedItem()
    if (options.publishedCreateBufferPreserved() && current) {
      const operation = options.beginOperation(false)
      try {
        const latest = await options.mutations.read(current.kind, current.itemId)
        options.commitOutcome({ kind: 'discard_preserved', item: latest }, operation)
      } catch (error) {
        if (!this.#preservedOperationIsCurrent(operation)) return
        if (requestStatus(error) === 404) {
          options.commitOutcome({ kind: 'discard_preserved_missing' }, operation)
        } else {
          options.reportError(error)
        }
      } finally {
        options.endOperation(operation)
      }
      return
    }
    const operation = options.beginOperation(false)
    const lease = options.editLease()
    options.commitOutcome({
      kind: 'cancel_edit',
      saved: current ? cloneLibraryItem(current) : null,
      cancelledDirtyDraft: options.dirty(),
    }, operation)
    try {
      await options.mutations.releaseEditLease(lease)
    } finally {
      options.endOperation(operation)
    }
  }

  async removeItem(): Promise<void> {
    const options = this.#options
    if (!this.#requireNoPendingOperation() || !this.#requireSharedMutation()) return
    const current = options.selectedItem()
    if (!current) { options.deny('no_saved_library_item_selected'); return }
    if (!confirm(`Remove ${current.title}?`)) return
    const operation = options.beginOperation()
    let temporaryLease: ContentEditLeaseGrant | null = null
    try {
      let lease = options.editLease()
      let record = current
      if (!lease) {
        const acquired = await this.#acquireLease(current, operation, 'remove')
        if (!acquired) return
        lease = acquired.grant
        record = acquired.item
        temporaryLease = lease
      }
      await options.mutations.delete(record, lease)
      temporaryLease = null
      if (!options.commitOutcome({ kind: 'remove_item' }, operation)) return
      await options.list.reload(false, false)
    } catch (error) {
      if (temporaryLease) await options.mutations.discardTemporaryLease(temporaryLease)
      if (options.canCommitToken(operation)) options.reportError(error)
    } finally {
      options.endOperation(operation)
    }
  }

  async loadIntoMacro(): Promise<void> {
    const options = this.#options
    if (!this.#requireNoPendingOperation() || !this.#requireSharedMutation()) return
    const current = options.selectedItem()
    if (!current || current.kind !== 'macro-template') {
      options.deny('no_saved_library_macro_selected')
      return
    }
    const operation = options.beginOperation()
    try {
      const result = await options.onLoadIntoMacro(current.itemId, current.revision)
      options.commitOutcome({ kind: 'load_into_macro', result }, operation)
    } catch (error) {
      if (options.canCommitToken(operation)) options.reportError(error, true)
    } finally {
      options.endOperation(operation)
    }
  }

  async releaseEditLease(): Promise<void> {
    await this.#options.mutations.releaseEditLease(this.#options.takeEditLease())
  }

  async #releaseNavigationLease(operation: LibraryOperationSnapshot): Promise<boolean> {
    await this.#options.mutations.releaseEditLease(this.#options.editLease())
    return this.#options.commitReleasedLease(operation)
  }

  async #acquireLease(
    item: LibraryItem,
    operation: LibraryOperationSnapshot,
    intent: 'edit' | 'remove',
  ): Promise<Extract<LibraryFreshLeaseOutcome, { kind: 'acquired' }> | null> {
    const outcome = await this.#options.mutations.acquireFreshLease(
      item,
      intent,
      () => this.#options.canCommitToken(operation)
        && this.#options.selectedItem()?.itemId === item.itemId,
    )
    if (outcome.kind === 'declined') this.#options.setStatusText('Item remains read-only')
    return outcome.kind === 'acquired' ? outcome : null
  }

  #confirmDiscard(message: string): boolean {
    return !this.#options.dirty() || confirm(message)
  }

  #preservedOperationIsCurrent(operation: LibraryOperationSnapshot): boolean {
    const selected = this.#options.selectedItem()
    return this.#options.canCommitToken(operation)
      && this.#options.publishedCreateBufferPreserved()
      && selected !== null
      && selected.kind + ':' + selected.itemId === operation.selectedKey
  }

  #requireSharedMutation(): boolean {
    if (!this.#options.roomClientPresent()) { this.#options.deny('room_disconnected'); return false }
    if (!this.#options.canMutateShared()) { this.#options.deny('room_control_required'); return false }
    return true
  }

  #requireNoPendingOperation(): boolean {
    if (!this.#options.operationPending()) return true
    this.#options.deny('operation_pending')
    return false
  }
}

export function formatLibraryMacroValidation(
  result: Exclude<ReturnType<typeof parseAndValidateMacroDefinitionJson>, { ok: true }>,
): string {
  return result.error.code === 'invalid_json'
    ? `invalid_json at ${result.error.line}:${result.error.column} (offset ${result.error.offset}): ${result.error.message}`
    : result.error.issues.map((issue) => `${issue.path || '<root>'}: ${issue.code}: ${issue.message}`).join('\n')
}

export function formatLibraryRequestError(error: unknown): string {
  const response = error instanceof Error && 'response' in error
    ? (error as Error & { response?: Record<string, unknown> }).response
    : undefined
  if (Array.isArray(response?.issues)) {
    return (response.issues as Array<{ path: string; code?: string; message: string }>)
      .map((issue) => `${issue.path || '<root>'}: ${issue.code ? issue.code + ': ' : ''}${issue.message}`)
      .join('\n')
  }
  if (response?.error === 'invalid_json') {
    return `invalid_json at ${response.line}:${response.column} (offset ${response.offset}): ${response.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

function emptyMacroJson(): string {
  return JSON.stringify({
    schemaVersion: 5,
    name: 'Library Macro',
    description: '',
    terminalLayout: [],
    body: [],
  }, null, 2)
}

function requestStatus(error: unknown): number | null {
  return error instanceof Error && 'status' in error
    && typeof (error as Error & { status?: unknown }).status === 'number'
    ? (error as Error & { status: number }).status
    : null
}
