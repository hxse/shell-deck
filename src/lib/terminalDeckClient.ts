import type { ClientMessage, ServerMessage } from './protocol'

export type TerminalDeckClientOptions = {
  configId: string
  url?: string
  onMessage(message: ServerMessage): void
  onOpen?: () => void
  onClose?: () => void
}

export class TerminalDeckClient {
  readonly configId: string
  readonly ws: WebSocket

  constructor(options: TerminalDeckClientOptions) {
    this.configId = options.configId
    const url = options.url ?? defaultWsUrl(options.configId)
    this.ws = new WebSocket(url)
    this.ws.addEventListener('open', () => options.onOpen?.())
    this.ws.addEventListener('close', () => options.onClose?.())
    this.ws.addEventListener('message', (event) => {
      options.onMessage(JSON.parse(String(event.data)) as ServerMessage)
    })
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message))
  }

  close(): void {
    this.ws.close()
  }
}

function defaultWsUrl(configId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return proto + '//' + location.host + '/ws?configId=' + encodeURIComponent(configId)
}
