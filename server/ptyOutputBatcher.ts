export const DEFAULT_PTY_OUTPUT_BATCH_DELAY_MS = 4
export const DEFAULT_PTY_OUTPUT_BATCH_BYTES = 256 * 1024

export type PtyOutputBatchScheduler = {
  schedule(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

export type PtyOutputBatcherOptions = {
  onBatch(data: string): void
  delayMs?: number
  batchBytes?: number
  scheduler?: PtyOutputBatchScheduler
}

const timeoutScheduler: PtyOutputBatchScheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    timer.unref()
    return timer
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

export class PtyOutputBatcher {
  readonly delayMs: number
  readonly batchBytes: number
  readonly scheduler: PtyOutputBatchScheduler
  readonly onBatch: (data: string) => void

  #pending: string[] = []
  #pendingBytes = 0
  #scheduled = false
  #scheduleHandle: unknown
  #scheduleToken = 0

  constructor(options: PtyOutputBatcherOptions) {
    this.delayMs = options.delayMs ?? DEFAULT_PTY_OUTPUT_BATCH_DELAY_MS
    this.batchBytes = options.batchBytes ?? DEFAULT_PTY_OUTPUT_BATCH_BYTES
    this.scheduler = options.scheduler ?? timeoutScheduler
    this.onBatch = options.onBatch
  }

  push(data: string): void {
    if (data.length === 0) return
    this.#pending.push(data)
    this.#pendingBytes += Buffer.byteLength(data)
    if (!this.#scheduled) this.scheduleFlush()
    if (this.#pendingBytes >= this.batchBytes) this.flush()
  }

  flush(): void {
    this.cancelScheduledFlush()
    if (this.#pending.length === 0) return
    const batch = this.#pending.join('')
    this.#pending = []
    this.#pendingBytes = 0
    this.onBatch(batch)
  }

  private scheduleFlush(): void {
    const token = ++this.#scheduleToken
    this.#scheduled = true
    this.#scheduleHandle = this.scheduler.schedule(() => {
      if (!this.#scheduled || token !== this.#scheduleToken) return
      this.#scheduled = false
      this.#scheduleHandle = undefined
      this.emitPending()
    }, this.delayMs)
  }

  private cancelScheduledFlush(): void {
    if (!this.#scheduled) return
    this.scheduler.cancel(this.#scheduleHandle)
    this.#scheduled = false
    this.#scheduleHandle = undefined
    this.#scheduleToken += 1
  }

  private emitPending(): void {
    if (this.#pending.length === 0) return
    const batch = this.#pending.join('')
    this.#pending = []
    this.#pendingBytes = 0
    this.onBatch(batch)
  }
}
