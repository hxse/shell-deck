import type { MacroRecord, MacroRecordSummary } from './macroDefinitionTypes'
import { MacroInvalidationQueue, type SequencedContentRecordChange } from './macroInvalidationQueue'
import { messageOf } from './macroJsonEditSession.svelte'

export type MacroTemplateRefreshResult = {
  outcome: 'applied' | 'stale' | 'retry'
  records?: MacroRecordSummary[]
}

type MacroRemoteSyncSnapshot = {
  selectedRecord: MacroRecord | null
  editorGeneration: number
  operationPending: boolean
  protectedBuffer: boolean
}

type MacroRecordRemoteSyncCoordinatorOptions = {
  connectionGeneration(): number
  snapshot(): MacroRemoteSyncSnapshot
  refreshTemplates(report: boolean): Promise<MacroTemplateRefreshResult>
  readRecord(recordId: string): Promise<MacroRecord>
  installRecord(record: MacroRecord): void
  setErrorText(value: string): void
}

export class MacroRecordRemoteSyncCoordinator {
  private readonly invalidations = new MacroInvalidationQueue()
  private contentChangeProcessing = Promise.resolve()
  private templateReadGeneration = 0
  private reconciledConnectionGeneration = 0
  private contentRetryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: MacroRecordRemoteSyncCoordinatorOptions) {}

  connectionChanged(generation: number): void {
    if (generation <= 0 || generation === this.reconciledConnectionGeneration) return
    this.reconciledConnectionGeneration = generation
    this.resetRetry()
    void this.reconcileSavedContentTruth(generation, false)
    this.scheduleRecordChangeDrain()
  }

  observe(changes: SequencedContentRecordChange[]): void {
    if (!this.invalidations.observe(changes)) return
    this.resetRetry()
    this.scheduleRecordChangeDrain()
  }

  mount(): void {
    void this.reconcileSavedContentTruth(this.options.connectionGeneration(), true)
  }

  focus(): void {
    this.resetRetry()
    void this.reconcileSavedContentTruth(this.options.connectionGeneration(), false)
    this.scheduleRecordChangeDrain()
  }

  operationEnded(): void {
    this.scheduleRecordChangeDrain()
  }

  dispose(): void {
    if (this.contentRetryTimer) clearTimeout(this.contentRetryTimer)
    this.contentRetryTimer = null
  }

  private scheduleRecordChangeDrain(): void {
    this.contentChangeProcessing = this.contentChangeProcessing
      .then(async () => { await this.drainRecordChanges() })
      .catch((error) => { this.options.setErrorText(messageOf(error)) })
  }

  private resetRetry(): void {
    this.invalidations.resetRetry()
    if (this.contentRetryTimer) clearTimeout(this.contentRetryTimer)
    this.contentRetryTimer = null
  }

  private scheduleRetry(): void {
    if (this.contentRetryTimer) return
    const delay = this.invalidations.nextRetryDelay()
    if (delay === null) return
    this.contentRetryTimer = setTimeout(() => {
      this.contentRetryTimer = null
      void this.reconcileSavedContentTruth(this.options.connectionGeneration(), false)
      this.scheduleRecordChangeDrain()
    }, delay)
  }

  private cleanReadonlySelectionMatches(id: string, revision: number, generation: number): boolean {
    const snapshot = this.options.snapshot()
    return snapshot.selectedRecord?.id === id
      && snapshot.selectedRecord.revision === revision
      && snapshot.editorGeneration === generation
      && !snapshot.operationPending
      && !snapshot.protectedBuffer
  }

  private async reconcileSavedContentTruth(expectedConnectionGeneration: number, report: boolean): Promise<void> {
    const refreshed = await this.options.refreshTemplates(report)
    if (refreshed.outcome !== 'applied') {
      if (refreshed.outcome === 'retry') this.scheduleRetry()
      return
    }
    if (expectedConnectionGeneration > 0 && expectedConnectionGeneration !== this.options.connectionGeneration()) return
    const current = this.options.snapshot().selectedRecord
    if (!current) return
    const summary = refreshed.records?.find((candidate) => candidate.id === current.id)
    if (!summary) {
      this.options.setErrorText('macro_record_deleted_elsewhere')
      return
    }
    if (summary.revision <= current.revision) return
    const snapshot = this.options.snapshot()
    if (snapshot.operationPending || snapshot.protectedBuffer) {
      this.options.setErrorText('macro_record_changed_elsewhere')
      return
    }
    const readGeneration = ++this.templateReadGeneration
    const capturedEditorGeneration = snapshot.editorGeneration
    try {
      const record = await this.options.readRecord(current.id)
      if (readGeneration !== this.templateReadGeneration) return
      if (expectedConnectionGeneration > 0 && expectedConnectionGeneration !== this.options.connectionGeneration()) return
      if (!this.cleanReadonlySelectionMatches(current.id, current.revision, capturedEditorGeneration)) return
      if (record.revision < Math.max(current.revision, summary.revision)) {
        this.scheduleRetry()
        return
      }
      this.options.installRecord(record)
    } catch (error) {
      if (readGeneration !== this.templateReadGeneration) return
      if (isNotFoundError(error) && this.options.snapshot().selectedRecord?.id === current.id) {
        this.options.setErrorText('macro_record_deleted_elsewhere')
      } else {
        if (report) this.options.setErrorText(messageOf(error))
        this.scheduleRetry()
      }
    }
  }

  private async drainRecordChanges(): Promise<void> {
    while (!this.options.snapshot().operationPending) {
      const batch = this.invalidations.batch()
      if (batch.length === 0) return
      const consumed = await this.handleRecordChanges(batch)
      if (!consumed) {
        this.scheduleRetry()
        return
      }
      this.invalidations.consumeThrough(batch.at(-1)!.sequence)
      this.resetRetry()
    }
  }

  private async handleRecordChanges(changes: SequencedContentRecordChange[]): Promise<boolean> {
    if (this.options.snapshot().operationPending) return false
    const refreshed = await this.options.refreshTemplates(false)
    const snapshotAfterRefresh = this.options.snapshot()
    if (refreshed.outcome !== 'applied' || snapshotAfterRefresh.operationPending) return false
    const selectedRecord = snapshotAfterRefresh.selectedRecord
    if (!selectedRecord) return true
    const decision = this.invalidations.classify(changes, selectedRecord.id, selectedRecord.revision)
    if (decision.kind === 'unrelated' || decision.kind === 'own_ack') return true
    if (decision.kind === 'deleted') {
      this.options.setErrorText('macro_record_deleted_elsewhere')
      return true
    }
    if (snapshotAfterRefresh.protectedBuffer) {
      this.options.setErrorText('macro_record_changed_elsewhere')
      return true
    }
    const expectedId = selectedRecord.id
    const expectedRevision = selectedRecord.revision
    const capturedEditorGeneration = snapshotAfterRefresh.editorGeneration
    const requiredRevision = decision.revision ?? expectedRevision
    const readGeneration = ++this.templateReadGeneration
    try {
      const record = await this.options.readRecord(expectedId)
      if (readGeneration !== this.templateReadGeneration) return false
      if (!this.cleanReadonlySelectionMatches(expectedId, expectedRevision, capturedEditorGeneration)) return false
      if (record.revision < Math.max(expectedRevision, requiredRevision)) return false
      this.options.installRecord(record)
    } catch (error) {
      if (readGeneration !== this.templateReadGeneration) return false
      if (isNotFoundError(error) && this.options.snapshot().selectedRecord?.id === expectedId) {
        this.options.setErrorText('macro_record_deleted_elsewhere')
        return true
      }
      if (this.options.snapshot().selectedRecord?.id === expectedId) this.options.setErrorText(messageOf(error))
      return false
    }
    return true
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error
    && (error.message.startsWith('macro_record_not_found:') || ('status' in error && error.status === 404))
}
