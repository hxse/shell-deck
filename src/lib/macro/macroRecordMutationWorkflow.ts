import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
import type { TerminalRoomClient } from '../terminalRoomClient'
import { validateMacroDefinitionV6 } from './macroDefinitionValidation'
import type { MacroDefinitionV6, MacroRecord } from './macroDefinitionTypes'
import { formatMacroIssues, messageOf } from './macroJsonEditSession.svelte'
import { MacroRecordClient, type MacroRecordListResult } from './macroRecordClient'

export type PersistedDefinition = {
  record: MacroRecord
  editing: boolean
  leaseWarning: string | null
  preservePublishedCreateBuffer: boolean
  editLease: ContentEditLeaseGrant | null
  leaseView: ContentEditLeaseView | null
}

export type MacroPersistDefinitionOutcome =
  | { kind: 'persisted'; value: PersistedDefinition }
  | { kind: 'published_create'; record: MacroRecord }
  | { kind: 'discarded' }

type MacroRecordMutationWorkflowOptions = {
  roomClient(): TerminalRoomClient | null
  selectedRecord(): MacroRecord | null
  editLease(): ContentEditLeaseGrant | null
  contentEditing(): boolean
}

export class MacroRecordMutationWorkflow {
  private readonly recordClient: MacroRecordClient

  constructor(private readonly options: MacroRecordMutationWorkflowOptions) {
    this.recordClient = new MacroRecordClient(() => options.roomClient()?.controlGrant ?? null)
  }

  async list(): Promise<MacroRecordListResult> {
    return await this.recordClient.list()
  }

  async read(recordId: string): Promise<MacroRecord> {
    return await this.recordClient.read(recordId)
  }

  async delete(record: MacroRecord, lease: ContentEditLeaseGrant): Promise<void> {
    await this.recordClient.delete(record, lease)
  }

  async releaseEditLease(lease: ContentEditLeaseGrant | null): Promise<void> {
    const roomClient = this.options.roomClient()
    if (lease && roomClient?.canMutateShared) {
      await roomClient.releaseContentEditLease(lease.editLeaseId).catch(() => {})
    }
  }

  async acquireFreshEditLease(
    recordId: string,
    intent: 'edit' | 'delete',
    operationIsCurrent: () => boolean,
  ): Promise<{ record: MacroRecord; grant: ContentEditLeaseGrant; view: ContentEditLeaseView } | null> {
    const roomClient = this.options.roomClient()
    const isCurrent = () => operationIsCurrent() && this.options.selectedRecord()?.id === recordId
    if (!roomClient || !isCurrent()) return null
    const key = { kind: 'macro' as const, itemId: recordId }
    const view = await roomClient.contentEditLeaseView(key)
    if (!isCurrent()) return null
    let result: { view: ContentEditLeaseView; grant: ContentEditLeaseGrant }
    if (view.mode === 'held') {
      const suffix = intent === 'delete' ? ' to delete it?' : '?'
      if (!confirm(`This macro is being edited elsewhere. Take over its edit lease${suffix}`)) return null
      result = await roomClient.takeOverContentEditLease(key, view.leaseEpoch)
    } else {
      result = await roomClient.acquireContentEditLease(key, view.leaseEpoch)
    }
    try {
      if (!isCurrent()) {
        await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
        return null
      }
      const record = await this.recordClient.read(recordId)
      if (!isCurrent()) {
        await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
        return null
      }
      return { record, grant: result.grant, view: result.view }
    } catch (error) {
      await roomClient.releaseContentEditLease(result.grant.editLeaseId).catch(() => {})
      throw error
    }
  }

