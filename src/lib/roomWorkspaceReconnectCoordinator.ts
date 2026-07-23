import type { RoomControlView } from './roomControl'
import type { TerminalRoomClient } from './terminalRoomClient'

type RoomSummary = {
  roomId: string
  roomGeneration: string
}

type ReconnectIdentity = {
  active: boolean
  connected: boolean
  roomId: string
  roomGeneration: string
  controlView: RoomControlView | null
  controlPending: boolean
  client: TerminalRoomClient | null
}

type RoomListFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type RoomWorkspaceReconnectOptions = {
  roomId: string
  identity(): ReconnectIdentity
  setConnected(value: boolean): void
  setControlView(value: RoomControlView | null): void
  setControlPending(value: boolean): void
  advanceConnectionGeneration(): void
  requestReconnect(): void
  resumeRunnerRepair(): void
  enterHome(): void
  notice(message: string): void
  fetcher?: RoomListFetch
  reconnectDelayMs?: number
}

const ROOM_CONTROL_RECLAIM_WINDOW_MS = 5_000
const RECONNECT_DELAY_MS = 750

export class RoomWorkspaceReconnectCoordinator {
  readonly #options: RoomWorkspaceReconnectOptions
  readonly #fetcher: RoomListFetch
  readonly #reconnectDelayMs: number
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #controlReclaimTimer: ReturnType<typeof setTimeout> | null = null
  #controlReclaimPending: boolean

  constructor(options: RoomWorkspaceReconnectOptions) {
    this.#options = options
    this.#fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init))
    this.#reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS
    this.#controlReclaimPending = isReloadNavigation() && rememberedRoomControl(options.roomId)
  }

  get controlReclaimPending(): boolean {
    return this.#controlReclaimPending
  }

  handleOpen(): void {
    this.#options.setConnected(true)
    this.#options.advanceConnectionGeneration()
    this.#clearReconnectTimer()
    this.#options.resumeRunnerRepair()
  }

  async handleClose(event?: CloseEvent): Promise<void> {
    const beforeClose = this.#options.identity()
    if (beforeClose.active && beforeClose.controlView?.mode === 'controller' && beforeClose.client?.canMutateShared) {
      this.armControlReclaim()
    }
    this.#options.setConnected(false)
    this.#options.setControlView(null)
    this.#options.setControlPending(false)
    if (!beforeClose.active) return

    const closedRoomId = beforeClose.roomId
    const closedGeneration = beforeClose.roomGeneration
    if (event?.code === 4001 || event?.reason === 'room_destroyed') {
      this.#options.enterHome()
      return
    }

    try {
      const response = await this.#fetcher('/api/rooms')
      const body = await response.json() as { ok: boolean; rooms?: RoomSummary[] }
      if (!response.ok || !body.ok || !this.#options.identity().active) return
      const stillLive = (body.rooms ?? []).some((room) =>
        room.roomId === closedRoomId && (!closedGeneration || room.roomGeneration === closedGeneration))
      if (!stillLive) this.#options.enterHome()
      else this.#scheduleReconnect(closedRoomId)
    } catch {
      this.#scheduleReconnect(closedRoomId)
    }
  }

  handleControlView(view: RoomControlView): void {
    if (view.mode === 'controller') {
      rememberRoomControl(this.#options.roomId, true)
      this.clearControlReclaim()
    } else if (view.mode === 'available' && this.#controlReclaimPending) {
      void this.#reclaimControl(view.controlEpoch)
    } else if (!this.#controlReclaimPending) {
      rememberRoomControl(this.#options.roomId, false)
    }
  }

  handleControlLost(): void {
    rememberRoomControl(this.#options.roomId, false)
    this.clearControlReclaim()
  }

  markControlOwned(): void {
    rememberRoomControl(this.#options.roomId, true)
    this.clearControlReclaim()
  }

  armControlReclaim(): void {
    this.#controlReclaimPending = true
    rememberRoomControl(this.#options.roomId, true)
    if (this.#controlReclaimTimer) clearTimeout(this.#controlReclaimTimer)
    this.#controlReclaimTimer = setTimeout(() => {
      this.#controlReclaimTimer = null
      this.#controlReclaimPending = false
      rememberRoomControl(this.#options.roomId, false)
    }, ROOM_CONTROL_RECLAIM_WINDOW_MS)
  }

  clearControlReclaim(): void {
    this.#controlReclaimPending = false
    if (this.#controlReclaimTimer) clearTimeout(this.#controlReclaimTimer)
    this.#controlReclaimTimer = null
  }

  dispose(): void {
    this.#clearReconnectTimer()
    this.clearControlReclaim()
  }

  async #reclaimControl(expectedControlEpoch: number): Promise<void> {
    const identity = this.#options.identity()
    const connection = identity.client
    if (!this.#controlReclaimPending || !connection || !identity.connected
      || identity.controlPending || identity.controlView?.mode !== 'available') return
    this.clearControlReclaim()
    this.#options.setControlPending(true)
    try {
      const result = await connection.acquireControl(expectedControlEpoch)
      this.#options.setControlView(result.view)
      rememberRoomControl(this.#options.roomId, true)
    } catch (error) {
      rememberRoomControl(this.#options.roomId, false)
      const reason = messageOf(error)
      if (reason !== 'room_control_held' && reason !== 'room_control_epoch_conflict') this.#options.notice(reason)
    } finally {
      this.#options.setControlPending(false)
    }
  }

  #scheduleReconnect(roomId: string): void {
    const identity = this.#options.identity()
    if (!identity.active || identity.roomId !== roomId || this.#reconnectTimer) return
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      const current = this.#options.identity()
      if (current.active && current.roomId === roomId) this.#options.requestReconnect()
    }, this.#reconnectDelayMs)
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = null
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function controlMemoryKey(roomId: string): string {
  return 'shell-deck:room-control-intent:' + roomId
}

function rememberedRoomControl(roomId: string): boolean {
  try { return sessionStorage.getItem(controlMemoryKey(roomId)) === 'controller' }
  catch { return false }
}

function rememberRoomControl(roomId: string, owned: boolean): void {
  if (!roomId) return
  try {
    if (owned) sessionStorage.setItem(controlMemoryKey(roomId), 'controller')
    else sessionStorage.removeItem(controlMemoryKey(roomId))
  } catch {}
}

function isReloadNavigation(): boolean {
  try {
    return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload'
  } catch {
    return false
  }
}
