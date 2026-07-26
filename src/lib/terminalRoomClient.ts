import type { ContentEditLeaseGrant, ContentEditLeaseView, ContentResourceKey } from './contentEditLease'
import type { ClientMessage, ServerMessage } from './protocol'
import { roomControlHeaders, type RoomControlGrant, type RoomControlView } from './roomControl'

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
  fetcher?: TerminalRoomFetch
  apiBase?: string
}

export type TerminalRoomFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export class TerminalRoomClient {
  readonly roomId: string
  readonly ws: WebSocket
  readonly #batcher: TerminalOutputFrameBatcher
  readonly #onClose: ((event?: CloseEvent) => void) | undefined
  readonly #fetcher: TerminalRoomFetch
  readonly #apiBase: string
  #disposed = false
  #clientId = ''
  #roomGeneration = ''
  #controlView: RoomControlView | null = null
  #controlGrant: RoomControlGrant | null = null

  constructor(options: TerminalRoomClientOptions) {
    this.roomId = options.roomId
    this.ws = (options.createWebSocket ?? ((target) => new WebSocket(target)))(options.url ?? defaultWsUrl(options.roomId))
    this.#batcher = new TerminalOutputFrameBatcher(options.onMessage, options.frameScheduler)
    this.#onClose = options.onClose
    this.#fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init))
    this.#apiBase = options.apiBase ?? ''
    this.ws.addEventListener('open', () => { if (!this.#disposed) options.onOpen?.() })
    this.ws.addEventListener('close', (event) => this.#finishClose(event))
    this.ws.addEventListener('message', (event) => {
      if (!this.#disposed) {
        const message = JSON.parse(String(event.data)) as ServerMessage
        this.#acceptControlMessage(message)
        this.#batcher.accept(message)
      }
    })
  }

  get clientId(): string { return this.#clientId }
  get roomGeneration(): string { return this.#roomGeneration }
  get controlView(): RoomControlView | null { return this.#controlView }
  get controlGrant(): RoomControlGrant | null { return this.#controlGrant }
  get canMutateShared(): boolean { return this.#controlView?.mode === 'controller' && this.#controlGrant !== null }

  controlHeaders(): Record<string, string> {
    return this.#ownerHeaders()
  }

  send(message: ClientMessage): boolean {
    if (this.#disposed || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(message))
    return true
  }

  async acquireControl(expectedControlEpoch: number): Promise<{ view: RoomControlView; grant: RoomControlGrant }> {
    const result = await this.#requestControl('/api/rooms/' + encodeURIComponent(this.roomId) + '/control/acquire', {
      method: 'POST',
      headers: this.#clientHeaders(),
      body: JSON.stringify({ expectedControlEpoch }),
    })
    this.#controlView = result.view
    this.#controlGrant = result.grant
    return result
  }

  async takeOverControl(expectedControlEpoch: number): Promise<{ view: RoomControlView; grant: RoomControlGrant }> {
    const result = await this.#requestControl('/api/rooms/' + encodeURIComponent(this.roomId) + '/control/take-over', {
      method: 'POST',
      headers: this.#clientHeaders(),
      body: JSON.stringify({ expectedControlEpoch, confirmed: true }),
    })
    this.#controlView = result.view
    this.#controlGrant = result.grant
    return result
  }

  async releaseControl(): Promise<void> {
    await this.#request('/api/rooms/' + encodeURIComponent(this.roomId) + '/control', {
      method: 'DELETE',
      headers: this.#ownerHeaders(),
      body: '{}',
    })
    this.#controlGrant = null
  }

  async acquireContentEditLease(resourceKey: ContentResourceKey, expectedLeaseEpoch: number): Promise<{ view: ContentEditLeaseView; grant: ContentEditLeaseGrant }> {
    return await this.#requestLease('/api/content-edit-leases/acquire', {
      method: 'POST',
      headers: this.#ownerHeaders(),
      body: JSON.stringify({ resourceKey, expectedLeaseEpoch }),
    })
  }

  async contentEditLeaseView(resourceKey: ContentResourceKey): Promise<ContentEditLeaseView> {
    const body = await this.#request('/api/content-edit-leases/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceKey }),
    }) as { view?: ContentEditLeaseView }
    if (!body.view) throw new Error('invalid_content_edit_lease_response')
    return body.view
  }

  async takeOverContentEditLease(resourceKey: ContentResourceKey, expectedLeaseEpoch: number): Promise<{ view: ContentEditLeaseView; grant: ContentEditLeaseGrant }> {
    return await this.#requestLease('/api/content-edit-leases/take-over', {
      method: 'POST',
      headers: this.#ownerHeaders(),
      body: JSON.stringify({ resourceKey, expectedLeaseEpoch, confirmed: true }),
    })
  }

  async releaseContentEditLease(editLeaseId: string): Promise<ContentEditLeaseView> {
    const body = await this.#request('/api/content-edit-leases/' + encodeURIComponent(editLeaseId), {
      method: 'DELETE',
      headers: this.#ownerHeaders(),
      body: '{}',
    }) as { view?: ContentEditLeaseView }
    if (!body.view) throw new Error('invalid_content_edit_lease_response')
    return body.view
  }

  close(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#batcher.dispose()
    this.#controlGrant = null
    this.ws.close()
    this.#onClose?.()
  }

  #finishClose(event: CloseEvent): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#batcher.dispose()
    this.#controlGrant = null
    this.#onClose?.(event)
  }

  #acceptControlMessage(message: ServerMessage): void {
    if (message.type === 'client_registered') {
      this.#clientId = message.clientId
      this.#roomGeneration = message.roomGeneration
      return
    }
    if (message.type === 'room_control') {
      this.#controlView = message.view
      if (message.grant) this.#controlGrant = message.grant
      else if (message.view.mode !== 'controller' || this.#controlGrant?.controlEpoch !== message.view.controlEpoch) this.#controlGrant = null
      else this.#controlGrant = { ...this.#controlGrant, expiresAt: message.view.expiresAt }
      return
    }
    if (message.type === 'room_control_lost') this.#controlGrant = null
  }

  #clientHeaders(): Record<string, string> {
    if (!this.#clientId) throw new Error('room_control_required')
    return { 'content-type': 'application/json', 'x-shell-deck-client-id': this.#clientId }
  }

  #ownerHeaders(): Record<string, string> {
    if (!this.#controlGrant) throw new Error('room_control_required')
    return { 'content-type': 'application/json', ...roomControlHeaders(this.#controlGrant) }
  }

  async #requestControl(path: string, init: RequestInit): Promise<{ view: RoomControlView; grant: RoomControlGrant }> {
    const body = await this.#request(path, init) as { view?: RoomControlView; grant?: RoomControlGrant }
    if (!body.view || !body.grant) throw new Error('invalid_room_control_response')
    return { view: body.view, grant: body.grant }
  }

  async #requestLease(path: string, init: RequestInit): Promise<{ view: ContentEditLeaseView; grant: ContentEditLeaseGrant }> {
    const body = await this.#request(path, init) as { view?: ContentEditLeaseView; grant?: ContentEditLeaseGrant }
    if (!body.view || !body.grant) throw new Error('invalid_content_edit_lease_response')
    return { view: body.view, grant: body.grant }
  }

  async #request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const fetcher = this.#fetcher
    const response = await fetcher(this.#apiBase + path, init)
    const body = await response.json() as Record<string, unknown>
    if (!response.ok || body.ok !== true) throw new Error(typeof body.error === 'string' ? body.error : 'shell_deck_request_failed')
    return body
  }
}

function defaultWsUrl(roomId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const devBackendPort = import.meta.env.VITE_SHELL_DECK_DEV_BACKEND_PORT
  const host = devBackendPort ? browserReachableHost(location.hostname) + ':' + devBackendPort : location.host
  return proto + '//' + host + '/ws/rooms/' + encodeURIComponent(roomId)
}

function browserReachableHost(configuredHost: string): string {
  return configuredHost.includes(':') && !configuredHost.startsWith('[') ? '[' + configuredHost + ']' : configuredHost
}
