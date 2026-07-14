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

  let { terminal, client } = $props<{
    terminal: TerminalSnapshot
    client: TerminalRoomClient | null
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
    writeState = editTextTerminal(writeState, value)
    if (!writeState.inFlight) sendLatestContent(terminal.textRevision)
  }

  function sendLatestContent(baseTextRevision: number) {
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
</script>

<section class="terminal-pane text-box-pane" data-testid="text-box-pane" data-terminal-id={terminal.terminalId}>
  <div class="terminal-meta text-box-meta">
    <code class="terminal-meta-label" title={terminalLabel}>{terminalLabel}</code>
    <div class="inline-actions">
      <button type="button" data-testid="text-box-copy" onclick={copyContent}>{copyStatus}</button>
    </div>
  </div>
  <div class="text-box-editor-shell" style={"--text-line-number-width: " + (lineNumberDigits + 2) + "ch"}>
    <div class="text-box-line-number-gutter" aria-hidden="true" data-testid="text-box-line-numbers">
      <div class="text-box-line-number-list" data-testid="text-box-line-number-list" style={"transform: translateY(-" + editorScrollTop + "px)"}>
        {#each Array.from({ length: lineCount }) as _, index}
          <div>{index + 1}</div>
        {/each}
      </div>
    </div>
    <textarea
      bind:this={editorElement}
      class="text-box-editor"
      data-testid="text-box-editor"
      spellcheck="false"
      wrap="off"
      value={localContent}
      oninput={(event) => updateContent(event.currentTarget.value)}
      onscroll={syncLineNumberScroll}
    ></textarea>
  </div>
</section>
