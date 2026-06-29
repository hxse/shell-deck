import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from './terminalBackend'

export class FakeTerminalBackend implements TerminalBackend {
  readonly kind = 'fake' as const
  readonly inputChannel = 'helper-stdin-pipe' as const
  #events: TerminalBackendEvent | null = null
  #buffer = ''
  #closed = false
  cols: number
  rows: number

  constructor(options: TerminalBackendOptions = { cols: 80, rows: 24 }) {
    this.cols = options.cols
    this.rows = options.rows
  }

  start(events: TerminalBackendEvent): void {
    this.#events = events
    queueMicrotask(() => {
      if (!this.#closed) {
        events.onData('READY\n')
      }
    })
  }

  write(data: string): void {
    if (this.#closed) {
      return
    }
    for (const char of data) {
      if (char === '\u0003') {
        this.#buffer = ''
        this.#events?.onData('^C\n')
        continue
      }
      if (char === '\u001b') {
        this.#events?.onData('<ESC>\n')
        continue
      }
      if (char === '\r' || char === '\n') {
        const line = this.#buffer
        this.#buffer = ''
        this.#events?.onData('\n')
        if (line.trim() === 'exit') {
          this.#events?.onData('exit\n')
          this.#closed = true
          this.#events?.onExit(0, null)
        } else {
          this.#events?.onData('ECHO:' + line + '\n')
        }
        continue
      }
      this.#buffer += char
      this.#events?.onData(char)
    }
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
