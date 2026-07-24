<script lang="ts">
  import type { ContentEditLeaseChangedMessage, ContentRecordChangedMessage, RoomSnapshot, TerminalRuntimePosition, TerminalSnapshot } from '../../protocol'
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
    macroVisible: boolean; macroWidthPx: number
    canMutateShared: boolean; terminalStructureRevision: number
    terminalPositions: TerminalRuntimePosition[] | null; terminalStructureLocked: boolean; insertionPaletteMode: MacroInsertionPaletteMode
    runnerSnapshot: MacroRunnerSnapshot | null; contentRecordChanges: Array<ContentRecordChangedMessage & { sequence: number }>
    contentEditLeaseChanges: Array<ContentEditLeaseChangedMessage & { sequence: number }>
    connectionGeneration: number
    onMacroWidthChange: (widthPx: number) => void; onMacroDirtyChange: (dirty: boolean) => void
    onRoomSnapshot: (snapshot: RoomSnapshot) => void
    onSelectTerminal: (terminalId: string) => void; onCloseTerminal: (event: MouseEvent, terminal: TerminalSnapshot) => void
    onStartTabDrag: (event: DragEvent, terminalId: string) => void
    onDropOnTab: (event: DragEvent, terminal: TerminalSnapshot, sourceTerminalId?: string) => void
    onTabDragEnd: () => void; onTabKeydown: (event: KeyboardEvent, terminal: TerminalSnapshot) => void
    onMutationDenied: (reason: string) => void
  }>()

  let retainedTerminalIds = $state<string[]>([])
  const textFlushers = new Map<string, () => Promise<void>>()
  const visibleTerminalId = $derived(activeTerminal?.terminalId ?? null)
  const retainedTerminalIdSet = $derived(new Set(retainedTerminalIds))
  const retainedTerminals = $derived(terminals.filter((terminal: TerminalViewSnapshot) =>
    terminal.terminalId === visibleTerminalId || retainedTerminalIdSet.has(terminal.terminalId),
  ))

  $effect(() => {
    const liveTerminalIds = new Set(terminals.map((terminal: TerminalViewSnapshot) => terminal.terminalId))
    const next = retainedTerminalIds.filter((terminalId) => liveTerminalIds.has(terminalId))
    if (visibleTerminalId && liveTerminalIds.has(visibleTerminalId) && !next.includes(visibleTerminalId)) {
      next.push(visibleTerminalId)
    }
    if (next.length !== retainedTerminalIds.length || next.some((terminalId, index) => terminalId !== retainedTerminalIds[index])) {
      retainedTerminalIds = next
    }
  })

  function beginResize(event: PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = macroWidthPx
    const move = (next: PointerEvent) => onMacroWidthChange(Math.max(360, Math.min(1200, startWidth + startX - next.clientX)))
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }

  function registerTextFlush(terminalId: string, flush: () => Promise<void>): () => void {
    textFlushers.set(terminalId, flush)
    return () => {
      if (textFlushers.get(terminalId) === flush) textFlushers.delete(terminalId)
    }
  }

  async function flushTextTerminal(terminalId: string | null): Promise<void> {
    if (!terminalId) return
    await textFlushers.get(terminalId)?.()
  }

  async function flushAllTextTerminals(): Promise<void> {
    for (const flush of textFlushers.values()) await flush()
  }

  async function selectTerminal(terminalId: string): Promise<void> {
    try {
      if (terminalId !== activeTerminalId) await flushTextTerminal(activeTerminalId)
      onSelectTerminal(terminalId)
    } catch (error) {
      onMutationDenied(error instanceof Error ? error.message : String(error))
    }
  }

  async function closeTerminal(event: MouseEvent, terminal: TerminalSnapshot): Promise<void> {
    event.stopPropagation()
    try {
      await flushTextTerminal(terminal.terminalId)
      onCloseTerminal(event, terminal)
    } catch (error) {
      onMutationDenied(error instanceof Error ? error.message : String(error))
    }
  }

  async function dropOnTab(event: DragEvent, terminal: TerminalSnapshot): Promise<void> {
    event.preventDefault()
    const sourceTerminalId = event.dataTransfer?.getData('text/plain') || draggingTerminalId || undefined
    try {
      await flushTextTerminal(activeTerminalId)
      onDropOnTab(event, terminal, sourceTerminalId)
    } catch (error) {
      event.preventDefault()
      onMutationDenied(error instanceof Error ? error.message : String(error))
    }
  }

</script>

