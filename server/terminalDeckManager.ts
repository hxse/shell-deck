import { assertValidPublicId } from '../src/lib/identifier'
import type { DeckSnapshot, ServerMessage, TerminalBackendKind, TerminalSnapshot } from '../src/lib/protocol'
import { createTerminalId, createTerminalLaunchId, normalizeTerminalRef, type TerminalRef } from '../src/lib/terminalIdentity'
import { ConfigStore } from './configStore'
import { FakeTerminalBackend } from './fakeTerminalBackend'
import { RealPtyBackend } from './realPtyBackend'
import { TextBoxBackend } from './textBoxBackend'
import type { TerminalBackend, TerminalBackendFactory } from './terminalBackend'

export const DEFAULT_REPLAY_BYTE_LIMIT = 2 * 1024 * 1024
const REPLAY_COMPACT_THRESHOLD = 1024

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
  replayStart: number
  replayBytes: number
  replayDiscardedBytes: number
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

function defaultAliasPrefix(backend: TerminalBackendKind): string {
  return backend === 'text' ? 'text' : 'shell'
}

export class TerminalDeckManager {
  readonly configs = new Map<string, ConfigScope>()
  readonly clients = new Map<string, DeckClient>()
  readonly replayByteLimit: number
  readonly backendFactory: TerminalBackendFactory
  private terminalEnvProvider: (configId: string, terminalId: string, launchId: string) => Record<string, string | undefined> = () => ({})
  #nextClient = 1

  constructor(options: { replayByteLimit?: number; backendFactory?: TerminalBackendFactory } = {}) {
    const replayByteLimit = options.replayByteLimit ?? DEFAULT_REPLAY_BYTE_LIMIT
    if (!Number.isInteger(replayByteLimit) || replayByteLimit <= 0) {
      throw new Error('invalid_replay_byte_limit')
    }
    this.replayByteLimit = replayByteLimit
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
      replayStart: 0,
      replayBytes: 0,
      replayDiscardedBytes: 0,
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
      config.store.addTerminal(terminalId, options.terminalAlias, defaultAliasPrefix(backendKind))
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

  setTextContent(configId: string, ref: TerminalRef | string | number, content: string) {
    const terminal = this.resolveTerminal(configId, ref)
    if (terminal.backendKind !== 'text') {
      throw new Error('terminal_not_text_box:' + terminal.terminalId)
    }
    terminal.replay = [content]
    terminal.replayStart = 0
    terminal.replayBytes = Buffer.byteLength(content)
    terminal.replayDiscardedBytes = 0
    this.broadcast(configId, this.terminalSnapshot(terminal))
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
      replayStart: 0,
      replayBytes: 0,
      replayDiscardedBytes: 0,
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
    oldTerminal.backend.close()
    config.terminals.set(nextTerminal.terminalId, nextTerminal)
    committed = true
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
    const config = this.configOrThrow(configId)
    const terminal = this.resolveTerminal(configId, ref)
    terminal.backend.close()
    config.terminals.delete(terminal.terminalId)
    config.store.removeTerminal(terminal.terminalId)
    this.broadcastIndexMap(configId)
    this.broadcast(configId, this.deckSnapshot(configId))
    return { ok: true as const }
  }

  requestReplay(configId: string, ref: TerminalRef | string | number): ServerMessage {
    const terminal = this.resolveTerminal(configId, ref)
    return { type: 'terminal_replay', configId, terminalId: terminal.terminalId, replay: this.replayChunks(terminal) }
  }

  broadcastConfigMessage(configId: string, message: ServerMessage): void {
    this.broadcast(configId, message)
  }

  broadcastAllConfigMessages(createMessage: (configId: string) => ServerMessage): void {
    for (const client of this.clients.values()) {
      client.send(createMessage(client.configId))
    }
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
      launchId: terminal.launchId,
      terminalAlias: config.store.aliasOf(terminal.terminalId),
      terminalIndex,
      visualOrder: terminalIndex,
      status: terminal.status,
      cols: terminal.cols,
      rows: terminal.rows,
      backend: terminal.backendKind,
      replay: this.replayChunks(terminal),
      exitCode: terminal.exitCode,
      signal: terminal.signal,
    }
  }

  private emitOutput(terminal: TerminalSlot, data: string) {
    if (!this.isCurrentTerminal(terminal)) return
    this.appendReplay(terminal, data)
    this.broadcast(terminal.configId, {
      type: 'pty_output',
      configId: terminal.configId,
      terminalId: terminal.terminalId,
      data,
      source: 'pty',
    })
  }

  private appendReplay(terminal: TerminalSlot, data: string): void {
    const dataBytes = Buffer.byteLength(data)
    if (terminal.backendKind === 'text') {
      terminal.replay.push(data)
      terminal.replayBytes += dataBytes
      return
    }
    if (dataBytes > this.replayByteLimit) {
      const tail = utf8Tail(data, this.replayByteLimit)
      terminal.replay = tail.length > 0 ? [tail] : []
      terminal.replayStart = 0
      terminal.replayBytes = Buffer.byteLength(tail)
      terminal.replayDiscardedBytes = 0
      return
    }
    terminal.replay.push(data)
    terminal.replayBytes += dataBytes
    while (terminal.replayBytes > this.replayByteLimit && terminal.replayStart < terminal.replay.length) {
      const discardedBytes = Buffer.byteLength(terminal.replay[terminal.replayStart])
      terminal.replayBytes -= discardedBytes
      terminal.replayDiscardedBytes += discardedBytes
      terminal.replayStart += 1
    }
    this.compactReplay(terminal)
  }

  private replayChunks(terminal: TerminalSlot): string[] {
    return terminal.replay.slice(terminal.replayStart)
  }

  private compactReplay(terminal: TerminalSlot): void {
    if (terminal.replayStart === 0) return
    const discardedBytesAreBounded = terminal.replayDiscardedBytes < this.replayByteLimit
    const discardedChunksAreSparse = terminal.replayStart < REPLAY_COMPACT_THRESHOLD || terminal.replayStart * 2 < terminal.replay.length
    if (discardedBytesAreBounded && discardedChunksAreSparse) return
    terminal.replay = terminal.replay.slice(terminal.replayStart)
    terminal.replayStart = 0
    terminal.replayDiscardedBytes = 0
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

function utf8Tail(data: string, maxBytes: number): string {
  const encoded = Buffer.from(data)
  let start = Math.max(0, encoded.length - maxBytes)
  while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) start += 1
  return encoded.subarray(start).toString('utf8')
}


export function defaultBackendFactory(kind: TerminalBackendKind, options: { cols: number; rows: number }): TerminalBackend {
  if (kind === 'fake') {
    return new FakeTerminalBackend(options)
  }
  if (kind === 'text') {
    return new TextBoxBackend(options)
  }
  return new RealPtyBackend(options)
}
