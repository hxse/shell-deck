<script lang="ts">
  import type { MacroNotificationMessage, MacroNotificationSound, PromptUpdatedMessage, RunLogUpdatedMessage, ServerMessage, TerminalSnapshot } from './lib/protocol'
  import { TerminalDeckClient } from './lib/terminalDeckClient'
  import NoticeStack, { type NoticeItem } from './lib/components/workspace/NoticeStack.svelte'
  import WorkspaceShell from './lib/components/workspace/WorkspaceShell.svelte'
  import { UiLayoutClient } from './lib/workspace/uiLayoutClient'
  import {
    DEFAULT_WORKSPACE_LAYOUT,
    PANEL_DEFAULT_WIDTH,
    PANEL_MIN_WIDTH_PX,
    normalizePanelWidth,
    normalizeWorkspaceUiLayout,
    type MacroInsertionPaletteMode,
    type WorkspacePanelKey,
    type WorkspaceUiLayout,
  } from './lib/workspace/uiLayoutTypes'

  const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
  const CONFIG_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
  const NOTIFICATION_VOLUME_STORAGE_KEY = 'shell-deck:notification-volume'
  const MACRO_INSERTION_MODE_STORAGE_KEY = 'shell-deck:macro-insertion-palette-mode'
  const TAB_DRAG_ENABLED_STORAGE_KEY = 'shell-deck:tab-drag-enabled'
  const DEFAULT_NOTIFICATION_VOLUME = 2.4
  const NOTIFICATION_MAX_VOLUME = 10
  const NOTIFICATION_MAX_GAIN = 0.3
  type AudibleNotificationSound = Exclude<MacroNotificationSound, 'none'>

  function initialConfigId() {
    const value = new URL(window.location.href).searchParams.get('configId')
    return value && CONFIG_ID_RE.test(value) ? value : 'local'
  }

  function normalizeNotificationVolume(value: unknown) {
    if (value === null || value === undefined || value === '') return DEFAULT_NOTIFICATION_VOLUME
    const next = Number(value)
    if (!Number.isFinite(next)) return DEFAULT_NOTIFICATION_VOLUME
    return Math.max(0, Math.min(NOTIFICATION_MAX_VOLUME, next))
  }

  function initialNotificationVolume() {
    try {
      return normalizeNotificationVolume(window.localStorage.getItem(NOTIFICATION_VOLUME_STORAGE_KEY))
    } catch {
      return DEFAULT_NOTIFICATION_VOLUME
    }
  }

  function normalizeMacroInsertionPaletteMode(value: unknown): MacroInsertionPaletteMode {
    return value === 'center' ? 'center' : 'anchored'
  }

  function initialMacroInsertionPaletteMode(): MacroInsertionPaletteMode {
    try {
      return normalizeMacroInsertionPaletteMode(window.localStorage.getItem(MACRO_INSERTION_MODE_STORAGE_KEY))
    } catch {
      return 'anchored'
    }
  }

  function initialTabDragEnabled() {
    try {
      return window.localStorage.getItem(TAB_DRAG_ENABLED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  }

  let configId = $state(initialConfigId())
  let connected = $state(false)
  let client = $state<TerminalDeckClient | null>(null)
  let terminals = $state<TerminalSnapshot[]>([])
  let indexMap = $state<Array<{ index: number; terminalId: string; terminalAlias: string }>>([])
  let activeTerminalId = $state<string | null>(null)
  let draggingTerminalId = $state<string | null>(null)
  let tabDragEnabled = $state(initialTabDragEnabled())
  let macroInsertionPaletteMode = $state<MacroInsertionPaletteMode>(initialMacroInsertionPaletteMode())
  let settingsOpen = $state(false)
  let notificationVolume = $state(initialNotificationVolume())
  let editingTerminalId = $state<string | null>(null)
  let aliasDraft = $state('')
  let aliasError = $state<string | null>(null)
  let layoutLoadedConfigId = $state('')
  let layout = $state<WorkspaceUiLayout>(normalizeWorkspaceUiLayout(DEFAULT_WORKSPACE_LAYOUT))
  let promptRefreshToken = $state(0)
  let promptRefreshEvent = $state<PromptUpdatedMessage | null>(null)
  let runLogRefreshToken = $state(0)
  let runLogRefreshEvent = $state<RunLogUpdatedMessage | null>(null)
  let noticeSeq = 0
  let notice = $state<NoticeItem | null>(null)
  let activeTerminal = $derived(terminals.find((terminal) => terminal.terminalId === activeTerminalId) ?? terminals[0] ?? null)

  $effect(() => {
    const deck = new TerminalDeckClient({
      configId,
      onOpen: () => { connected = true },
      onClose: () => { connected = false },
      onMessage: handleMessage,
    })
    client = deck
    return () => deck.close()
  })

  $effect(() => {
    if (layoutLoadedConfigId !== configId) {
      layoutLoadedConfigId = configId
      layout = normalizeWorkspaceUiLayout(DEFAULT_WORKSPACE_LAYOUT)
      promptRefreshToken = 0
      void loadLayout()
    }
  })

  $effect(() => {
    if (terminals.length === 0) {
      activeTerminalId = null
      return
    }
    if (!activeTerminalId || !terminals.some((terminal) => terminal.terminalId === activeTerminalId)) {
      activeTerminalId = terminals[0].terminalId
    }
  })

  $effect(() => {
    try {
      window.localStorage.setItem(NOTIFICATION_VOLUME_STORAGE_KEY, String(notificationVolume))
      window.localStorage.setItem(MACRO_INSERTION_MODE_STORAGE_KEY, macroInsertionPaletteMode)
      window.localStorage.setItem(TAB_DRAG_ENABLED_STORAGE_KEY, String(tabDragEnabled))
    } catch {
      // Settings are browser-local preferences.
    }
  })

  $effect(() => {
    if (!settingsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settingsOpen = false
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
    }
  })

  function handleMessage(message: ServerMessage) {
    if (message.type === 'deck_snapshot') {
      terminals = message.terminals
      indexMap = message.indexMap
    }
    if (message.type === 'terminal_snapshot') {
      upsertTerminal(message)
    }
    if (message.type === 'pty_output') {
      appendTerminalReplay(message.terminalId, message.data)
    }
    if (message.type === 'terminal_replay') {
      replaceTerminalReplay(message.terminalId, message.replay)
    }
    if (message.type === 'terminal_index_map') {
      indexMap = message.items
      terminals = terminals.map((terminal) => {
        const mapped = message.items.find((item) => item.terminalId === terminal.terminalId)
        return mapped ? { ...terminal, terminalAlias: mapped.terminalAlias, terminalIndex: mapped.index, visualOrder: mapped.index } : terminal
      }).sort((a, b) => a.terminalIndex - b.terminalIndex)
    }
    if (message.type === 'terminal_error') {
      pushNotice((message.terminalId ? message.terminalId + ': ' : '') + message.reason)
    }
    if (message.type === 'input_rejected') {
      pushNotice(message.terminalId + ': input rejected: ' + message.reason)
    }
    if (message.type === 'terminal_state') {
      terminals = terminals.map((terminal) => terminal.terminalId === message.terminalId
        ? { ...terminal, status: message.status, cols: message.cols, rows: message.rows, exitCode: message.exitCode, signal: message.signal }
        : terminal)
    }
    if (message.type === 'ui_layout_updated' && message.configId === configId) {
      layout = normalizeWorkspaceUiLayout(message.layout)
    }
    if (message.type === 'prompts_updated' && message.configId === configId) {
      promptRefreshEvent = message
      promptRefreshToken += 1
    }
    if (message.type === 'run_log_updated' && message.configId === configId) {
      runLogRefreshEvent = message
      runLogRefreshToken += 1
    }
    if (message.type === 'macro_notification' && message.configId === configId) {
      void handleMacroNotification(message)
    }
  }

  async function handleMacroNotification(message: MacroNotificationMessage) {
    const appChannel = message.channels.find((channel) => channel.kind === 'app')
    const hasAppToast = appChannel?.kind === 'app' && appChannel.toast
    const systemRequested = message.channels.some((channel) => channel.kind === 'system')
    if (hasAppToast) {
      pushNotice(message.message || message.title, notificationOptionsFromMessage(message))
    }
    if (appChannel?.kind === 'app' && appChannel.sound !== 'none') {
      void playNotificationSound(appChannel.sound, message.level)
    }
    if (systemRequested) {
      void showBrowserSystemNotification(message).then((systemStatus) => {
        if (systemStatus === 'delivered') return
        if (hasAppToast) {
          if (notice?.notificationId !== message.notificationId) return
          pushNotice(message.message || message.title, notificationOptionsFromMessage(message, systemStatus))
          return
        }
        pushNotice('System notification was not delivered.', notificationOptionsFromMessage(message, systemStatus))
      })
    }
  }

  async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unavailable' | 'failed'> {
    if (!('Notification' in window)) return 'unavailable'
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission
    try {
      return await Notification.requestPermission()
    } catch {
      return 'failed'
    }
  }

  async function showBrowserSystemNotification(message: MacroNotificationMessage): Promise<string> {
    const permission = await requestBrowserNotificationPermission()
    if (permission === 'unavailable') return 'unavailable'
    if (permission === 'failed') return 'permission-request-failed'
    if (permission !== 'granted') return 'permission-' + permission
    try {
      new Notification(message.title, { body: message.message, tag: message.notificationId })
      return 'delivered'
    } catch {
      return 'failed'
    }
  }

  async function playNotificationSound(sound: AudibleNotificationSound, level: MacroNotificationMessage['level']) {
    try {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) return
      const context = new AudioContextCtor()
      const sequence = soundSequence(sound, level)
      let cursor = context.currentTime
      for (const tone of sequence) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = tone.type
        oscillator.frequency.value = tone.frequency
        gain.gain.value = Math.min(NOTIFICATION_MAX_GAIN, tone.gain * notificationVolume)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(cursor)
        oscillator.stop(cursor + tone.duration)
        cursor += tone.duration + tone.gap
      }
      window.setTimeout(() => void context.close(), Math.ceil((cursor - context.currentTime + 0.05) * 1000))
    } catch {
      // Audio notification is best effort.
    }
  }

  function soundSequence(sound: AudibleNotificationSound, level: MacroNotificationMessage['level']) {
    const base = level === 'error' ? 220 : level === 'warning' ? 330 : 660
    if (sound === 'bell') return [
      { frequency: 880, duration: 0.08, gap: 0.02, gain: 0.045, type: 'triangle' as OscillatorType },
      { frequency: 660, duration: 0.11, gap: 0.02, gain: 0.035, type: 'triangle' as OscillatorType },
    ]
    if (sound === 'chime') return [
      { frequency: 523, duration: 0.09, gap: 0.025, gain: 0.04, type: 'sine' as OscillatorType },
      { frequency: 784, duration: 0.13, gap: 0.02, gain: 0.035, type: 'sine' as OscillatorType },
    ]
    if (sound === 'ping') return [
      { frequency: 1175, duration: 0.07, gap: 0.015, gain: 0.04, type: 'sine' as OscillatorType },
      { frequency: 1568, duration: 0.08, gap: 0.02, gain: 0.032, type: 'sine' as OscillatorType },
    ]
    if (sound === 'pulse') return [
      { frequency: base, duration: 0.1, gap: 0.035, gain: 0.04, type: 'sine' as OscillatorType },
      { frequency: base, duration: 0.1, gap: 0.02, gain: 0.035, type: 'sine' as OscillatorType },
    ]
    if (sound === 'success') return [
      { frequency: 523, duration: 0.07, gap: 0.018, gain: 0.036, type: 'triangle' as OscillatorType },
      { frequency: 659, duration: 0.07, gap: 0.018, gain: 0.036, type: 'triangle' as OscillatorType },
      { frequency: 784, duration: 0.12, gap: 0.02, gain: 0.034, type: 'triangle' as OscillatorType },
    ]
    if (sound === 'warning') return [
      { frequency: 330, duration: 0.11, gap: 0.04, gain: 0.045, type: 'sawtooth' as OscillatorType },
      { frequency: 330, duration: 0.11, gap: 0.02, gain: 0.04, type: 'sawtooth' as OscillatorType },
    ]
    if (sound === 'alert') return [
      { frequency: 440, duration: 0.08, gap: 0.025, gain: 0.05, type: 'square' as OscillatorType },
      { frequency: 440, duration: 0.08, gap: 0.025, gain: 0.05, type: 'square' as OscillatorType },
      { frequency: 440, duration: 0.1, gap: 0.02, gain: 0.045, type: 'square' as OscillatorType },
    ]
    return [{ frequency: base, duration: 0.16, gap: 0.02, gain: 0.045, type: 'sine' as OscillatorType }]
  }

  async function loadLayout() {
    try {
      layout = await new UiLayoutClient(configId).read()
    } catch (error) {
      pushNotice('layout: ' + messageOf(error))
    }
  }

  async function saveLayout(nextLayout: WorkspaceUiLayout) {
    layout = normalizeWorkspaceUiLayout(nextLayout)
    try {
      layout = await new UiLayoutClient(configId).save(layout)
    } catch (error) {
      pushNotice('layout save failed: ' + messageOf(error))
    }
  }

  function setPanelVisible(panel: WorkspacePanelKey, visible: boolean) {
    void saveLayout({
      ...layout,
      panels: {
        ...layout.panels,
        [panel]: { ...layout.panels[panel], visible },
      },
    })
  }

  function resetPanelWidth(panel: WorkspacePanelKey) {
    void saveLayout({
      ...layout,
      panels: {
        ...layout.panels,
        [panel]: { ...layout.panels[panel], widthPx: PANEL_DEFAULT_WIDTH[panel] },
      },
    })
  }

  function setMacroInsertionPaletteMode(mode: MacroInsertionPaletteMode) {
    macroInsertionPaletteMode = normalizeMacroInsertionPaletteMode(mode)
  }

  function toggleMacroInsertionPaletteMode() {
    setMacroInsertionPaletteMode(macroInsertionPaletteMode === 'anchored' ? 'center' : 'anchored')
  }

  function setNotificationVolume(value: number) {
    notificationVolume = normalizeNotificationVolume(value)
  }

  function beginPanelResize(panel: WorkspacePanelKey, event: PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = layout.panels[panel].widthPx
    const onMove = (moveEvent: PointerEvent) => {
      const maxWidth = Math.max(PANEL_MIN_WIDTH_PX, Math.min(1200, Math.floor(window.innerWidth * 0.85)))
      const widthPx = Math.max(PANEL_MIN_WIDTH_PX, Math.min(maxWidth, startWidth + startX - moveEvent.clientX))
      layout = {
        ...layout,
        panels: {
          ...layout.panels,
          [panel]: { ...layout.panels[panel], widthPx: normalizePanelWidth(widthPx, startWidth) },
        },
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      void saveLayout(layout)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function notificationOptionsFromMessage(message: MacroNotificationMessage, systemStatus?: string): Omit<NoticeItem, 'id' | 'text'> {
    return { title: message.title, level: message.level, createdAt: message.createdAt, notificationId: message.notificationId, runId: message.runId, stepId: message.stepId, systemStatus }
  }

  function pushNotice(text: string, options: Omit<NoticeItem, 'id' | 'text'> = {}) {
    const displayText = text.length > 500 ? text.slice(0, 500) + '...' : text
    notice = { id: ++noticeSeq, text: displayText, ...options }
  }

  function dismissNotice(id: number) {
    if (notice?.id === id) notice = null
  }

  function upsertTerminal(snapshot: TerminalSnapshot) {
    const existing = terminals.findIndex((terminal) => terminal.terminalId === snapshot.terminalId)
    if (existing === -1) {
      terminals = [...terminals, snapshot].sort((a, b) => a.terminalIndex - b.terminalIndex)
      activeTerminalId = snapshot.terminalId
      return
    }
    terminals = terminals.map((terminal) => terminal.terminalId === snapshot.terminalId ? snapshot : terminal).sort((a, b) => a.terminalIndex - b.terminalIndex)
  }

  function appendTerminalReplay(terminalId: string, data: string) {
    terminals = terminals.map((terminal) => terminal.terminalId === terminalId
      ? { ...terminal, replay: [...terminal.replay, data] }
      : terminal)
  }

  function replaceTerminalReplay(terminalId: string, replay: string[]) {
    terminals = terminals.map((terminal) => terminal.terminalId === terminalId
      ? { ...terminal, replay: [...replay] }
      : terminal)
  }

  function createTerminal(backend: 'fake' | 'real' | 'text') {
    client?.send({ type: 'create_terminal', backend })
  }

  function selectTerminal(terminalId: string) {
    activeTerminalId = terminalId
  }

  function closeTerminalTab(event: MouseEvent, terminal: TerminalSnapshot) {
    event.stopPropagation()
    const label = terminal.terminalAlias || terminal.terminalId
    if (!window.confirm('Close tab ' + label + '?')) return
    client?.send({ type: 'close_terminal', terminalId: terminal.terminalId })
  }

  function startDrag(event: DragEvent, terminalId: string) {
    if (!tabDragEnabled) {
      event.preventDefault()
      return
    }
    draggingTerminalId = terminalId
    event.dataTransfer?.setData('text/plain', terminalId)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
    }
  }

  function dropOnTab(event: DragEvent, targetTerminal: TerminalSnapshot) {
    event.preventDefault()
    if (!tabDragEnabled) return
    const sourceTerminalId = event.dataTransfer?.getData('text/plain') || draggingTerminalId
    draggingTerminalId = null
    if (!sourceTerminalId || sourceTerminalId === targetTerminal.terminalId) return
    client?.send({ type: 'reorder_terminal', terminalId: sourceTerminalId, newIndex: targetTerminal.terminalIndex })
    activeTerminalId = sourceTerminalId
  }

  function startRename(terminal: TerminalSnapshot) {
    activeTerminalId = terminal.terminalId
    editingTerminalId = terminal.terminalId
    aliasDraft = terminal.terminalAlias
    aliasError = null
  }

  function commitRename(terminal: TerminalSnapshot) {
    const nextAlias = aliasDraft.trim()
    if (nextAlias === terminal.terminalAlias) {
      editingTerminalId = null
      aliasError = null
      return
    }
    if (!ALIAS_RE.test(nextAlias)) {
      aliasError = 'Alias must use A-Z, a-z, 0-9, _ or -, and start with a letter or number.'
      return
    }
    if (terminals.some((item) => item.terminalId !== terminal.terminalId && item.terminalAlias === nextAlias)) {
      aliasError = 'Alias already exists in this config.'
      return
    }
    client?.send({ type: 'rename_terminal', terminalId: terminal.terminalId, terminalAlias: nextAlias })
    editingTerminalId = null
    aliasError = null
  }

  function cancelRename() {
    editingTerminalId = null
    aliasError = null
  }

  function aliasKeydown(event: KeyboardEvent, terminal: TerminalSnapshot) {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      commitRename(terminal)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelRename()
    }
  }

  function tabKeydown(event: KeyboardEvent, terminal: TerminalSnapshot) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectTerminal(terminal.terminalId)
    }
  }

  function messageOf(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
</script>

<main class="deck-shell">
  <header class="topbar compact-topbar">
    <div class="brand-line">
      <h1>shell-deck</h1>
      <p>{configId} · {connected ? 'connected' : 'disconnected'}</p>
    </div>
    <div class="actions">
      <button
        type="button"
        class="panel-toggle"
        data-testid="macro-panel-toggle"
        aria-pressed={layout.panels.macro.visible}
        onclick={() => setPanelVisible('macro', !layout.panels.macro.visible)}
      >
        <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
        <span>Macro</span>
      </button>
      <button
        type="button"
        class="panel-toggle"
        data-testid="prompt-panel-toggle"
        aria-pressed={layout.panels.prompt.visible}
        onclick={() => setPanelVisible('prompt', !layout.panels.prompt.visible)}
      >
        <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
        <span>Prompt</span>
      </button>
      <button type="button" onclick={() => createTerminal('fake')}>New fake</button>
      <button type="button" onclick={() => createTerminal('real')}>New shell</button>
      <button type="button" onclick={() => createTerminal('text')}>New text</button>
      <button
        type="button"
        class="settings-button"
        data-testid="settings-button"
        aria-expanded={settingsOpen}
        aria-controls="settings-popover"
        onclick={() => { settingsOpen = !settingsOpen }}
      >
        Settings
      </button>
    </div>
  </header>

  {#if settingsOpen}
    <button class="popover-dismiss-layer settings-dismiss-layer" type="button" data-testid="settings-dismiss-layer" aria-label="Close settings" onclick={() => { settingsOpen = false }}></button>
    <section id="settings-popover" class="settings-popover" data-testid="settings-popover" aria-label="Workspace settings">
      <div class="settings-popover-head">
        <strong>Settings</strong>
        <button type="button" aria-label="Close settings" onclick={() => { settingsOpen = false }}>Close</button>
      </div>

      <button
        type="button"
        class="settings-control-button"
        data-testid="macro-insertion-placement-toggle"
        aria-pressed={macroInsertionPaletteMode === 'center'}
        title={macroInsertionPaletteMode === 'anchored' ? 'Insertion palette opens near the clicked button' : 'Insertion palette opens in the center'}
        onclick={toggleMacroInsertionPaletteMode}
      >
        Insert: {macroInsertionPaletteMode === 'anchored' ? 'near' : 'center'}
      </button>

      <label class="settings-volume-control">
        <span>
          <span>Notification volume</span>
          <output data-testid="notification-volume-output">{Math.round(notificationVolume * 100)}%</output>
        </span>
        <input
          type="range"
          min="0"
          max="1000"
          step="10"
          value={Math.round(notificationVolume * 100)}
          data-testid="notification-volume"
          oninput={(event) => setNotificationVolume(Number(event.currentTarget.value) / 100)}
        />
      </label>

      <button
        type="button"
        class="settings-control-button"
        data-testid="notification-success-sound-test"
        onclick={() => { void playNotificationSound('success', 'success') }}
      >
        Play success sound
      </button>

      <button
        type="button"
        class="drag-toggle settings-drag-toggle"
        data-testid="tab-drag-toggle"
        aria-pressed={tabDragEnabled}
        onclick={() => { tabDragEnabled = !tabDragEnabled }}
      >
        <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
        <span>Drag</span>
      </button>
    </section>
  {/if}

  <NoticeStack {notice} onDismiss={dismissNotice} />

  <WorkspaceShell
    {configId}
    {client}
    {terminals}
    {indexMap}
    {activeTerminal}
    {activeTerminalId}
    {draggingTerminalId}
    {tabDragEnabled}
    {editingTerminalId}
    {aliasDraft}
    {aliasError}
    {layout}
    {macroInsertionPaletteMode}
    {promptRefreshToken}
    {promptRefreshEvent}
    {runLogRefreshToken}
    {runLogRefreshEvent}
    onAliasDraftChange={(value: string) => { aliasDraft = value }}
    onSelectTerminal={selectTerminal}
    onCloseTerminal={closeTerminalTab}
    onStartTabDrag={startDrag}
    onDropOnTab={dropOnTab}
    onTabDragEnd={() => { draggingTerminalId = null }}
    onStartRename={startRename}
    onAliasKeydown={aliasKeydown}
    onCommitRename={commitRename}
    onTabKeydown={tabKeydown}
    onBeginPanelResize={beginPanelResize}
    onResetPanelWidth={resetPanelWidth}
  />
</main>
