export type TerminalStatus = 'running' | 'closed'

export type TerminalSnapshot = {
  type: 'terminal_snapshot'
  configId: string
  terminalId: string
  terminalIndex: number
  replay: string[]
  status: TerminalStatus
  cols: number
  rows: number
}

export type ServerMessage =
  | { type: 'client_registered'; clientId: string; configId: string }
  | TerminalSnapshot
  | { type: 'pty_output'; configId: string; terminalId: string; data: string; source: 'pty' }
  | { type: 'terminal_state'; configId: string; terminalId: string; status: TerminalStatus; cols: number; rows: number; exitCode: number | null; signal: string | null }
  | { type: 'terminal_index_map'; configId: string; items: Array<{ index: number; terminalId: string }> }
  | { type: 'input_rejected'; configId: string; terminalId: string; reason: string }
  | { type: 'capture_terminal_buffer_result'; requestId: string; configId: string; terminalId: string; artifactRef: string; text: string }

export type ProbeClient = {
  clientId: string
  configId: string
  messages: ServerMessage[]
  subscriptions: Set<string>
}

type TerminalSlot = {
  configId: string
  terminalId: string
  terminalIndex: number
  status: TerminalStatus
  cols: number
  rows: number
  exitCode: number | null
  signal: string | null
  replay: string[]
  inputBuffer: string
}

type ConfigScope = {
  configId: string
  terminals: Map<string, TerminalSlot>
}

export class ProbeTerminalDeck {
  readonly configs = new Map<string, ConfigScope>()
  readonly clients = new Map<string, ProbeClient>()
  readonly commandChannel = 'helper-stdin-pipe' as const
  #nextTerminal = 1
  #nextCapture = 1

  createConfig(configId: string) {
    if (this.configs.has(configId)) {
      throw new Error(`config_exists:${configId}`)
    }
    const config = { configId, terminals: new Map<string, TerminalSlot>() }
    this.configs.set(configId, config)
    return config
  }

  createTerminal(configId: string, terminalId = `term_probe_${this.#nextTerminal++}`) {
    const config = this.configOrThrow(configId)
    const terminalIndex = config.terminals.size + 1
    const terminal: TerminalSlot = {
      configId,
      terminalId,
      terminalIndex,
      status: 'running',
      cols: 80,
      rows: 24,
      exitCode: null,
      signal: null,
      replay: ['READY\n'],
      inputBuffer: '',
    }
    config.terminals.set(terminalId, terminal)
    this.broadcastIndexMap(configId)
    return terminal
  }

  connectClient(configId: string, clientId: string) {
    this.configOrThrow(configId)
    const client: ProbeClient = { clientId, configId, messages: [], subscriptions: new Set() }
    this.clients.set(clientId, client)
    client.messages.push({ type: 'client_registered', clientId, configId })
    return client
  }

  subscribeTerminal(clientId: string, terminalId: string) {
    const client = this.clientOrThrow(clientId)
    const terminal = this.terminalOrThrow(client.configId, terminalId)
    client.subscriptions.add(terminalId)
    client.messages.push(snapshotOf(terminal))
  }

  terminalInput(configId: string, terminalId: string, data: string) {
    const terminal = this.terminalOrThrow(configId, terminalId)
    if (terminal.status !== 'running') {
      this.broadcast(configId, terminalId, { type: 'input_rejected', configId, terminalId, reason: 'not_running' })
      return { ok: false as const, reason: 'not_running' }
    }

    for (const char of data) {
      if (char === '\u0003') {
        terminal.inputBuffer = ''
        this.emitOutput(terminal, '^C\n')
        continue
      }
      if (char === '\u001b') {
        this.emitOutput(terminal, '<ESC>\n')
        continue
      }
      if (char === '\r' || char === '\n') {
        const line = terminal.inputBuffer
        terminal.inputBuffer = ''
        this.emitOutput(terminal, `ECHO:${line}\n`)
        continue
      }
      terminal.inputBuffer += char
    }

    return { ok: true as const }
  }

  terminalResize(configId: string, terminalId: string, cols: number, rows: number) {
    const terminal = this.terminalOrThrow(configId, terminalId)
    terminal.cols = cols
    terminal.rows = rows
    this.broadcast(configId, terminalId, stateOf(terminal))
    return { ok: true as const }
  }

