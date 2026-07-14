<script lang="ts">
  import type { TerminalSnapshot } from '../../protocol'
  import { terminalDisplayLabel } from '../../terminalDisplay'

  let {
    terminals,
    activeTerminalId,
    draggingTerminalId,
    tabDragEnabled,
    onSelect,
    onClose,
    onStartDrag,
    onDrop,
    onDragEnd,
    onTabKeydown,
  } = $props<{
    terminals: TerminalSnapshot[]
    activeTerminalId: string | null
    draggingTerminalId: string | null
    tabDragEnabled: boolean
    onSelect: (terminalId: string) => void
    onClose: (event: MouseEvent, terminal: TerminalSnapshot) => void
    onStartDrag: (event: DragEvent, terminalId: string) => void
    onDrop: (event: DragEvent, terminal: TerminalSnapshot) => void
    onDragEnd: () => void
    onTabKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
  }>()
</script>

<div class="tab-strip">
  <div class="terminal-tabs" role="tablist" aria-label="Room terminals">
    {#each terminals as terminal (terminal.terminalId)}
      {@const label = terminalDisplayLabel(terminal)}
      <div
        class="terminal-tab"
        class:active={terminal.terminalId === activeTerminalId}
        class:dragging={terminal.terminalId === draggingTerminalId}
        role="tab"
        tabindex="0"
        draggable={tabDragEnabled}
        aria-selected={terminal.terminalId === activeTerminalId}
        title={label}
        data-testid="terminal-tab"
        data-terminal-id={terminal.terminalId}
        onclick={() => onSelect(terminal.terminalId)}
        onkeydown={(event) => onTabKeydown(event, terminal)}
        ondragstart={(event) => onStartDrag(event, terminal.terminalId)}
        ondragover={(event) => event.preventDefault()}
        ondrop={(event) => onDrop(event, terminal)}
        ondragend={onDragEnd}
      >
        <span class="tab-label">{label}</span>
        <button
          type="button"
          class="tab-close"
          data-testid="terminal-tab-close"
          aria-label={"Close terminal " + terminal.terminalIndex}
          title="Close tab"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => onClose(event, terminal)}
        >x</button>
      </div>
    {/each}
  </div>
</div>
