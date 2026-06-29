<script lang="ts">
  import type { ServerMessage, TerminalSnapshot } from './lib/protocol'
  import { TerminalDeckClient } from './lib/terminalDeckClient'
  import TerminalSlot from './lib/components/TerminalSlot.svelte'
  import MacroPanel from './lib/components/MacroPanel.svelte'
  import RunLogView from './lib/components/RunLogView.svelte'

  const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

  let configId = $state('local')
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

  function createTerminal(backend: 'fake' | 'real') {
    client?.send({ type: 'create_terminal', backend })
  }

  function selectTerminal(terminalId: string) {
    activeTerminalId = terminalId
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
</script>

<main class="deck-shell">
  <header class="topbar">
    <div>
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
      <button type="button" onclick={() => createTerminal('fake')}>New fake</button>
      <button type="button" onclick={() => createTerminal('real')}>New shell</button>
    </div>
  </header>

  {#if notices.length > 0}
    <section class="notice-stack" aria-label="Terminal notices">
      {#each notices as notice (notice.id)}
        <div class="notice" role="alert">
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss notice" onclick={() => dismissNotice(notice.id)}>Dismiss</button>
        </div>
      {/each}
    </section>
  {/if}

  <div class="tab-strip">
    <div class="terminal-tabs" role="tablist" aria-label="Terminal tabs">
      {#each terminals as terminal (terminal.terminalId)}
        <div
        class="terminal-tab"
        class:active={terminal.terminalId === activeTerminalId}
        class:dragging={terminal.terminalId === draggingTerminalId}
        role="tab"
        tabindex="0"
        draggable={tabDragEnabled && editingTerminalId !== terminal.terminalId}
        aria-selected={terminal.terminalId === activeTerminalId}
        title={terminal.terminalId}
        data-testid="terminal-tab"
        data-terminal-id={terminal.terminalId}
        data-terminal-alias={terminal.terminalAlias}
        onclick={() => selectTerminal(terminal.terminalId)}
        onkeydown={(event) => tabKeydown(event, terminal)}
        ondragstart={(event) => startDrag(event, terminal.terminalId)}
        ondragover={(event) => event.preventDefault()}
        ondrop={(event) => dropOnTab(event, terminal)}
        ondragend={() => { draggingTerminalId = null }}
        ondblclick={() => startRename(terminal)}
        >
          <span class="tab-index">{terminal.terminalIndex}</span>
          {#if editingTerminalId === terminal.terminalId}
            <input
            class="tab-alias-input"
            data-testid="terminal-alias-input"
            bind:value={aliasDraft}
            onkeydown={(event) => aliasKeydown(event, terminal)}
            onblur={() => commitRename(terminal)}
            onclick={(event) => event.stopPropagation()}
            />
          {:else}
            <span class="tab-alias">{terminal.terminalAlias}</span>
          {/if}
          <span class="tab-kind">{terminal.backend}</span>
        </div>
      {/each}
    </div>
  </div>

  {#if aliasError}
    <div class="alias-error" role="alert">{aliasError}</div>
  {/if}

  <section class="workspace-shell">
    <div class="terminal-stage">
      {#if activeTerminal}
        {#key activeTerminal.terminalId}
          <TerminalSlot terminal={activeTerminal} client={client} />
        {/key}
      {/if}
    </div>
    <div class="side-panels">
      <MacroPanel {configId} {terminals} {indexMap} />
      <RunLogView {configId} />
    </div>
  </section>
</main>
