<script lang="ts">
  import type { MacroDefinitionV6 } from '../../macro/macroDefinitionTypes'
  import {
    parallelMessageChoices,
    type ArtifactChoice,
  } from '../../macro/macroArtifactChoices'
  import {
    buildParallelTerminalUsage,
    parallelActionTerminalReference,
  } from '../../macro/parallelTerminalUsage'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import type { TerminalChoice } from '../../macro/macroTerminalChoices'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import {
    MacroInsertionPaletteLifecycle,
    type InsertionPalettePosition,
  } from './MacroInsertionPalette.svelte'
  import ParallelLaneActionEditor from './ParallelLaneActionEditor.svelte'
  import {
    createParallelLaneEditorController,
    type LaneActionType,
  } from './parallelLaneEditorController.svelte'

  let {
    draft,
    nodeId,
    updateDraft,
    terminalChoices,
    adoptTerminalSelection,
    outerArtifactChoices,
    templateScope = null,
    insertionPaletteMode,
    telegramProfileIds = [],
    telegramProfilesError = '',
    currentNodeId = null,
    depth,
  } = $props<{
    draft: MacroDefinitionV6
    nodeId: string
    updateDraft: (mutator: (template: MacroDefinitionV6) => void) => void
    terminalChoices: () => TerminalChoice[]
    adoptTerminalSelection: (template: MacroDefinitionV6, terminalIndex: number) => boolean
    outerArtifactChoices: ArtifactChoice[]
    templateScope?: TextTemplateScope | null
    insertionPaletteMode: MacroInsertionPaletteMode
    telegramProfileIds?: string[]
    telegramProfilesError?: string
    currentNodeId?: string | null
    depth: number
  }>()

  let selectedLaneId = $state('')
  let laneInsertion = $state<{ laneId: string; index: number; summary: string } | null>(null)
  let laneInsertionPosition = $state<InsertionPalettePosition | null>(null)
  let laneInsertionPaletteElement = $state<HTMLElement | null>(null)
  const laneInsertionPaletteLifecycle = new MacroInsertionPaletteLifecycle()
  const laneEditor = createParallelLaneEditorController({
    draft: () => draft,
    nodeId: () => nodeId,
    selectedLaneId: () => selectedLaneId,
    setSelectedLaneId: (laneId) => { selectedLaneId = laneId },
    updateDraft: (mutator) => updateDraft(mutator),
    terminalChoices: () => terminalChoices(),
    terminalUsageIndex: () => terminalUsageIndex,
    adoptTerminalSelection: (template, terminalIndex) => adoptTerminalSelection(template, terminalIndex),
    closeLaneInsertion,
    closeLaneInsertionForLane: (laneId) => {
      if (laneInsertion?.laneId === laneId) closeLaneInsertion(false)
    },
  })
  const parallelNode = $derived(laneEditor.parallelNode())
  const terminalUsageIndex = $derived(parallelNode
    ? buildParallelTerminalUsage(parallelNode, draft.terminalLayout)
    : undefined)
  const selectedLane = $derived(laneEditor.selectedLane())
  const editNotice = $derived(laneEditor.editNotice)
  const laneInsertionAnchored = $derived(insertionPaletteMode === 'anchored' && laneInsertionPosition !== null)
  const laneInsertionPaletteStyle = $derived(laneInsertionAnchored && laneInsertionPosition
    ? '--palette-x: ' + laneInsertionPosition.x + 'px; --palette-y: ' + laneInsertionPosition.y + 'px;'
      + (laneInsertionPosition.maxHeight ? ' --palette-max-height: ' + laneInsertionPosition.maxHeight + 'px;' : '')
    : '')

  $effect(() => {
    if (!parallelNode) return
    if (!parallelNode.lanes.some((lane) => lane.id === selectedLaneId)) {
      selectedLaneId = parallelNode.lanes[0]?.id ?? ''
      closeLaneInsertion(false)
    } else if (laneInsertion && !parallelNode.lanes.some((lane) => lane.id === laneInsertion?.laneId)) {
      closeLaneInsertion(false)
    }
  })

  function openLaneInsertion(laneId: string, index: number, summary: string, event?: MouseEvent): void {
    selectedLaneId = laneId
    laneInsertion = { laneId, index, summary }
    laneInsertionPosition = laneInsertionPaletteLifecycle.open(event, insertionPaletteMode)
    void settleLaneInsertionPalette(true)
  }

  async function settleLaneInsertionPalette(shouldFocus: boolean): Promise<void> {
    await laneInsertionPaletteLifecycle.settle(
      () => insertionPaletteMode,
      () => laneInsertionPosition,
      () => laneInsertionPaletteElement,
      (position) => { laneInsertionPosition = position },
      shouldFocus,
    )
  }

  function closeLaneInsertion(restoreFocus: boolean): void {
    laneInsertionPaletteLifecycle.close(() => {
      laneInsertion = null
      laneInsertionPosition = null
      laneInsertionPaletteElement = null
    }, restoreFocus)
  }

  function insertLaneAction(type: LaneActionType): void {
    if (!laneInsertion) return
    if (laneEditor.addAction(laneInsertion.laneId, type, laneInsertion.index)) {
      closeLaneInsertion(true)
    }
  }

  function handleLaneInsertionKeydown(event: KeyboardEvent): void {
    laneInsertionPaletteLifecycle.handleKeydown(event, laneInsertion !== null, () => closeLaneInsertion(true))
  }

  function handleLaneInsertionResize(): void {
    if (laneInsertion) void settleLaneInsertionPalette(false)
  }
