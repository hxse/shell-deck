const ENABLED_KEY = 'shell-deck-login-debug-enabled'
const LOG_KEY = 'shell-deck-login-debug-log'
const MAX_LINES = 160
const MAX_TEXT_LENGTH = 24_000

type DiagnosticValue = string | number | boolean | null | undefined
export type LoginQrDiagnosticDetails = Record<string, DiagnosticValue>

export class LoginQrDiagnostics {
  readonly enabled: boolean
  readonly #shell: HTMLDetailsElement | null
  readonly #output: HTMLTextAreaElement | null
  readonly #copyButton: HTMLButtonElement | null
  readonly #selectButton: HTMLButtonElement | null
  readonly #clearButton: HTMLButtonElement | null
  readonly #status: HTMLElement | null
  #lines: string[]

  constructor() {
    this.#shell = optionalElement('login-debug-shell', HTMLDetailsElement)
    this.#output = optionalElement('login-debug-output', HTMLTextAreaElement)
    this.#copyButton = optionalElement('copy-login-debug', HTMLButtonElement)
    this.#selectButton = optionalElement('select-login-debug', HTMLButtonElement)
    this.#clearButton = optionalElement('clear-login-debug', HTMLButtonElement)
    this.#status = optionalElement('login-debug-status', HTMLElement)
    if (location.hash === '#debug') safeSet(ENABLED_KEY, '1')
    this.enabled = safeGet(ENABLED_KEY) === '1'
      && this.#shell !== null && this.#output !== null
      && this.#copyButton !== null && this.#selectButton !== null
      && this.#clearButton !== null && this.#status !== null
    this.#lines = readLines()
    if (!this.enabled) return
    this.#shell!.classList.remove('hidden')
    this.#shell!.open = true
    this.#render()
    this.#copyButton!.addEventListener('click', () => void this.#copy())
    this.#selectButton!.addEventListener('click', () => this.#select())
    this.#clearButton!.addEventListener('click', () => this.#clear())
    this.event('page_loaded', {
      path: location.pathname + location.search,
      secureContext: window.isSecureContext,
      visibility: document.visibilityState,
      userAgent: navigator.userAgent,
    })
  }

  event(name: string, details: LoginQrDiagnosticDetails = {}): void {
    if (!this.enabled) return
    const detailText = Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ')
    const line = `${new Date().toISOString()} ${name}${detailText ? ` ${detailText}` : ''}`
    console.info('[shell-deck login]', name, details)
    this.#lines.push(line)
    while (this.#lines.length > MAX_LINES || this.#text().length > MAX_TEXT_LENGTH) this.#lines.shift()
    safeSet(LOG_KEY, JSON.stringify(this.#lines))
    this.#render()
  }

  #render(): void {
    if (!this.#output) return
    this.#output.value = this.#text()
    this.#output.scrollTop = this.#output.scrollHeight
  }

  #text(): string {
    return this.#lines.join('\n')
  }

  async #copy(): Promise<void> {
    const text = this.#text()
    this.#select()
    try {
      if (document.execCommand('copy')) {
        this.#status!.textContent = 'Debug log copied.'
        return
      }
    } catch {
      // Fall through to the modern Clipboard API.
    }
    try {
      if (!navigator.clipboard) throw new Error('clipboard_unavailable')
      await navigator.clipboard.writeText(text)
      this.#status!.textContent = 'Debug log copied.'
    } catch {
      this.#status!.textContent = 'Clipboard unavailable. The log is selected for manual copy.'
    }
  }

  #select(): void {
    this.#output!.focus()
    this.#output!.select()
    this.#output!.setSelectionRange(0, this.#output!.value.length)
    this.#status!.textContent = 'Debug log selected. Use the browser copy action.'
  }

  #clear(): void {
    this.#lines = []
    safeRemove(LOG_KEY)
    this.#render()
    this.#status!.textContent = 'Debug log cleared.'
  }
}

function readLines(): string[] {
  const raw = safeGet(LOG_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((line): line is string => typeof line === 'string') : []
  } catch {
    return []
  }
}

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Diagnostics still remain in memory when browser storage is unavailable.
  }
}

function safeRemove(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // The in-memory log was already cleared.
  }
}

function optionalElement<T extends Element>(
  id: string,
  constructor: { new(): T },
): T | null {
  const element = document.getElementById(id)
  return element instanceof constructor ? element : null
}
