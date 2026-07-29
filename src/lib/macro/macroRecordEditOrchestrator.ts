import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
import { cloneJsonValue } from '../jsonClone'
import type { TerminalRoomClient } from '../terminalRoomClient'
import type { MacroDefinitionV6, MacroRecord } from './macroDefinitionTypes'
import type { MacroJsonCommit } from './macroJsonEditSession.svelte'
import { formatMacroError } from './macroJsonEditSession.svelte'
import type {
  MacroPersistDefinitionOutcome,
  MacroRecordMutationWorkflow,
  PersistedDefinition,
} from './macroRecordMutationWorkflow'
import type { MacroRecordListResult } from './macroRecordClient'
import type { MacroOperationToken } from './macroRecordNavigationCoordinator'
import type { MacroTemplateRefreshResult } from './macroRecordRemoteSyncCoordinator'

type DefinitionOperationSource = 'visual' | 'json'

export type MacroStartRecordSnapshot = {
  definition: MacroDefinitionV6
  draftRevision: number
  dirty: boolean
  record: MacroRecord | null
}

export type MacroDefinitionOperationContext = {
  definition: MacroDefinitionV6
  token: MacroOperationToken
  revision: number
  source: DefinitionOperationSource
}

export type MacroEditCommitOutcome =
  | {
      kind: 'begin_edit'
      acquired: {
        record: MacroRecord
        grant: ContentEditLeaseGrant
        view: ContentEditLeaseView
      }
      enterJson: boolean
    }
  | { kind: 'cancel_edit' }
  | { kind: 'delete_record' }

type MacroRecordEditOptions = {
  mutations: MacroRecordMutationWorkflow
  roomClient(): TerminalRoomClient | null
  canMutateShared(): boolean
  operationPending(): boolean
  selectedRecord(): MacroRecord | null
  draft(): MacroDefinitionV6 | null
  draftRevision(): number
  dirty(): boolean
  contentEditing(): boolean
  editLease(): ContentEditLeaseGrant | null
  jsonEditing(): boolean
  beginJsonCommit(): { ok: true; commit: MacroJsonCommit } | { ok: false }
  finishJsonCommit(commit: MacroJsonCommit): void
  setJsonError(value: string): void
  openJsonBuffer(): void
  beginOperation(): MacroOperationToken
  canCommit(token: MacroOperationToken): boolean
  definitionIsCurrent(context: MacroDefinitionOperationContext): boolean
  endOperation(token: MacroOperationToken): void
  takeEditLease(): ContentEditLeaseGrant | null
  commitEdit(outcome: MacroEditCommitOutcome, token: MacroOperationToken): boolean
  acceptPersistOutcome(
    outcome: MacroPersistDefinitionOutcome,
    context: MacroDefinitionOperationContext,
  ): PersistedDefinition | null
  installPersisted(value: PersistedDefinition, context: MacroDefinitionOperationContext): boolean
  reconcilePublishedCreate(record: MacroRecord, context: MacroDefinitionOperationContext): boolean
  installTemplateList(result: MacroRecordListResult): void
  refreshTemplates(report: boolean): Promise<MacroTemplateRefreshResult>
  rejectMutation(reason: string): void
  reportMutationError(error: unknown, formatted?: boolean): void
}

export class MacroRecordEditOrchestrator {
  readonly #options: MacroRecordEditOptions

  constructor(options: MacroRecordEditOptions) {
    this.#options = options
  }

  async beginEdit(enterJson = false): Promise<void> {
    const options = this.#options
    const record = options.selectedRecord()
    if (!record || !options.roomClient() || options.operationPending() || !options.canMutateShared()) {
      options.rejectMutation(!options.roomClient()
        ? 'room_disconnected'
        : !options.canMutateShared()
          ? 'room_control_required'
          : options.operationPending()
            ? 'operation_pending'
            : 'no_saved_macro_selected')
      return
    }
    if (options.dirty() && !confirm('Discard the unsaved draft and reload the latest saved Macro before editing?')) return
    const token = options.beginOperation()
    try {
      const acquired = await options.mutations.acquireFreshEditLease(record.id, 'edit', () => options.canCommit(token))
      if (acquired) options.commitEdit({ kind: 'begin_edit', acquired, enterJson }, token)
    } catch (error) {
      if (options.canCommit(token)) options.reportMutationError(error)
    } finally {
      options.endOperation(token)
    }
  }

  async cancelEdit(): Promise<void> {
    const options = this.#options
    if (options.operationPending()) return
    const token = options.beginOperation()
    try {
      await options.mutations.releaseEditLease(options.takeEditLease())
      options.commitEdit({ kind: 'cancel_edit' }, token)
    } catch (error) {
      if (options.canCommit(token)) options.reportMutationError(error)
    } finally {
      options.endOperation(token)
    }
  }

