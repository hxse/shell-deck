<script lang="ts">
  import { onMount } from 'svelte'
  import { loadBrowserSettings, saveBrowserSettings, type BrowserSettings } from './lib/browserSettings'
  import NoticeStack, { type NoticeItem } from './lib/components/workspace/NoticeStack.svelte'
  import WorkspaceShell from './lib/components/workspace/WorkspaceShell.svelte'
  import type { ServerMessage, TerminalSnapshot } from './lib/protocol'
  import { TerminalRoomClient } from './lib/terminalRoomClient'
  import { TerminalViewStateStore, type TerminalViewSnapshot } from './lib/terminalViewState'

  type RoomSummary = {
    roomId: string
    roomGeneration: string
    terminalCount: number
    connectedClientCount: number
    hasActiveRun: boolean
  }

  const initialPath = window.location.pathname
  let isHome = $state(initialPath === '/')
  let roomId = $state(initialPath === '/' ? '' : decodeURIComponent(initialPath.slice(1)))
  const loadedSettings = loadBrowserSettings()
  const terminalViews = new TerminalViewStateStore()

  let settings = $state<BrowserSettings>(loadedSettings.settings)
  let noticeSeq = 0
  let notice = $state<NoticeItem | null>(null)
  let settingsOpen = $state(false)

  let homeLoading = $state(false)
  let rooms = $state<RoomSummary[]>([])
  let maxLiveRooms = $state(32)

  let connected = $state(false)
  let roomGeneration = $state('')
  let latestRoomRevision = $state(0)
  let client = $state<TerminalRoomClient | null>(null)
  let terminals = $state<TerminalViewSnapshot[]>([])
  let activeTerminalId = $state<string | null>(null)
  let draggingTerminalId = $state<string | null>(null)
  let activeTerminal = $derived(terminals.find((terminal) => terminal.terminalId === activeTerminalId) ?? terminals[0] ?? null)

  onMount(() => {
    if (loadedSettings.reset) pushNotice('Browser settings were reset because the stored schema is invalid.')
    if (isHome) void loadRooms()
    const refresh = () => { if (isHome) void loadRooms() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  })

  $effect(() => {
    if (isHome) return
    terminalViews.clear()
    terminals = []
    latestRoomRevision = 0
    const connection = new TerminalRoomClient({
      roomId,
      onOpen: () => { connected = true },
      onClose: (event) => { void handleConnectionClose(event) },
      onMessage: handleMessage,
    })
    client = connection
    return () => connection.close()
  })

  $effect(() => {
    if (terminals.length === 0) activeTerminalId = null
    else if (!activeTerminalId || !terminals.some((terminal) => terminal.terminalId === activeTerminalId)) activeTerminalId = terminals[0].terminalId
  })

  $effect(() => {
    try { saveBrowserSettings(settings) } catch {}
  })

  function handleMessage(message: ServerMessage) {
    if (message.type === 'client_registered') {
      roomGeneration = message.roomGeneration
      latestRoomRevision = 0
    }
    if ('roomGeneration' in message && roomGeneration && message.roomGeneration !== roomGeneration) return
    if (message.type === 'room_snapshot') {
      if (!acceptRoomRevision(message.roomRevision)) return
      terminals = terminalViews.mergeRoom(message.terminals, terminals)
    }
    if (message.type === 'terminal_snapshot') {
      observeRoomRevision(message.roomRevision)
      upsertTerminal(message)
    }
    if (message.type === 'terminal_created') activeTerminalId = message.terminalId
    if (message.type === 'pty_output') {
      observeRoomRevision(message.roomRevision)
      appendTerminalReplay(message)
    }
    if (message.type === 'terminal_replay') {
      observeRoomRevision(message.roomRevision)
      replaceTerminalReplay(message)
    }
    if (message.type === 'terminal_index_map') {
      if (!acceptRoomRevision(message.roomRevision)) return
      terminals = terminals.map((terminal) => {
        const mapped = message.items.find((item) => item.terminalId === terminal.terminalId)
        return mapped ? { ...terminal, terminalIndex: mapped.index, visualOrder: mapped.index } : terminal
      }).sort((left, right) => left.terminalIndex - right.terminalIndex)
    }
    if (message.type === 'terminal_error') pushNotice((message.terminalId ? message.terminalId + ': ' : '') + message.reason)
    if (message.type === 'input_rejected') pushNotice(message.terminalId + ': input rejected: ' + message.reason)
    if (message.type === 'terminal_state') {
      observeRoomRevision(message.roomRevision)
      terminals = terminals.map((terminal) => terminal.terminalId === message.terminalId
        ? terminalViews.patch(terminal, message, { status: message.status, cols: message.cols, rows: message.rows, exitCode: message.exitCode, signal: message.signal })
        : terminal)
    }
    if (message.type === 'terminal_cwd') {
      observeRoomRevision(message.roomRevision)
      terminals = terminals.map((terminal) => terminal.terminalId === message.terminalId
        ? terminalViews.patch(terminal, message, { cwd: message.cwd })
        : terminal)
    }
    if (message.type === 'room_destroyed') enterHomeWithoutRootRequest()
  }

  async function loadRooms() {
    homeLoading = true
    try {
      const response = await fetch('/api/rooms')
      const body = await response.json() as { ok: boolean; rooms?: RoomSummary[]; maxLiveRooms?: number; error?: string }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'room_list_failed')
      rooms = body.rooms ?? []
      maxLiveRooms = body.maxLiveRooms ?? 32
    } catch (error) {
      pushNotice(messageOf(error))
    } finally {
      homeLoading = false
    }
  }

  function enterHomeWithoutRootRequest() {
    if (isHome) return
    window.history.replaceState(null, '', '/')
    isHome = true
    roomId = ''
    connected = false
    roomGeneration = ''
    latestRoomRevision = 0
    terminalViews.clear()
    terminals = []
    activeTerminalId = null
    void loadRooms()
  }

  async function handleConnectionClose(event?: CloseEvent) {
    connected = false
    if (isHome) return
    const closedRoomId = roomId
    const closedGeneration = roomGeneration
    if (event?.code === 4001 || event?.reason === 'room_destroyed') {
      enterHomeWithoutRootRequest()
      return
    }
    try {
      const response = await fetch('/api/rooms')
      const body = await response.json() as { ok: boolean; rooms?: RoomSummary[] }
      if (!response.ok || !body.ok || isHome || roomId !== closedRoomId) return
      const stillLive = (body.rooms ?? []).some((room) => room.roomId === closedRoomId && (!closedGeneration || room.roomGeneration === closedGeneration))
      if (!stillLive) enterHomeWithoutRootRequest()
    } catch {}
  }

  async function newRoom() {
    try {
      const response = await fetch('/api/rooms', { method: 'POST' })
      const body = await response.json() as { ok: boolean; url?: string; error?: string }
      if (!response.ok || !body.ok || !body.url) throw new Error(body.error ?? 'room_create_failed')
      window.location.assign(body.url)
    } catch (error) { pushNotice(messageOf(error)) }
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
    } catch (error) { pushNotice(messageOf(error)) }
  }

  function createShell() {
    client?.send({ type: 'create_terminal', backend: 'real', cwdSource: 'last-shell' })
  }

  function createText() {
    client?.send({ type: 'create_terminal', backend: 'text' })
  }

  function updateSettings(next: Partial<BrowserSettings>) {
    settings = { ...settings, ...next }
  }

  function upsertTerminal(snapshot: TerminalSnapshot) {
    const index = terminals.findIndex((terminal) => terminal.terminalId === snapshot.terminalId)
    const view = terminalViews.mergeSnapshot(snapshot, index === -1 ? undefined : terminals[index])
    if (index === -1) {
      terminals = [...terminals, view].sort((left, right) => left.terminalIndex - right.terminalIndex)
    } else {
      terminals = terminals.map((terminal) => terminal.terminalId === snapshot.terminalId ? view : terminal).sort((left, right) => left.terminalIndex - right.terminalIndex)
    }
  }

  function appendTerminalReplay(message: Extract<ServerMessage, { type: 'pty_output' }>) {
    terminals = terminals.map((terminal) => terminal.terminalId === message.terminalId
      ? terminalViews.append(terminal, message.data, message)
      : terminal)
  }

  function replaceTerminalReplay(message: Extract<ServerMessage, { type: 'terminal_replay' }>) {
    terminals = terminals.map((terminal) => terminal.terminalId === message.terminalId
      ? terminalViews.replaceReplay(terminal, message.replay, message)
      : terminal)
  }

  function acceptRoomRevision(revision: number): boolean {
    if (revision < latestRoomRevision) return false
    latestRoomRevision = revision
    return true
  }

  function observeRoomRevision(revision: number): void {
    latestRoomRevision = Math.max(latestRoomRevision, revision)
  }

  function closeTerminalTab(event: MouseEvent, terminal: TerminalSnapshot) {
    event.stopPropagation()
    if (window.confirm('Close terminal ' + terminal.terminalIndex + ' · ' + terminal.terminalId + '?')) client?.send({ type: 'close_terminal', terminalId: terminal.terminalId })
  }

  function startDrag(event: DragEvent, terminalId: string) {
    if (!settings.terminalDragEnabled) { event.preventDefault(); return }
    draggingTerminalId = terminalId
    event.dataTransfer?.setData('text/plain', terminalId)
  }

  function dropOnTab(event: DragEvent, target: TerminalSnapshot) {
    event.preventDefault()
    const source = event.dataTransfer?.getData('text/plain') || draggingTerminalId
    draggingTerminalId = null
    if (settings.terminalDragEnabled && source && source !== target.terminalId) {
      client?.send({ type: 'reorder_terminal', terminalId: source, newIndex: target.terminalIndex })
      activeTerminalId = source
    }
  }

  function tabKeydown(event: KeyboardEvent, terminal: TerminalSnapshot) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activeTerminalId = terminal.terminalId }
  }

  function pushNotice(text: string) {
    notice = { id: ++noticeSeq, text: text.length > 500 ? text.slice(0, 500) + '...' : text }
  }

  function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }
