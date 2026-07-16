import type { ServerMessage, TerminalBackendKind, TerminalRevisionFields, TerminalRuntimePosition, TerminalSnapshot } from './protocol'

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
  renderRevision: number
  serverRevision: number
  tail: ReplayTail
}

export type TerminalRevisionStamp = TerminalRevisionFields & { launchId: string }

export class TerminalViewStateStore {
  readonly #entries = new Map<string, TerminalViewEntry>()

  clear(): void {
    this.#entries.clear()
  }

  mergeRoom(snapshots: TerminalSnapshot[], current: TerminalViewSnapshot[]): TerminalViewSnapshot[] {
    const terminalIds = new Set(snapshots.map((snapshot) => snapshot.terminalId))
    for (const terminalId of this.#entries.keys()) {
      if (!terminalIds.has(terminalId)) this.#entries.delete(terminalId)
    }
    const currentById = new Map(current.map((terminal) => [terminal.terminalId, terminal]))
    return snapshots.map((snapshot) => this.mergeSnapshot(snapshot, currentById.get(snapshot.terminalId)))
  }

  mergeSnapshot(snapshot: TerminalSnapshot, current?: TerminalViewSnapshot): TerminalViewSnapshot {
    const entry = this.#entries.get(snapshot.terminalId)
    if (current && entry && entry.launchId === snapshot.launchId && snapshot.terminalRevision < entry.serverRevision) return current
    if (current && entry && entry.launchId !== snapshot.launchId && snapshot.roomRevision <= current.roomRevision) return current
    if (current && entry && entry.backend === snapshot.backend && entry.launchId === snapshot.launchId && entry.tail.matches(snapshot.replay)) {
      entry.serverRevision = snapshot.terminalRevision
      return {
        ...snapshot,
        replay: entry.tail.snapshot(),
        renderUpdate: current.renderUpdate,
      }
    }
    return this.#replaceSnapshot(snapshot, entry?.renderRevision ?? 0)
  }

  append(current: TerminalViewSnapshot, data: string, stamp: TerminalRevisionStamp): TerminalViewSnapshot {
    if (stamp.launchId !== current.launchId || stamp.terminalRevision <= current.terminalRevision) return current
    let entry = this.#entries.get(current.terminalId)
    if (!entry || entry.backend !== current.backend || entry.launchId !== current.launchId) {
      entry = {
        backend: current.backend,
        launchId: current.launchId,
        renderRevision: current.renderUpdate.revision,
        serverRevision: current.terminalRevision,
        tail: ReplayTail.from(current.replay, browserReplayCodeUnitLimit(current.backend)),
      }
      this.#entries.set(current.terminalId, entry)
    }
    entry.tail.append(data)
    entry.renderRevision += 1
    entry.serverRevision = stamp.terminalRevision
    return {
      ...current,
      ...stamp,
      replay: entry.tail.snapshot(),
      renderUpdate: { revision: entry.renderRevision, kind: 'append', data },
    }
  }

  replaceReplay(current: TerminalViewSnapshot, replay: string[], stamp: TerminalRevisionStamp): TerminalViewSnapshot {
    if (stamp.launchId !== current.launchId || stamp.terminalRevision < current.terminalRevision) return current
    return this.#replaceSnapshot({ ...current, ...stamp, replay }, current.renderUpdate.revision)
  }

  patch(
    current: TerminalViewSnapshot,
    stamp: TerminalRevisionStamp,
    values: Partial<Pick<TerminalSnapshot, 'status' | 'cols' | 'rows' | 'exitCode' | 'signal' | 'cwd'>>,
  ): TerminalViewSnapshot {
    if (stamp.launchId !== current.launchId || stamp.terminalRevision <= current.terminalRevision) return current
    const entry = this.#entries.get(current.terminalId)
    if (entry && entry.launchId === current.launchId) entry.serverRevision = stamp.terminalRevision
    return { ...current, ...stamp, ...values }
  }

  #replaceSnapshot(snapshot: TerminalSnapshot, previousRevision: number): TerminalViewSnapshot {
    const tail = ReplayTail.from(snapshot.replay, browserReplayCodeUnitLimit(snapshot.backend))
    const revision = previousRevision + 1
    this.#entries.set(snapshot.terminalId, {
      backend: snapshot.backend,
      launchId: snapshot.launchId,
      renderRevision: revision,
      serverRevision: snapshot.terminalRevision,
      tail,
    })
    return {
      ...snapshot,
      replay: tail.snapshot(),
      renderUpdate: { revision, kind: 'replace', data: tail.text() },
    }
  }
}

export function applyTerminalStateProjection(
  store: TerminalViewStateStore,
  terminals: TerminalViewSnapshot[],
  positions: TerminalRuntimePosition[] | null,
  message: Extract<ServerMessage, { type: 'terminal_state' }>,
): { terminals: TerminalViewSnapshot[]; positions: TerminalRuntimePosition[] | null; accepted: boolean } {
  let accepted = false
  const nextTerminals = terminals.map((terminal) => {
    if (terminal.terminalId !== message.terminalId) return terminal
    const next = store.patch(terminal, message, {
      status: message.status,
      cols: message.cols,
      rows: message.rows,
      exitCode: message.exitCode,
      signal: message.signal,
    })
    if (next !== terminal) accepted = true
    return next
  })
  if (!accepted) return { terminals: nextTerminals, positions, accepted: false }
  const readiness = message.status === 'running' ? 'ready' : message.status === 'closed' ? 'exited' : message.status
  return {
    terminals: nextTerminals,
    positions: positions?.map((position) => position.terminalId === message.terminalId ? { ...position, readiness } : position) ?? null,
    accepted: true,
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
