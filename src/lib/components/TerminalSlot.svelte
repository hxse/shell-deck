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
  let renderedTerminalId: string | null = null
  let renderedReplay: string[] = []

  onMount(() => {
    xterm = new Terminal({ cols: terminal.cols, rows: terminal.rows, convertEol: true, cursorBlink: true })
    xterm.open(host)
    xterm.onData((data) => client?.send({ type: 'terminal_input', terminalId: terminal.terminalId, data }))
    syncReplay()
  })

  $effect(() => {
    if (!xterm) return
    syncReplay()
    xterm.resize(terminal.cols, terminal.rows)
  })

  onDestroy(() => xterm?.dispose())

  function syncReplay() {
    if (!xterm) return
    const needsRebuild = renderedTerminalId !== terminal.terminalId
      || terminal.replay.length < renderedReplay.length
      || renderedReplay.some((chunk, index) => terminal.replay[index] !== chunk)

    if (needsRebuild) {
      xterm.clear()
      for (const chunk of terminal.replay) {
        xterm.write(chunk)
      }
    } else {
      for (const chunk of terminal.replay.slice(renderedReplay.length)) {
        xterm.write(chunk)
      }
    }

    renderedTerminalId = terminal.terminalId
    renderedReplay = [...terminal.replay]
    host.dataset.renderedReplay = renderedReplay.join('')
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
