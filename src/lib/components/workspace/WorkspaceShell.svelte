<script lang="ts">
  import type { ContentEditLeaseChangedMessage, ContentRecordChangedMessage, RoomSnapshot, TerminalRuntimePosition, TerminalSnapshot } from '../../protocol'
  import { MacroRecordClient } from '../../macro/macroRecordClient'
  import type { MacroRunnerSnapshot } from '../../macro/runnerTypes'
  import type { TerminalRoomClient } from '../../terminalRoomClient'
  import type { TerminalViewSnapshot } from '../../terminalViewState'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import MacroPanel from '../MacroPanel.svelte'
  import LibraryPanel from '../LibraryPanel.svelte'
  import TerminalSlot from '../TerminalSlot.svelte'
  import TextBoxSlot from '../TextBoxSlot.svelte'
  import TerminalTabBar from './TerminalTabBar.svelte'

  let {
    client, terminals, activeTerminal, activeTerminalId, draggingTerminalId, tabDragEnabled, sharedReadOnly,
    macroVisible, macroWidthPx, libraryVisible, libraryWidthPx, librarySelectedTab, libraryFilter, canMutateShared, terminalStructureRevision, terminalPositions, terminalStructureLocked, runnerSnapshot, contentRecordChanges, contentEditLeaseChanges, connectionGeneration,
    insertionPaletteMode, onMacroWidthChange, onMacroDirtyChange, onLibraryWidthChange, onLibraryPreferenceChange, onLibraryDirtyChange, onRoomSnapshot,
    onSelectTerminal, onCloseTerminal, onStartTabDrag, onDropOnTab, onTabDragEnd, onTabKeydown, onMutationDenied,
  } = $props<{
    client: TerminalRoomClient | null; terminals: TerminalViewSnapshot[]; activeTerminal: TerminalViewSnapshot | null
    activeTerminalId: string | null; draggingTerminalId: string | null; tabDragEnabled: boolean; sharedReadOnly: boolean
    macroVisible: boolean; macroWidthPx: number; libraryVisible: boolean; libraryWidthPx: number
    librarySelectedTab: 'json-template' | 'prompt' | 'note'; libraryFilter: string
    canMutateShared: boolean; terminalStructureRevision: number
    terminalPositions: TerminalRuntimePosition[] | null; terminalStructureLocked: boolean; insertionPaletteMode: MacroInsertionPaletteMode
    runnerSnapshot: MacroRunnerSnapshot | null; contentRecordChanges: Array<ContentRecordChangedMessage & { sequence: number }>
    contentEditLeaseChanges: Array<ContentEditLeaseChangedMessage & { sequence: number }>
    connectionGeneration: number
    onMacroWidthChange: (widthPx: number) => void; onMacroDirtyChange: (dirty: boolean) => void; onLibraryWidthChange: (widthPx: number) => void
    onLibraryPreferenceChange: (selectedTab: 'json-template' | 'prompt' | 'note', filter: string) => void
    onLibraryDirtyChange: (dirty: boolean) => void; onRoomSnapshot: (snapshot: RoomSnapshot) => void
    onSelectTerminal: (terminalId: string) => void; onCloseTerminal: (event: MouseEvent, terminal: TerminalSnapshot) => void
    onStartTabDrag: (event: DragEvent, terminalId: string) => void; onDropOnTab: (event: DragEvent, terminal: TerminalSnapshot) => void
    onTabDragEnd: () => void; onTabKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
    onMutationDenied: (reason: string) => void
  }>()

  let macroPanel = $state<{ loadFromLibrary(itemId: string, expectedRevision: number): Promise<{ selected: boolean; recordId: string }> } | null>(null)

  function beginResize(event: PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = macroWidthPx
    const move = (next: PointerEvent) => onMacroWidthChange(Math.max(360, Math.min(1200, startWidth + startX - next.clientX)))
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }

  function beginLibraryResize(event: PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = libraryWidthPx
    const move = (next: PointerEvent) => onLibraryWidthChange(Math.max(280, Math.min(1200, startWidth + startX - next.clientX)))
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }

  async function loadLibraryMacro(itemId: string, expectedRevision: number) {
    if (macroPanel) return await macroPanel.loadFromLibrary(itemId, expectedRevision)
    const record = await new MacroRecordClient(() => client?.controlGrant ?? null).createFromLibrary(itemId, expectedRevision)
    return { selected: false, recordId: record.id }
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
      <MacroPanel bind:this={macroPanel} roomClient={client} {canMutateShared} {terminalStructureRevision} {terminalPositions} {terminalStructureLocked}
        {runnerSnapshot} {contentRecordChanges} {contentEditLeaseChanges} {connectionGeneration} {insertionPaletteMode} {onRoomSnapshot} {onMutationDenied}
        onDirtyChange={onMacroDirtyChange} onResetWidth={() => onMacroWidthChange(760)} />
    </div>
  </section>

  <section class="workspace-side-panel prompt-side-panel library-side-panel" data-testid="library-side-panel"
    style={`width: ${libraryWidthPx}px;${libraryVisible ? '' : ' display: none;'}`} hidden={!libraryVisible}>
    <button class="panel-resize-handle" type="button" data-testid="library-resize-handle" aria-label="Resize Library panel" onpointerdown={beginLibraryResize}></button>
    <div class="side-panel-scroll">
      <LibraryPanel roomClient={client} {canMutateShared} selectedTab={librarySelectedTab} filter={libraryFilter}
        {contentRecordChanges} contentLeaseChanges={contentEditLeaseChanges} {connectionGeneration} onPreferenceChange={onLibraryPreferenceChange}
        onDirtyChange={onLibraryDirtyChange} onLoadIntoMacro={loadLibraryMacro} {onMutationDenied}
        onResetWidth={() => onLibraryWidthChange(380)} />
    </div>
  </section>
</section>
