<script lang="ts">
  import type { TerminalSnapshot } from '../../protocol'
  import type { TerminalRoomClient } from '../../terminalRoomClient'
  import type { TerminalViewSnapshot } from '../../terminalViewState'
  import TerminalSlot from '../TerminalSlot.svelte'
  import TextBoxSlot from '../TextBoxSlot.svelte'
  import TerminalTabBar from './TerminalTabBar.svelte'

  let {
    client,
    terminals,
    activeTerminal,
    activeTerminalId,
    draggingTerminalId,
    tabDragEnabled,
    sharedReadOnly,
    onSelectTerminal,
    onCloseTerminal,
    onStartTabDrag,
    onDropOnTab,
    onTabDragEnd,
    onTabKeydown,
  } = $props<{
    client: TerminalRoomClient | null
    terminals: TerminalViewSnapshot[]
    activeTerminal: TerminalViewSnapshot | null
    activeTerminalId: string | null
    draggingTerminalId: string | null
    tabDragEnabled: boolean
    sharedReadOnly: boolean
    onSelectTerminal: (terminalId: string) => void
    onCloseTerminal: (event: MouseEvent, terminal: TerminalSnapshot) => void
    onStartTabDrag: (event: DragEvent, terminalId: string) => void
    onDropOnTab: (event: DragEvent, terminal: TerminalSnapshot) => void
    onTabDragEnd: () => void
    onTabKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
  }>()
</script>

<section class="workspace-shell room-workspace" data-testid="workspace-shell">
  <div class="terminal-room" data-testid="terminal-room">
    <TerminalTabBar
      {terminals}
      {activeTerminalId}
      {draggingTerminalId}
      {tabDragEnabled}
      {sharedReadOnly}
      onSelect={onSelectTerminal}
      onClose={onCloseTerminal}
      onStartDrag={onStartTabDrag}
      onDrop={onDropOnTab}
      onDragEnd={onTabDragEnd}
      onTabKeydown={onTabKeydown}
    />
    <div class="terminal-stage">
      {#if activeTerminal}
        {#key activeTerminal.terminalId}
          {#if activeTerminal.backend === 'text'}
            <TextBoxSlot terminal={activeTerminal} {client} readOnly={sharedReadOnly} />
          {:else}
            <TerminalSlot terminal={activeTerminal} {client} readOnly={sharedReadOnly} />
          {/if}
        {/key}
      {:else}
        <div class="empty-terminal-room" data-testid="empty-terminal-room">Create a Shell or Text terminal to begin.</div>
      {/if}
    </div>
  </div>
</section>
