<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import '@xterm/xterm/css/xterm.css'
  import type { TerminalRenderUpdate, TerminalViewSnapshot } from '../terminalViewState'
  import { terminalDisplayLabel } from '../terminalDisplay'
  import { TerminalParserWritePump } from '../terminalParserWritePump'
  import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_WEIGHT, TERMINAL_FONT_WEIGHT_BOLD } from '../terminalFont'
  import type { TerminalRoomClient } from '../terminalRoomClient'
  import { documentColorScheme, observeDocumentColorScheme, type EffectiveColorScheme } from '../theme'
  import { xtermThemeForColorScheme } from '../terminal/xtermTheme'

  const RENDERED_TAIL_CODE_UNIT_LIMIT = 8192
  const DEBUG_COUNTER_LIMIT = 999_999_999

  type TerminalTestState = {
    instanceId: number
    colorScheme: EffectiveColorScheme
    baseY: number
    viewportY: number
    cursorX: number
    cursorY: number
    selection: string
  }

  let { terminal, client, active = true, readOnly = false, onMutationDenied = () => {} } = $props<{
    terminal: TerminalViewSnapshot
    client: TerminalRoomClient | null
    active?: boolean
    readOnly?: boolean
    onMutationDenied?: (reason: string) => void
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
  let appliedReadOnly = false
  let colorScheme = $state<EffectiveColorScheme>(documentColorScheme())
  let stopObservingColorScheme: (() => void) | null = null
  let terminalInstanceSequence = 0

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
      if (update.kind === 'replace') current.scrollToBottom()
      if (update.kind === 'replace' && hydratingXterm === current) {
        hydratingXterm = null
        current.options.disableStdin = false
      }
    },
  })

  onMount(() => {
    mounted = true
    host.addEventListener('shell-deck-terminal-test-state-request', handleTerminalTestStateRequest)
    stopObservingColorScheme = observeDocumentColorScheme(applyTerminalTheme)
    resizeObserver = new ResizeObserver(() => fitToHost())
    resizeObserver.observe(host)
    applyRenderUpdate(terminal.renderUpdate)
  })

  $effect(() => {
    const update = terminal.renderUpdate
    if (!mounted || update.revision === appliedRevision) return
    applyRenderUpdate(update)
  })

  $effect(() => {
    const wasReadOnly = appliedReadOnly
    appliedReadOnly = readOnly
    if (!xterm) return
    xterm.options.disableStdin = hydratingXterm === xterm
    if (!readOnly) {
      // An observer still fits its local xterm for readable/copyable output, but
      // it must not resize the shared PTY. Force the first controller-side fit
      // to publish the current dimensions even when the local grid is unchanged.
      if (wasReadOnly) {
        sentCols = 0
        sentRows = 0
      }
      fitToHost()
    }
  })

  $effect(() => {
    if (!active) return
    const frame = window.requestAnimationFrame(() => {
      if (mounted && active) fitToHost()
    })
    return () => window.cancelAnimationFrame(frame)
  })

  onDestroy(() => {
    mounted = false
    parserPump.setTarget(null)
    resizeObserver?.disconnect()
    host?.removeEventListener('shell-deck-terminal-test-state-request', handleTerminalTestStateRequest)
    stopObservingColorScheme?.()
    stopObservingColorScheme = null
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
      theme: xtermThemeForColorScheme(colorScheme),
      fontFamily: TERMINAL_FONT_FAMILY,
      fontWeight: TERMINAL_FONT_WEIGHT,
      fontWeightBold: TERMINAL_FONT_WEIGHT_BOLD,
      fontSize: 14,
      lineHeight: 1.2,
    })
    xterm = next
    terminalInstanceSequence += 1
    hydratingXterm = next
    next.open(host)
    const terminalId = terminal.terminalId
    next.onData((data) => {
      if (readOnly) { onMutationDenied('room_control_required'); return }
      client?.send({ type: 'terminal_input', terminalId, data })
    })
    parserPump.setTarget(next)
    fitToHost()
    writeToParser(update)
  }

  function applyTerminalTheme(nextColorScheme: EffectiveColorScheme) {
    colorScheme = nextColorScheme
    if (xterm) xterm.options.theme = xtermThemeForColorScheme(nextColorScheme)
  }

  function writeToParser(update: TerminalRenderUpdate) {
    enqueuedCodeUnits = addDebugCount(enqueuedCodeUnits, update.data.length)
    host.dataset.terminalEnqueuedCodeUnits = String(enqueuedCodeUnits)
    parserPump.enqueue(update)
  }

  function fitToHost() {
    if (!active || !xterm || !host) return
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
    const wasAtBottom = xterm.buffer.active.viewportY === xterm.buffer.active.baseY
    xterm.resize(cols, rows)
    if (wasAtBottom) xterm.scrollToBottom()
    if (!readOnly) client?.send({ type: 'terminal_resize', terminalId: terminal.terminalId, cols, rows })
  }

  function handleTerminalTestStateRequest(event: Event) {
    const accept = (event as CustomEvent<{ accept?: (state: TerminalTestState) => void }>).detail?.accept
    const current = xterm
    if (!current || typeof accept !== 'function') return
    const buffer = current.buffer.active
    accept({
      instanceId: terminalInstanceSequence,
      colorScheme,
      baseY: buffer.baseY,
      viewportY: buffer.viewportY,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      selection: current.hasSelection() ? current.getSelection().slice(0, 1024) : '',
    })
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

<section class="terminal-pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-base-300 bg-base-100 shadow-sm data-[shared-read-only=true]:ring-1 data-[shared-read-only=true]:ring-inset data-[shared-read-only=true]:ring-warning/60" class:shared-read-only={readOnly} data-testid="terminal-pane" data-terminal-id={terminal.terminalId} data-shared-read-only={readOnly}>
  <div class="terminal-meta box-border flex min-h-[30px] items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-2 py-[3px]">
    <code class="terminal-meta-label block min-w-0 flex-1 select-text overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.35] text-base-content/70" title={terminalLabel}>{terminalLabel}</code>
  </div>
  <div
    class="terminal-host relative box-border min-h-0 flex-1 overflow-hidden bg-base-200 p-1.5"
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
