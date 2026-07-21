import type { ContentRecordChangedMessage } from '../protocol'
import type { LibraryItem } from './libraryTypes'

export type SequencedContentRecordChange = ContentRecordChangedMessage & { sequence: number }

export type LibraryInvalidationDecision =
  | { kind: 'unrelated' }
  | { kind: 'own_ack'; revision: number }
  | { kind: 'higher_revision'; revision: number | null }
  | { kind: 'deleted' }

const RETRY_DELAYS_MS = [100, 300, 800] as const

export class LibraryInvalidationQueue {
  #observedSequence = 0
  #pending: SequencedContentRecordChange[] = []
  #retryAttempt = 0

  observe(changes: SequencedContentRecordChange[]): boolean {
    const next = changes.filter((change) => change.sequence > this.#observedSequence)
    if (next.length === 0) return false
    this.#observedSequence = next.at(-1)!.sequence
    const libraryChanges = next.filter((change) => change.resourceKey.kind === 'library')
    this.#pending.push(...libraryChanges)
    return libraryChanges.length > 0
  }

  batch(): SequencedContentRecordChange[] {
    return this.#pending.slice()
  }

  consumeThrough(sequence: number): void {
    this.#pending = this.#pending.filter((change) => change.sequence > sequence)
  }

  classify(changes: SequencedContentRecordChange[], item: LibraryItem): LibraryInvalidationDecision {
    const change = changes.filter((candidate) => candidate.resourceKey.kind === 'library'
      && candidate.resourceKey.itemKind === item.kind
      && candidate.resourceKey.itemId === item.itemId).at(-1)
    if (!change) return { kind: 'unrelated' }
    if (change.operation === 'deleted') return { kind: 'deleted' }
    if (change.revision !== null && change.revision <= item.revision) {
      return { kind: 'own_ack', revision: change.revision }
    }
    return { kind: 'higher_revision', revision: change.revision }
  }

  resetRetry(): void {
    this.#retryAttempt = 0
  }

  nextRetryDelay(): number | null {
    const delay = RETRY_DELAYS_MS[this.#retryAttempt]
    if (delay === undefined) return null
    this.#retryAttempt += 1
    return delay
  }
}
