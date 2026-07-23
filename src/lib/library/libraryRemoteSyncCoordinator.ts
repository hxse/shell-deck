import { LibraryInvalidationQueue, type SequencedContentRecordChange } from './libraryInvalidationQueue'
import type { LibraryItem, LibraryItemFields, LibraryItemSummary } from './libraryTypes'

export type LibraryRefreshOutcome = 'applied' | 'stale' | 'retry'

export type LibraryListRefreshResult = {
  outcome: LibraryRefreshOutcome
  records?: LibraryItemSummary[]
}

type LibraryRemoteSyncSnapshot = {
  selectedItem: LibraryItem | null
  draft: LibraryItemFields | null
  draftRevision: number
  operationPending: boolean
  protectedBuffer: boolean
  publishedCreateBufferPreserved: boolean
}

type LibraryRemoteSyncCoordinatorOptions = {
  connectionGeneration(): number
  snapshot(): LibraryRemoteSyncSnapshot
  reloadList(report: boolean, announce: boolean): Promise<LibraryListRefreshResult>
  readItem(item: LibraryItem): Promise<LibraryItem>
  installItem(item: LibraryItem): void
  clearSelection(status: string): void
  setRemoteNotice(notice: string): void
  setErrorText(error: string): void
  reportError(error: unknown): void
}

