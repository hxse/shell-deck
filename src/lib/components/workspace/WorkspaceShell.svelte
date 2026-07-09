<script lang="ts">
  import type { PromptUpdatedMessage, RunLogUpdatedMessage, TerminalIndexMapItem, TerminalSnapshot } from "../../protocol"
  import type { TerminalDeckClient } from "../../terminalDeckClient"
  import type { MacroInsertionPaletteMode, WorkspacePanelKey, WorkspaceUiLayout } from "../../workspace/uiLayoutTypes"
  import TerminalSlot from "../TerminalSlot.svelte"
  import TextBoxSlot from "../TextBoxSlot.svelte"
  import MacroPanel from "../MacroPanel.svelte"
  import PromptPanel from "../PromptPanel.svelte"
  import TerminalTabBar from "./TerminalTabBar.svelte"

  let {
    configId,
    client,
    terminals,
    indexMap,
    activeTerminal,
    activeTerminalId,
    draggingTerminalId,
    tabDragEnabled,
    editingTerminalId,
    aliasDraft,
    aliasError,
    layout,
    macroInsertionPaletteMode,
    promptRefreshToken,
    promptRefreshEvent,
    runLogRefreshToken,
    runLogRefreshEvent,
    onAliasDraftChange,
    onSelectTerminal,
    onCloseTerminal,
    onStartTabDrag,
    onDropOnTab,
    onTabDragEnd,
    onStartRename,
    onAliasKeydown,
    onCommitRename,
    onTabKeydown,
    onBeginPanelResize,
    onResetPanelWidth,
  } = $props<{
    configId: string
    client: TerminalDeckClient | null
    terminals: TerminalSnapshot[]
    indexMap: TerminalIndexMapItem[]
    activeTerminal: TerminalSnapshot | null
    activeTerminalId: string | null
    draggingTerminalId: string | null
    tabDragEnabled: boolean
    editingTerminalId: string | null
    aliasDraft: string
    aliasError: string | null
    layout: WorkspaceUiLayout
    macroInsertionPaletteMode: MacroInsertionPaletteMode
    promptRefreshToken: number
    promptRefreshEvent: PromptUpdatedMessage | null
    runLogRefreshToken: number
    runLogRefreshEvent: RunLogUpdatedMessage | null
    onAliasDraftChange: (value: string) => void
    onSelectTerminal: (terminalId: string) => void
    onCloseTerminal: (event: MouseEvent, terminal: TerminalSnapshot) => void
    onStartTabDrag: (event: DragEvent, terminalId: string) => void
    onDropOnTab: (event: DragEvent, terminal: TerminalSnapshot) => void
    onTabDragEnd: () => void
    onStartRename: (terminal: TerminalSnapshot) => void
    onAliasKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
    onCommitRename: (terminal: TerminalSnapshot) => void
    onTabKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
    onBeginPanelResize: (panel: WorkspacePanelKey, event: PointerEvent) => void
    onResetPanelWidth: (panel: WorkspacePanelKey) => void
  }>()
</script>

<section class="workspace-shell" data-testid="workspace-shell">
  <div class="terminal-deck" data-testid="terminal-deck">
    <TerminalTabBar
      {terminals}
      {activeTerminalId}
      {draggingTerminalId}
      {tabDragEnabled}
      {editingTerminalId}
      {aliasDraft}
      onAliasDraftChange={onAliasDraftChange}
      onSelect={onSelectTerminal}
      onClose={onCloseTerminal}
      onStartDrag={onStartTabDrag}
      onDrop={onDropOnTab}
      onDragEnd={onTabDragEnd}
      onStartRename={onStartRename}
      onAliasKeydown={onAliasKeydown}
      onCommitRename={onCommitRename}
      onTabKeydown={onTabKeydown}
    />

    {#if aliasError}
      <div class="alias-error" role="alert">{aliasError}</div>
    {/if}

    <div class="terminal-stage">
      {#if activeTerminal}
        {#key activeTerminal.terminalId}
          {#if activeTerminal.backend === "text"}
            <TextBoxSlot terminal={activeTerminal} client={client} />
          {:else}
            <TerminalSlot terminal={activeTerminal} client={client} />
          {/if}
        {/key}
      {/if}
    </div>
  </div>

  {#if layout.panels.macro.visible}
    <section class="workspace-side-panel macro-side-panel" data-testid="macro-side-panel" style={"width: " + layout.panels.macro.widthPx + "px"}>
      <div class="panel-resize-handle" data-testid="macro-resize-handle" role="separator" aria-orientation="vertical" onpointerdown={(event) => onBeginPanelResize("macro", event)}></div>
      <div class="side-panel-scroll macro-workbench-shell" data-testid="macro-workbench-shell">
        <MacroPanel {configId} {terminals} {indexMap} insertionPaletteMode={macroInsertionPaletteMode} onResetWidth={() => onResetPanelWidth("macro")} {runLogRefreshToken} {runLogRefreshEvent} />
      </div>
    </section>
  {/if}

  {#if layout.panels.prompt.visible}
    <section class="workspace-side-panel prompt-side-panel" data-testid="prompt-side-panel" style={"width: " + layout.panels.prompt.widthPx + "px"}>
      <div class="panel-resize-handle" data-testid="prompt-resize-handle" role="separator" aria-orientation="vertical" onpointerdown={(event) => onBeginPanelResize("prompt", event)}></div>
      <div class="side-panel-scroll">
        <PromptPanel {configId} refreshToken={promptRefreshToken} refreshEvent={promptRefreshEvent} onResetWidth={() => onResetPanelWidth("prompt")} />
      </div>
    </section>
  {/if}
</section>