</script>

<svelte:window onkeydown={handleLaneInsertionKeydown} onresize={handleLaneInsertionResize} />

{#if parallelNode}
  <section class="parallel-tabs-editor grid min-w-0 gap-2.5" data-testid="parallel-lane-tabs">
    <div class="macro-row">
      <label>On pane fail<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-on-lane-fail" value={parallelNode.onLaneFail} onchange={(event) => laneEditor.updateParallel((node) => { node.onLaneFail = event.currentTarget.value as 'pause' | 'fail' })}><option value="pause">pause</option><option value="fail">fail</option></select></label>
      <label>Shared Text order<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-shared-text-order" value={parallelNode.sharedTextOrder} onchange={(event) => laneEditor.updateParallel((node) => { node.sharedTextOrder = event.currentTarget.value as 'pane_order' | 'completion_order' })}><option value="pane_order">pane order (default)</option><option value="completion_order">completion order</option></select></label>
    </div>

    <div class="parallel-tab-strip tabs tabs-box flex min-w-0 flex-wrap items-center gap-1 overflow-x-auto p-1" role="tablist">
      {#each parallelNode.lanes as lane}
        <button class="tab tab-sm h-7 min-h-7 px-2 text-xs [&.current-node]:bg-primary/20" type="button" class:tab-active={selectedLane?.id === lane.id} class:active={selectedLane?.id === lane.id} class:current-node={Boolean(currentNodeId && lane.body.some((item) => item.id === currentNodeId))} data-testid="parallel-lane-tab" data-current-node={currentNodeId && lane.body.some((item) => item.id === currentNodeId) ? 'true' : undefined} onclick={() => { selectedLaneId = lane.id; closeLaneInsertion(false) }}>{lane.label || lane.id}</button>
      {/each}
    </div>

    {#if selectedLane}
      <div
        class="parallel-lane-card active-lane card grid min-w-0 gap-2 border-l-4 bg-primary/10 p-2 pl-2 shadow-sm"
        class:border-l-primary={(depth + 1) % 4 === 0}
        class:border-l-secondary={(depth + 1) % 4 === 1}
        class:border-l-accent={(depth + 1) % 4 === 2}
        class:border-l-info={(depth + 1) % 4 === 3}
        data-testid="parallel-lane-editor"
        data-flow-depth={depth + 1}
      >
        <div class="step-title flex min-w-0 flex-wrap items-center justify-between gap-2">
          <strong>{selectedLane.label || selectedLane.id}</strong>
          <div class="inline-actions parallel-lane-controls flex flex-wrap gap-1">
            <button class="btn btn-primary btn-xs" type="button" data-testid="parallel-add-lane" onclick={laneEditor.addLane}>Add pane</button>
            <button class="btn btn-error btn-xs" type="button" data-testid="parallel-remove-lane" disabled={parallelNode.lanes.length <= 1} onclick={() => laneEditor.removeLane(selectedLane.id)}>Remove pane</button>
          </div>
        </div>
        <div class="macro-row">
          <label>Pane id<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-lane-id-input" value={selectedLane.id} oninput={(event) => { if (!laneEditor.setLaneId(selectedLane.id, event.currentTarget.value)) event.currentTarget.value = selectedLane.id }} /></label>
          <label>Label<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-lane-label-input" value={selectedLane.label} oninput={(event) => { if (!laneEditor.setLaneLabel(selectedLane.id, event.currentTarget.value)) event.currentTarget.value = selectedLane.label }} /></label>
        </div>
        {#if editNotice}
          <p class="macro-insertion-notice alert alert-warning py-2 text-xs" data-testid="parallel-id-edit-notice">{editNotice}</p>
        {/if}

        {#if selectedLane.body.length === 0}
          <div class="rounded-box bg-base-200/60 p-2 text-center">
            <button class="btn btn-primary btn-xs" type="button" data-testid="parallel-lane-add-empty" onclick={(event) => openLaneInsertion(selectedLane.id, 0, 'Add pane action', event)}>Add action</button>
          </div>
        {/if}

        {#if laneInsertion?.laneId === selectedLane.id}
          <div class="macro-insertion-mode fixed inset-0 z-[80] bg-neutral/10 [&.centered]:grid [&.centered]:place-items-center [&.centered]:p-4" class:anchored={laneInsertionAnchored} class:centered={!laneInsertionAnchored} data-testid="parallel-lane-insertion-mode" data-placement-mode={insertionPaletteMode}>
            <button type="button" class="macro-insertion-scrim fixed inset-0 !size-full !min-h-0 cursor-default !rounded-none !border-0 !bg-transparent !p-0" data-testid="parallel-lane-insertion-cancel-scrim" aria-label="Cancel parallel pane insertion" onclick={() => closeLaneInsertion(true)}></button>
            <section bind:this={laneInsertionPaletteElement} class="floating-insertion-palette relative z-[81] grid w-[min(360px,calc(100vw-32px))] max-h-[min(var(--palette-max-height,560px),calc(100vh-24px))] gap-2.5 overflow-auto rounded-box border border-base-300 bg-base-100 p-3 shadow-2xl [&.anchored]:fixed [&.anchored]:top-[var(--palette-y)] [&.anchored]:left-[var(--palette-x)] [&.anchored]:-translate-x-1/2 [&.anchored.above]:-translate-y-full" class:anchored={laneInsertionAnchored} class:above={laneInsertionPosition?.placement === 'above'} class:below={laneInsertionPosition?.placement === 'below'} style={laneInsertionPaletteStyle} data-testid="parallel-lane-action-palette" aria-label="Insert parallel pane action">
              <div class="palette-heading flex min-w-0 items-baseline justify-between gap-2"><span class="font-bold">{laneInsertion.summary}</span><small class="text-base-content/55">choose action</small></div>
              <div class="step-palette card grid gap-2 bg-base-200/60 p-2 shadow-sm">
                <div class="palette-heading flex min-w-0 items-baseline justify-between gap-2"><span class="font-bold">Actions</span><small class="text-base-content/55">do pane work</small></div>
                <div class="step-actions grid grid-cols-3 gap-1.5 [@media(max-width:760px)]:grid-cols-2">
                  {#each laneEditor.laneActionPaletteItems() as item}
                    <button class="btn btn-sm btn-primary min-h-8" type="button" data-testid={item.testId} title={item.type} onclick={() => insertLaneAction(item.type)}><span class="tool-label">{item.label}</span></button>
                  {/each}
                </div>
              </div>
              <button class="btn btn-ghost btn-xs justify-self-end" type="button" data-testid="parallel-lane-insertion-cancel" onclick={() => closeLaneInsertion(true)}>Cancel</button>
            </section>
          </div>
        {/if}

        {#each selectedLane.body as item, itemIndex (item)}
          {@const terminal = parallelActionTerminalReference(item)}
          <ParallelLaneActionEditor
            {item}
            {itemIndex}
            moveDownDisabled={itemIndex === selectedLane.body.length - 1}
            collapsed={laneEditor.isLaneActionCollapsed(item.id)}
            artifactChoices={parallelMessageChoices(outerArtifactChoices, selectedLane, item.id)}
            {templateScope}
            terminalChoices={laneEditor.actionTerminalChoices(item)}
            allTerminalChoices={terminalChoices()}
            disabledTerminalValues={laneEditor.unavailableActionTerminalValues(selectedLane.id, item)}
            expectedTerminalType={terminal ? laneEditor.expectedTerminalTypeAt(terminal) : undefined}
            terminalUsage={laneEditor.terminalUsage(item)}
            allowedCaptureKinds={item.type === 'capture-source' ? laneEditor.actionCaptureKinds(item) : []}
            captureAllowed={item.type === 'capture-source' ? laneEditor.actionCaptureAllowed(item) : true}
            {telegramProfileIds}
            {telegramProfilesError}
            isCurrent={currentNodeId === item.id}
            onSetId={(nextId) => laneEditor.setLaneActionId(selectedLane.id, item.id, nextId)}
            onToggle={() => laneEditor.toggleLaneActionCollapsed(item.id)}
            onMove={(offset) => laneEditor.moveAction(selectedLane.id, item.id, offset)}
            onAddBefore={(event) => openLaneInsertion(selectedLane.id, itemIndex, 'Insert before: ' + item.id, event)}
            onAddAfter={(event) => openLaneInsertion(selectedLane.id, itemIndex + 1, 'Insert after: ' + item.id, event)}
            onRemove={() => laneEditor.removeAction(selectedLane.id, item.id)}
            onUpdate={(mutator) => laneEditor.updateLaneAction(selectedLane.id, item.id, mutator)}
            onTerminalChange={(reference) => laneEditor.setActionTerminalReference(selectedLane.id, item.id, reference)}
          />
        {/each}
      </div>
    {/if}
  </section>
{/if}
