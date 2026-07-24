import type { ContentEditLeaseGrant } from '../contentEditLease'
import type { MacroRecord } from './macroDefinitionTypes'
import type { MacroRecordMutationWorkflow } from './macroRecordMutationWorkflow'
import type { MacroTemplateRefreshResult } from './macroRecordRemoteSyncCoordinator'
import { messageOf } from './macroJsonEditSession.svelte'
import type { MacroRecordListResult } from './macroRecordClient'

export type MacroOperationToken = {
  generation: number
  controlEpoch: number | null
  recordId: string | null
  recordRevision: number | null
  draftRevision: number
  jsonRevision: number
  editLeaseId: string | null
}

export type MacroTemplateRequestOutcome =
  | { kind: 'applied'; result: MacroRecordListResult }
  | { kind: 'stale' }
  | { kind: 'retry'; error: string }

export type MacroNavigationCommitOutcome =
  | { kind: 'clear_selection' }
  | { kind: 'select_record'; record: MacroRecord }
  | { kind: 'new_draft' }

type MacroRecordNavigationOptions = {
  mutations: MacroRecordMutationWorkflow
  canMutateShared(): boolean
  roomClientPresent(): boolean
  operationPending(): boolean
  jsonEditing(): boolean
  dirty(): boolean
  beginOperation(): MacroOperationToken
  canCommit(token: MacroOperationToken): boolean
  endOperation(token: MacroOperationToken): void
  takeEditLease(): ContentEditLeaseGrant | null
  commitRefresh(outcome: MacroTemplateRequestOutcome, report: boolean): MacroTemplateRefreshResult
  commitNavigation(outcome: MacroNavigationCommitOutcome, token: MacroOperationToken): boolean
  rejectMutation(reason: string): void
  reportMutationError(error: unknown): void
}

export class MacroRecordNavigationCoordinator {
  readonly #options: MacroRecordNavigationOptions
  #templateListGeneration = 0

  constructor(options: MacroRecordNavigationOptions) {
    this.#options = options
  }

  async refreshTemplates(report = true): Promise<MacroTemplateRefreshResult> {
    return this.#options.commitRefresh(await this.#requestTemplates(), report)
  }

  async selectTemplate(id: string): Promise<boolean> {
    const options = this.#options
    if (options.operationPending() || options.jsonEditing()) return false
    if (options.dirty() && !confirm('Discard unsaved macro changes?')) return false
    const token = options.beginOperation()
    try {
      await options.mutations.releaseEditLease(options.takeEditLease())
      const outcome: MacroNavigationCommitOutcome = id
        ? { kind: 'select_record', record: await options.mutations.read(id) }
        : { kind: 'clear_selection' }
      return options.commitNavigation(outcome, token)
    } catch (error) {
      if (options.canCommit(token)) options.reportMutationError(error)
      return false
    } finally {
      options.endOperation(token)
    }
  }

  async createTemplate(): Promise<void> {
    const options = this.#options
    if (!options.canMutateShared()) {
      options.rejectMutation(options.roomClientPresent() ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (options.operationPending()) {
      options.rejectMutation('operation_pending')
      return
    }
    if (options.jsonEditing()) return
    if (options.dirty() && !confirm('Discard unsaved macro changes?')) return
    const token = options.beginOperation()
    try {
      await options.mutations.releaseEditLease(options.takeEditLease())
      options.commitNavigation({ kind: 'new_draft' }, token)
    } catch (error) {
      if (options.canCommit(token)) options.reportMutationError(error)
    } finally {
      options.endOperation(token)
    }
  }

  async #requestTemplates(): Promise<MacroTemplateRequestOutcome> {
    const generation = ++this.#templateListGeneration
    try {
      const result = await this.#options.mutations.list()
      return generation === this.#templateListGeneration
        ? { kind: 'applied', result }
        : { kind: 'stale' }
    } catch (error) {
      return generation === this.#templateListGeneration
        ? { kind: 'retry', error: messageOf(error) }
        : { kind: 'stale' }
    }
  }
}
