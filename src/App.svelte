<script lang="ts">
  import { onMount } from 'svelte'
  import { loadBrowserSettings, saveBrowserSettings, type BrowserSettings } from './lib/browserSettings'
  import NoticeStack, { type NoticeItem } from './lib/components/workspace/NoticeStack.svelte'
  import WorkspaceShell from './lib/components/workspace/WorkspaceShell.svelte'
  import type { ContentEditLeaseChangedMessage, ContentRecordChangedMessage, MacroNotificationMessage, MacroNotificationSound, RoomSnapshot, ServerMessage, TerminalRuntimePosition, TerminalSnapshot } from './lib/protocol'
  import type { MacroRunnerSnapshot } from './lib/macro/runnerTypes'
  import { mergeMacroRunnerDelta } from './lib/macro/runnerSnapshotMerge'
  import type { RoomControlView } from './lib/roomControl'
  import { RoomRevisionGate } from './lib/roomRevisionGate'
  import { TerminalRoomClient } from './lib/terminalRoomClient'
  import { applyTerminalStateProjection, TerminalViewStateStore, type TerminalViewSnapshot } from './lib/terminalViewState'
  import { isRoomControlFeedback, sharedMutationFeedback } from './lib/sharedMutationFeedback'

  type RoomSummary = {
    roomId: string
    roomGeneration: string
    terminalCount: number
    connectedClientCount: number
    hasActiveRun: boolean
  }

  const initialPath = window.location.pathname
  const initialRoomId = initialPath === '/' ? '' : decodeURIComponent(initialPath.slice(1))
  let isHome = $state(initialPath === '/')
  let roomId = $state(initialRoomId)
  const ROOM_CONTROL_RECLAIM_WINDOW_MS = 5_000
  const loadedSettings = loadBrowserSettings()
  const terminalViews = new TerminalViewStateStore()
  const roomRevisionGate = new RoomRevisionGate()

  let settings = $state<BrowserSettings>(loadedSettings.settings)
  let noticeSeq = 0
  let notice = $state<NoticeItem | null>(null)
  let settingsOpen = $state(false)
  let macroDirty = $state(false)
  let pageVisible = $state(document.visibilityState === 'visible')

  let homeLoading = $state(false)
  let rooms = $state<RoomSummary[]>([])
  let maxLiveRooms = $state(32)

  let connected = $state(false)
  let connectionGeneration = $state(0)
  let reconnectNonce = $state(0)
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let controlReclaimTimer: ReturnType<typeof setTimeout> | null = null
  let controlReclaimPending = initialRoomId !== '' && isReloadNavigation() && rememberedRoomControl(initialRoomId)
  let roomGeneration = $state('')
  let controlView = $state<RoomControlView | null>(null)
  let controlPending = $state(false)
  let client = $state<TerminalRoomClient | null>(null)
  let terminals = $state<TerminalViewSnapshot[]>([])
  let terminalStructureRevision = $state(0)
  let terminalPositions = $state<TerminalRuntimePosition[] | null>(null)
  let terminalStructureLocked = $state(false)
  let runnerSnapshot = $state<MacroRunnerSnapshot | null>(null)
  const RUNNER_REPAIR_MAX_ATTEMPTS = 3
  const RUNNER_REPAIR_RETRY_DELAYS_MS = [100, 300] as const
  let runnerRepairPending = false
  let runnerRepairRoomId = ''
  let runnerRepairRoomGeneration = ''
  let runnerRepairAttempts = 0
  let runnerRepairToken = 0
  let runnerRepairTimer: ReturnType<typeof setTimeout> | null = null
  let runnerRepairAbort: AbortController | null = null
  let runnerResyncInFlightToken: number | null = null
  let contentChangeSequence = 0
  let contentRecordChanges = $state<Array<ContentRecordChangedMessage & { sequence: number }>>([])
  let contentLeaseChangeSequence = 0
  let contentEditLeaseChanges = $state<Array<ContentEditLeaseChangedMessage & { sequence: number }>>([])
  let libraryDirty = $state(false)
  let activeTerminalId = $state<string | null>(null)
  let draggingTerminalId = $state<string | null>(null)
  let activeTerminal = $derived(terminals.find((terminal) => terminal.terminalId === activeTerminalId) ?? terminals[0] ?? null)
  let canMutateShared = $derived(connected && controlView?.mode === 'controller' && client?.canMutateShared === true)
  const NOTIFICATION_MAX_GAIN = 0.12
  const seenNotifications = new Set<string>()
  const seenNotificationOrder: string[] = []
  let homeEffectGeneration = 0
  let homeRequestInFlight = false

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!macroDirty && !libraryDirty) return
    event.preventDefault()
    event.returnValue = ''
  }

  onMount(() => {
    if (loadedSettings.reset) pushNotice('Browser settings were reset because the stored schema is invalid.')
    if (controlReclaimPending) armControlReclaim()
    const refresh = () => {
      if (isHome && pageVisible) void loadRooms(homeEffectGeneration)
      else if (!isHome) resumeRunnerRepair()
    }
    const visibility = () => {
      pageVisible = document.visibilityState === 'visible'
      if (pageVisible && isHome) void loadRooms(homeEffectGeneration)
      else if (pageVisible) resumeRunnerRepair()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visibility)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (controlReclaimTimer) clearTimeout(controlReclaimTimer)
      clearRunnerRepair()
    }
  })

  $effect(() => {
    if (!isHome || !pageVisible) return
    const generation = ++homeEffectGeneration
    void loadRooms(generation)
    const timer = window.setInterval(() => { void loadRooms(generation) }, 1000)
    return () => {
      window.clearInterval(timer)
      if (homeEffectGeneration === generation) homeEffectGeneration += 1
    }
  })

  $effect(() => {
    if (isHome) return
    reconnectNonce
    terminalViews.clear()
    roomRevisionGate.reset()
    terminals = []
    terminalStructureRevision = 0
    terminalPositions = null
    terminalStructureLocked = false
    runnerSnapshot = null
    if (runnerRepairPending && runnerRepairRoomId !== roomId) clearRunnerRepair()
    else suspendRunnerRepair()
    contentRecordChanges = []
    contentEditLeaseChanges = []
    seenNotifications.clear()
    seenNotificationOrder.splice(0)
    connected = false
    controlView = null
    controlPending = false
    const connection = new TerminalRoomClient({
      roomId,
      onOpen: () => {
        connected = true
        connectionGeneration += 1
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = null
        resumeRunnerRepair()
      },
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
      if (runnerRepairPending && runnerRepairRoomGeneration !== message.roomGeneration) clearRunnerRepair()
      roomGeneration = message.roomGeneration
      roomRevisionGate.reset()
      resumeRunnerRepair()
    }
    if ('roomGeneration' in message && roomGeneration && message.roomGeneration !== roomGeneration) return
    if (message.type === 'room_control') {
      controlView = message.view
      if (message.view.mode === 'controller') {
        rememberRoomControl(roomId, true)
        clearControlReclaim()
      } else if (message.view.mode === 'available' && controlReclaimPending) {
        void reclaimControlAfterReconnect(message.view.controlEpoch)
      } else if (!controlReclaimPending) rememberRoomControl(roomId, false)
    }
    if (message.type === 'room_control_lost') {
      rememberRoomControl(roomId, false)
      clearControlReclaim()
      controlView = { mode: 'observer', controlEpoch: message.controlEpoch, expiresAt: new Date().toISOString() }
      pushMutationNotice('room_control_lost')
    }
    if (message.type === 'room_snapshot') applyRoomSnapshot(message)
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
      if (!roomRevisionGate.acceptIndexMap(message.roomRevision)) return
      terminalStructureRevision = message.terminalStructureRevision
      terminalPositions = message.terminalPositions
      terminalStructureLocked = message.terminalStructureLocked
      terminals = terminals.map((terminal) => {
        const mapped = message.items.find((item) => item.terminalId === terminal.terminalId)
        return mapped ? { ...terminal, terminalIndex: mapped.index, visualOrder: mapped.index } : terminal
      }).sort((left, right) => left.terminalIndex - right.terminalIndex)
    }
    if (message.type === 'terminal_error') pushMutationNotice(message.reason, message.terminalId ? message.terminalId + ': ' : '')
    if (message.type === 'input_rejected') pushMutationNotice(message.reason, message.terminalId + ': ')
    if (message.type === 'runner_snapshot' && (!roomGeneration || message.snapshot.roomGeneration === roomGeneration)) {
      installFullRunnerSnapshot(message.snapshot)
      if (runnerRepairPending) resumeRunnerRepair()
    }
    if (message.type === 'runner_delta' && (!roomGeneration || message.delta.roomGeneration === roomGeneration)) {
      const merged = mergeMacroRunnerDelta(runnerSnapshot, message.delta)
      if (merged.kind === 'applied') runnerSnapshot = merged.snapshot
      else if (merged.kind === 'resync_required') requestRunnerRepair(message.delta.roomGeneration)
      if (runnerRepairPending) resumeRunnerRepair()
    }
    if (message.type === 'content_record_changed') {
      contentRecordChanges = [...contentRecordChanges.slice(-199), { ...message, sequence: ++contentChangeSequence }]
    }
    if (message.type === 'content_edit_lease_changed') {
      contentEditLeaseChanges = [...contentEditLeaseChanges.slice(-199), { ...message, sequence: ++contentLeaseChangeSequence }]
    }
    if (message.type === 'macro_notification') void handleMacroNotification(message)
    if (message.type === 'terminal_state') {
      observeRoomRevision(message.roomRevision)
      const applied = applyTerminalStateProjection(terminalViews, terminals, terminalPositions, message)
      terminals = applied.terminals
      terminalPositions = applied.positions
    }
    if (message.type === 'terminal_cwd') {
      observeRoomRevision(message.roomRevision)
      terminals = terminals.map((terminal) => terminal.terminalId === message.terminalId
        ? terminalViews.patch(terminal, message, { cwd: message.cwd })
        : terminal)
    }
    if (message.type === 'room_destroyed') enterHomeWithoutRootRequest()
  }

  async function loadRooms(expectedGeneration = homeEffectGeneration) {
    if (homeRequestInFlight) return
    homeRequestInFlight = true
    homeLoading = true
    try {
      const response = await fetch('/api/rooms')
      const body = await response.json() as { ok: boolean; rooms?: RoomSummary[]; maxLiveRooms?: number; error?: string }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'room_list_failed')
      if (isHome && expectedGeneration === homeEffectGeneration) {
        rooms = body.rooms ?? []
        maxLiveRooms = body.maxLiveRooms ?? 32
      }
    } catch (error) {
      pushNotice(messageOf(error))
    } finally {
      homeLoading = false
      homeRequestInFlight = false
    }
  }

  function enterHomeWithoutRootRequest() {
    if (isHome) return
    window.history.replaceState(null, '', '/')
    isHome = true
    roomId = ''
    connected = false
    controlView = null
    controlPending = false
    roomGeneration = ''
    roomRevisionGate.reset()
    terminalViews.clear()
    terminals = []
    terminalStructureRevision = 0
    terminalPositions = null
    terminalStructureLocked = false
    runnerSnapshot = null
    clearRunnerRepair()
    contentRecordChanges = []
    contentEditLeaseChanges = []
    libraryDirty = false
    activeTerminalId = null
    macroDirty = false
  }

  async function handleConnectionClose(event?: CloseEvent) {
    if (!isHome && controlView?.mode === 'controller' && client?.canMutateShared) armControlReclaim()
    connected = false
    controlView = null
    controlPending = false
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
      else scheduleReconnect(closedRoomId)
    } catch {
      scheduleReconnect(closedRoomId)
    }
  }

  function scheduleReconnect(expectedRoomId: string) {
    if (isHome || roomId !== expectedRoomId || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (!isHome && roomId === expectedRoomId) reconnectNonce += 1
    }, 750)
  }

  async function newRoom() {
    try {
      const response = await fetch('/api/rooms', { method: 'POST' })
      const body = await response.json() as { ok: boolean; url?: string; error?: string }
      if (!response.ok || !body.ok || !body.url) throw new Error(body.error ?? 'room_create_failed')
      window.location.assign(body.url)
    } catch (error) { pushMutationNotice(messageOf(error)) }
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
    } catch (error) { pushMutationNotice(messageOf(error)) }
  }

  function createShell() {
    if (!canMutateShared) { pushMutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { pushMutationNotice('room_structure_locked_by_run'); return }
    client?.send({ type: 'create_terminal', backend: 'real', cwdSource: 'last-shell' })
  }

  function createText() {
    if (!canMutateShared) { pushMutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { pushMutationNotice('room_structure_locked_by_run'); return }
    client?.send({ type: 'create_terminal', backend: 'text' })
  }

  async function takeControl() {
    const connection = client
    const view = controlView
    if (!connection || !connected || !view || view.mode === 'controller' || controlPending) return
    if (view.mode === 'observer' && !window.confirm('Take control of this Room?\nShared terminals and the active Macro run stay on the server and will not be lost. The other connected device becomes read-only. Its unsaved browser-local Macro or Library draft remains on that device, but it cannot save shared changes until it takes control again.')) return
    controlPending = true
    try {
      const result = view.mode === 'available'
        ? await connection.acquireControl(view.controlEpoch)
        : await connection.takeOverControl(view.controlEpoch)
      controlView = result.view
      rememberRoomControl(roomId, true)
      clearControlReclaim()
      if (notice?.kind === 'mutation' && isRoomControlFeedback(notice.reason)) notice = null
    } catch (error) {
      pushMutationNotice(messageOf(error))
    } finally {
      controlPending = false
    }
  }

  async function reclaimControlAfterReconnect(expectedControlEpoch: number) {
    const connection = client
    if (!controlReclaimPending || !connection || !connected || controlPending || controlView?.mode !== 'available') return
    clearControlReclaim()
    controlPending = true
    try {
      const result = await connection.acquireControl(expectedControlEpoch)
      controlView = result.view
      rememberRoomControl(roomId, true)
    } catch (error) {
      rememberRoomControl(roomId, false)
      const reason = messageOf(error)
      if (reason !== 'room_control_held' && reason !== 'room_control_epoch_conflict') pushNotice(reason)
    } finally {
      controlPending = false
    }
  }

  function armControlReclaim() {
    controlReclaimPending = true
    rememberRoomControl(roomId, true)
    if (controlReclaimTimer) clearTimeout(controlReclaimTimer)
    controlReclaimTimer = setTimeout(() => {
      controlReclaimTimer = null
      controlReclaimPending = false
      rememberRoomControl(roomId, false)
    }, ROOM_CONTROL_RECLAIM_WINDOW_MS)
  }

  function clearControlReclaim() {
    controlReclaimPending = false
    if (controlReclaimTimer) clearTimeout(controlReclaimTimer)
    controlReclaimTimer = null
  }

  function updateSettings(next: Partial<BrowserSettings>) {
    settings = { ...settings, ...next }
  }

  function updateMacroPanel(widthPx?: number, visible?: boolean) {
    settings = {
      ...settings,
      panels: {
        ...settings.panels,
        macro: {
          visible: visible ?? settings.panels.macro.visible,
          widthPx: widthPx ?? settings.panels.macro.widthPx,
        },
      },
    }
  }

  function updateLibraryPanel(widthPx?: number, visible?: boolean) {
    settings = {
      ...settings,
      panels: {
        ...settings.panels,
        library: {
          visible: visible ?? settings.panels.library.visible,
          widthPx: widthPx ?? settings.panels.library.widthPx,
        },
      },
    }
  }

  function updateLibraryPreference(selectedTab: 'json-template' | 'prompt' | 'note', filter: string) {
    settings = { ...settings, library: { selectedTab, filter } }
  }

  function applyRoomSnapshot(snapshot: RoomSnapshot) {
    if (roomGeneration && snapshot.roomGeneration !== roomGeneration) return
    if (!roomRevisionGate.acceptRoomSnapshot(snapshot.roomRevision)) return
    terminalStructureRevision = snapshot.terminalStructureRevision
    terminalPositions = snapshot.terminalPositions
    terminalStructureLocked = snapshot.terminalStructureLocked
    terminals = terminalViews.mergeRoom(snapshot.terminals, terminals)
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

  function observeRoomRevision(revision: number): void {
    roomRevisionGate.observeTerminal(revision)
  }

  function requestRunnerRepair(expectedRoomGeneration: string): void {
    if (isHome || !roomId || !expectedRoomGeneration) return
    if (!runnerRepairPending || runnerRepairRoomId !== roomId || runnerRepairRoomGeneration !== expectedRoomGeneration) {
      clearRunnerRepair()
      runnerRepairPending = true
      runnerRepairRoomId = roomId
      runnerRepairRoomGeneration = expectedRoomGeneration
      runnerRepairAttempts = 0
    }
    resumeRunnerRepair()
  }

  function resumeRunnerRepair(): void {
    if (!runnerRepairPending || !connected || isHome || !roomId || roomId !== runnerRepairRoomId) return
    if (roomGeneration && roomGeneration !== runnerRepairRoomGeneration) return
    if (runnerResyncInFlightToken !== null || runnerRepairTimer !== null) return
    if (runnerRepairAttempts >= RUNNER_REPAIR_MAX_ATTEMPTS) runnerRepairAttempts = 0
    scheduleRunnerRepair(0)
  }

  function scheduleRunnerRepair(delayMs: number): void {
    if (!runnerRepairPending || runnerResyncInFlightToken !== null || runnerRepairTimer !== null) return
    const token = runnerRepairToken
    runnerRepairTimer = setTimeout(() => {
      runnerRepairTimer = null
      if (token !== runnerRepairToken) return
      void resyncRunnerSnapshot(token)
    }, delayMs)
  }

  async function resyncRunnerSnapshot(expectedToken: number): Promise<void> {
    if (!runnerRepairPending || !connected || expectedToken !== runnerRepairToken || runnerResyncInFlightToken !== null || isHome || !roomId) return
    runnerResyncInFlightToken = expectedToken
    runnerRepairAttempts += 1
    const expectedRoomId = roomId
    const expectedRoomGeneration = runnerRepairRoomGeneration
    const expectedConnectionGeneration = connectionGeneration
    const abort = new AbortController()
    runnerRepairAbort = abort
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(expectedRoomId)}/runner`, { signal: abort.signal })
      const body = await response.json() as { ok?: boolean; runner?: MacroRunnerSnapshot; error?: string }
      if (!response.ok || body.ok !== true || !body.runner) throw new Error(body.error ?? 'runner_resync_failed')
      if (!runnerRepairIdentityMatches(expectedToken, expectedRoomId, expectedRoomGeneration, expectedConnectionGeneration)) return
      if (body.runner.roomId !== expectedRoomId || body.runner.roomGeneration !== expectedRoomGeneration) throw new Error('runner_resync_identity_mismatch')
      const validated = mergeMacroRunnerDelta(null, body.runner)
      if (validated.kind !== 'applied') throw new Error('runner_resync_invalid_snapshot')
      if (runnerSnapshot?.roomGeneration === body.runner.roomGeneration && body.runner.runtimeRevision < runnerSnapshot.runtimeRevision) {
        throw new Error('runner_resync_stale_snapshot')
      }
      runnerSnapshot = validated.snapshot
      clearRunnerRepair()
    } catch (error) {
      if (abort.signal.aborted || !runnerRepairIdentityMatches(expectedToken, expectedRoomId, expectedRoomGeneration, expectedConnectionGeneration)) return
      if (runnerRepairAttempts < RUNNER_REPAIR_MAX_ATTEMPTS) {
        const delay = RUNNER_REPAIR_RETRY_DELAYS_MS[runnerRepairAttempts - 1] ?? RUNNER_REPAIR_RETRY_DELAYS_MS.at(-1)!
        scheduleRunnerRepair(delay)
      } else {
        pushNotice('runner_resync_pending: ' + messageOf(error))
      }
    } finally {
      if (runnerRepairAbort === abort) runnerRepairAbort = null
      if (runnerResyncInFlightToken === expectedToken) runnerResyncInFlightToken = null
      if (runnerRepairPending && runnerRepairToken === expectedToken && runnerRepairAttempts < RUNNER_REPAIR_MAX_ATTEMPTS && runnerRepairTimer === null) {
        const delay = RUNNER_REPAIR_RETRY_DELAYS_MS[runnerRepairAttempts - 1] ?? RUNNER_REPAIR_RETRY_DELAYS_MS.at(-1)!
        scheduleRunnerRepair(delay)
      }
      else if (runnerRepairPending && runnerRepairToken !== expectedToken) resumeRunnerRepair()
    }
  }

  function installFullRunnerSnapshot(snapshot: MacroRunnerSnapshot): void {
    const validated = mergeMacroRunnerDelta(null, snapshot)
    if (validated.kind !== 'applied') {
      requestRunnerRepair(snapshot.roomGeneration)
      return
    }
    const mayInstall = !runnerSnapshot
      || runnerSnapshot.roomGeneration !== snapshot.roomGeneration
      || snapshot.runtimeRevision > runnerSnapshot.runtimeRevision
      || (runnerRepairPending && snapshot.runtimeRevision === runnerSnapshot.runtimeRevision)
    if (!mayInstall) return
    runnerSnapshot = validated.snapshot
    if (runnerRepairPending && runnerRepairRoomId === roomId && runnerRepairRoomGeneration === snapshot.roomGeneration) clearRunnerRepair()
  }

  function runnerRepairIdentityMatches(
    expectedToken: number,
    expectedRoomId: string,
    expectedRoomGeneration: string,
    expectedConnectionGeneration: number,
  ): boolean {
    return runnerRepairPending
      && runnerRepairToken === expectedToken
      && !isHome
      && roomId === expectedRoomId
      && runnerRepairRoomId === expectedRoomId
      && runnerRepairRoomGeneration === expectedRoomGeneration
      && connectionGeneration === expectedConnectionGeneration
  }

  function suspendRunnerRepair(): void {
    if (!runnerRepairPending) return
    runnerRepairToken += 1
    runnerRepairAttempts = 0
    if (runnerRepairTimer) clearTimeout(runnerRepairTimer)
    runnerRepairTimer = null
    runnerRepairAbort?.abort()
    runnerRepairAbort = null
  }

  function clearRunnerRepair(): void {
    runnerRepairPending = false
    runnerRepairRoomId = ''
    runnerRepairRoomGeneration = ''
    runnerRepairAttempts = 0
    runnerRepairToken += 1
    if (runnerRepairTimer) clearTimeout(runnerRepairTimer)
    runnerRepairTimer = null
    runnerRepairAbort?.abort()
    runnerRepairAbort = null
  }

  function closeTerminalTab(event: MouseEvent, terminal: TerminalSnapshot) {
    event.stopPropagation()
    if (!canMutateShared) { pushMutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { pushMutationNotice('room_structure_locked_by_run'); return }
    if (window.confirm('Close terminal ' + terminal.terminalIndex + ' · ' + terminal.terminalId + '?')) client?.send({ type: 'close_terminal', terminalId: terminal.terminalId })
  }

  function startDrag(event: DragEvent, terminalId: string) {
    if (!settings.terminalDragEnabled) { event.preventDefault(); return }
    if (!canMutateShared) { event.preventDefault(); pushMutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { event.preventDefault(); pushMutationNotice('room_structure_locked_by_run'); return }
    draggingTerminalId = terminalId
    event.dataTransfer?.setData('text/plain', terminalId)
  }

  function dropOnTab(event: DragEvent, target: TerminalSnapshot) {
    event.preventDefault()
    const source = event.dataTransfer?.getData('text/plain') || draggingTerminalId
    draggingTerminalId = null
    if (!canMutateShared) { pushMutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { pushMutationNotice('room_structure_locked_by_run'); return }
    if (settings.terminalDragEnabled && source && source !== target.terminalId) {
      client?.send({ type: 'reorder_terminal', terminalId: source, newIndex: target.terminalIndex })
      activeTerminalId = source
    }
  }

  function tabKeydown(event: KeyboardEvent, terminal: TerminalSnapshot) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activeTerminalId = terminal.terminalId }
  }

  function pushNotice(text: string) {
    notice = { id: ++noticeSeq, kind: 'general', text: text.length > 500 ? text.slice(0, 500) + '...' : text }
  }

  function pushMutationNotice(reason: string, prefix = '') {
    const text = prefix + sharedMutationFeedback(reason)
    notice = { id: ++noticeSeq, kind: 'mutation', reason, level: 'warning', text: text.length > 500 ? text.slice(0, 500) + '...' : text }
  }

  async function handleMacroNotification(message: MacroNotificationMessage) {
    const notificationKey = message.roomGeneration + ':' + message.notificationId + ':' + message.channels.map((channel) => channel.kind).sort().join(',')
    if (seenNotifications.has(notificationKey)) return
    seenNotifications.add(notificationKey)
    seenNotificationOrder.push(notificationKey)
    if (seenNotificationOrder.length > 500) seenNotifications.delete(seenNotificationOrder.shift()!)
    const app = message.channels.find((channel) => channel.kind === 'app')
    const toast = app?.kind === 'app' && app.toast
    const options = { title: message.title, level: message.level, createdAt: message.createdAt, notificationId: message.notificationId, runId: message.runId, stepId: message.stepId }
    if (toast) pushDetailedNotice(message.message || message.title, options)
    if (app?.kind === 'app' && app.sound !== 'none') void playNotificationSound(app.sound, message.level)
    if (message.channels.some((channel) => channel.kind === 'system')) {
      const status = await showSystemNotification(message)
      if (status !== 'delivered' && !toast) pushDetailedNotice('System notification was not delivered.', { ...options, systemStatus: status })
    }
  }

  function pushDetailedNotice(text: string, options: Omit<NoticeItem, 'id' | 'text'>) {
    notice = { id: ++noticeSeq, kind: 'notification', text: text.length > 500 ? text.slice(0, 500) + '...' : text, ...options }
  }

  async function showSystemNotification(message: MacroNotificationMessage): Promise<string> {
    if (!('Notification' in window)) return 'unavailable'
    let permission = Notification.permission
    if (permission === 'default') {
      try { permission = await Notification.requestPermission() }
      catch { return 'permission-request-failed' }
    }
    if (permission !== 'granted') return 'permission-' + permission
    try { new Notification(message.title, { body: message.message, tag: message.notificationId }); return 'delivered' }
    catch { return 'failed' }
  }

  async function playNotificationSound(sound: Exclude<MacroNotificationSound, 'none'>, level: MacroNotificationMessage['level']) {
    try {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) return
      const context = new AudioContextCtor()
      let cursor = context.currentTime
      for (const tone of notificationTones(sound, level)) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = tone.type
        oscillator.frequency.value = tone.frequency
        gain.gain.value = Math.min(NOTIFICATION_MAX_GAIN, tone.gain * settings.notificationVolume)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(cursor)
        oscillator.stop(cursor + tone.duration)
        cursor += tone.duration + tone.gap
      }
      window.setTimeout(() => void context.close(), Math.ceil((cursor - context.currentTime + 0.05) * 1000))
    } catch { /* Browser audio is best effort. */ }
  }

  function notificationTones(sound: Exclude<MacroNotificationSound, 'none'>, level: MacroNotificationMessage['level']) {
    const base = level === 'error' ? 220 : level === 'warning' ? 330 : 660
    const tone = (frequency: number, duration = 0.09, gap = 0.02, gain = 0.04, type: OscillatorType = 'sine') => ({ frequency, duration, gap, gain, type })
    if (sound === 'success') return [tone(523, 0.07, 0.018, 0.036, 'triangle'), tone(659, 0.07, 0.018, 0.036, 'triangle'), tone(784, 0.12, 0.02, 0.034, 'triangle')]
    if (sound === 'warning') return [tone(440, 0.12, 0.04, 0.045, 'square'), tone(330, 0.15, 0.02, 0.04, 'square')]
    if (sound === 'alert') return [tone(880, 0.08, 0.025, 0.05, 'sawtooth'), tone(440, 0.1, 0.025, 0.045, 'sawtooth'), tone(880, 0.12, 0.02, 0.045, 'sawtooth')]
    if (sound === 'chime') return [tone(523), tone(784, 0.13)]
    if (sound === 'ping') return [tone(1175, 0.07), tone(1568, 0.08)]
    if (sound === 'pulse') return [tone(base, 0.1, 0.035), tone(base, 0.1)]
    return [tone(880, 0.08, 0.02, 0.045, 'triangle'), tone(660, 0.11, 0.02, 0.035, 'triangle')]
  }

  function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }

  function controlMemoryKey(targetRoomId: string) { return 'shell-deck:room-control-intent:' + targetRoomId }
  function rememberedRoomControl(targetRoomId: string): boolean {
    try { return sessionStorage.getItem(controlMemoryKey(targetRoomId)) === 'controller' }
    catch { return false }
  }
  function rememberRoomControl(targetRoomId: string, owned: boolean) {
    if (!targetRoomId) return
    try {
      if (owned) sessionStorage.setItem(controlMemoryKey(targetRoomId), 'controller')
      else sessionStorage.removeItem(controlMemoryKey(targetRoomId))
    } catch {}
  }
  function isReloadNavigation(): boolean {
    return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload'
  }
</script>

<svelte:window onbeforeunload={handleBeforeUnload} />

{#if isHome}
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
{:else}
  <main class="room-shell">
    <header class="topbar compact-topbar">
      <div class="brand-line"><h1>shell-deck</h1><p data-testid="room-identity">{roomId} · {connected ? 'connected' : 'disconnected'}</p></div>
      <div class="actions">
        {#if !connected || !controlView}
          <span class="room-control-status reconnecting" data-testid="room-control-status">Reconnecting · Read-only</span>
        {:else if controlView.mode === 'controller'}
          <span class="room-control-status controller" data-testid="room-control-status">Control: This device</span>
        {:else}
          <button
            type="button"
            class="room-control-takeover"
            data-testid="take-control"
            onclick={() => void takeControl()}
            disabled={controlPending}
          >{controlPending ? 'Taking control…' : 'Read-only · Take control'}</button>
        {/if}
        <button type="button" data-testid="home-button" onclick={() => window.open('/', '_blank', 'noopener')}>Home</button>
        <button type="button" class="panel-toggle" aria-pressed={settings.panels.macro.visible} data-testid="macro-panel-toggle" onclick={() => updateMacroPanel(undefined, !settings.panels.macro.visible)}>
          <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span><span>Macro</span>
        </button>
        <button type="button" class="panel-toggle" aria-pressed={settings.panels.library.visible} data-testid="library-panel-toggle" onclick={() => updateLibraryPanel(undefined, !settings.panels.library.visible)}>
          <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span><span>Library</span>
        </button>
        <button type="button" class="terminal-create-button" data-testid="terminal-create-real" onclick={createShell} aria-disabled={!canMutateShared || terminalStructureLocked}>New shell</button>
        <button type="button" class="terminal-create-button" data-testid="terminal-create-text" onclick={createText} aria-disabled={!canMutateShared || terminalStructureLocked}>New text</button>
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
        <button
          type="button"
          class="settings-control-button"
          data-testid="macro-insertion-placement"
          aria-pressed={settings.macroInsertionPlacement === 'anchored'}
          onclick={() => updateSettings({ macroInsertionPlacement: settings.macroInsertionPlacement === 'anchored' ? 'center' : 'anchored' })}
        >Action picker: {settings.macroInsertionPlacement === 'anchored' ? 'near trigger' : 'centered'}</button>
        <label class="settings-volume-control">
          <span><span>Notification volume</span><output data-testid="notification-volume-output">{Math.round(settings.notificationVolume * 100)}%</output></span>
          <input type="range" min="0" max="1000" step="10" value={Math.round(settings.notificationVolume * 100)} data-testid="notification-volume" oninput={(event) => updateSettings({ notificationVolume: Number(event.currentTarget.value) / 100 })} />
        </label>
        <button type="button" class="settings-control-button" data-testid="notification-success-sound-test" onclick={() => { void playNotificationSound('success', 'success') }}>Play success sound</button>
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
      sharedReadOnly={!canMutateShared}
      macroVisible={settings.panels.macro.visible}
      macroWidthPx={settings.panels.macro.widthPx}
      libraryVisible={settings.panels.library.visible}
      libraryWidthPx={settings.panels.library.widthPx}
      librarySelectedTab={settings.library.selectedTab}
      libraryFilter={settings.library.filter}
      {canMutateShared}
      {terminalStructureRevision}
      {terminalPositions}
      {terminalStructureLocked}
      {runnerSnapshot}
      {contentRecordChanges}
      {contentEditLeaseChanges}
      {connectionGeneration}
      insertionPaletteMode={settings.macroInsertionPlacement}
      onMacroWidthChange={(widthPx) => updateMacroPanel(widthPx)}
      onMacroDirtyChange={(dirty) => { macroDirty = dirty }}
      onLibraryWidthChange={(widthPx) => updateLibraryPanel(widthPx)}
      onLibraryPreferenceChange={updateLibraryPreference}
      onLibraryDirtyChange={(dirty) => { libraryDirty = dirty }}
      onRoomSnapshot={applyRoomSnapshot}
      onSelectTerminal={(id) => { activeTerminalId = id }}
      onCloseTerminal={closeTerminalTab}
      onStartTabDrag={startDrag}
      onDropOnTab={dropOnTab}
      onTabDragEnd={() => { draggingTerminalId = null }}
      onTabKeydown={tabKeydown}
      onMutationDenied={pushMutationNotice}
    />
  </main>
{/if}

{#if isHome}<NoticeStack {notice} onDismiss={(id) => { if (notice?.id === id) notice = null }} />{/if}
