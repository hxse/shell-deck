import type { ContentEditLeaseGrant, ContentEditLeaseView } from '../contentEditLease'
import { cloneJsonValue } from '../jsonClone'
import type { ContentEditLeaseChangedMessage } from '../protocol'
import type { TerminalRoomClient } from '../terminalRoomClient'
import { MacroDiagnosticsScheduler } from './macroDiagnosticsScheduler'
import {
  diagnoseTrustedMacroDefinitionV5,
  type MacroDefinitionDiagnostics,
} from './macroDefinitionValidation'
import { createMacroDraftMutationTracker } from './macroDraftMutation'
import type { MacroDefinitionV5, MacroRecord, MacroRecordSummary } from './macroDefinitionTypes'
import { MacroRecordEditOrchestrator, type MacroDefinitionOperationContext, type MacroEditCommitOutcome, type MacroStartRecordSnapshot } from './macroRecordEditOrchestrator'
import { formatMacroError, messageOf, type MacroJsonEditSession } from './macroJsonEditSession.svelte'
import type { SequencedContentRecordChange } from './macroInvalidationQueue'
import { type MacroNavigationCommitOutcome, type MacroOperationToken, MacroRecordNavigationCoordinator, type MacroTemplateRequestOutcome } from './macroRecordNavigationCoordinator'
import { type MacroPersistDefinitionOutcome, MacroRecordMutationWorkflow, type PersistedDefinition } from './macroRecordMutationWorkflow'
import { MacroRecordRemoteSyncCoordinator, type MacroTemplateRefreshResult } from './macroRecordRemoteSyncCoordinator'
import type { MacroRecordListResult } from './macroRecordClient'

export type { MacroOperationToken } from './macroRecordNavigationCoordinator'
export type { MacroStartRecordSnapshot } from './macroRecordEditOrchestrator'

type ContentEditLeaseChange = ContentEditLeaseChangedMessage & { sequence: number }

type MacroRecordSessionOptions = {
  roomClient(): TerminalRoomClient | null
  canMutateShared(): boolean
  connectionGeneration(): number
  contentRecordChanges(): SequencedContentRecordChange[]
  contentEditLeaseChanges(): ContentEditLeaseChange[]
  json: MacroJsonEditSession
  showEditor(): void
  showJson(): void
  onMutationDenied(reason: string): void
}

