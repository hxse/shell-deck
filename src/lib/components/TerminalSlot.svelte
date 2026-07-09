<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import '@xterm/xterm/css/xterm.css'
  import type { TerminalSnapshot } from '../protocol'
  import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_WEIGHT, TERMINAL_FONT_WEIGHT_BOLD } from '../terminalFont'
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
      fontFamily: TERMINAL_FONT_FAMILY,
      fontWeight: TERMINAL_FONT_WEIGHT,
      fontWeightBold: TERMINAL_FONT_WEIGHT_BOLD,
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

    xterm.scrollToBottom()
    renderedTerminalId = terminal.terminalId
    renderedReplay = [...terminal.replay]
    host.dataset.renderedReplay = renderedReplay.join('')
  }

  function fitToHost() {
    if (!xterm || !host) return
    const terminalElement = host.querySelector('.xterm') as HTMLElement | null
    const fitRect = terminalElement?.getBoundingClientRect() ?? host.getBoundingClientRect()
    if (fitRect.width < 40 || fitRect.height < 40) return

    const cellSize = measureCellSize()
    const cols = Math.max(20, Math.floor(fitRect.width / cellSize.width))
    const rows = Math.max(4, Math.floor(fitRect.height / cellSize.height))
    if (cols === sentCols && rows === sentRows) return
    sentCols = cols
    sentRows = rows
    xterm.resize(cols, rows)
    xterm.scrollToBottom()
    client?.send({ type: 'terminal_resize', terminalId: terminal.terminalId, cols, rows })
  }

  function measureCellSize() {
    const screen = host.querySelector('.xterm-screen') as HTMLElement | null
    const rowsElement = host.querySelector('.xterm-rows') as HTMLElement | null
    const firstRow = host.querySelector('.xterm-rows > div') as HTMLElement | null
    const screenRect = screen?.getBoundingClientRect()
    const rowsRect = rowsElement?.getBoundingClientRect()
    const firstRowRect = firstRow?.getBoundingClientRect()

    const measuredWidth = screenRect && xterm && xterm.cols > 0 ? screenRect.width / xterm.cols : 0
    const measuredHeight = firstRowRect?.height || (rowsRect && xterm && xterm.rows > 0 ? rowsRect.height / xterm.rows : 0)

    return {
      width: measuredWidth > 0 ? measuredWidth : 8.4,
      height: measuredHeight > 0 ? measuredHeight : 20,
    }
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
