import type { ClientMessage, ServerMessage } from './protocol'

export type TerminalFrameScheduler = {
  request(callback: (timestamp: number) => void): number
  cancel(handle: number): void
}

type PtyOutputMessage = Extract<ServerMessage, { type: 'pty_output' }>
type PendingTerminalOutput = { message: PtyOutputMessage; chunks: string[] }

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
    const key = message.roomGeneration + ':' + message.terminalId
    const pending = this.#pending.get(key)
    if (pending) {
      pending.chunks.push(message.data)
      pending.message = message
    }
    else this.#pending.set(key, { message, chunks: [message.data] })
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
    const batches = [...this.#pending.values()]
    this.#pending.clear()
    for (const pending of batches) this.#onMessage({ ...pending.message, data: pending.chunks.join('') })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#scheduledFrame !== null) this.#scheduler.cancel(this.#scheduledFrame)
    this.#scheduledFrame = null
    this.#pending.clear()
  }
}

export type TerminalRoomClientOptions = {
  roomId: string
  url?: string
  onMessage(message: ServerMessage): void
  onOpen?: () => void
  onClose?: (event?: CloseEvent) => void
  frameScheduler?: TerminalFrameScheduler
  createWebSocket?: (url: string) => WebSocket
}

export class TerminalRoomClient {
  readonly roomId: string
  readonly ws: WebSocket
  readonly #batcher: TerminalOutputFrameBatcher
  readonly #onClose: ((event?: CloseEvent) => void) | undefined
  #disposed = false

  constructor(options: TerminalRoomClientOptions) {
    this.roomId = options.roomId
    this.ws = (options.createWebSocket ?? ((target) => new WebSocket(target)))(options.url ?? defaultWsUrl(options.roomId))
    this.#batcher = new TerminalOutputFrameBatcher(options.onMessage, options.frameScheduler)
    this.#onClose = options.onClose
    this.ws.addEventListener('open', () => { if (!this.#disposed) options.onOpen?.() })
    this.ws.addEventListener('close', (event) => this.#finishClose(event))
    this.ws.addEventListener('message', (event) => {
      if (!this.#disposed) this.#batcher.accept(JSON.parse(String(event.data)) as ServerMessage)
    })
  }

  send(message: ClientMessage): boolean {
    if (this.#disposed || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(message))
    return true
  }

  close(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#batcher.dispose()
    this.ws.close()
    this.#onClose?.()
  }

  #finishClose(event: CloseEvent): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#batcher.dispose()
    this.#onClose?.(event)
  }
}

function defaultWsUrl(roomId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const devBackendHost = import.meta.env.VITE_SHELL_DECK_DEV_BACKEND_HOST
  const devBackendPort = import.meta.env.VITE_SHELL_DECK_DEV_BACKEND_PORT
  const host = devBackendHost && devBackendPort ? browserReachableHost(devBackendHost) + ':' + devBackendPort : location.host
  return proto + '//' + host + '/ws/rooms/' + encodeURIComponent(roomId)
}

function browserReachableHost(configuredHost: string): string {
  if (configuredHost === '0.0.0.0' || configuredHost === '::') return location.hostname
  return configuredHost.includes(':') && !configuredHost.startsWith('[') ? '[' + configuredHost + ']' : configuredHost
}