export function createMacroRecordSession(options: MacroRecordSessionOptions) {
  let templates = $state<MacroRecordSummary[]>([])
  let selectedRecord = $state<MacroRecord | null>(null)
  let baseDefinition = $state<MacroDefinitionV5 | null>(null)
  let draft = $state<MacroDefinitionV5 | null>(null)
  let draftRevision = $state(0)
  let editorGeneration = $state(0)
  let contentEditing = $state(false)
  let leaseLost = $state(false)
  let publishedCreateBufferPreserved = $state(false)
  let editLease = $state<ContentEditLeaseGrant | null>(null)
  let leaseView = $state<ContentEditLeaseView | null>(null)
  let dirty = $state(false)
  let operationGeneration = $state(0)
  let operationPending = $state(false)
  let errorText = $state<string | null>(null)
  let templateListProblem = $state<string | null>(null)
  let diagnostics = $state<MacroDefinitionDiagnostics>(diagnoseTrustedMacroDefinitionV5(null))
  let handledContentLeaseChangeSequence = 0
  const draftMutations = createMacroDraftMutationTracker()
  const diagnosticsScheduler = new MacroDiagnosticsScheduler(
    () => ({ definition: draft, revision: draftRevision }),
    (value) => { diagnostics = value },
  )
  const mutations = new MacroRecordMutationWorkflow({
    roomClient: options.roomClient, selectedRecord: () => selectedRecord,
    editLease: () => editLease, contentEditing: () => contentEditing,
  })
  const navigation = new MacroRecordNavigationCoordinator({
    mutations, canMutateShared: options.canMutateShared, roomClientPresent: () => options.roomClient() !== null,
    operationPending: () => operationPending, jsonEditing: () => options.json.editing, dirty: () => dirty,
    beginOperation, canCommit, endOperation, takeEditLease,
    commitRefresh, commitNavigation, rejectMutation, reportMutationError,
  })
  const edit = new MacroRecordEditOrchestrator({
    mutations, roomClient: options.roomClient, canMutateShared: options.canMutateShared,
    operationPending: () => operationPending, selectedRecord: () => selectedRecord, draft: () => draft,
    draftRevision: () => draftRevision, dirty: () => dirty, contentEditing: () => contentEditing,
    editLease: () => editLease, jsonEditing: () => options.json.editing,
    beginJsonCommit: () => options.json.beginCommit(), finishJsonCommit: (commit) => { options.json.finishCommit(commit) },
    setJsonError: (value) => { options.json.setError(value) }, openJsonBuffer,
    beginOperation, canCommit, definitionIsCurrent, endOperation, takeEditLease,
    commitEdit, acceptPersistOutcome, installPersisted, reconcilePublishedCreate, installTemplateList,
    refreshTemplates: (report) => navigation.refreshTemplates(report),
    rejectMutation, reportMutationError,
  })
  const remoteSync = new MacroRecordRemoteSyncCoordinator({
    connectionGeneration: options.connectionGeneration,
    snapshot: () => ({
      selectedRecord, editorGeneration, operationPending,
      protectedBuffer: dirty || contentEditing || options.json.editing || leaseLost || publishedCreateBufferPreserved,
    }),
    refreshTemplates: (report) => navigation.refreshTemplates(report), readRecord: (recordId) => mutations.read(recordId),
    installRecord: (record) => installRecord(record), setErrorText: (value) => { errorText = value },
  })

  $effect(() => {
    const changes = options.contentEditLeaseChanges()
      .filter((change) => change.sequence > handledContentLeaseChangeSequence)
    if (changes.length === 0) return
    handledContentLeaseChangeSequence = changes.at(-1)!.sequence
    const recordId = selectedRecord?.id
    const lease = editLease
    if (!recordId || !lease || !contentEditing) return
    const latest = changes
      .filter((change) => change.resourceKey.kind === 'macro' && change.resourceKey.itemId === recordId)
      .at(-1)
    if (!latest) return
    if (latest.view.mode === 'held' && latest.view.leaseEpoch === lease.leaseEpoch) {
      leaseView = latest.view
      return
    }
    markEditLeaseLost(latest.view, 'content_edit_lease_lost')
  })

  $effect(() => { remoteSync.connectionChanged(options.connectionGeneration()) })
  $effect(() => { remoteSync.observe(options.contentRecordChanges()) })
  $effect(() => {
    if (!options.canMutateShared() && selectedRecord && contentEditing && editLease) {
      markEditLeaseLost(null, 'room_control_lost')
    }
  })

  function mount(): () => void {
    remoteSync.mount()
    const focus = () => remoteSync.focus()
    window.addEventListener('focus', focus)
    return () => {
      window.removeEventListener('focus', focus)
      remoteSync.dispose()
      diagnosticsScheduler.dispose()
      void edit.releaseEditLease()
    }
  }

  function commitRefresh(outcome: MacroTemplateRequestOutcome, report: boolean): MacroTemplateRefreshResult {
    if (outcome.kind === 'stale') return { outcome: 'stale' }
    if (outcome.kind === 'retry') {
      templateListProblem = `Macro list unavailable: ${outcome.error}`
      if (report) errorText = outcome.error
      return { outcome: 'retry' }
    }
    installTemplateList(outcome.result)
    return { outcome: 'applied', records: outcome.result.templates }
  }

  function installTemplateList(result: MacroRecordListResult): void {
    templates = result.templates
    templateListProblem = result.invalidRecords.length === 0
      ? null
      : `Invalid Macro records ignored: ${result.invalidRecords.map((record) => `${record.recordId} (${record.error})`).join(', ')}`
  }

  function commitNavigation(outcome: MacroNavigationCommitOutcome, token: MacroOperationToken): boolean {
    if (!canCommit(token)) return false
    if (outcome.kind === 'select_record') installRecord(outcome.record)
    else if (outcome.kind === 'clear_selection') {
      selectedRecord = null; replaceBaseDefinition(null); draft = null
      dirty = false; contentEditing = false; leaseLost = false; publishedCreateBufferPreserved = false
      options.json.clearSelection()
      options.showEditor()
      advanceDraftRevision(true); editorGeneration += 1
      errorText = null
    } else {
      selectedRecord = null; replaceBaseDefinition(null)
      draft = emptyDefinition()
      contentEditing = true; leaseLost = false; publishedCreateBufferPreserved = false; dirty = true
      advanceDraftRevision(true); editorGeneration += 1
      errorText = null
      options.showEditor()
    }
    return true
  }

  function commitEdit(outcome: MacroEditCommitOutcome, token: MacroOperationToken): boolean {
    if (!canCommit(token)) return false
    if (outcome.kind === 'begin_edit') {
      editLease = outcome.acquired.grant; leaseView = outcome.acquired.view
      installRecord(outcome.acquired.record, true)
      if (outcome.enterJson) openJsonBuffer()
    } else if (outcome.kind === 'cancel_edit') {
      options.json.closeAfterRecordInstall()
      if (baseDefinition) {
        draft = cloneJsonValue(baseDefinition)
        draftMutations.replaceBase(baseDefinition)
      }
      else {
        selectedRecord = null
        draft = null
        options.showEditor()
        editorGeneration += 1
      }
      dirty = false; contentEditing = false; publishedCreateBufferPreserved = false; leaseLost = false
      advanceDraftRevision(true)
    } else {
      editLease = null; leaseView = null
      selectedRecord = null; replaceBaseDefinition(null); draft = null
      dirty = false; contentEditing = false; publishedCreateBufferPreserved = false; leaseLost = false
      editorGeneration += 1
    }
    return true
  }

  function acceptPersistOutcome(
    outcome: MacroPersistDefinitionOutcome, context: MacroDefinitionOperationContext,
  ): PersistedDefinition | null {
    if (outcome.kind === 'published_create') {
      reconcilePublishedCreate(outcome.record, context)
      return null
    }
    if (outcome.kind === 'discarded') return null
    editLease = outcome.value.editLease; leaseView = outcome.value.leaseView
    return outcome.value
  }

  function installPersisted(value: PersistedDefinition, context: MacroDefinitionOperationContext): boolean {
    if (!definitionIsCurrent(context)) {
      reconcilePublishedCreate(value.record, context)
      return false
    }
    installRecord(value.record, value.editing, value.preservePublishedCreateBuffer)
    if (value.leaseWarning) errorText = value.leaseWarning
    return true
  }

  function reconcilePublishedCreate(record: MacroRecord, context: MacroDefinitionOperationContext): boolean {
    const localIdentityMatches = operationGeneration === context.token.generation
      && selectedRecord === null
      && (context.source === 'json'
        ? options.json.revision === context.revision
        : draftRevision === context.revision)
    if (!localIdentityMatches || record.revision !== 1) return false
    editLease = null; leaseView = null
    installRecord(record, false, true)
    draft = cloneJsonValue(context.definition)
    replaceBaseDefinition(cloneJsonValue(record.definition))
    dirty = false
    diagnosticsScheduler.invalidate()
    diagnosticsScheduler.flush()
    errorText = 'macro_saved_but_edit_lease_not_retained:operation_context_changed'
    return true
  }

  function installRecord(record: MacroRecord, editing = false, preserveBuffer = false): void {
    selectedRecord = cloneJsonValue(record)
    replaceBaseDefinition(cloneJsonValue(record.definition))
    draft = cloneJsonValue(record.definition)
    dirty = false; contentEditing = editing; leaseLost = false
    publishedCreateBufferPreserved = preserveBuffer
    advanceDraftRevision(true); editorGeneration += 1
    options.json.closeAfterRecordInstall()
    errorText = null
  }

  function updateDraft(mutator: (definition: MacroDefinitionV5) => void): void {
    if (!options.canMutateShared()) {
      rejectMutation(options.roomClient() ? 'room_control_required' : 'room_disconnected')
      return
    }
    if (operationPending) { rejectMutation('operation_pending'); return }
    if (!draft) return
    if (selectedRecord !== null && !contentEditing) {
      rejectMutation(leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required')
      return
    }
    dirty = draftMutations.apply(draft, mutator)
    advanceDraftRevision(false)
  }

  function advanceDraftRevision(immediate: boolean): void {
    draftRevision += 1
    if (immediate) diagnosticsScheduler.flush()
    else diagnosticsScheduler.schedule()
  }

  function replaceBaseDefinition(definition: MacroDefinitionV5 | null): void {
    baseDefinition = definition
    draftMutations.replaceBase(definition)
  }

  function captureStartRecordSnapshot(): MacroStartRecordSnapshot | null {
    return draft
      ? {
          definition: cloneJsonValue(draft), draftRevision, dirty,
          record: selectedRecord ? cloneJsonValue(selectedRecord) : null,
        }
      : null
  }

  function openJsonBuffer(): void {
    if (!draft) return
    options.json.open(draft)
    options.showJson()
  }

  function takeEditLease(): ContentEditLeaseGrant | null {
    const lease = editLease
    editLease = null; leaseView = null; leaseLost = false
    return lease
  }

  function markEditLeaseLost(view: ContentEditLeaseView | null, reason: string): void {
    editLease = null; leaseView = view; contentEditing = false; leaseLost = true
    errorText = reason
    options.onMutationDenied(reason)
  }

  function beginOperation(): MacroOperationToken {
    operationGeneration += 1
    operationPending = true
    errorText = null
    return {
      generation: operationGeneration, controlEpoch: options.roomClient()?.controlGrant?.controlEpoch ?? null,
      recordId: selectedRecord?.id ?? null, recordRevision: selectedRecord?.revision ?? null,
      draftRevision, jsonRevision: options.json.revision,
      editLeaseId: editLease?.editLeaseId ?? null,
    }
  }

  function endOperation(token: MacroOperationToken): void {
    if (operationGeneration !== token.generation) return
    operationPending = false
    remoteSync.operationEnded()
  }

  function canCommit(token: MacroOperationToken): boolean {
    return operationGeneration === token.generation
      && (token.controlEpoch === null
        || options.roomClient()?.controlGrant?.controlEpoch === token.controlEpoch)
  }

  function definitionIsCurrent(context: MacroDefinitionOperationContext): boolean {
    return canCommit(context.token)
      && (context.source === 'json'
        ? options.json.revision === context.revision
        : draftRevision === context.revision)
  }

  function rejectMutation(reason: string): void {
    errorText = reason
    options.onMutationDenied(reason)
  }

  function reportMutationError(error: unknown, formatted = false): void {
    const reason = messageOf(error)
    errorText = formatted ? formatMacroError(error) : reason
    options.onMutationDenied(reason)
  }

  function emptyDefinition(): MacroDefinitionV5 {
    return { schemaVersion: 5, name: 'New Macro', description: '', terminalLayout: [], body: [] }
  }

  return {
    get templates() { return templates }, get selectedRecord() { return selectedRecord },
    get draft() { return draft }, get draftRevision() { return draftRevision },
    get editorGeneration() { return editorGeneration }, get contentEditing() { return contentEditing },
    get leaseLost() { return leaseLost }, get publishedCreateBufferPreserved() { return publishedCreateBufferPreserved },
    get editLease() { return editLease },
    get dirty() { return dirty },
    get diagnostics() { return diagnostics },
    get operationPending() { return operationPending },
    get errorText() { return errorText },
    get templateListProblem() { return templateListProblem },
    mount,
    selectTemplate: (id: string) => navigation.selectTemplate(id),
    createTemplate: () => navigation.createTemplate(),
    beginEdit: (enterJson = false) => edit.beginEdit(enterJson),
    cancelEdit: () => edit.cancelEdit(),
    saveTemplate: () => { diagnosticsScheduler.flush(); return edit.saveTemplate() },
    deleteTemplate: () => edit.deleteTemplate(),
    updateDraft,
    startJsonBuffer: () => { diagnosticsScheduler.flush(); return edit.startJsonBuffer() },
    saveJson: () => edit.saveJson(),
    captureStartRecordSnapshot,
    flushDiagnostics: () => diagnosticsScheduler.flush(),
    resolveStartRecord: (token: MacroOperationToken, snapshot: MacroStartRecordSnapshot) => edit.resolveStartRecord(token, snapshot),
    beginOperation,
    endOperation,
    canCommit,
    rejectMutation,
    reportMutationError,
    setErrorText: (value: string | null) => { errorText = value },
  }
}

export type MacroRecordSession = ReturnType<typeof createMacroRecordSession>
