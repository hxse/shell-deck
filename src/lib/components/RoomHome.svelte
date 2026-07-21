<script lang="ts">
  import { onMount } from 'svelte'

  type RoomSummary = {
    roomId: string
    roomGeneration: string
    terminalCount: number
    connectedClientCount: number
    hasActiveRun: boolean
  }

  let { onNotice, onMutationNotice } = $props<{
    onNotice: (text: string) => void
    onMutationNotice: (reason: string, prefix?: string) => void
  }>()

  let pageVisible = $state(document.visibilityState === 'visible')
  let homeLoading = $state(false)
  let rooms = $state<RoomSummary[]>([])
  let maxLiveRooms = $state(32)
  let homeEffectGeneration = 0
  let homeRequestInFlight = false

  onMount(() => {
    const refresh = () => {
      if (pageVisible) void loadRooms(homeEffectGeneration)
    }
    const visibility = () => {
      pageVisible = document.visibilityState === 'visible'
      if (pageVisible) void loadRooms(homeEffectGeneration)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visibility)
    }
  })

  $effect(() => {
    if (!pageVisible) return
    const generation = ++homeEffectGeneration
    void loadRooms(generation)
    const timer = window.setInterval(() => { void loadRooms(generation) }, 1000)
    return () => {
      window.clearInterval(timer)
      if (homeEffectGeneration === generation) homeEffectGeneration += 1
    }
  })

  async function loadRooms(expectedGeneration = homeEffectGeneration) {
    if (homeRequestInFlight) return
    homeRequestInFlight = true
    homeLoading = true
    try {
      const response = await fetch('/api/rooms')
      const body = await response.json() as { ok: boolean; rooms?: RoomSummary[]; maxLiveRooms?: number; error?: string }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'room_list_failed')
      if (expectedGeneration === homeEffectGeneration) {
        rooms = body.rooms ?? []
        maxLiveRooms = body.maxLiveRooms ?? 32
      }
    } catch (error) {
      onNotice(messageOf(error))
    } finally {
      homeLoading = false
      homeRequestInFlight = false
    }
  }

  async function newRoom() {
    try {
      const response = await fetch('/api/rooms', { method: 'POST' })
      const body = await response.json() as { ok: boolean; url?: string; error?: string }
      if (!response.ok || !body.ok || !body.url) throw new Error(body.error ?? 'room_create_failed')
      window.location.assign(body.url)
    } catch (error) { onMutationNotice(messageOf(error)) }
  }

  async function destroyRoom(room: RoomSummary) {
    const detail = `${room.terminalCount} terminals, ${room.connectedClientCount} connections${room.hasActiveRun ? ', active run' : ''}`
    if (!window.confirm('Destroy ' + room.roomId + '?\n' + detail)) return
    try {
      const response = await fetch('/api/rooms/' + encodeURIComponent(room.roomId), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRoomGeneration: room.roomGeneration }),
      })
      const body = await response.json() as { ok: boolean; error?: string }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'room_destroy_failed')
      await loadRooms()
    } catch (error) { onMutationNotice(messageOf(error)) }
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
</script>

<main class="room-home" data-testid="room-home">
  <header class="room-home-header">
    <div><h1>shell-deck</h1><p>Live Rooms in this server process</p></div>
    <div class="actions">
      <span data-testid="room-capacity">{rooms.length} / {maxLiveRooms}</span>

      <button type="button" data-testid="new-room" onclick={() => void newRoom()} disabled={rooms.length >= maxLiveRooms}>New Room</button>
    </div>
  </header>
  {#if rooms.length === 0}
    <section class="room-home-empty" data-testid="room-home-empty"><p>No live Rooms.</p><button type="button" data-testid="new-room-empty" onclick={() => void newRoom()}>New Room</button></section>
  {:else}
    <ul class="room-list" data-testid="room-list">
      {#each rooms as room (room.roomId)}
        <li>
          <button class="room-open" type="button" data-testid="room-open" onclick={() => window.location.assign('/' + room.roomId)}>
            <code>{room.roomId}</code><span>{room.terminalCount} terminals · {room.connectedClientCount} connections{room.hasActiveRun ? ' · running' : ''}</span>
          </button>
          <button class="room-destroy" type="button" data-testid="room-destroy" onclick={() => void destroyRoom(room)}>Destroy</button>
        </li>
      {/each}
    </ul>
  {/if}
</main>