  async saveTemplate(): Promise<void> {
    const options = this.#options
    if (!options.canMutateShared()) {
      options.rejectMutation(options.roomClient() ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (options.operationPending()) {
      options.rejectMutation('operation_pending')
      return
    }
    const draft = options.draft()
    if (!draft) return
    const token = options.beginOperation()
    const context = this.#context(cloneJsonValue(draft), token, options.draftRevision(), 'visual')
    try {
      const persisted = await this.#persist(context)
      if (!persisted || !options.installPersisted(persisted, context)) return
      await options.refreshTemplates(false)
    } catch (error) {
      if (options.canCommit(token)) options.reportMutationError(error, true)
    } finally {
      options.endOperation(token)
    }
  }

  async deleteTemplate(): Promise<void> {
    const options = this.#options
    const roomClient = options.roomClient()
    const selected = options.selectedRecord()
    if (!roomClient || !options.canMutateShared()) {
      options.rejectMutation(roomClient ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (options.operationPending()) {
      options.rejectMutation('operation_pending')
      return
    }
    if (!selected) {
      options.rejectMutation('no_saved_macro_selected')
      return
    }
    const token = options.beginOperation()
    let temporaryLease: ContentEditLeaseGrant | null = null
    try {
      let record = selected
      let lease = options.editLease()
      if (!lease || !options.contentEditing()) {
        const acquired = await options.mutations.acquireFreshEditLease(
          selected.id,
          'delete',
          () => options.canCommit(token),
        )
        if (!acquired) return
        record = acquired.record
        lease = acquired.grant
        temporaryLease = acquired.grant
      }
      if (!confirm(`Delete ${record.definition.name}?`)) {
        await this.#releaseTemporaryLease(roomClient, temporaryLease)
        temporaryLease = null
        return
      }
      await options.mutations.delete(record, lease)
      temporaryLease = null
      if (!options.commitEdit({ kind: 'delete_record' }, token)) return
      await options.refreshTemplates(false)
    } catch (error) {
      await this.#releaseTemporaryLease(roomClient, temporaryLease)
      if (options.canCommit(token)) options.reportMutationError(error)
    } finally {
      options.endOperation(token)
    }
  }

  startJsonBuffer(): void {
    const options = this.#options
    if (!options.draft() || options.operationPending()) return
    if (options.selectedRecord() && !options.contentEditing()) {
      void this.beginEdit(true)
      return
    }
    options.openJsonBuffer()
  }

  async saveJson(): Promise<void> {
    const options = this.#options
    const pending = options.beginJsonCommit()
    if (!pending.ok) return
    if (!options.canMutateShared()) {
      options.finishJsonCommit(pending.commit)
      options.rejectMutation(options.roomClient() ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (options.operationPending()) {
      options.finishJsonCommit(pending.commit)
      options.rejectMutation('operation_pending')
      return
    }
    const token = options.beginOperation()
    const context = this.#context(pending.commit.candidate, token, pending.commit.revision, 'json')
    try {
      const persisted = await this.#persist(context)
      if (!persisted) return
      if (!options.definitionIsCurrent(context)) {
        options.reconcilePublishedCreate(persisted.record, context)
        return
      }
      const refreshed = await options.mutations.list()
      if (!options.definitionIsCurrent(context)) return
      options.installTemplateList(refreshed)
      options.installPersisted(persisted, context)
    } catch (error) {
      if (options.definitionIsCurrent(context)) options.setJsonError(formatMacroError(error))
    } finally {
      options.finishJsonCommit(pending.commit)
      options.endOperation(token)
    }
  }

  async resolveStartRecord(
    token: MacroOperationToken,
    snapshot: MacroStartRecordSnapshot,
  ): Promise<MacroRecord | null> {
    const options = this.#options
    const context = this.#context(snapshot.definition, token, snapshot.draftRevision, 'visual')
    let record = snapshot.record
    let persisted: PersistedDefinition | null = null
    if (snapshot.dirty) {
      persisted = await this.#persist(context)
      record = persisted?.record ?? null
    }
    if (!record) return null
    if (!options.definitionIsCurrent(context)) {
      if (snapshot.dirty) options.reconcilePublishedCreate(record, context)
      return null
    }
    if (snapshot.dirty && persisted) {
      options.installPersisted(persisted, context)
      await options.refreshTemplates(false)
    }
    return options.canCommit(token) ? record : null
  }

  async releaseEditLease(): Promise<void> {
    await this.#options.mutations.releaseEditLease(this.#options.takeEditLease())
  }

  async #persist(context: MacroDefinitionOperationContext): Promise<PersistedDefinition | null> {
    let committed: PersistedDefinition | null = null
    const outcome = await this.#options.mutations.persistDefinition(
      context.definition,
      () => this.#options.definitionIsCurrent(context),
      (value) => { committed = this.#options.acceptPersistOutcome(value, context) },
    )
    return outcome.kind === 'discarded' ? null : committed
  }

  #context(
    definition: MacroDefinitionV6,
    token: MacroOperationToken,
    revision: number,
    source: DefinitionOperationSource,
  ): MacroDefinitionOperationContext {
    return { definition, token, revision, source }
  }

  async #releaseTemporaryLease(
    roomClient: TerminalRoomClient,
    lease: ContentEditLeaseGrant | null,
  ): Promise<void> {
    if (lease) await roomClient.releaseContentEditLease(lease.editLeaseId).catch(() => {})
  }
}
