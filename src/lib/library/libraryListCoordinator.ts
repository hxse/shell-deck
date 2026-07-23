import type { LibraryMutationWorkflow } from './libraryMutationWorkflow'
import type { LibraryListRefreshResult } from './libraryRemoteSyncCoordinator'
import type { LibraryItemKind, LibraryItemListResult } from './libraryTypes'

export type LibraryTab = 'json-template' | 'prompt' | 'note'

export type LibraryListRequestOutcome =
  | { kind: 'applied'; result: LibraryItemListResult }
  | { kind: 'stale' }
  | { kind: 'retry'; error: unknown }

type LibraryListCoordinatorOptions = {
  mutations: LibraryMutationWorkflow
  kind(): LibraryItemKind
  searchText(): string
  commitSearch(value: string): void
  commitList(
    outcome: LibraryListRequestOutcome,
    report: boolean,
    announce: boolean,
  ): LibraryListRefreshResult
}

export class LibraryListCoordinator {
  readonly #options: LibraryListCoordinatorOptions
  #generation = 0
  #searchTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: LibraryListCoordinatorOptions) {
    this.#options = options
  }

  updateSearch(value: string): void {
    this.#options.commitSearch(value)
    this.cancelScheduledSearch()
    this.#searchTimer = setTimeout(() => {
      this.#searchTimer = null
      void this.reload(false)
    }, 180)
  }

  cancelScheduledSearch(): void {
    if (this.#searchTimer) clearTimeout(this.#searchTimer)
    this.#searchTimer = null
  }

  dispose(): void {
    this.cancelScheduledSearch()
  }

  async reload(report: boolean, announce = true): Promise<LibraryListRefreshResult> {
    const generation = ++this.#generation
    const requestKind = this.#options.kind()
    const requestQuery = this.#options.searchText()
    try {
      const result = await this.#options.mutations.list(requestKind, requestQuery)
      return this.#options.commitList(
        generation === this.#generation
          && requestKind === this.#options.kind()
          && requestQuery === this.#options.searchText()
          ? { kind: 'applied', result }
          : { kind: 'stale' },
        report,
        announce,
      )
    } catch (error) {
      return this.#options.commitList(
        generation === this.#generation
          && requestKind === this.#options.kind()
          && requestQuery === this.#options.searchText()
          ? { kind: 'retry', error }
          : { kind: 'stale' },
        report,
        announce,
      )
    }
  }
}

export function libraryTabKind(tab: LibraryTab): LibraryItemKind {
  return tab === 'json-template' ? 'macro-template' : tab
}

export function libraryKindTab(value: LibraryItemKind): LibraryTab {
  return value === 'macro-template' ? 'json-template' : value
}

export function libraryKindLabel(value: LibraryItemKind): string {
  return value === 'macro-template' ? 'Macro JSON' : value === 'prompt' ? 'Prompt' : 'Note'
}
