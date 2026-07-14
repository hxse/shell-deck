import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from './terminalBackend'
import { BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END } from '../src/lib/terminal/terminalInputDelivery'

export class FakeTerminalBackend implements TerminalBackend {
  readonly kind = 'fake' as const
  readonly inputChannel = 'helper-stdin-pipe' as const
  #events: TerminalBackendEvent | null = null
  #buffer = ''
  #inBracketedPaste = false
  #closed = false
  readonly cwd: string | null
  cols: number
  rows: number

  constructor(options: TerminalBackendOptions = { cols: 80, rows: 24 }) {
    this.cols = options.cols
    this.rows = options.rows
    this.cwd = options.cwd ?? null
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
    for (let offset = 0; offset < data.length;) {
      if (!this.#inBracketedPaste && data.startsWith(BRACKETED_PASTE_BEGIN, offset)) {
        this.#inBracketedPaste = true
        offset += BRACKETED_PASTE_BEGIN.length
        continue
      }
      if (this.#inBracketedPaste && data.startsWith(BRACKETED_PASTE_END, offset)) {
        this.#inBracketedPaste = false
        offset += BRACKETED_PASTE_END.length
        continue
      }
      const char = data[offset]
      offset += 1
      if (this.#inBracketedPaste && (char === '\r' || char === '\n')) {
        this.#buffer += char
        this.#events?.onData(char)
        continue
      }
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

  currentCwd(): string | null {
    return this.#closed ? null : this.cwd
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true
      this.#events?.onExit(0, null)
    }
  }
}
