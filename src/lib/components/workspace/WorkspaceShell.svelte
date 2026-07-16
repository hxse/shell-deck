<script lang="ts">
  import type { ContentRecordChangedMessage, RoomSnapshot, ServerMessage, TerminalRuntimePosition, TerminalSnapshot } from '../../protocol'
  import type { MacroRunnerSnapshot } from '../../macro/runnerTypes'
  import type { TerminalRoomClient } from '../../terminalRoomClient'
  import type { TerminalViewSnapshot } from '../../terminalViewState'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import MacroPanel from '../MacroPanel.svelte'
  import TerminalSlot from '../TerminalSlot.svelte'
  import TextBoxSlot from '../TextBoxSlot.svelte'
  import TerminalTabBar from './TerminalTabBar.svelte'

  let {
    client, terminals, activeTerminal, activeTerminalId, draggingTerminalId, tabDragEnabled, sharedReadOnly,
    macroVisible, macroWidthPx, canMutateShared, terminalStructureRevision, terminalPositions, terminalStructureLocked, runnerSnapshot, contentRecordChanges, contentEditLeaseChanges, connectionGeneration,
    insertionPaletteMode, onMacroWidthChange, onMacroDirtyChange, onRoomSnapshot,
    onSelectTerminal, onCloseTerminal, onStartTabDrag, onDropOnTab, onTabDragEnd, onTabKeydown, onMutationDenied,
  } = $props<{
    client: TerminalRoomClient | null; terminals: TerminalViewSnapshot[]; activeTerminal: TerminalViewSnapshot | null
    activeTerminalId: string | null; draggingTerminalId: string | null; tabDragEnabled: boolean; sharedReadOnly: boolean
    macroVisible: boolean; macroWidthPx: number; canMutateShared: boolean; terminalStructureRevision: number
    terminalPositions: TerminalRuntimePosition[] | null; terminalStructureLocked: boolean; insertionPaletteMode: MacroInsertionPaletteMode
    runnerSnapshot: MacroRunnerSnapshot | null; contentRecordChanges: Array<ContentRecordChangedMessage & { sequence: number }>
    contentEditLeaseChanges: Array<Extract<ServerMessage, { type: 'content_edit_lease_changed' }> & { sequence: number }>
    connectionGeneration: number
    onMacroWidthChange: (widthPx: number) => void; onMacroDirtyChange: (dirty: boolean) => void; onRoomSnapshot: (snapshot: RoomSnapshot) => void
    onSelectTerminal: (terminalId: string) => void; onCloseTerminal: (event: MouseEvent, terminal: TerminalSnapshot) => void
    onStartTabDrag: (event: DragEvent, terminalId: string) => void; onDropOnTab: (event: DragEvent, terminal: TerminalSnapshot) => void
    onTabDragEnd: () => void; onTabKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
    onMutationDenied: (reason: string) => void
  }>()

  function beginResize(event: PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = macroWidthPx
    const move = (next: PointerEvent) => onMacroWidthChange(Math.max(360, Math.min(1200, startWidth + startX - next.clientX)))
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }
</script>

<section class="workspace-shell room-workspace" data-testid="workspace-shell">
  <div class="terminal-room" data-testid="terminal-room">
    <TerminalTabBar {terminals} {activeTerminalId} {draggingTerminalId} {tabDragEnabled} {sharedReadOnly}
      onSelect={onSelectTerminal} onClose={onCloseTerminal} onStartDrag={onStartTabDrag} onDrop={onDropOnTab}
      onDragEnd={onTabDragEnd} onTabKeydown={onTabKeydown} {onMutationDenied} />
    <div class="terminal-stage">
      {#if activeTerminal}
        {#key activeTerminal.terminalId}
          {#if activeTerminal.backend === 'text'}<TextBoxSlot terminal={activeTerminal} {client} readOnly={sharedReadOnly} {onMutationDenied} />
          {:else}<TerminalSlot terminal={activeTerminal} {client} readOnly={sharedReadOnly} {onMutationDenied} />{/if}
        {/key}
      {:else}<div class="empty-terminal-room" data-testid="empty-terminal-room">Create a Shell or Text terminal to begin.</div>{/if}
    </div>
  </div>

  <section class="workspace-side-panel macro-side-panel" data-testid="macro-side-panel"
    style={`width: ${macroWidthPx}px;${macroVisible ? '' : ' display: none;'}`} hidden={!macroVisible}>
    <button class="panel-resize-handle" type="button" data-testid="macro-resize-handle" aria-label="Resize Macro panel" onpointerdown={beginResize}></button>
    <div class="side-panel-scroll macro-workbench-shell">
      <MacroPanel roomClient={client} {canMutateShared} {terminalStructureRevision} {terminalPositions} {terminalStructureLocked}
        {runnerSnapshot} {contentRecordChanges} {contentEditLeaseChanges} {connectionGeneration} {insertionPaletteMode} {onRoomSnapshot} {onMutationDenied}
        onDirtyChange={onMacroDirtyChange} onResetWidth={() => onMacroWidthChange(760)} />
    </div>
  </section>
</section>
