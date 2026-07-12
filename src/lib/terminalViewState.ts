import type { TerminalBackendKind, TerminalSnapshot } from './protocol'

export const BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT = 2 * 1024 * 1024

const REPLAY_TAIL_COMPACT_CHUNKS = 64

export type TerminalRenderUpdate = {
  revision: number
  kind: 'append' | 'replace'
  data: string
}

export type TerminalViewSnapshot = TerminalSnapshot & {
  renderUpdate: TerminalRenderUpdate
}

type TerminalViewEntry = {
  backend: TerminalBackendKind
  launchId: string
  revision: number
  tail: ReplayTail
}

export class TerminalViewStateStore {
  readonly #entries = new Map<string, TerminalViewEntry>()

  clear(): void {
    this.#entries.clear()
  }

  mergeDeck(snapshots: TerminalSnapshot[], current: TerminalViewSnapshot[]): TerminalViewSnapshot[] {
    const terminalIds = new Set(snapshots.map((snapshot) => snapshot.terminalId))
    for (const terminalId of this.#entries.keys()) {
      if (!terminalIds.has(terminalId)) this.#entries.delete(terminalId)
    }
    const currentById = new Map(current.map((terminal) => [terminal.terminalId, terminal]))
    return snapshots.map((snapshot) => this.mergeSnapshot(snapshot, currentById.get(snapshot.terminalId)))
  }

  mergeSnapshot(snapshot: TerminalSnapshot, current?: TerminalViewSnapshot): TerminalViewSnapshot {
    const entry = this.#entries.get(snapshot.terminalId)
    if (current && entry && entry.backend === snapshot.backend && entry.launchId === snapshot.launchId && entry.tail.matches(snapshot.replay)) {
      return {
        ...snapshot,
        replay: entry.tail.snapshot(),
        renderUpdate: current.renderUpdate,
      }
    }
    return this.#replaceSnapshot(snapshot, entry?.revision ?? 0)
  }

  append(current: TerminalViewSnapshot, data: string): TerminalViewSnapshot {
    let entry = this.#entries.get(current.terminalId)
    if (!entry || entry.backend !== current.backend || entry.launchId !== current.launchId) {
      entry = {
        backend: current.backend,
        launchId: current.launchId,
        revision: current.renderUpdate.revision,
        tail: ReplayTail.from(current.replay, browserReplayCodeUnitLimit(current.backend)),
      }
      this.#entries.set(current.terminalId, entry)
    }
    entry.tail.append(data)
    entry.revision += 1
    return {
      ...current,
      replay: entry.tail.snapshot(),
      renderUpdate: { revision: entry.revision, kind: 'append', data },
    }
  }

  replaceReplay(current: TerminalViewSnapshot, replay: string[]): TerminalViewSnapshot {
    return this.#replaceSnapshot({ ...current, replay }, current.renderUpdate.revision)
  }

  #replaceSnapshot(snapshot: TerminalSnapshot, previousRevision: number): TerminalViewSnapshot {
    const tail = ReplayTail.from(snapshot.replay, browserReplayCodeUnitLimit(snapshot.backend))
    const revision = previousRevision + 1
    this.#entries.set(snapshot.terminalId, { backend: snapshot.backend, launchId: snapshot.launchId, revision, tail })
    return {
      ...snapshot,
      replay: tail.snapshot(),
      renderUpdate: { revision, kind: 'replace', data: tail.text() },
    }
  }
}

class ReplayTail {
  readonly #limit: number | null
  #chunks: string[] = []
  #length = 0

  private constructor(limit: number | null) {
    this.#limit = limit
  }

  static from(chunks: string[], limit: number | null): ReplayTail {
    const tail = new ReplayTail(limit)
    for (const chunk of chunks) tail.append(chunk)
    return tail
  }

  append(data: string): void {
    if (data.length === 0) return
    if (this.#limit === null) {
      this.#chunks.push(data)
      this.#length += data.length
      return
    }
    if (data.length >= this.#limit) {
      const retained = utf16Suffix(data, this.#limit)
      this.#chunks = retained.length > 0 ? [retained] : []
      this.#length = retained.length
      return
    }

    this.#chunks.push(data)
    this.#length += data.length
    this.#trim()
    if (this.#chunks.length > REPLAY_TAIL_COMPACT_CHUNKS) {
      this.#chunks = [this.#chunks.join('')]
    }
  }

  snapshot(): string[] {
    return [...this.#chunks]
  }

  text(): string {
    return this.#chunks.join('')
  }

  matches(chunks: string[]): boolean {
    const incoming = chunks.join('')
    const current = this.text()
    return incoming === current
  }

  #trim(): void {
    if (this.#limit === null || this.#length <= this.#limit) return
    let excess = this.#length - this.#limit
    while (this.#chunks.length > 0 && excess >= this.#chunks[0].length) {
      const removed = this.#chunks.shift()!
      excess -= removed.length
      this.#length -= removed.length
    }
    if (excess <= 0 || this.#chunks.length === 0) return
    const first = this.#chunks[0]
    const retained = utf16Suffix(first, first.length - excess)
    this.#chunks[0] = retained
    this.#length -= first.length - retained.length
  }
}

function browserReplayCodeUnitLimit(backend: TerminalBackendKind): number | null {
  return backend === 'text' ? null : BROWSER_TERMINAL_REPLAY_CODE_UNIT_LIMIT
}

function utf16Suffix(value: string, maxCodeUnits: number): string {
  if (maxCodeUnits <= 0) return ''
  if (value.length <= maxCodeUnits) return value
  let start = value.length - maxCodeUnits
  const current = value.charCodeAt(start)
  const previous = value.charCodeAt(start - 1)
  if (isLowSurrogate(current) && isHighSurrogate(previous)) start += 1
  return value.slice(start)
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xD800 && value <= 0xDBFF
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xDC00 && value <= 0xDFFF
}
