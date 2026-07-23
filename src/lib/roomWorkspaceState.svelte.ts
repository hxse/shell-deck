import type {
  ContentEditLeaseChangedMessage,
  ContentRecordChangedMessage,
  RoomSnapshot,
  ServerMessage,
  TerminalRuntimePosition,
  TerminalSnapshot,
} from './protocol'
import type { MacroRunnerSnapshot } from './macro/runnerTypes'
import type { RoomControlView } from './roomControl'
import { RoomNotificationDelivery, type RoomNotificationNoticeOptions } from './roomNotificationDelivery'
import { RoomRevisionGate } from './roomRevisionGate'
import { RunnerRepairCoordinator } from './runnerRepairCoordinator'
import { TerminalRoomClient } from './terminalRoomClient'
import { applyTerminalStateProjection, TerminalViewStateStore, type TerminalViewSnapshot } from './terminalViewState'
import { RoomWorkspaceMessageCoordinator } from './roomWorkspaceMessageCoordinator'
import { RoomWorkspaceReconnectCoordinator } from './roomWorkspaceReconnectCoordinator'

type RoomWorkspaceStateOptions = {
  roomId: string
  notificationVolume(): number
  notice(text: string): void
  notificationNotice(text: string, options: RoomNotificationNoticeOptions): void
  mutationNotice(reason: string, prefix?: string): void
  clearControlFeedback(): void
  enterHome(): void
}