  resetTerminal(configId: string, terminalId: string, options: { fail?: boolean } = {}) {
    const terminal = this.terminalOrThrow(configId, terminalId)
    if (options.fail) {
      return { ok: false as const, reason: 'backend_unavailable' }
    }
    terminal.status = 'running'
    terminal.exitCode = null
    terminal.signal = null
    terminal.inputBuffer = ''
    terminal.replay.splice(0, terminal.replay.length, 'READY\n')
    this.broadcast(configId, terminalId, snapshotOf(terminal))
    return { ok: true as const }
  }

  closeTerminal(configId: string, terminalId: string, exitCode = 0, signal: string | null = null) {
    const terminal = this.terminalOrThrow(configId, terminalId)
    terminal.status = 'closed'
    terminal.exitCode = exitCode
    terminal.signal = signal
    this.broadcast(configId, terminalId, stateOf(terminal))
  }

  captureTerminalBuffer(configId: string, terminalId: string, requestId = `cap_${this.#nextCapture++}`) {
    const terminal = this.terminalOrThrow(configId, terminalId)
    const text = terminal.replay.join('')
    const result = {
      type: 'capture_terminal_buffer_result' as const,
      requestId,
      configId,
      terminalId,
      artifactRef: `artifacts/capture/${requestId}.txt`,
      text,
    }
    this.broadcast(configId, terminalId, result)
    return result
  }

  moveTerminal(configId: string, terminalId: string, newIndex: number) {
    const config = this.configOrThrow(configId)
    const terminal = this.terminalOrThrow(configId, terminalId)
    const previous = [...config.terminals.values()].find((candidate) => candidate.terminalIndex === newIndex)
    if (previous) {
      previous.terminalIndex = terminal.terminalIndex
    }
    terminal.terminalIndex = newIndex
    this.broadcastIndexMap(configId)
  }

  indexMap(configId: string) {
    const config = this.configOrThrow(configId)
    return [...config.terminals.values()]
      .sort((a, b) => a.terminalIndex - b.terminalIndex)
      .map((terminal) => ({ index: terminal.terminalIndex, terminalId: terminal.terminalId }))
  }

  private emitOutput(terminal: TerminalSlot, data: string) {
    terminal.replay.push(data)
    if (terminal.replay.length > 200) {
      terminal.replay.splice(0, terminal.replay.length - 200)
    }
    this.broadcast(terminal.configId, terminal.terminalId, {
      type: 'pty_output',
      configId: terminal.configId,
      terminalId: terminal.terminalId,
      data,
      source: 'pty',
    })
  }

  private broadcastIndexMap(configId: string) {
    const message = { type: 'terminal_index_map' as const, configId, items: this.indexMap(configId) }
    for (const client of this.clients.values()) {
      if (client.configId === configId) {
        client.messages.push(message)
      }
    }
  }

  private broadcast(configId: string, terminalId: string, message: ServerMessage) {
    for (const client of this.clients.values()) {
      if (client.configId === configId && client.subscriptions.has(terminalId)) {
        client.messages.push(message)
      }
    }
  }

  private configOrThrow(configId: string) {
    const config = this.configs.get(configId)
    if (!config) {
      throw new Error(`config_not_found:${configId}`)
    }
    return config
  }

  private terminalOrThrow(configId: string, terminalId: string) {
    const terminal = this.configOrThrow(configId).terminals.get(terminalId)
    if (!terminal) {
      throw new Error(`terminal_not_found:${configId}:${terminalId}`)
    }
    return terminal
  }

  private clientOrThrow(clientId: string) {
    const client = this.clients.get(clientId)
    if (!client) {
      throw new Error(`client_not_found:${clientId}`)
    }
    return client
  }
}

function snapshotOf(terminal: TerminalSlot): TerminalSnapshot {
  return {
    type: 'terminal_snapshot',
    configId: terminal.configId,
    terminalId: terminal.terminalId,
    terminalIndex: terminal.terminalIndex,
    replay: [...terminal.replay],
    status: terminal.status,
    cols: terminal.cols,
    rows: terminal.rows,
  }
}

function stateOf(terminal: TerminalSlot): ServerMessage {
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
