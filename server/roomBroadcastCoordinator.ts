import type { ServerMessage } from '../src/lib/protocol'
import type { RoomRuntime } from './roomLifecycleCoordinator'

type IndexBatch = {
  depth: number
  latest: Extract<ServerMessage, { type: 'terminal_index_map' }> | null
}

export class RoomBroadcastCoordinator {
  readonly #indexBatches = new Map<string, IndexBatch>()

  constructor(private readonly disconnectClient: (clientId: string) => void) {}

  broadcast(room: RoomRuntime, message: ServerMessage): void {
    if (room.lifecycle !== 'active') return
    const batch = this.#indexBatches.get(room.roomId)
    if (batch && message.type === 'terminal_index_map') {
      batch.latest = message
      return
    }
    const payload = JSON.stringify(message)
    for (const client of [...room.clients.values()]) {
      try {
        if (client.sendSerialized) client.sendSerialized(payload)
        else client.send(message)
      } catch {
        this.disconnectClient(client.clientId)
      }
    }
  }

  async batchIndexMaps<T>(room: RoomRuntime, operation: () => Promise<T> | T): Promise<T> {
    const existing = this.#indexBatches.get(room.roomId)
    const batch = existing ?? { depth: 0, latest: null }
    batch.depth += 1
    this.#indexBatches.set(room.roomId, batch)
    try {
      return await operation()
    } finally {
      batch.depth -= 1
      if (batch.depth === 0) {
        this.#indexBatches.delete(room.roomId)
        if (batch.latest) this.broadcast(room, batch.latest)
      }
    }
  }
}
