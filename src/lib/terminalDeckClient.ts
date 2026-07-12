import type { ClientMessage, ServerMessage } from './protocol'

export type TerminalFrameScheduler = {
  request(callback: (timestamp: number) => void): number
  cancel(handle: number): void
}

type PtyOutputMessage = Extract<ServerMessage, { type: 'pty_output' }>

type PendingTerminalOutput = {
  message: PtyOutputMessage
  chunks: string[]
}

const browserFrameScheduler: TerminalFrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
}

export class TerminalOutputFrameBatcher {
  readonly #onMessage: (message: ServerMessage) => void
  readonly #scheduler: TerminalFrameScheduler
  readonly #pending = new Map<string, PendingTerminalOutput>()
  #scheduledFrame: number | null = null
  #disposed = false

  constructor(onMessage: (message: ServerMessage) => void, scheduler: TerminalFrameScheduler = browserFrameScheduler) {
    this.#onMessage = onMessage
    this.#scheduler = scheduler
  }

  accept(message: ServerMessage): void {
    if (this.#disposed) return
    if (message.type !== 'pty_output') {
      this.flush()
      this.#onMessage(message)
      return
    }

    const pending = this.#pending.get(message.terminalId)
    if (pending) {
      pending.chunks.push(message.data)
    } else {
      this.#pending.set(message.terminalId, { message, chunks: [message.data] })
    }
    if (this.#scheduledFrame === null) {
      this.#scheduledFrame = this.#scheduler.request(() => {
        this.#scheduledFrame = null
        this.flush()
      })
    }
  }

  flush(): void {
    if (this.#disposed) return
    if (this.#scheduledFrame !== null) {
      this.#scheduler.cancel(this.#scheduledFrame)
      this.#scheduledFrame = null
    }
    if (this.#pending.size === 0) return

    const batches = [...this.#pending.values()]
    this.#pending.clear()
    for (const pending of batches) {
      this.#onMessage({ ...pending.message, data: pending.chunks.join('') })
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#scheduledFrame !== null) {
      this.#scheduler.cancel(this.#scheduledFrame)
      this.#scheduledFrame = null
    }
    this.#pending.clear()
  }
}

export type TerminalDeckClientOptions = {
  configId: string
  url?: string
  onMessage(message: ServerMessage): void
  onOpen?: () => void
  onClose?: () => void
  frameScheduler?: TerminalFrameScheduler
  createWebSocket?: (url: string) => WebSocket
}

export class TerminalDeckClient {
  readonly configId: string
  readonly ws: WebSocket
  readonly #batcher: TerminalOutputFrameBatcher
  readonly #onClose: (() => void) | undefined
  #disposed = false

  constructor(options: TerminalDeckClientOptions) {
    this.configId = options.configId
    const url = options.url ?? defaultWsUrl(options.configId)
    this.ws = (options.createWebSocket ?? ((target) => new WebSocket(target)))(url)
    this.#batcher = new TerminalOutputFrameBatcher(options.onMessage, options.frameScheduler)
    this.#onClose = options.onClose
    this.ws.addEventListener('open', () => {
      if (!this.#disposed) options.onOpen?.()
    })
    this.ws.addEventListener('close', () => this.#finishClose())
    this.ws.addEventListener('message', (event) => {
      if (this.#disposed) return
      this.#batcher.accept(JSON.parse(String(event.data)) as ServerMessage)
    })
  }

  send(message: ClientMessage): void {
    if (this.#disposed) return
    this.ws.send(JSON.stringify(message))
  }

  close(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#batcher.dispose()
    this.ws.close()
    this.#onClose?.()
  }

  #finishClose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#batcher.dispose()
    this.#onClose?.()
  }
}

function defaultWsUrl(configId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const devBackendHost = import.meta.env.VITE_SHELL_DECK_DEV_BACKEND_HOST
  const devBackendPort = import.meta.env.VITE_SHELL_DECK_DEV_BACKEND_PORT
  const host = devBackendHost && devBackendPort
    ? browserReachableHost(devBackendHost) + ':' + devBackendPort
    : location.host
  return proto + '//' + host + '/ws?configId=' + encodeURIComponent(configId)
}

function browserReachableHost(configuredHost: string): string {
  if (configuredHost === '0.0.0.0' || configuredHost === '::') return location.hostname
  return configuredHost.includes(':') && !configuredHost.startsWith('[') ? '[' + configuredHost + ']' : configuredHost
}