<section class="workspace-shell room-workspace flex min-h-0 flex-1 gap-0 overflow-hidden bg-base-200 p-0 [@media(max-width:980px)]:flex-col" data-testid="workspace-shell">
  <div class="terminal-room flex min-h-0 min-w-0 flex-[1_1_auto] flex-col overflow-hidden [@media(min-width:981px)_and_(max-width:1100px)]:min-w-[240px]" data-testid="terminal-room">
    <TerminalTabBar {terminals} {activeTerminalId} {draggingTerminalId} {tabDragEnabled} {sharedReadOnly}
      onSelect={(terminalId) => { void selectTerminal(terminalId) }} onClose={(event, terminal) => { void closeTerminal(event, terminal) }} onStartDrag={onStartTabDrag} onDrop={(event, terminal) => { void dropOnTab(event, terminal) }}
      onDragEnd={onTabDragEnd} onTabKeydown={(event, terminal) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void selectTerminal(terminal.terminalId)
        } else onTabKeydown(event, terminal)
      }} {onMutationDenied} />
    <div class="terminal-stage flex min-h-0 min-w-0 flex-1 overflow-hidden p-3 [@media(max-width:640px)]:p-2">
      {#each retainedTerminals as terminal (terminal.terminalId)}
        <div
          class="terminal-view-slot flex min-h-0 min-w-0 flex-1 overflow-hidden [&[hidden]]:hidden"
          data-testid="terminal-view-slot"
          data-terminal-id={terminal.terminalId}
          hidden={terminal.terminalId !== visibleTerminalId}
          aria-hidden={terminal.terminalId !== visibleTerminalId}
        >
          {#if terminal.backend === 'text'}
            <TextBoxSlot {terminal} {client} readOnly={sharedReadOnly} {onMutationDenied} {registerTextFlush} />
          {:else}
            <TerminalSlot {terminal} {client} active={terminal.terminalId === visibleTerminalId} readOnly={sharedReadOnly} {onMutationDenied} />
          {/if}
        </div>
      {/each}
      {#if !activeTerminal}<div class="empty-terminal-room grid h-full flex-1 place-items-center rounded-field border border-dashed border-base-content/30 bg-base-100 text-base-content/60" data-testid="empty-terminal-room">Create a Shell or Text terminal to begin.</div>{/if}
    </div>
  </div>

  <section class="workspace-side-panel macro-side-panel relative flex min-h-0 min-w-[360px] max-w-[85vw] shrink-0 border-l border-base-300 bg-base-200 [&_.macro-panel]:box-border [&_.macro-panel]:w-full [&_.macro-panel]:max-h-none [&_.macro-panel]:overflow-visible [&_.prompt-panel]:box-border [&_.prompt-panel]:w-full [&_.run-log-panel]:box-border [&_.run-log-panel]:w-full [@media(min-width:981px)_and_(max-width:1100px)]:flex-[0_1_auto] [@media(max-width:1260px)]:min-w-[420px] [@media(max-width:980px)]:!w-auto [@media(max-width:980px)]:min-h-[260px] [@media(max-width:980px)]:border-t [@media(max-width:980px)]:border-l-0" data-testid="macro-side-panel"
    style={`width: ${macroWidthPx}px;${macroVisible ? '' : ' display: none;'}`} hidden={!macroVisible}>
    <button class="panel-resize-handle relative box-border w-1.5 flex-[0_0_6px] touch-none cursor-col-resize rounded-none border-0 bg-transparent p-0 before:absolute before:inset-y-2 before:left-0.5 before:w-0.5 before:rounded-full before:bg-base-content/20 before:transition-[background-color,box-shadow] before:content-[''] hover:before:bg-primary/60 focus-visible:before:bg-primary/60 focus-visible:before:shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-primary)_20%,transparent)] active:before:bg-primary active:before:shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-primary)_24%,transparent)] [@media(max-width:980px)]:hidden" type="button" data-testid="macro-resize-handle" aria-label="Resize Macro panel" onpointerdown={beginResize}></button>
    <div class="side-panel-scroll macro-workbench-shell box-border flex min-h-0 min-w-0 max-w-full flex-1 flex-col gap-2.5 overflow-hidden p-2.5">
      <MacroPanel roomClient={client} {canMutateShared} {terminalStructureRevision} {terminalPositions} {terminalStructureLocked}
        {runnerSnapshot} {contentRecordChanges} {contentEditLeaseChanges} {connectionGeneration} {insertionPaletteMode} {onRoomSnapshot} {onMutationDenied}
        flushPendingText={flushAllTextTerminals} onDirtyChange={onMacroDirtyChange} onResetWidth={() => onMacroWidthChange(760)} />
    </div>
  </section>
</section>
