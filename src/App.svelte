<script lang="ts">
  import type { PromptUpdatedMessage, RunLogUpdatedMessage, ServerMessage, TerminalSnapshot } from './lib/protocol'
  import { TerminalDeckClient } from './lib/terminalDeckClient'
  import NoticeStack from './lib/components/workspace/NoticeStack.svelte'
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

  function initialConfigId() {
    const value = new URL(window.location.href).searchParams.get('configId')
    return value && CONFIG_ID_RE.test(value) ? value : 'local'
  }

  let configId = $state(initialConfigId())
  let connected = $state(false)
  let client = $state<TerminalDeckClient | null>(null)
  let terminals = $state<TerminalSnapshot[]>([])
  let indexMap = $state<Array<{ index: number; terminalId: string; terminalAlias: string }>>([])
  let activeTerminalId = $state<string | null>(null)
  let draggingTerminalId = $state<string | null>(null)
  let tabDragEnabled = $state(false)
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
  let notices = $state<Array<{ id: number; text: string }>>([])
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
    void saveLayout({ ...layout, macroInsertionPaletteMode: mode })
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

  function pushNotice(text: string) {
    notices = [...notices, { id: ++noticeSeq, text }].slice(-4)
  }

  function dismissNotice(id: number) {
    notices = notices.filter((notice) => notice.id !== id)
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
        class="drag-toggle"
        data-testid="tab-drag-toggle"
        aria-pressed={tabDragEnabled}
        onclick={() => { tabDragEnabled = !tabDragEnabled }}
      >
        <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
        <span>Drag</span>
      </button>
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
    </div>
  </header>

  <NoticeStack {notices} onDismiss={dismissNotice} />

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
    onMacroInsertionPaletteModeChange={setMacroInsertionPaletteMode}
  />
</main>