export class LibraryRemoteSyncCoordinator {
  private readonly invalidations = new LibraryInvalidationQueue()
  private contentChangeProcessing = Promise.resolve()
  private selectedReadGeneration = 0
  private reconciledConnectionGeneration = 0
  private contentRetryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: LibraryRemoteSyncCoordinatorOptions) {}

  connectionChanged(generation: number): void {
    if (generation <= 0 || generation === this.reconciledConnectionGeneration) return
    this.reconciledConnectionGeneration = generation
    this.resetRetry()
    void this.refresh(false, generation)
    this.scheduleDrain()
  }

  observe(changes: SequencedContentRecordChange[]): void {
    if (!this.invalidations.observe(changes)) return
    this.resetRetry()
    this.scheduleDrain()
  }

  mount(): void {
    void this.refresh(true, this.options.connectionGeneration())
  }

  focus(): void {
    this.resetRetry()
    void this.refresh(false, this.options.connectionGeneration())
    this.scheduleDrain()
  }

  operationEnded(): void {
    this.scheduleDrain()
  }

  dispose(): void {
    if (this.contentRetryTimer) clearTimeout(this.contentRetryTimer)
    this.contentRetryTimer = null
  }

  async refresh(
    report = true,
    expectedConnectionGeneration = this.options.connectionGeneration(),
  ): Promise<LibraryRefreshOutcome> {
    const resolvesPublishedCreateBuffer = report && this.options.snapshot().publishedCreateBufferPreserved
    const refreshed = await this.options.reloadList(report, true)
    if (refreshed.outcome !== 'applied') {
      if (refreshed.outcome === 'retry' && !report) this.scheduleRetry()
      return refreshed.outcome
    }
    if (expectedConnectionGeneration > 0
      && expectedConnectionGeneration !== this.options.connectionGeneration()) return 'stale'
    const snapshot = this.options.snapshot()
    const current = snapshot.selectedItem
    if (!current) return 'applied'
    const summary = refreshed.records?.find((item) => item.kind === current.kind && item.itemId === current.itemId)
    if (snapshot.protectedBuffer && !resolvesPublishedCreateBuffer) {
      if (!summary) {
        this.options.setRemoteNotice('The selected item is no longer in the current saved result. The local draft was kept.')
      } else if (summary.revision > current.revision) {
        this.options.setRemoteNotice('This saved item changed elsewhere. The local draft was kept.')
      }
      return 'applied'
    }
    if (snapshot.operationPending) return 'stale'
    const readGeneration = ++this.selectedReadGeneration
    const capturedDraft = snapshot.draft
    const capturedDraftRevision = snapshot.draftRevision
    const capturedRevision = current.revision
    try {
      const next = await this.options.readItem(current)
      if (readGeneration !== this.selectedReadGeneration) return 'stale'
      if (expectedConnectionGeneration > 0
        && expectedConnectionGeneration !== this.options.connectionGeneration()) return 'stale'
      if (!resolvesPublishedCreateBuffer
        && !this.cleanReadonlySelectionMatches(current, capturedRevision, capturedDraft, capturedDraftRevision)) {
        return 'stale'
      }
      const live = this.options.snapshot()
      if (resolvesPublishedCreateBuffer
        && (!live.publishedCreateBufferPreserved
          || live.selectedItem?.kind !== current.kind
          || live.selectedItem.itemId !== current.itemId)) return 'stale'
      if (next.revision < Math.max(capturedRevision, summary?.revision ?? capturedRevision)) return 'stale'
      this.options.installItem(next)
      return 'applied'
    } catch (error) {
      if (readGeneration !== this.selectedReadGeneration) return 'stale'
      const live = this.options.snapshot()
      if ((resolvesPublishedCreateBuffer || !snapshot.protectedBuffer)
        && live.selectedItem?.kind === current.kind
        && live.selectedItem.itemId === current.itemId
        && requestStatus(error) === 404) {
        this.options.clearSelection('Item removed elsewhere')
        return 'applied'
      }
      if (report) this.options.reportError(error)
      else this.scheduleRetry()
      return 'retry'
    }
  }

  private scheduleDrain(): void {
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
      void this.refresh(false, this.options.connectionGeneration())
      this.scheduleDrain()
    }, delay)
  }

  private cleanReadonlySelectionMatches(
    item: LibraryItem,
    revision: number,
    capturedDraft: LibraryItemFields | null,
    capturedDraftRevision: number,
  ): boolean {
    const snapshot = this.options.snapshot()
    return snapshot.selectedItem?.kind === item.kind
      && snapshot.selectedItem.itemId === item.itemId
      && snapshot.selectedItem.revision === revision
      && snapshot.draft === capturedDraft
      && snapshot.draftRevision === capturedDraftRevision
      && !snapshot.operationPending
      && !snapshot.protectedBuffer
  }

  private async drainRecordChanges(): Promise<void> {
    while (!this.options.snapshot().operationPending) {
      const batch = this.invalidations.batch()
      if (batch.length === 0) return
      const consumed = await this.handleRemoteContent(batch)
      if (!consumed) {
        this.scheduleRetry()
        return
      }
      this.invalidations.consumeThrough(batch.at(-1)!.sequence)
      this.resetRetry()
    }
  }

  private async handleRemoteContent(changes: SequencedContentRecordChange[]): Promise<boolean> {
    if (this.options.snapshot().operationPending) return false
    const refreshed = await this.options.reloadList(false, false)
    const snapshot = this.options.snapshot()
    if (refreshed.outcome !== 'applied' || snapshot.operationPending) return false
    const current = snapshot.selectedItem
    if (!current) return true
    const decision = this.invalidations.classify(changes, current)
    if (decision.kind === 'unrelated' || decision.kind === 'own_ack') return true
    if (snapshot.protectedBuffer) {
      this.options.setRemoteNotice(decision.kind === 'deleted'
        ? 'This saved item was removed elsewhere. The local draft was kept.'
        : 'This saved item changed elsewhere. The local draft was kept.')
      return true
    }
    if (decision.kind === 'deleted') {
      this.options.clearSelection('Item removed elsewhere')
      return true
    }
    const expectedRevision = current.revision
    const capturedDraft = snapshot.draft
    const capturedDraftRevision = snapshot.draftRevision
    const requiredRevision = decision.revision ?? expectedRevision
    const readGeneration = ++this.selectedReadGeneration
    try {
      const item = await this.options.readItem(current)
      if (readGeneration !== this.selectedReadGeneration) return false
      if (!this.cleanReadonlySelectionMatches(
        current,
        expectedRevision,
        capturedDraft,
        capturedDraftRevision,
      )) return false
      if (item.revision < Math.max(expectedRevision, requiredRevision)) return false
      this.options.installItem(item)
    } catch (error) {
      if (readGeneration !== this.selectedReadGeneration) return false
      const live = this.options.snapshot()
      if (requestStatus(error) === 404
        && live.selectedItem?.kind === current.kind
        && live.selectedItem.itemId === current.itemId) {
        this.options.clearSelection('Item removed elsewhere')
        return true
      }
      if (live.selectedItem?.kind === current.kind && live.selectedItem.itemId === current.itemId) {
        this.options.setErrorText(messageOf(error))
      }
      return false
    }
    return true
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requestStatus(error: unknown): number | null {
  return error instanceof Error && 'status' in error
    && typeof (error as Error & { status?: unknown }).status === 'number'
    ? (error as Error & { status: number }).status
    : null
}
