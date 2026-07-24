export const DEFAULT_WEBSOCKET_SEND_QUEUE_BYTE_LIMIT = 64 * 1024 * 1024

export type WebSocketSendTarget = {
  send(data: string): number
}

type PendingFrame = { data: string; bytes: number }

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
  #pending: PendingFrame[] = []
  #pendingHead = 0
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
    return this.#pending.length - this.#pendingHead
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
    if (this.#blocked || this.pendingCount > 0) {
      this.enqueue(data)
      return
    }
    const result = this.trySend(data)
    if (result === 'blocked') this.#blocked = true
  }

  notifyDrain(): void {
    if (this.#disposed || this.#drainScheduled || (!this.#blocked && this.pendingCount === 0)) return
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
    while (this.#pendingHead < this.#pending.length) {
      const frame = this.#pending[this.#pendingHead]
      const result = this.trySend(frame.data)
      if (result === 'fatal') return
      this.#pendingHead += 1
      this.#pendingBytes -= frame.bytes
      if (result === 'blocked') {
        this.#blocked = true
        this.compactPending()
        return
      }
    }
    this.#pending = []
    this.#pendingHead = 0
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#blocked = false
    this.#drainScheduled = false
    this.#pending = []
    this.#pendingHead = 0
    this.#pendingBytes = 0
  }

  private enqueue(data: string): void {
    const dataBytes = Buffer.byteLength(data)
    if (this.#pendingBytes + dataBytes > this.maxPendingBytes) {
      this.fail('websocket_send_queue_overflow')
      return
    }
    this.#pending.push({ data, bytes: dataBytes })
    this.#pendingBytes += dataBytes
  }

  private compactPending(): void {
    if (this.#pendingHead < 1024 || this.#pendingHead * 2 < this.#pending.length) return
    this.#pending = this.#pending.slice(this.#pendingHead)
    this.#pendingHead = 0
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
