<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import '@xterm/xterm/css/xterm.css'
  import type { TerminalSnapshot } from '../protocol'
  import type { TerminalDeckClient } from '../terminalDeckClient'

  let { terminal, client } = $props<{
    terminal: TerminalSnapshot
    client: TerminalDeckClient | null
  }>()

  let host: HTMLDivElement
  let xterm: Terminal | null = null
  let resizeObserver: ResizeObserver | null = null
  let renderedTerminalId: string | null = null
  let renderedReplay: string[] = []
  let sentCols = 0
  let sentRows = 0

  onMount(() => {
    xterm = new Terminal({
      cols: terminal.cols,
      rows: terminal.rows,
      convertEol: true,
      cursorBlink: true,
      theme: { background: '#111316', foreground: '#e6edf3' },
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      lineHeight: 1.2,
    })
    xterm.open(host)
    xterm.onData((data) => client?.send({ type: 'terminal_input', terminalId: terminal.terminalId, data }))
    resizeObserver = new ResizeObserver(() => fitToHost())
    resizeObserver.observe(host)
    syncReplay()
    requestAnimationFrame(() => fitToHost())
  })

  $effect(() => {
    if (!xterm) return
    syncReplay()
    fitToHost()
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    xterm?.dispose()
  })

  function syncReplay() {
    if (!xterm) return
    const needsRebuild = renderedTerminalId !== terminal.terminalId
      || terminal.replay.length < renderedReplay.length
      || renderedReplay.some((chunk, index) => terminal.replay[index] !== chunk)

    if (needsRebuild) {
      xterm.clear()
      for (const chunk of terminal.replay) xterm.write(chunk)
    } else {
      for (const chunk of terminal.replay.slice(renderedReplay.length)) xterm.write(chunk)
    }

    renderedTerminalId = terminal.terminalId
    renderedReplay = [...terminal.replay]
    host.dataset.renderedReplay = renderedReplay.join('')
  }

  function fitToHost() {
    if (!xterm || !host) return
    const rect = host.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 40) return
    const cols = Math.max(20, Math.floor((rect.width - 18) / 8.4))
    const rows = Math.max(4, Math.floor((rect.height - 18) / 16.8))
    if (cols === sentCols && rows === sentRows) return
    sentCols = cols
    sentRows = rows
    xterm.resize(cols, rows)
    client?.send({ type: 'terminal_resize', terminalId: terminal.terminalId, cols, rows })
  }
</script>

<section class="terminal-pane" data-testid="terminal-pane" data-terminal-id={terminal.terminalId}>
  <div class="terminal-meta">
    <div>
      <strong>{terminal.terminalAlias}</strong>
      <code>{terminal.terminalId}</code>
    </div>
    <span>{terminal.backend} · {terminal.status}</span>
  </div>
  <div class="terminal-host" data-testid="terminal-host" bind:this={host}></div>
</section>
