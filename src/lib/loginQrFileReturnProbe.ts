const POLL_INTERVAL_MS = 500
const MAX_HANDOFF_MS = 2 * 60 * 1000
const RETURN_GRACE_MS = 1200

export type LoginQrFileReturnProbeOptions = {
  onFile(): void
  onTimeout(): void
  onEvent(name: string, details?: Record<string, string | number | boolean | undefined>): void
}

export class LoginQrFileReturnProbe {
  readonly #input: HTMLInputElement
  readonly #options: LoginQrFileReturnProbeOptions
  #timer: number | null = null
  #startedAt = 0
  #returnDeadline = 0
  #attempt = 0

  constructor(input: HTMLInputElement, options: LoginQrFileReturnProbeOptions) {
    this.#input = input
    this.#options = options
  }

  get active(): boolean {
    return this.#startedAt !== 0
  }

  begin(): void {
    if (this.active) return
    this.#startedAt = Date.now()
    this.#returnDeadline = 0
    this.#attempt = 0
    this.#options.onEvent('file_probe_started')
    this.#schedule(100)
  }

  returned(): void {
    if (!this.active) return
    this.#returnDeadline = Date.now() + RETURN_GRACE_MS
    this.#options.onEvent('file_probe_returned')
    this.#schedule(50)
  }

  cancel(): void {
    if (this.#timer !== null) window.clearTimeout(this.#timer)
    this.#timer = null
    this.#startedAt = 0
    this.#returnDeadline = 0
    this.#attempt = 0
  }

  #schedule(delay: number): void {
    if (this.#timer !== null) window.clearTimeout(this.#timer)
    this.#timer = window.setTimeout(() => this.#poll(), delay)
  }

  #poll(): void {
    this.#timer = null
    if (!this.active) return
    this.#attempt += 1
    const file = this.#input.files?.[0]
    if (file || this.#attempt === 1 || this.#attempt % 10 === 0) {
      this.#options.onEvent('file_probe_poll', {
        attempt: this.#attempt,
        files: this.#input.files?.length,
        elapsedMs: Date.now() - this.#startedAt,
      })
    }
    if (file) {
      this.cancel()
      this.#options.onFile()
      return
    }
    const now = Date.now()
    if ((this.#returnDeadline > 0 && now >= this.#returnDeadline)
      || now - this.#startedAt >= MAX_HANDOFF_MS) {
      this.cancel()
      this.#options.onTimeout()
      return
    }
    this.#schedule(POLL_INTERVAL_MS)
  }
}
