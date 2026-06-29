import { assertValidPublicId } from '../src/lib/identifier'
import type { DeckSnapshot, ServerMessage, TerminalBackendKind, TerminalSnapshot } from '../src/lib/protocol'
import { createTerminalId, createTerminalLaunchId, normalizeTerminalRef, type TerminalRef } from '../src/lib/terminalIdentity'
import { ConfigStore } from './configStore'
import { FakeTerminalBackend } from './fakeTerminalBackend'
import { RealPtyBackend } from './realPtyBackend'
import type { TerminalBackend, TerminalBackendFactory } from './terminalBackend'

const DEFAULT_REPLAY_LIMIT = 500

export type DeckClient = {
  clientId: string
  configId: string
  send(message: ServerMessage): void
}

type TerminalSlot = {
  configId: string
  terminalId: string
  launchId: string
  backend: TerminalBackend
  backendKind: TerminalBackendKind
  status: 'starting' | 'running' | 'closed' | 'failed'
  cols: number
  rows: number
  replay: string[]
  exitCode: number | null
  signal: string | null
}

type ConfigScope = {
  store: ConfigStore
  terminals: Map<string, TerminalSlot>
}

export type CreateTerminalOptions = {
  backend?: TerminalBackendKind
  terminalId?: string
  terminalAlias?: string
  cols?: number
  rows?: number
}

export class TerminalDeckManager {
  readonly configs = new Map<string, ConfigScope>()
  readonly clients = new Map<string, DeckClient>()
  readonly replayLimit: number
  readonly backendFactory: TerminalBackendFactory
  private terminalEnvProvider: (configId: string, terminalId: string, launchId: string) => Record<string, string | undefined> = () => ({})
  #nextClient = 1

  constructor(options: { replayLimit?: number; backendFactory?: TerminalBackendFactory } = {}) {
    this.replayLimit = options.replayLimit ?? DEFAULT_REPLAY_LIMIT
    this.backendFactory = options.backendFactory ?? defaultBackendFactory
  }

  ensureConfig(configId: string): ConfigScope {
    assertValidPublicId(configId, 'configId')
    let config = this.configs.get(configId)
    if (!config) {
      config = { store: new ConfigStore(configId), terminals: new Map() }
      this.configs.set(configId, config)
    }
    return config
  }

  setTerminalEnvProvider(provider: (configId: string, terminalId: string, launchId: string) => Record<string, string | undefined>): void {
    this.terminalEnvProvider = provider
  }

  connectClient(configId: string, send: (message: ServerMessage) => void, clientId = 'client_' + this.#nextClient++): DeckClient {
    const config = this.ensureConfig(configId)
    const client = { clientId, configId: config.store.configId, send }
    this.clients.set(clientId, client)
    send({ type: 'client_registered', clientId, configId })
    send(this.deckSnapshot(configId))
    return client
  }

  disconnectClient(clientId: string): void {
    this.clients.delete(clientId)
  }

  createTerminal(configId: string, options: CreateTerminalOptions = {}): TerminalSnapshot {
    const config = this.ensureConfig(configId)
    const terminalId = options.terminalId ?? createTerminalId()
    const backendKind = options.backend ?? 'fake'
    const cols = options.cols ?? 80
    const rows = options.rows ?? 24
    const launchId = createTerminalLaunchId()
    const backend = this.backendFactory(backendKind, { cols, rows, configId, terminalId, launchId, env: this.terminalEnvProvider(configId, terminalId, launchId) })
    const terminal: TerminalSlot = {
      configId,
      terminalId,
      launchId,
      backend,
      backendKind,
      status: 'starting',
      cols,
      rows,
      replay: [],
      exitCode: null,
      signal: null,
    }
    const pendingData: string[] = []
    let pendingExitCode: number | null | undefined
    let pendingSignal: string | null = null
    let pendingError: Error | null = null
    let committed = false

    try {
      backend.start({
        onData: (data) => committed ? this.emitOutput(terminal, data) : pendingData.push(data),
        onExit: (exitCode, signal) => {
          if (committed) this.markClosed(terminal, exitCode, signal)
          else {
            pendingExitCode = exitCode
            pendingSignal = signal
          }
        },
        onError: (error) => {
          if (committed) this.markFailed(terminal, error)
          else pendingError = error
        },
      })
      config.store.addTerminal(terminalId, options.terminalAlias)
      config.terminals.set(terminalId, terminal)
      committed = true
    } catch (error) {
      backend.close()
      config.terminals.delete(terminalId)
      config.store.removeTerminal(terminalId)
      throw error
    }

    terminal.status = 'running'
    const snapshot = this.terminalSnapshot(terminal)
    this.broadcast(configId, snapshot)
    this.broadcastIndexMap(configId)
    for (const data of pendingData) {
      this.emitOutput(terminal, data)
    }
    if (pendingError) {
      this.markFailed(terminal, pendingError)
    }
    if (pendingExitCode !== undefined) {
      this.markClosed(terminal, pendingExitCode, pendingSignal)
    }
    return this.terminalSnapshot(terminal)
  }