export function createRoomWorkspaceState(options: RoomWorkspaceStateOptions) {
  const roomId = options.roomId
  const terminalViews = new TerminalViewStateStore()
  const roomRevisionGate = new RoomRevisionGate()
  let active = $state(true)
  let connected = $state(false)
  let connectionGeneration = $state(0)
  let reconnectNonce = $state(0)
  let roomGeneration = $state('')
  let controlView = $state<RoomControlView | null>(null)
  let controlPending = $state(false)
  let client = $state<TerminalRoomClient | null>(null)
  let terminals = $state<TerminalViewSnapshot[]>([])
  let terminalStructureRevision = $state(0)
  let terminalPositions = $state<TerminalRuntimePosition[] | null>(null)
  let terminalStructureLocked = $state(false)
  let runnerSnapshot = $state<MacroRunnerSnapshot | null>(null)
  let contentRecordChanges = $state<Array<ContentRecordChangedMessage & { sequence: number }>>([])
  let contentEditLeaseChanges = $state<Array<ContentEditLeaseChangedMessage & { sequence: number }>>([])
  let activeTerminalId = $state<string | null>(null)
  let draggingTerminalId = $state<string | null>(null)
  let activeTerminal = $derived(terminals.find((terminal) => terminal.terminalId === activeTerminalId) ?? terminals[0] ?? null)
  let canMutateShared = $derived(connected && controlView?.mode === 'controller' && client?.canMutateShared === true)
  const runnerRepair = new RunnerRepairCoordinator({
    identity: () => ({ active, connected, roomId, roomGeneration, connectionGeneration }),
    snapshot: () => runnerSnapshot,
    install: (snapshot) => { runnerSnapshot = snapshot },
    notice: options.notice,
  })
  const notificationDelivery = new RoomNotificationDelivery({
    volume: options.notificationVolume,
    notice: options.notificationNotice,
  })
  const reconnect = new RoomWorkspaceReconnectCoordinator({
    roomId,
    identity: () => ({ active, connected, roomId, roomGeneration, controlView, controlPending, client }),
    setConnected: (value) => { connected = value },
    setControlView: (value) => { controlView = value },
    setControlPending: (value) => { controlPending = value },
    advanceConnectionGeneration: () => { connectionGeneration += 1 },
    requestReconnect: () => { reconnectNonce += 1 },
    resumeRunnerRepair: () => { runnerRepair.resume() },
    enterHome: enterHomeWithoutRootRequest,
    notice: options.notice,
  })
  const messageCoordinator = new RoomWorkspaceMessageCoordinator({
    roomGeneration: () => roomGeneration,
    setRoomGeneration: (value) => { roomGeneration = value },
    setControlView: (value) => { controlView = value },
    acceptControlView: (value) => { reconnect.handleControlView(value) },
    acceptControlLost: () => { reconnect.handleControlLost() },
    setActiveTerminalId: (value) => { activeTerminalId = value },
    resetRoomRevision: () => { roomRevisionGate.reset() },
    applyRoomSnapshot,
    observeRoomRevision,
    upsertTerminal,
    appendTerminalReplay,
    replaceTerminalReplay,
    applyTerminalIndexMap,
    applyTerminalState,
    applyTerminalCwd,
    appendContentRecordChange: (message, sequence) => {
      contentRecordChanges = [...contentRecordChanges.slice(-199), { ...message, sequence }]
    },
    appendContentEditLeaseChange: (message, sequence) => {
      contentEditLeaseChanges = [...contentEditLeaseChanges.slice(-199), { ...message, sequence }]
    },
    mutationNotice: options.mutationNotice,
    runnerRepairPending: () => runnerRepair.pending,
    runnerRepairRoomGeneration: () => runnerRepair.roomGeneration,
    clearRunnerRepair: () => { runnerRepair.clear() },
    resumeRunnerRepair: () => { runnerRepair.resume() },
    installRunnerSnapshot: (message) => { runnerRepair.installFull(message.snapshot) },
    applyRunnerDelta: (message) => { runnerRepair.handleDelta(message.delta) },
    deliverNotification: (message) => { void notificationDelivery.deliver(message) },
    enterHome: enterHomeWithoutRootRequest,
  })

  $effect(() => {
    if (!active) return
    if (reconnect.controlReclaimPending) reconnect.armControlReclaim()
    const refresh = () => { runnerRepair.resume() }
    const visibility = () => {
      if (document.visibilityState === 'visible') runnerRepair.resume()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visibility)
      reconnect.dispose()
      runnerRepair.dispose()
    }
  })

  $effect(() => {
    if (!active) return
    reconnectNonce
    terminalViews.clear()
    roomRevisionGate.reset()
    terminals = []
    terminalStructureRevision = 0
    terminalPositions = null
    terminalStructureLocked = false
    runnerSnapshot = null
    runnerRepair.resetForConnection(roomId)
    contentRecordChanges = []
    contentEditLeaseChanges = []
    notificationDelivery.clear()
    connected = false
    controlView = null
    controlPending = false
    const connection = new TerminalRoomClient({
      roomId,
      onOpen: () => { reconnect.handleOpen() },
      onClose: (event) => { void reconnect.handleClose(event) },
      onMessage: (message) => { messageCoordinator.handle(message) },
    })
    client = connection
    return () => connection.close()
  })

  $effect(() => {
    if (terminals.length === 0) activeTerminalId = null
    else if (!activeTerminalId || !terminals.some((terminal) => terminal.terminalId === activeTerminalId)) activeTerminalId = terminals[0].terminalId
  })

  function enterHomeWithoutRootRequest() {
    if (!active) return
    options.enterHome()
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
    runnerRepair.clear()
    contentRecordChanges = []
    contentEditLeaseChanges = []
    activeTerminalId = null
    dispose()
  }

  function createShell() {
    if (!canMutateShared) { options.mutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { options.mutationNotice('room_structure_locked_by_run'); return }
    client?.send({ type: 'create_terminal', backend: 'real', cwdSource: 'last-shell' })
  }

  function createText() {
    if (!canMutateShared) { options.mutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { options.mutationNotice('room_structure_locked_by_run'); return }
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
      reconnect.markControlOwned()
      options.clearControlFeedback()
    } catch (error) {
      options.mutationNotice(messageOf(error))
    } finally {
      controlPending = false
    }
  }

  function applyTerminalIndexMap(message: Extract<ServerMessage, { type: 'terminal_index_map' }>) {
    if (!roomRevisionGate.acceptIndexMap(message.roomRevision)) return
    terminalStructureRevision = message.terminalStructureRevision
    terminalPositions = message.terminalPositions
    terminalStructureLocked = message.terminalStructureLocked
    terminals = terminals.map((terminal) => {
      const mapped = message.items.find((item) => item.terminalId === terminal.terminalId)
      return mapped ? { ...terminal, terminalIndex: mapped.index, visualOrder: mapped.index } : terminal
    }).sort((left, right) => left.terminalIndex - right.terminalIndex)
  }

  function applyTerminalState(message: Extract<ServerMessage, { type: 'terminal_state' }>) {
    observeRoomRevision(message.roomRevision)
    const applied = applyTerminalStateProjection(terminalViews, terminals, terminalPositions, message)
    terminals = applied.terminals
    terminalPositions = applied.positions
  }

  function applyTerminalCwd(message: Extract<ServerMessage, { type: 'terminal_cwd' }>) {
    observeRoomRevision(message.roomRevision)
    terminals = terminals.map((terminal) => terminal.terminalId === message.terminalId
      ? terminalViews.patch(terminal, message, { cwd: message.cwd })
      : terminal)
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

  function closeTerminalTab(event: MouseEvent, terminal: TerminalSnapshot) {
    event.stopPropagation()
    if (!canMutateShared) { options.mutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { options.mutationNotice('room_structure_locked_by_run'); return }
    if (window.confirm('Close terminal ' + terminal.terminalIndex + ' · ' + terminal.terminalId + '?')) client?.send({ type: 'close_terminal', terminalId: terminal.terminalId })
  }

  function startDrag(event: DragEvent, terminalId: string, terminalDragEnabled: boolean) {
    if (!terminalDragEnabled) { event.preventDefault(); return }
    if (!canMutateShared) { event.preventDefault(); options.mutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { event.preventDefault(); options.mutationNotice('room_structure_locked_by_run'); return }
    draggingTerminalId = terminalId
    event.dataTransfer?.setData('text/plain', terminalId)
  }

  function dropOnTab(event: DragEvent, target: TerminalSnapshot, terminalDragEnabled: boolean) {
    event.preventDefault()
    const source = event.dataTransfer?.getData('text/plain') || draggingTerminalId
    draggingTerminalId = null
    if (!canMutateShared) { options.mutationNotice(connected ? 'room_control_required' : 'room_disconnected'); return }
    if (terminalStructureLocked) { options.mutationNotice('room_structure_locked_by_run'); return }
    if (terminalDragEnabled && source && source !== target.terminalId) {
      client?.send({ type: 'reorder_terminal', terminalId: source, newIndex: target.terminalIndex })
      activeTerminalId = source
    }
  }

  function tabKeydown(event: KeyboardEvent, terminal: TerminalSnapshot) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activeTerminalId = terminal.terminalId }
  }

  function dispose(): void {
    if (!active) return
    active = false
    reconnect.dispose()
    runnerRepair.dispose()
    notificationDelivery.clear()
    client?.close()
  }

  return {
    get connected() { return connected },
    get connectionGeneration() { return connectionGeneration },
    get controlView() { return controlView },
    get controlPending() { return controlPending },
    get client() { return client },
    get terminals() { return terminals },
    get terminalStructureRevision() { return terminalStructureRevision },
    get terminalPositions() { return terminalPositions },
    get terminalStructureLocked() { return terminalStructureLocked },
    get runnerSnapshot() { return runnerSnapshot },
    get contentRecordChanges() { return contentRecordChanges },
    get contentEditLeaseChanges() { return contentEditLeaseChanges },
    get activeTerminalId() { return activeTerminalId },
    get draggingTerminalId() { return draggingTerminalId },
    get activeTerminal() { return activeTerminal },
    get canMutateShared() { return canMutateShared },
    createShell,
    createText,
    takeControl,
    applyRoomSnapshot,
    selectTerminal: (terminalId: string) => { activeTerminalId = terminalId },
    closeTerminalTab,
    startDrag,
    dropOnTab,
    finishTabDrag: () => { draggingTerminalId = null },
    tabKeydown,
    playNotificationSound: notificationDelivery.playSound.bind(notificationDelivery),
    dispose,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
