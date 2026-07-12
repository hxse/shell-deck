<script lang="ts">
  import { tick } from "svelte"
  import type { TerminalSnapshot } from "../../protocol"

  let {
    terminals,
    activeTerminalId,
    draggingTerminalId,
    tabDragEnabled,
    editingTerminalId,
    aliasDraft,
    onAliasDraftChange,
    onSelect,
    onClose,
    onStartDrag,
    onDrop,
    onDragEnd,
    onStartRename,
    onAliasKeydown,
    onCommitRename,
    onTabKeydown,
  } = $props<{
    terminals: TerminalSnapshot[]
    activeTerminalId: string | null
    draggingTerminalId: string | null
    tabDragEnabled: boolean
    editingTerminalId: string | null
    aliasDraft: string
    onAliasDraftChange: (value: string) => void
    onSelect: (terminalId: string) => void
    onClose: (event: MouseEvent, terminal: TerminalSnapshot) => void
    onStartDrag: (event: DragEvent, terminalId: string) => void
    onDrop: (event: DragEvent, terminal: TerminalSnapshot) => void
    onDragEnd: () => void
    onStartRename: (terminal: TerminalSnapshot) => void
    onAliasKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
    onCommitRename: (terminal: TerminalSnapshot) => void
    onTabKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
  }>()

  let aliasInput = $state<HTMLInputElement | null>(null)

  $effect(() => {
    const input = aliasInput
    const terminalId = editingTerminalId
    if (!input || !terminalId) return
    void tick().then(() => {
      if (aliasInput !== input || editingTerminalId !== terminalId) return
      input.focus()
      const caret = input.value.length
      input.setSelectionRange(caret, caret)
    })
  })
</script>

<div class="tab-strip">
  <div class="terminal-tabs" role="tablist" aria-label="Deck tabs">
    {#each terminals as terminal (terminal.terminalId)}
      <div
        class="terminal-tab"
        class:active={terminal.terminalId === activeTerminalId}
        class:dragging={terminal.terminalId === draggingTerminalId}
        role="tab"
        tabindex="0"
        draggable={tabDragEnabled && editingTerminalId !== terminal.terminalId}
        aria-selected={terminal.terminalId === activeTerminalId}
        title={terminal.terminalId}
        data-testid="terminal-tab"
        data-terminal-id={terminal.terminalId}
        data-terminal-alias={terminal.terminalAlias}
        onclick={() => onSelect(terminal.terminalId)}
        onkeydown={(event) => onTabKeydown(event, terminal)}
        ondragstart={(event) => onStartDrag(event, terminal.terminalId)}
        ondragover={(event) => event.preventDefault()}
        ondrop={(event) => onDrop(event, terminal)}
        ondragend={onDragEnd}
        ondblclick={() => onStartRename(terminal)}
      >
        <span class="tab-index">{terminal.terminalIndex}</span>
        {#if editingTerminalId === terminal.terminalId}
          <input
            bind:this={aliasInput}
            class="tab-alias-input"
            data-testid="terminal-alias-input"
            value={aliasDraft}
            oninput={(event) => onAliasDraftChange(event.currentTarget.value)}
            onkeydown={(event) => onAliasKeydown(event, terminal)}
            onblur={() => onCommitRename(terminal)}
            onclick={(event) => event.stopPropagation()}
          />
        {:else}
          <span class="tab-alias">{terminal.terminalAlias}</span>
        {/if}
        <span class="tab-kind">{terminal.backend}</span>
        <button
          type="button"
          class="tab-close"
          data-testid="terminal-tab-close"
          aria-label={"Close tab " + terminal.terminalAlias}
          title="Close tab"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => onClose(event, terminal)}
        >x</button>
      </div>
    {/each}
  </div>
</div>
