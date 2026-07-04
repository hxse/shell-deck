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

  $effect(() => {
    const content = terminal.replay.join('')
    if (terminal.terminalId !== localTerminalId) {
      localTerminalId = terminal.terminalId
      localContent = content
      lastAppliedReplay = content
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
  <textarea
    class="text-box-editor"
    data-testid="text-box-editor"
    spellcheck="false"
    value={localContent}
    oninput={(event) => updateContent(event.currentTarget.value)}
  ></textarea>
</section>
