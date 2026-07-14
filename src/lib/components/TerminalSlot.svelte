<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import '@xterm/xterm/css/xterm.css'
  import type { TerminalRenderUpdate, TerminalViewSnapshot } from '../terminalViewState'
  import { terminalDisplayLabel } from '../terminalDisplay'
  import { TerminalParserWritePump } from '../terminalParserWritePump'
  import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_WEIGHT, TERMINAL_FONT_WEIGHT_BOLD } from '../terminalFont'
  import type { TerminalRoomClient } from '../terminalRoomClient'

  const RENDERED_TAIL_CODE_UNIT_LIMIT = 8192
  const DEBUG_COUNTER_LIMIT = 999_999_999

  let { terminal, client } = $props<{
    terminal: TerminalViewSnapshot
    client: TerminalRoomClient | null
  }>()
  const terminalLabel = $derived(terminalDisplayLabel(terminal))

  let host: HTMLDivElement
  let xterm: Terminal | null = null
  let hydratingXterm: Terminal | null = null
  let resizeObserver: ResizeObserver | null = null
  let mounted = false
  let appliedRevision = 0
  let renderedTail = ''
  let writeCount = 0
  let enqueuedCodeUnits = 0
  let parserConsumedCodeUnits = 0
  let fitCount = 0
  let sentCols = 0
  let sentRows = 0

  const parserPump = new TerminalParserWritePump({
    onChunkWrite: (_data, _update, target) => {
      if (!mounted || target !== xterm) return
      writeCount = incrementDebugCounter(writeCount)
      host.dataset.terminalWriteCount = String(writeCount)
    },
    onChunkParsed: (data, _update, target) => {
      if (!mounted || target !== xterm) return
      parserConsumedCodeUnits = addDebugCount(parserConsumedCodeUnits, data.length)
      host.dataset.terminalParserConsumedCodeUnits = String(parserConsumedCodeUnits)
    },
    onUpdateParsed: (update, target) => {
      const current = xterm
      if (!mounted || !current || target !== current) return
      renderedTail = update.kind === 'replace'
        ? boundedTail(update.data)
        : appendBoundedTail(renderedTail, update.data)
      host.dataset.renderedTail = renderedTail
      host.dataset.renderedRevision = String(update.revision)
      current.scrollToBottom()
      if (update.kind === 'replace' && hydratingXterm === current) {
        hydratingXterm = null
        current.options.disableStdin = false
      }
    },
  })

  onMount(() => {
    mounted = true
    resizeObserver = new ResizeObserver(() => fitToHost())
    resizeObserver.observe(host)
    applyRenderUpdate(terminal.renderUpdate)
  })

  $effect(() => {
    const update = terminal.renderUpdate
    if (!mounted || update.revision === appliedRevision) return
    applyRenderUpdate(update)
  })

  onDestroy(() => {
    mounted = false
    parserPump.setTarget(null)
    resizeObserver?.disconnect()
    hydratingXterm = null
    xterm?.dispose()
  })

  function applyRenderUpdate(update: TerminalRenderUpdate) {
    appliedRevision = update.revision
    if (!xterm) {
      recreateXterm({ ...update, kind: 'replace', data: terminal.replay.join('') })
      return
    }
    if (update.kind === 'replace') {
      recreateXterm(update)
      return
    }
    writeToParser(update)
  }

  function recreateXterm(update: TerminalRenderUpdate) {
    parserPump.setTarget(null)
    hydratingXterm = null
    xterm?.dispose()
    host.replaceChildren()
    renderedTail = ''
    enqueuedCodeUnits = 0
    parserConsumedCodeUnits = 0
    host.dataset.renderedTail = ''
    host.dataset.renderedRevision = '0'
    host.dataset.terminalEnqueuedCodeUnits = '0'
    host.dataset.terminalParserConsumedCodeUnits = '0'
    sentCols = 0
    sentRows = 0

    const next = new Terminal({
      cols: terminal.cols,
      rows: terminal.rows,
      convertEol: true,
      cursorBlink: true,
      // A replacement is historical server replay, not fresh PTY output.
      // Terminal queries inside that history must not produce new input.
      disableStdin: true,
      theme: { background: '#111316', foreground: '#e6edf3' },
      fontFamily: TERMINAL_FONT_FAMILY,
      fontWeight: TERMINAL_FONT_WEIGHT,
      fontWeightBold: TERMINAL_FONT_WEIGHT_BOLD,
      fontSize: 14,
      lineHeight: 1.2,
    })
    xterm = next
    hydratingXterm = next
    next.open(host)
    const terminalId = terminal.terminalId
    next.onData((data) => client?.send({ type: 'terminal_input', terminalId, data }))
    parserPump.setTarget(next)
    fitToHost()
    writeToParser(update)
  }

  function writeToParser(update: TerminalRenderUpdate) {
    enqueuedCodeUnits = addDebugCount(enqueuedCodeUnits, update.data.length)
    host.dataset.terminalEnqueuedCodeUnits = String(enqueuedCodeUnits)
    parserPump.enqueue(update)
  }

  function fitToHost() {
    if (!xterm || !host) return
    fitCount = incrementDebugCounter(fitCount)
    host.dataset.terminalFitCount = String(fitCount)
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

  function boundedTail(value: string): string {
    return value.length <= RENDERED_TAIL_CODE_UNIT_LIMIT
      ? value
      : value.slice(value.length - RENDERED_TAIL_CODE_UNIT_LIMIT)
  }

  function appendBoundedTail(current: string, data: string): string {
    if (data.length >= RENDERED_TAIL_CODE_UNIT_LIMIT) {
      return data.slice(data.length - RENDERED_TAIL_CODE_UNIT_LIMIT)
    }
    return boundedTail(current + data)
  }

  function incrementDebugCounter(value: number): number {
    return Math.min(DEBUG_COUNTER_LIMIT, value + 1)
  }

  function addDebugCount(value: number, increment: number): number {
    return Math.min(DEBUG_COUNTER_LIMIT, value + increment)
  }
</script>

<section class="terminal-pane" data-testid="terminal-pane" data-terminal-id={terminal.terminalId}>
  <div class="terminal-meta">
    <code class="terminal-meta-label" title={terminalLabel}>{terminalLabel}</code>
  </div>
  <div
    class="terminal-host"
    data-testid="terminal-host"
    data-rendered-tail=""
    data-rendered-revision="0"
    data-terminal-write-count="0"
    data-terminal-enqueued-code-units="0"
    data-terminal-parser-consumed-code-units="0"
    data-terminal-fit-count="0"
    bind:this={host}
  ></div>
</section>