  input(configId: string, ref: TerminalRef | string | number, data: string) {
    const terminal = this.resolveTerminal(configId, ref)
    if (terminal.status !== 'running') {
      const message = { type: 'input_rejected' as const, configId, terminalId: terminal.terminalId, reason: 'not_running' }
      this.broadcast(configId, message)
      return { ok: false as const, reason: 'not_running' }
    }
    terminal.backend.write(data)
    return { ok: true as const }
  }

  resize(configId: string, ref: TerminalRef | string | number, cols: number, rows: number) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) {
      throw new Error('invalid_terminal_size')
    }
    const terminal = this.resolveTerminal(configId, ref)
    terminal.cols = cols
    terminal.rows = rows
    terminal.backend.resize(cols, rows)
    this.broadcast(configId, this.stateMessage(terminal))
    return { ok: true as const }
  }

  resetTerminal(configId: string, ref: TerminalRef | string | number, backendKind?: TerminalBackendKind, fail = false) {
    const config = this.configOrThrow(configId)
    const oldTerminal = this.resolveTerminal(configId, ref)
    if (fail) {
      return { ok: false as const, reason: 'backend_unavailable' }
    }

    const nextBackendKind = backendKind ?? oldTerminal.backendKind
    const launchId = createTerminalLaunchId()
    const backend = this.backendFactory(nextBackendKind, { cols: oldTerminal.cols, rows: oldTerminal.rows, configId, terminalId: oldTerminal.terminalId, launchId, env: this.terminalEnvProvider(configId, oldTerminal.terminalId, launchId) })
    const nextTerminal: TerminalSlot = {
      configId: oldTerminal.configId,
      terminalId: oldTerminal.terminalId,
      launchId,
      backend,
      backendKind: nextBackendKind,
      status: 'starting',
      cols: oldTerminal.cols,
      rows: oldTerminal.rows,
      replay: [],
      exitCode: null,
      signal: null,
    }

    const pendingData: string[] = []
    let pendingExitCode: number | null | undefined
    let pendingSignal: string | null = null
    let pendingError: Error | null = null
    let committed = false

    try {
      backend.start({
        onData: (data) => committed ? this.emitOutput(nextTerminal, data) : pendingData.push(data),
        onExit: (exitCode, signal) => {
          if (committed) this.markClosed(nextTerminal, exitCode, signal)
          else {
            pendingExitCode = exitCode
            pendingSignal = signal
          }
        },
        onError: (error) => {
          if (committed) this.markFailed(nextTerminal, error)
          else pendingError = error
        },
      })
    } catch {
      backend.close()
      return { ok: false as const, reason: 'backend_unavailable' }
    }

    nextTerminal.status = 'running'
    config.terminals.set(nextTerminal.terminalId, nextTerminal)
    committed = true
    oldTerminal.backend.close()
    this.broadcast(configId, this.terminalSnapshot(nextTerminal))
    for (const data of pendingData) {
      this.emitOutput(nextTerminal, data)
    }
    if (pendingError) {
      this.markFailed(nextTerminal, pendingError)
    }
    if (pendingExitCode !== undefined) {
      this.markClosed(nextTerminal, pendingExitCode, pendingSignal)
    }
    return { ok: true as const }
  }

  renameTerminal(configId: string, terminalId: string, terminalAlias: string) {
    const config = this.configOrThrow(configId)
    if (!config.terminals.has(terminalId)) {
      throw new Error('terminal_not_found:' + configId + ':' + terminalId)
    }
    config.store.renameTerminal(terminalId, terminalAlias)
    this.broadcastIndexMap(configId)
    this.broadcast(configId, this.terminalSnapshot(this.terminalOrThrow(configId, terminalId)))
    return { ok: true as const }
  }

  moveTerminal(configId: string, terminalId: string, newIndex: number) {
    const config = this.configOrThrow(configId)
    if (!config.terminals.has(terminalId)) {
      throw new Error('terminal_not_found:' + configId + ':' + terminalId)
    }
    config.store.moveTerminal(terminalId, newIndex)
    this.broadcastIndexMap(configId)
    this.broadcast(configId, this.deckSnapshot(configId))
  }

  closeTerminal(configId: string, ref: TerminalRef | string | number) {
    const terminal = this.resolveTerminal(configId, ref)
    terminal.backend.close()
  }

  requestReplay(configId: string, ref: TerminalRef | string | number): ServerMessage {
    const terminal = this.resolveTerminal(configId, ref)
    return { type: 'terminal_replay', configId, terminalId: terminal.terminalId, replay: [...terminal.replay] }
  }

  deckSnapshot(configId: string): DeckSnapshot {
    const config = this.configOrThrow(configId)
    const terminals = config.store.terminalOrder.map((terminalId) => this.terminalSnapshot(this.terminalOrThrow(configId, terminalId)))
    return { type: 'deck_snapshot', configId, terminals, indexMap: config.store.indexMap() }
  }

  indexMap(configId: string) {
    return this.configOrThrow(configId).store.indexMap()
  }

  resolveTerminal(configId: string, ref: TerminalRef | string | number): TerminalSlot {
    const normalized = normalizeTerminalRef(ref)
    const config = this.configOrThrow(configId)
    const terminalId = normalized.kind === 'id'
      ? normalized.value
      : normalized.kind === 'alias'
        ? config.store.terminalIdByAlias(normalized.value)
        : config.store.terminalIdAt(normalized.value)
    return this.terminalOrThrow(configId, terminalId)
  }

  terminalSnapshot(terminal: TerminalSlot): TerminalSnapshot {
    const config = this.configOrThrow(terminal.configId)
    const terminalIndex = config.store.indexOf(terminal.terminalId)
    return {
      type: 'terminal_snapshot',
      configId: terminal.configId,
      terminalId: terminal.terminalId,
      terminalAlias: config.store.aliasOf(terminal.terminalId),
      terminalIndex,
      visualOrder: terminalIndex,
      status: terminal.status,
      cols: terminal.cols,
      rows: terminal.rows,
      backend: terminal.backendKind,
      replay: [...terminal.replay],
      exitCode: terminal.exitCode,
      signal: terminal.signal,
    }
  }

  private emitOutput(terminal: TerminalSlot, data: string) {
    if (!this.isCurrentTerminal(terminal)) return
    terminal.replay.push(data)
    if (terminal.replay.length > this.replayLimit) {
      terminal.replay.splice(0, terminal.replay.length - this.replayLimit)
    }
    this.broadcast(terminal.configId, {
      type: 'pty_output',
      configId: terminal.configId,
      terminalId: terminal.terminalId,
      data,
      source: 'pty',
    })
  }

  private markClosed(terminal: TerminalSlot, exitCode: number | null, signal: string | null) {
    if (!this.isCurrentTerminal(terminal)) return
    terminal.status = 'closed'
    terminal.exitCode = exitCode
    terminal.signal = signal
    this.broadcast(terminal.configId, this.stateMessage(terminal))
  }

  private markFailed(terminal: TerminalSlot, error: Error) {
    if (!this.isCurrentTerminal(terminal)) return
    terminal.status = 'failed'
    this.broadcast(terminal.configId, { type: 'terminal_error', configId: terminal.configId, terminalId: terminal.terminalId, reason: error.message })
    this.broadcast(terminal.configId, this.stateMessage(terminal))
  }

  private stateMessage(terminal: TerminalSlot): ServerMessage {
    return {
      type: 'terminal_state',
      configId: terminal.configId,
      terminalId: terminal.terminalId,
      status: terminal.status,
      cols: terminal.cols,
      rows: terminal.rows,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
    }
  }

  private broadcastIndexMap(configId: string) {
    this.broadcast(configId, { type: 'terminal_index_map', configId, items: this.indexMap(configId) })
  }

  private broadcast(configId: string, message: ServerMessage) {
    for (const client of this.clients.values()) {
      if (client.configId === configId) {
        client.send(message)
      }
    }
  }

  private isCurrentTerminal(terminal: TerminalSlot): boolean {
    return this.configs.get(terminal.configId)?.terminals.get(terminal.terminalId) === terminal
  }

  private configOrThrow(configId: string): ConfigScope {
    const config = this.configs.get(assertValidPublicId(configId, 'configId'))
    if (!config) {
      throw new Error('config_not_found:' + configId)
    }
    return config
  }

  private terminalOrThrow(configId: string, terminalId: string): TerminalSlot {
    const terminal = this.configOrThrow(configId).terminals.get(terminalId)
    if (!terminal) {
      throw new Error('terminal_not_found:' + configId + ':' + terminalId)
    }
    return terminal
  }
}

export function defaultBackendFactory(kind: TerminalBackendKind, options: { cols: number; rows: number }): TerminalBackend {
  if (kind === 'fake') {
    return new FakeTerminalBackend(options)
  }
  return new RealPtyBackend(options)
}
