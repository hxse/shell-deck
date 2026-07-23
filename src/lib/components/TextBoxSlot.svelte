<script lang="ts">
  import type { TerminalSnapshot } from '../protocol'
  import { terminalDisplayLabel } from '../terminalDisplay'
  import type { TerminalRoomClient } from '../terminalRoomClient'
  import {
    beginLatestTextWrite,
    createTextTerminalWriteState,
    editTextTerminal,
    observeTextTerminalTruth,
  } from '../textTerminalWriteState'

  let { terminal, client, readOnly = false, onMutationDenied = () => {} } = $props<{
    terminal: TerminalSnapshot
    client: TerminalRoomClient | null
    readOnly?: boolean
    onMutationDenied?: (reason: string) => void
  }>()
  const terminalLabel = $derived(terminalDisplayLabel(terminal))

  let writeState = $state(createTextTerminalWriteState({
    terminalId: '',
    launchId: '',
    content: '',
    textRevision: 0,
  }))
  const localContent = $derived(writeState.localContent)
  let copyStatus = $state('Copy')
  let editorScrollTop = $state(0)
  let editorElement = $state<HTMLTextAreaElement | null>(null)
  const lineCount = $derived(Math.max(1, localContent.split('\n').length))
  const lineNumberDigits = $derived(Math.max(3, String(lineCount).length))

  $effect(() => {
    const content = terminal.replay.join('')
    const identityChanged = terminal.terminalId !== writeState.terminalId || terminal.launchId !== writeState.launchId
    if (readOnly) {
      const mustReset = identityChanged
        || writeState.inFlight !== null
        || writeState.localContent !== content
        || writeState.observedTextRevision !== terminal.textRevision
      if (mustReset) {
        writeState = createTextTerminalWriteState({
          terminalId: terminal.terminalId,
          launchId: terminal.launchId,
          content,
          textRevision: terminal.textRevision,
        })
      }
      return
    }
    const observed = observeTextTerminalTruth(writeState, {
      terminalId: terminal.terminalId,
      launchId: terminal.launchId,
      content,
      textRevision: terminal.textRevision,
    })
    if (observed.state !== writeState) writeState = observed.state
    if (identityChanged) {
      editorScrollTop = 0
      if (editorElement) editorElement.scrollTop = 0
    }
    if (observed.needsWrite) sendLatestContent(terminal.textRevision)
  })

  function updateContent(value: string) {
    if (readOnly) { onMutationDenied('room_control_required'); return }
    writeState = editTextTerminal(writeState, value)
    if (!writeState.inFlight) sendLatestContent(terminal.textRevision)
  }

  function sendLatestContent(baseTextRevision: number) {
    if (readOnly) return
    const started = beginLatestTextWrite(writeState, baseTextRevision)
    if (started && client?.send({ type: 'set_terminal_text', terminalId: terminal.terminalId, content: started.request.content })) {
      writeState = started.state
    }
  }

  async function copyContent() {
    await navigator.clipboard.writeText(localContent)
    copyStatus = 'Copied'
    window.setTimeout(() => { copyStatus = 'Copy' }, 900)
  }

  function syncLineNumberScroll(event: Event) {
    editorScrollTop = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.scrollTop : 0
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
      <div class="text-box-line-number-list absolute top-3 right-2 left-1 text-right will-change-transform" data-testid="text-box-line-number-list" style={"transform: translateY(-" + editorScrollTop + "px)"}>
        {#each Array.from({ length: lineCount }) as _, index}
          <div class="h-[1.45em]">{index + 1}</div>
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
      onkeydown={rejectReadOnlyEdit}
      onscroll={syncLineNumberScroll}
    ></textarea>
  </div>
</section>
