import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from './terminalBackend'

export class TextBoxBackend implements TerminalBackend {
  readonly kind = 'text' as const
  readonly inputChannel = 'helper-stdin-pipe' as const
  #events: TerminalBackendEvent | null = null
  #closed = false
  cols: number
  rows: number

  constructor(options: TerminalBackendOptions = { cols: 80, rows: 24 }) {
    this.cols = options.cols
    this.rows = options.rows
  }

  start(events: TerminalBackendEvent): void {
    this.#events = events
  }

  write(data: string): void {
    if (this.#closed) return
    this.#events?.onData(data.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true
      this.#events?.onExit(0, null)
    }
  }
}