  async persistDefinition(
    definition: MacroDefinitionV6,
    operationIsCurrent: () => boolean,
    commit: (outcome: Exclude<MacroPersistDefinitionOutcome, { kind: 'discarded' }>) => void,
  ): Promise<MacroPersistDefinitionOutcome> {
    const validation = validateMacroDefinitionV6(definition)
    if (!validation.ok) throw new Error(formatMacroIssues(validation.issues))
    const record = this.options.selectedRecord()
    const initialLease = this.options.editLease()
    const updateResult = record
      ? initialLease && this.options.contentEditing()
        ? await this.recordClient.update(record, validation.value, initialLease)
        : (() => { throw new Error('content_edit_lease_required') })()
      : null
    const result = updateResult?.record ?? await this.recordClient.create(validation.value)
    if (!operationIsCurrent()) {
      if (!record) {
        const outcome = { kind: 'published_create' as const, record: result }
        commit(outcome)
        return outcome
      }
      return { kind: 'discarded' }
    }
    if (record && result.id !== record.id) throw new Error('macro_record_identity_changed')
    if (record && result.revision !== record.revision + 1) throw new Error('macro_revision_conflict')
    if (!record && result.revision !== 1) throw new Error('macro_revision_conflict')
    if (record) {
      if (!this.options.editLease() || !this.options.contentEditing()) throw new Error('content_edit_lease_required')
      if (updateResult?.leaseOutcome.status === 'retained') {
        const persisted: PersistedDefinition = {
          record: result,
          editing: true,
          leaseWarning: null,
          preservePublishedCreateBuffer: false,
          editLease: updateResult.leaseOutcome.grant,
          leaseView: {
            mode: 'held',
            leaseEpoch: updateResult.leaseOutcome.grant.leaseEpoch,
            expiresAt: updateResult.leaseOutcome.grant.expiresAt,
          },
        }
        const outcome = { kind: 'persisted' as const, value: persisted }
        commit(outcome)
        return outcome
      }
      const persisted: PersistedDefinition = {
        record: result,
        editing: false,
        leaseWarning: updateResult?.leaseOutcome.status === 'lost'
          ? updateResult.leaseOutcome.reason
          : 'content_edit_lease_lost',
        preservePublishedCreateBuffer: false,
        editLease: null,
        leaseView: null,
      }
      const outcome = { kind: 'persisted' as const, value: persisted }
      commit(outcome)
      return outcome
    }
    const acquired = await this.acquireCreatedRecordEditLease(result, operationIsCurrent)
    if (acquired === null || !operationIsCurrent()) {
      const outcome = { kind: 'published_create' as const, record: result }
      commit(outcome)
      return outcome
    }
    const persisted: PersistedDefinition = {
      record: result,
      editing: acquired.ok,
      leaseWarning: acquired.ok ? null : `macro_saved_but_edit_lease_not_retained:${acquired.reason}`,
      preservePublishedCreateBuffer: !acquired.ok,
      editLease: acquired.ok ? acquired.grant : null,
      leaseView: acquired.ok ? acquired.view : null,
    }
    const outcome = { kind: 'persisted' as const, value: persisted }
    commit(outcome)
    return outcome
  }

  private async acquireCreatedRecordEditLease(
    record: MacroRecord,
    operationIsCurrent: () => boolean,
  ): Promise<
    | { ok: true; grant: ContentEditLeaseGrant; view: ContentEditLeaseView }
    | { ok: false; reason: string }
    | null
  > {
    const roomClient = this.options.roomClient()
    if (!roomClient || !operationIsCurrent()) return null
    const key = { kind: 'macro' as const, itemId: record.id }
    try {
      const view = await roomClient.contentEditLeaseView(key)
      if (!operationIsCurrent()) return null
      if (view.mode !== 'available') return { ok: false, reason: 'content_edit_lease_held' }
      const acquired = await roomClient.acquireContentEditLease(key, view.leaseEpoch)
      if (!operationIsCurrent()) {
        await roomClient.releaseContentEditLease(acquired.grant.editLeaseId).catch(() => {})
        return null
      }
      return { ok: true, grant: acquired.grant, view: acquired.view }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }
}