</script>

{#if isHome}
  <main class="room-home" data-testid="room-home">
    <header class="room-home-header">
      <div><h1>shell-deck</h1><p>Live Rooms in this server process</p></div>
      <div class="actions">
        <span data-testid="room-capacity">{rooms.length} / {maxLiveRooms}</span>
        <button type="button" data-testid="home-refresh" onclick={() => void loadRooms()} disabled={homeLoading}>Refresh</button>
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
{:else}
  <main class="room-shell">
    <header class="topbar compact-topbar">
      <div class="brand-line"><h1>shell-deck</h1><p data-testid="room-identity">{roomId} · {connected ? 'connected' : 'disconnected'}</p></div>
      <div class="actions">
        <button type="button" data-testid="home-button" onclick={() => window.open('/', '_blank', 'noopener')}>Home</button>
        <button type="button" class="terminal-create-button" data-testid="terminal-create-real" onclick={createShell} disabled={!connected}>New shell</button>
        <button type="button" class="terminal-create-button" data-testid="terminal-create-text" onclick={createText} disabled={!connected}>New text</button>
        <button type="button" class="settings-button" data-testid="settings-button" onclick={() => { settingsOpen = !settingsOpen }}>Settings</button>
      </div>
    </header>
    {#if settingsOpen}
      <button class="popover-dismiss-layer settings-dismiss-layer" type="button" data-testid="settings-dismiss-layer" aria-label="Close settings" onclick={() => { settingsOpen = false }}></button>
      <section class="settings-popover" data-testid="settings-popover">
        <div class="settings-popover-head"><strong>Settings</strong><button type="button" data-testid="settings-close" onclick={() => { settingsOpen = false }}>Close</button></div>
        <button
          type="button"
          class="drag-toggle settings-drag-toggle"
          data-testid="tab-drag-toggle"
          aria-pressed={settings.terminalDragEnabled}
          onclick={() => updateSettings({ terminalDragEnabled: !settings.terminalDragEnabled })}
        ><span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span><span>Drag terminals</span></button>
      </section>
    {/if}
    <NoticeStack {notice} onDismiss={(id) => { if (notice?.id === id) notice = null }} />
    <WorkspaceShell
      {client}
      {terminals}
      {activeTerminal}
      {activeTerminalId}
      {draggingTerminalId}
      tabDragEnabled={settings.terminalDragEnabled}
      onSelectTerminal={(id) => { activeTerminalId = id }}
      onCloseTerminal={closeTerminalTab}
      onStartTabDrag={startDrag}
      onDropOnTab={dropOnTab}
      onTabDragEnd={() => { draggingTerminalId = null }}
      onTabKeydown={tabKeydown}
    />
  </main>
{/if}

{#if isHome}<NoticeStack {notice} onDismiss={(id) => { if (notice?.id === id) notice = null }} />{/if}
