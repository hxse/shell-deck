import type { ServerMessage } from './protocol'
import { sha256Text } from './textHash'
import { applyTextTerminalMutation } from './textTerminalMutation'
import type { TerminalRoomClient } from './terminalRoomClient'
import type { TerminalViewSnapshot } from './terminalViewState'

type TextProjectionOptions = {
  roomGeneration(): string
  client(): TerminalRoomClient | null
  terminal(terminalId: string): TerminalViewSnapshot | undefined
  install(terminal: TerminalViewSnapshot): void
  observeRoomRevision(revision: number): void
  notice(reason: string, prefix?: string): void
  hash?(content: string): Promise<string>
}

export class TextTerminalProjectionCoordinator {
  readonly #tails = new Map<string, Promise<void>>()
  readonly #repairPending = new Set<string>()
  readonly #repairAttempts = new Map<string, number>()
  readonly #repairLaunches = new Map<string, string>()
  readonly #projectionTokens = new Map<string, number>()
  readonly #hash: (content: string) => Promise<string>
  #nextProjectionTokenValue = 1

  constructor(private readonly options: TextProjectionOptions) {
    this.#hash = options.hash ?? sha256Text
  }

  applyMutation(message: Extract<ServerMessage, { type: 'terminal_text_mutation' }>): void {
    this.options.observeRoomRevision(message.roomRevision)
    const projectionToken = this.#projectionToken(message.terminalId)
    this.#queue(message.terminalId, async () => {
      if (message.roomGeneration !== this.options.roomGeneration()) return
      const terminal = this.options.terminal(message.terminalId)
      if (!terminal) { this.options.client()?.send({ type: 'request_snapshot' }); return }
      if (terminal.launchId !== message.launchId || terminal.backend !== 'text') return
      this.#bindRepairIdentity(message.terminalId, terminal.launchId)
      if (message.textRevision <= terminal.textRevision) return
      if (message.textRevision !== terminal.textRevision + 1) {
        this.#requestRepair(message.terminalId)
        return
      }
      let content: string
      try {
        content = applyTextTerminalMutation(terminal.replay.join(''), message.mutation)
      } catch {
        this.#requestRepair(message.terminalId)
        return
      }
      const resultHash = await this.#hash(content)
      const current = this.#currentTerminal(message.terminalId, message.roomGeneration, terminal, projectionToken)
      if (!current) return
      if (resultHash !== message.resultHash) {
        this.#requestRepair(message.terminalId)
        return
      }
      this.options.install({
        ...current,
        replay: [content],
        contentHash: message.resultHash,
        roomRevision: Math.max(current.roomRevision, message.roomRevision),
        terminalRevision: Math.max(current.terminalRevision, message.terminalRevision),
        textRevision: message.textRevision,
        outputActivityRevision: Math.max(current.outputActivityRevision, message.outputActivityRevision),
      })
      this.#repairAttempts.delete(message.terminalId)
    })
  }

  validateTerminal(terminalId: string): void {
    const projectionToken = this.#nextProjectionToken(terminalId)
    this.#queue(terminalId, async () => {
      const terminal = this.options.terminal(terminalId)
      if (!terminal || terminal.backend !== 'text') return
      const roomGeneration = this.options.roomGeneration()
      this.#bindRepairIdentity(terminalId, terminal.launchId)
      const contentHash = terminal.contentHash
      const verifiedHash = contentHash ? await this.#hash(terminal.replay.join('')) : null
      if (!this.#currentTerminal(terminalId, roomGeneration, terminal, projectionToken)) return
      if (!contentHash || verifiedHash !== contentHash) {
        this.#requestRepair(terminalId)
      }
    })
  }

  applySnapshot(message: Extract<ServerMessage, { type: 'terminal_text_snapshot' }>): void {
    this.options.observeRoomRevision(message.roomRevision)
    const projectionToken = this.#projectionToken(message.terminalId)
    this.#queue(message.terminalId, async () => {
      if (message.roomGeneration !== this.options.roomGeneration()) return
      const terminal = this.options.terminal(message.terminalId)
      if (!terminal || terminal.launchId !== message.launchId || terminal.backend !== 'text') {
        this.options.client()?.send({ type: 'request_snapshot' })
        return
      }
      this.#bindRepairIdentity(message.terminalId, terminal.launchId)
      const resultHash = await this.#hash(message.content)
      const current = this.#currentTerminal(message.terminalId, message.roomGeneration, terminal, projectionToken)
      if (!current) return
      this.#repairPending.delete(message.terminalId)
      if (resultHash !== message.resultHash) {
        this.options.notice('text_snapshot_hash_mismatch', message.terminalId + ': ')
        return
      }
      if (message.textRevision < current.textRevision) return
      this.options.install({
        ...current,
        replay: [message.content],
        contentHash: message.resultHash,
        roomRevision: Math.max(current.roomRevision, message.roomRevision),
        terminalRevision: Math.max(current.terminalRevision, message.terminalRevision),
        textRevision: message.textRevision,
        outputActivityRevision: Math.max(current.outputActivityRevision, message.outputActivityRevision),
        textRepairGeneration: current.textRepairGeneration + 1,
      })
    })
  }

  requestRepair(message: Extract<ServerMessage, { type: 'terminal_text_resync_required' }>): void {
    if (message.roomGeneration !== this.options.roomGeneration()) return
    const terminal = this.options.terminal(message.terminalId)
    if (!terminal || terminal.launchId !== message.launchId || terminal.backend !== 'text') return
    this.#bindRepairIdentity(message.terminalId, terminal.launchId)
    this.options.notice(message.reason, message.terminalId + ': ')
    this.#requestRepair(message.terminalId)
  }

  retain(terminalIds: ReadonlySet<string>): void {
    for (const terminalId of this.#tails.keys()) {
      if (!terminalIds.has(terminalId)) this.#tails.delete(terminalId)
    }
    for (const terminalId of this.#repairPending) {
      if (!terminalIds.has(terminalId)) this.#repairPending.delete(terminalId)
    }
    for (const terminalId of this.#repairAttempts.keys()) {
      if (!terminalIds.has(terminalId)) this.#repairAttempts.delete(terminalId)
    }
    for (const terminalId of this.#repairLaunches.keys()) {
      if (!terminalIds.has(terminalId)) this.#repairLaunches.delete(terminalId)
    }
    for (const terminalId of this.#projectionTokens.keys()) {
      if (!terminalIds.has(terminalId)) this.#projectionTokens.delete(terminalId)
    }
  }

  reset(): void {
    this.#tails.clear()
    this.#repairPending.clear()
    this.#repairAttempts.clear()
    this.#repairLaunches.clear()
    this.#projectionTokens.clear()
  }

  #requestRepair(terminalId: string): void {
    const terminal = this.options.terminal(terminalId)
    if (!terminal || terminal.backend !== 'text') return
    this.#bindRepairIdentity(terminalId, terminal.launchId)
    if (this.#repairPending.has(terminalId)) return
    const attempts = this.#repairAttempts.get(terminalId) ?? 0
    if (attempts >= 1) {
      this.options.notice('text_sync_repair_failed', terminalId + ': ')
      return
    }
    if (!this.options.client()?.send({ type: 'request_text_snapshot', terminalId })) return
    this.#repairAttempts.set(terminalId, attempts + 1)
    this.#repairPending.add(terminalId)
  }

  #bindRepairIdentity(terminalId: string, launchId: string): void {
    if (this.#repairLaunches.get(terminalId) === launchId) return
    this.#repairLaunches.set(terminalId, launchId)
    this.#repairPending.delete(terminalId)
    this.#repairAttempts.delete(terminalId)
  }

  #currentTerminal(
    terminalId: string,
    roomGeneration: string,
    captured: TerminalViewSnapshot,
    projectionToken: number,
  ): TerminalViewSnapshot | null {
    if (roomGeneration !== this.options.roomGeneration()) return null
    if (projectionToken !== this.#projectionToken(terminalId)) return null
    const current = this.options.terminal(terminalId)
    if (!current || current.backend !== 'text') return null
    if (current.launchId !== captured.launchId || current.textRevision !== captured.textRevision) return null
    return current
  }

  #projectionToken(terminalId: string): number {
    return this.#projectionTokens.get(terminalId) ?? 0
  }

  #nextProjectionToken(terminalId: string): number {
    const next = this.#nextProjectionTokenValue
    this.#nextProjectionTokenValue += 1
    this.#projectionTokens.set(terminalId, next)
    return next
  }

  #queue(terminalId: string, operation: () => Promise<void>): void {
    const previous = this.#tails.get(terminalId) ?? Promise.resolve()
    const next = previous.then(operation, operation).finally(() => {
      if (this.#tails.get(terminalId) === next) this.#tails.delete(terminalId)
    })
    this.#tails.set(terminalId, next)
  }
}
