<script lang="ts">
  import type { TerminalSnapshot } from '../../protocol'
  import { terminalDisplayLabel } from '../../terminalDisplay'

  let {
    terminals,
    activeTerminalId,
    draggingTerminalId,
    tabDragEnabled,
    sharedReadOnly,
    onSelect,
    onClose,
    onStartDrag,
    onDrop,
    onDragEnd,
    onTabKeydown,
    onMutationDenied,
  } = $props<{
    terminals: TerminalSnapshot[]
    activeTerminalId: string | null
    draggingTerminalId: string | null
    tabDragEnabled: boolean
    sharedReadOnly: boolean
    onSelect: (terminalId: string) => void
    onClose: (event: MouseEvent, terminal: TerminalSnapshot) => void
    onStartDrag: (event: DragEvent, terminalId: string) => void
    onDrop: (event: DragEvent, terminal: TerminalSnapshot) => void
    onDragEnd: () => void
    onTabKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
    onMutationDenied: (reason: string) => void
  }>()
</script>

<div class="tab-strip box-border flex min-h-10 items-stretch border-b border-base-300 bg-base-200 px-2.5 pt-[5px] pb-0">
  <div class="terminal-tabs flex min-w-0 flex-1 items-stretch gap-[3px] overflow-x-auto" role="tablist" aria-label="Room terminals">
    {#each terminals as terminal (terminal.terminalId)}
      {@const label = terminalDisplayLabel(terminal)}
      <div
        class="terminal-tab tab !grid relative box-border h-[34px] min-h-[34px] min-w-[138px] max-w-[230px] grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-t-[6px] rounded-b-none border border-b-0 border-base-300 bg-base-200 px-2 py-0 text-base-content/60 select-none hover:bg-base-100 hover:text-base-content focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary [@media(max-width:640px)]:min-w-[122px] [&[draggable=true]]:cursor-grab [&[aria-selected=true]]:border-primary/50 [&[aria-selected=true]]:bg-base-100 [&[aria-selected=true]]:text-base-content [&[aria-selected=true]]:shadow-[inset_0_-2px_0_var(--color-primary)] [&[aria-selected=true]_.tab-label]:font-bold [&[aria-selected=true]_.tab-close]:text-primary"
        class:active={terminal.terminalId === activeTerminalId}
        class:tab-active={terminal.terminalId === activeTerminalId}
        class:dragging={terminal.terminalId === draggingTerminalId}
        class:opacity-50={terminal.terminalId === draggingTerminalId}
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
        <span class="tab-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs font-semibold">{label}</span>
        <button
          type="button"
          class="tab-close btn btn-circle btn-ghost btn-xs !size-5 !min-h-5 border-transparent p-0 text-xs font-extrabold leading-none text-base-content/60 !pointer-events-auto hover:border-base-300 hover:bg-base-200 hover:text-base-content"
          data-testid="terminal-tab-close"
          aria-label={"Close terminal " + terminal.terminalIndex}
          title="Close tab"
          aria-disabled={sharedReadOnly}
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => sharedReadOnly ? (event.stopPropagation(), onMutationDenied('room_control_required')) : onClose(event, terminal)}
        >x</button>
      </div>
    {/each}
  </div>
</div>
