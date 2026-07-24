<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { TerminalSnapshot } from '../protocol'
  import { terminalDisplayLabel } from '../terminalDisplay'
  import type { TerminalRoomClient } from '../terminalRoomClient'
  import {
    beginLatestTextWrite,
    createTextTerminalWriteState,
    editTextTerminal,
    observeTextTerminalTruth,
  } from '../textTerminalWriteState'
  import { sha256Text } from '../textHash'
  import { createTextTerminalMutation } from '../textTerminalMutation'
  import { countTextLines, visibleLineWindow } from '../visibleLineWindow'

  let {
    terminal,
    client,
    readOnly = false,
    onMutationDenied = () => {},
    registerTextFlush = undefined,
  } = $props<{
    terminal: TerminalSnapshot
    client: TerminalRoomClient | null
    readOnly?: boolean
    onMutationDenied?: (reason: string) => void
    registerTextFlush?: (terminalId: string, flush: () => Promise<void>) => () => void
  }>()
  const terminalLabel = $derived(terminalDisplayLabel(terminal))

  let writeState = $state(createTextTerminalWriteState({
    terminalId: '',
    launchId: '',
    content: '',
    contentHash: '',
    textRevision: 0,
    repairGeneration: 0,
  }))
  const localContent = $derived(writeState.localContent)
  let copyStatus = $state('Copy')
  let editorScrollTop = $state(0)
  let editorElement = $state<HTMLTextAreaElement | null>(null)
  let lineCount = $state(1)
  let editorViewportHeight = $state(20)
  let lineHeight = $state(19)
  let sendTimer: ReturnType<typeof setTimeout> | null = null
  let layoutFrame: number | null = null
  let hashing = false
  let lastSendAt: number | null = null
  let resizeObserver: ResizeObserver | null = null
  const flushWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const lineNumberDigits = $derived(Math.max(3, String(lineCount).length))
  const lineWindow = $derived(visibleLineWindow(lineCount, editorScrollTop, editorViewportHeight, lineHeight))

  $effect(() => {
    const content = terminal.replay.join('')
    const contentHash = terminal.contentHash ?? ''
    const identityChanged = terminal.terminalId !== writeState.terminalId || terminal.launchId !== writeState.launchId
    if (readOnly) {
      const syncInterrupted = !identityChanged && (
        writeState.inFlight !== null
        || writeState.localContent !== writeState.syncedContent
        || hashing
      )
      const mustReset = identityChanged
        || writeState.inFlight !== null
        || writeState.localContent !== content
        || writeState.observedTextRevision !== terminal.textRevision
      if (mustReset) {
        writeState = createTextTerminalWriteState({
          terminalId: terminal.terminalId,
          launchId: terminal.launchId,
          content,
          contentHash,
          textRevision: terminal.textRevision,
          repairGeneration: terminal.textRepairGeneration,
        })
      }
      if (syncInterrupted) {
        rejectFlushWaiters('text_sync_interrupted')
        onMutationDenied('text_sync_interrupted')
      }
      return
    }
    const observed = observeTextTerminalTruth(writeState, {
      terminalId: terminal.terminalId,
      launchId: terminal.launchId,
      content,
      contentHash,
      textRevision: terminal.textRevision,
      repairGeneration: terminal.textRepairGeneration,
    })
    if (observed.state !== writeState) writeState = observed.state
    if (identityChanged) {
      editorScrollTop = 0
      if (editorElement) editorElement.scrollTop = 0
    }
    scheduleLineLayout()
    if (observed.needsWrite) scheduleNetworkSync()
    else settleFlushWaiters()
  })

  function updateContent(value: string) {
    if (readOnly) { onMutationDenied('room_control_required'); return }
    writeState = editTextTerminal(writeState, value)
    scheduleLineLayout()
    scheduleNetworkSync()
  }

  function scheduleNetworkSync(force = false): void {
    if (readOnly || writeState.inFlight || hashing) return
    if (writeState.localContent === writeState.syncedContent) {
      settleFlushWaiters()
      return
    }
    if (sendTimer) clearTimeout(sendTimer)
    sendTimer = null
    const elapsed = lastSendAt === null ? Infinity : performance.now() - lastSendAt
    const delay = force ? 0 : Math.max(0, 100 - elapsed)
    if (delay === 0) void sendLatestContent()
    else sendTimer = setTimeout(() => {
      sendTimer = null
      void sendLatestContent()
    }, delay)
  }

  async function sendLatestContent(): Promise<void> {
    if (readOnly || writeState.inFlight || hashing) return
    const candidate = writeState.localContent
    const syncedContent = writeState.syncedContent
    const baseTextRevision = writeState.observedTextRevision
    const editGeneration = writeState.localEditGeneration
    if (candidate === syncedContent) { settleFlushWaiters(); return }
    hashing = true
    const mutation = createTextTerminalMutation(syncedContent, candidate)
    let resultHash: string
    try { resultHash = await sha256Text(candidate) }
    catch {
      hashing = false
      rejectFlushWaiters('text_hash_failed')
      onMutationDenied('text_hash_failed')
      return
    }
    hashing = false
    if (writeState.inFlight
      || writeState.observedTextRevision !== baseTextRevision
      || writeState.syncedContent !== syncedContent) {
      scheduleNetworkSync()
      return
    }
    const started = beginLatestTextWrite(writeState, {
      candidate,
      mutation,
      resultHash,
      editGeneration,
    })
    if (!started || !client?.send({
      type: 'mutate_terminal_text',
      terminalId: terminal.terminalId,
      expectedTextRevision: baseTextRevision,
      mutation,
      resultHash,
    })) {
      rejectFlushWaiters('room_disconnected')
      return
    }
    writeState = started.state
    lastSendAt = performance.now()
  }

  function flushPendingText(): Promise<void> {
    if (writeState.localContent === writeState.syncedContent && !writeState.inFlight && !hashing) {
      return Promise.resolve()
    }
    if (readOnly || !client) return Promise.reject(new Error('text_sync_unavailable'))
    scheduleNetworkSync(true)
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          flushWaiters.delete(waiter)
          reject(new Error('text_sync_timeout'))
        }, 5_000),
      }
      flushWaiters.add(waiter)
    })
  }

  function settleFlushWaiters(): void {
    if (writeState.localContent !== writeState.syncedContent || writeState.inFlight || hashing) return
    for (const waiter of flushWaiters) {
      clearTimeout(waiter.timer)
      waiter.resolve()
    }
    flushWaiters.clear()
  }

  function rejectFlushWaiters(reason: string): void {
    for (const waiter of flushWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(reason))
    }
    flushWaiters.clear()
  }

  async function copyContent() {
    await navigator.clipboard.writeText(localContent)
    copyStatus = 'Copied'
    window.setTimeout(() => { copyStatus = 'Copy' }, 900)
  }

  function syncLineNumberScroll(event: Event) {
    editorScrollTop = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.scrollTop : 0
  }

  function scheduleLineLayout(): void {
    if (layoutFrame !== null) return
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null
      lineCount = countTextLines(writeState.localContent)
      const editor = editorElement
      if (!editor) return
      const style = getComputedStyle(editor)
      lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.45 || 19
      editorViewportHeight = editor.clientHeight
    })
  }

  function rejectReadOnlyEdit(event: KeyboardEvent) {
    if (!readOnly || event.altKey) return
    if ((event.ctrlKey || event.metaKey) && ['v', 'x'].includes(event.key.toLowerCase())) {
      onMutationDenied('room_control_required')
      return
    }
    if (event.ctrlKey || event.metaKey) return
    if (event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key)) onMutationDenied('room_control_required')
  }

  onMount(() => {
    const unregister = registerTextFlush?.(terminal.terminalId, flushPendingText)
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (writeState.localContent === writeState.syncedContent && !writeState.inFlight && !hashing) return
      event.preventDefault()
      event.returnValue = ''
    }
    resizeObserver = new ResizeObserver(scheduleLineLayout)
    if (editorElement) resizeObserver.observe(editorElement)
    window.addEventListener('beforeunload', warnBeforeUnload)
    scheduleLineLayout()
    return () => {
      unregister?.()
      resizeObserver?.disconnect()
      window.removeEventListener('beforeunload', warnBeforeUnload)
    }
  })

  onDestroy(() => {
    if (writeState.localContent !== writeState.syncedContent || writeState.inFlight || hashing) {
      onMutationDenied('text_sync_interrupted')
    }
    if (sendTimer) clearTimeout(sendTimer)
    if (layoutFrame !== null) cancelAnimationFrame(layoutFrame)
    rejectFlushWaiters('text_editor_disposed')
  })
