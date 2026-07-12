<script lang="ts">
  import type { TerminalSnapshot } from '../protocol'
  import type { TerminalDeckClient } from '../terminalDeckClient'

  let { terminal, client } = $props<{
    terminal: TerminalSnapshot
    client: TerminalDeckClient | null
  }>()

  let localTerminalId = $state('')
  let localContent = $state('')
  let lastAppliedReplay = $state('')
  let copyStatus = $state('Copy')
  let editorScrollTop = $state(0)
  let editorElement = $state<HTMLTextAreaElement | null>(null)
  const lineCount = $derived(Math.max(1, localContent.split('\n').length))
  const lineNumberDigits = $derived(Math.max(3, String(lineCount).length))

  $effect(() => {
    const content = terminal.replay.join('')
    if (terminal.terminalId !== localTerminalId) {
      localTerminalId = terminal.terminalId
      localContent = content
      lastAppliedReplay = content
      editorScrollTop = 0
      if (editorElement) editorElement.scrollTop = 0
      return
    }
    if (content !== lastAppliedReplay) {
      localContent = content
      lastAppliedReplay = content
    }
  })

  function updateContent(value: string) {
    localContent = value
    client?.send({ type: 'set_terminal_text', terminalId: terminal.terminalId, content: value })
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
    <div>
      <strong>{terminal.terminalAlias}</strong>
      <code>{terminal.terminalId}</code>
    </div>
    <div class="inline-actions">
      <span>{terminal.backend} · {terminal.status}</span>
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
