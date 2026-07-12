export const DEFAULT_WEBSOCKET_SEND_QUEUE_BYTE_LIMIT = 64 * 1024 * 1024

export type WebSocketSendTarget = {
  send(data: string): number
}

export type WebSocketSendQueueOptions = {
  target: WebSocketSendTarget
  maxPendingBytes?: number
  scheduleDrain?(callback: () => void): void
  onFatal(reason: 'websocket_send_dropped' | 'websocket_send_failed' | 'websocket_send_queue_overflow'): void
}

export class WebSocketSendQueue {
  readonly maxPendingBytes: number
  readonly #target: WebSocketSendTarget
  readonly #scheduleDrain: NonNullable<WebSocketSendQueueOptions['scheduleDrain']>
  readonly #onFatal: WebSocketSendQueueOptions['onFatal']
  #pending: string[] = []
  #pendingBytes = 0
  #blocked = false
  #drainScheduled = false
  #disposed = false

  constructor(options: WebSocketSendQueueOptions) {
    const maxPendingBytes = options.maxPendingBytes ?? DEFAULT_WEBSOCKET_SEND_QUEUE_BYTE_LIMIT
    if (!Number.isInteger(maxPendingBytes) || maxPendingBytes <= 0) {
      throw new Error('invalid_websocket_send_queue_byte_limit')
    }
    this.maxPendingBytes = maxPendingBytes
    this.#target = options.target
    this.#scheduleDrain = options.scheduleDrain ?? ((callback) => setImmediate(callback))
    this.#onFatal = options.onFatal
  }

  get pendingCount(): number {
    return this.#pending.length
  }

  get pendingBytes(): number {
    return this.#pendingBytes
  }

  get blocked(): boolean {
    return this.#blocked
  }

  get disposed(): boolean {
    return this.#disposed
  }

  get drainScheduled(): boolean {
    return this.#drainScheduled
  }

  send(data: string): void {
    if (this.#disposed) return
    if (this.#blocked || this.#pending.length > 0) {
      this.enqueue(data)
      return
    }
    const result = this.trySend(data)
    if (result === 'blocked') this.#blocked = true
  }

  notifyDrain(): void {
    if (this.#disposed || this.#drainScheduled || (!this.#blocked && this.#pending.length === 0)) return
    this.#drainScheduled = true
    this.#scheduleDrain(() => {
      if (!this.#drainScheduled) return
      this.#drainScheduled = false
      this.flushPending()
    })
  }

  private flushPending(): void {
    if (this.#disposed) return
    this.#blocked = false
    while (this.#pending.length > 0) {
      const data = this.#pending[0]
      const result = this.trySend(data)
      if (result === 'fatal') return
      this.#pending.shift()
      this.#pendingBytes -= Buffer.byteLength(data)
      if (result === 'blocked') {
        this.#blocked = true
        return
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#blocked = false
    this.#drainScheduled = false
    this.#pending = []
    this.#pendingBytes = 0
  }

  private enqueue(data: string): void {
    const dataBytes = Buffer.byteLength(data)
    if (this.#pendingBytes + dataBytes > this.maxPendingBytes) {
      this.fail('websocket_send_queue_overflow')
      return
    }
    this.#pending.push(data)
    this.#pendingBytes += dataBytes
  }

  private trySend(data: string): 'sent' | 'blocked' | 'fatal' {
    let result: number
    try {
      result = this.#target.send(data)
    } catch {
      this.fail('websocket_send_failed')
      return 'fatal'
    }
    if (result > 0) return 'sent'
    if (result < 0) return 'blocked'
    this.fail('websocket_send_dropped')
    return 'fatal'
  }

  private fail(reason: Parameters<WebSocketSendQueueOptions['onFatal']>[0]): void {
    if (this.#disposed) return
    this.dispose()
    this.#onFatal(reason)
  }
}