</script>

<section class="terminal-pane text-box-pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-base-300 bg-base-100 shadow-sm data-[shared-read-only=true]:ring-1 data-[shared-read-only=true]:ring-inset data-[shared-read-only=true]:ring-warning/60" class:shared-read-only={readOnly} data-testid="text-box-pane" data-terminal-id={terminal.terminalId} data-shared-read-only={readOnly}>
  <div class="terminal-meta text-box-meta box-border flex min-h-[30px] items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-2 py-[3px]">
    <code class="terminal-meta-label block min-w-0 flex-1 select-text overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.35] text-base-content/70" title={terminalLabel}>{terminalLabel}</code>
    <div class="inline-actions flex shrink-0 items-center gap-2">
      <button class="btn btn-xs btn-ghost !h-[23px] !min-h-[23px]" type="button" data-testid="text-box-copy" onclick={copyContent}>{copyStatus}</button>
    </div>
  </div>
  <div class="text-box-editor-shell grid min-h-0 flex-1 grid-cols-[var(--text-line-number-width)_minmax(0,1fr)] overflow-hidden bg-base-100" style={"--text-line-number-width: " + (lineNumberDigits + 2) + "ch"}>
    <div class="text-box-line-number-gutter relative min-w-0 overflow-hidden border-r border-base-300 bg-base-200 font-[var(--shell-deck-terminal-font-family)] text-[13px] leading-[1.45] text-base-content/50 select-none" aria-hidden="true" data-testid="text-box-line-numbers">
      <div class="text-box-line-number-list absolute top-3 right-2 left-1 text-right will-change-transform" data-testid="text-box-line-number-list" style={"transform: translateY(" + lineWindow.offsetPx + "px)"}>
        {#each Array.from({ length: lineWindow.end - lineWindow.start }) as _, index}
          <div class="h-[1.45em]">{lineWindow.start + index + 1}</div>
        {/each}
      </div>
    </div>
    <textarea
      bind:this={editorElement}
      class="text-box-editor textarea box-border h-full min-h-0 w-full resize-none overflow-auto !rounded-none !border-0 bg-base-100 p-3 font-[var(--shell-deck-terminal-font-family)] text-[13px] leading-[1.45] text-base-content outline-none focus:shadow-[inset_0_0_0_2px_var(--color-primary)] read-only:cursor-not-allowed read-only:bg-base-200 read-only:text-base-content/50"
      data-testid="text-box-editor"
      spellcheck="false"
      wrap="off"
      readonly={readOnly}
      value={localContent}
      oninput={(event) => updateContent(event.currentTarget.value)}
      onblur={() => { void flushPendingText().catch((error) => onMutationDenied(error.message) ) }}
      onkeydown={rejectReadOnlyEdit}
      onscroll={syncLineNumberScroll}
    ></textarea>
  </div>
</section>
