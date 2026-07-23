<script lang="ts">
  import type {
    MacroDefinitionV5,
    ParallelLane,
    ParallelLaneOutputNode,
  } from '../../macro/macroDefinitionTypes'
  import {
    artifactSourceKey,
    laneArtifactChoices,
    parallelMessageChoices,
    parallelOutputSourceKey,
    type ArtifactChoice,
  } from '../../macro/macroArtifactChoices'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import type { TerminalChoice } from '../../macro/macroTerminalChoices'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import {
    MacroInsertionPaletteLifecycle,
    type InsertionPalettePosition,
  } from './MacroInsertionPalette.svelte'
  import MacroTerminalSelect from './MacroTerminalSelect.svelte'
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
    choiceFromIndex,
    outerArtifactChoices,
    templateScope = null,
    insertionPaletteMode,
    currentNodeId = null,
  } = $props<{
    draft: MacroDefinitionV5
    nodeId: string
    updateDraft: (mutator: (template: MacroDefinitionV5) => void) => void
    terminalChoices: () => TerminalChoice[]
    adoptTerminalSelection: (template: MacroDefinitionV5, terminalIndex: number) => boolean
    choiceFromIndex: (target: number) => string
    outerArtifactChoices: ArtifactChoice[]
    templateScope?: TextTemplateScope | null
    insertionPaletteMode: MacroInsertionPaletteMode
    currentNodeId?: string | null
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
    adoptTerminalSelection: (template, terminalIndex) => adoptTerminalSelection(template, terminalIndex),
    choiceFromIndex: (target) => choiceFromIndex(target),
    closeLaneInsertion,
    closeLaneInsertionForLane: (laneId) => {
      if (laneInsertion?.laneId === laneId) closeLaneInsertion(false)
    },
  })
  const parallelNode = $derived(laneEditor.parallelNode())
  const selectedLane = $derived(laneEditor.selectedLane())
  const collectsAnyLaneText = $derived(laneEditor.collectsAnyLaneText())
  const editNotice = $derived(laneEditor.editNotice)
  const updateParallel = laneEditor.updateParallel
  const updateLaneAction = laneEditor.updateLaneAction
  const expectedTerminalTypeAt = laneEditor.expectedTerminalTypeAt
  const laneActionPaletteItemsFor = laneEditor.laneActionPaletteItemsFor
  const laneCaptureKinds = laneEditor.laneCaptureKinds
  const laneCaptureAllowed = laneEditor.laneCaptureAllowed
  const setLaneId = laneEditor.setLaneId
  const setLaneLabel = laneEditor.setLaneLabel
  const setLaneActionId = laneEditor.setLaneActionId
  const isLaneActionCollapsed = laneEditor.isLaneActionCollapsed
  const toggleLaneActionCollapsed = laneEditor.toggleLaneActionCollapsed
  const setLaneOutputId = laneEditor.setLaneOutputId
  const setLaneCollectsText = laneEditor.setLaneCollectsText
  const setLaneOutputSource = laneEditor.setLaneOutputSource
  const addLane = laneEditor.addLane
  const removeLane = laneEditor.removeLane
  const setLaneTerminalReference = laneEditor.setLaneTerminalReference
  const unavailableLaneTerminalValues = laneEditor.unavailableLaneTerminalValues
  const addAction = laneEditor.addAction
  const removeAction = laneEditor.removeAction
  const moveAction = laneEditor.moveAction
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

  function handleLaneInsertionKeydown(event: KeyboardEvent): void {
    laneInsertionPaletteLifecycle.handleKeydown(event, laneInsertion !== null, cancelLaneInsertion)
  }

  function handleLaneInsertionResize(): void {
    if (laneInsertion) void settleLaneInsertionPalette(false)
  }

  function insertLaneAction(type: LaneActionType): void {
    if (!laneInsertion) return
    if (addAction(laneInsertion.laneId, type, laneInsertion.index)) closeLaneInsertion(true)
  }

  function cancelLaneInsertion(): void {
    closeLaneInsertion(true)
  }

</script>

<svelte:window onkeydown={handleLaneInsertionKeydown} onresize={handleLaneInsertionResize} />

{#if parallelNode}
  <section class="parallel-tabs-editor grid min-w-0 gap-2.5" data-testid="parallel-lane-tabs">
    <div class="macro-row">
      <label>On lane fail<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-on-lane-fail" value={parallelNode.onLaneFail} onchange={(event) => updateParallel((node) => { node.onLaneFail = event.currentTarget.value as 'pause' | 'fail' })}><option value="pause">pause</option><option value="fail">fail</option></select></label>
      {#if collectsAnyLaneText}
        <label>Separator<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-merge-separator" value={parallelNode.merge.separator} oninput={(event) => updateParallel((node) => { node.merge.separator = event.currentTarget.value })} /></label>
        <label class="checkbox-row"><input class="checkbox checkbox-xs" type="checkbox" data-testid="parallel-include-empty-outputs" checked={parallelNode.merge.includeEmptyOutputs} onchange={(event) => updateParallel((node) => { node.merge.includeEmptyOutputs = event.currentTarget.checked })} />Include empty outputs</label>
      {/if}
    </div>

    <div class="parallel-tab-strip tabs tabs-box flex min-w-0 flex-wrap items-center gap-1 overflow-x-auto p-1" role="tablist">
      {#each parallelNode.lanes as lane}
        <button class="tab tab-sm h-7 min-h-7 px-2 text-xs [&.current-node]:bg-primary/20" type="button" class:tab-active={selectedLane?.id === lane.id} class:active={selectedLane?.id === lane.id} class:current-node={Boolean(currentNodeId && lane.body.some((item) => item.id === currentNodeId))} data-testid="parallel-lane-tab" data-current-node={currentNodeId && lane.body.some((item) => item.id === currentNodeId) ? 'true' : undefined} onclick={() => { selectedLaneId = lane.id; closeLaneInsertion(false) }}>{lane.label || lane.id}</button>
      {/each}
    </div>

    {#if selectedLane}
      <div class="parallel-lane-card active-lane card grid min-w-0 gap-2 bg-primary/10 p-2 shadow-sm" data-testid="parallel-lane-editor">
        <div class="step-title flex min-w-0 flex-wrap items-center justify-between gap-2">
          <strong>{selectedLane.label || selectedLane.id}</strong>
          <div class="inline-actions parallel-lane-controls flex flex-wrap gap-1">
            <button class="btn btn-primary btn-xs" type="button" data-testid="parallel-add-lane" onclick={addLane}>Add lane</button>
            <button class="btn btn-error btn-xs" type="button" data-testid="parallel-remove-lane" disabled={parallelNode.lanes.length <= 1} onclick={() => removeLane(selectedLane.id)}>Remove lane</button>
          </div>
        </div>
        <div class="macro-row">
          <label>Lane id<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-lane-id-input" value={selectedLane.id} oninput={(event) => { if (!setLaneId(selectedLane.id, event.currentTarget.value)) event.currentTarget.value = selectedLane.id }} /></label>
          <label>Label<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-lane-label-input" value={selectedLane.label} oninput={(event) => { if (!setLaneLabel(selectedLane.id, event.currentTarget.value)) event.currentTarget.value = selectedLane.label }} /></label>
          <label>Lane tab<MacroTerminalSelect testId="parallel-lane-terminal" reference={selectedLane.terminal} expectedType={expectedTerminalTypeAt(selectedLane.terminal)} choices={terminalChoices()} disabledValues={unavailableLaneTerminalValues(selectedLane.id)} onChange={(terminal) => setLaneTerminalReference(selectedLane.id, terminal)} /></label>
        </div>
        {#if editNotice}
          <p class="macro-insertion-notice alert alert-warning py-2 text-xs" data-testid="parallel-id-edit-notice">{editNotice}</p>
        {/if}

        {#if laneInsertion?.laneId === selectedLane.id}
          <div class="macro-insertion-mode fixed inset-0 z-[80] bg-neutral/10 [&.centered]:grid [&.centered]:place-items-center [&.centered]:p-4" class:anchored={laneInsertionAnchored} class:centered={!laneInsertionAnchored} data-testid="parallel-lane-insertion-mode" data-placement-mode={insertionPaletteMode}>
            <button type="button" class="macro-insertion-scrim fixed inset-0 !size-full !min-h-0 cursor-default !rounded-none !border-0 !bg-transparent !p-0" data-testid="parallel-lane-insertion-cancel-scrim" aria-label="Cancel parallel lane insertion" onclick={cancelLaneInsertion}></button>
            <section bind:this={laneInsertionPaletteElement} class="floating-insertion-palette relative z-[81] grid w-[min(360px,calc(100vw-32px))] max-h-[min(var(--palette-max-height,560px),calc(100vh-24px))] gap-2.5 overflow-auto rounded-box border border-base-300 bg-base-100 p-3 shadow-2xl [&.anchored]:fixed [&.anchored]:top-[var(--palette-y)] [&.anchored]:left-[var(--palette-x)] [&.anchored]:-translate-x-1/2 [&.anchored.above]:-translate-y-full" class:anchored={laneInsertionAnchored} class:above={laneInsertionPosition?.placement === 'above'} class:below={laneInsertionPosition?.placement === 'below'} style={laneInsertionPaletteStyle} data-testid="parallel-lane-action-palette" aria-label="Insert parallel lane action">
              <div class="palette-heading flex min-w-0 items-baseline justify-between gap-2"><span class="font-bold">{laneInsertion.summary}</span><small class="text-base-content/55">choose action</small></div>
              <div class="step-palette card grid gap-2 bg-base-200/60 p-2 shadow-sm">
                <div class="palette-heading flex min-w-0 items-baseline justify-between gap-2"><span class="font-bold">Actions</span><small class="text-base-content/55">do lane work</small></div>
                <div class="step-actions grid grid-cols-3 gap-1.5 [@media(max-width:760px)]:grid-cols-2">
                  {#each laneActionPaletteItemsFor(selectedLane) as item}
                    <button class="btn btn-sm btn-primary min-h-8" type="button" data-testid={item.testId} title={item.type} onclick={() => insertLaneAction(item.type)}><span class="tool-label">{item.label}</span></button>
                  {/each}
                </div>
              </div>
              <button class="btn btn-ghost btn-xs justify-self-end" type="button" data-testid="parallel-lane-insertion-cancel" onclick={cancelLaneInsertion}>Cancel</button>
            </section>
          </div>
        {/if}

        {#each selectedLane.body as item, itemIndex}
          {#if item.type === 'output'}
            {@render OutputEditor(selectedLane, item, itemIndex)}
          {:else}
            <ParallelLaneActionEditor
              {item}
              {itemIndex}
              moveDownDisabled={selectedLane.body[itemIndex + 1]?.type === 'output'}
              collapsed={isLaneActionCollapsed(item.id)}
              artifactChoices={parallelMessageChoices(outerArtifactChoices, selectedLane, item.id)}
              {templateScope}
              allowedCaptureKinds={laneCaptureKinds(selectedLane)}
              captureAllowed={item.type === 'capture-source' ? laneCaptureAllowed(selectedLane, item) : true}
              isCurrent={currentNodeId === item.id}
              onSetId={(nextId) => setLaneActionId(selectedLane.id, item.id, nextId)}
              onToggle={() => toggleLaneActionCollapsed(item.id)}
              onMove={(offset) => moveAction(selectedLane.id, item.id, offset)}
              onAddBefore={(event) => openLaneInsertion(selectedLane.id, itemIndex, 'Insert before: ' + item.id, event)}
              onAddAfter={(event) => openLaneInsertion(selectedLane.id, itemIndex + 1, 'Insert after: ' + item.id, event)}
              onRemove={() => removeAction(selectedLane.id, item.id)}
              onUpdate={(mutator) => updateLaneAction(selectedLane.id, item.id, mutator)}
            />
          {/if}
        {/each}
      </div>
    {/if}
  </section>
{/if}

{#snippet OutputEditor(lane: ParallelLane, output: ParallelLaneOutputNode, itemIndex: number)}
  <article class="step-card parallel-output-card card grid min-w-0 gap-2 bg-secondary/10 p-2 shadow-sm" data-testid="parallel-lane-output">
    <div class="step-title flex min-w-0 flex-wrap items-center justify-between gap-2">
      <span class="parallel-output-title flex min-w-0 items-baseline gap-1.5"><strong>Lane result</strong><small class="text-base-content/55">{output.source.kind === 'none' ? 'no text collected' : 'collecting text'}</small></span>
      <div class="inline-actions parallel-output-actions flex min-w-0 flex-wrap items-center gap-1.5">
        <label class="checkbox-row flex w-fit cursor-pointer items-center gap-1.5"><input class="checkbox checkbox-xs" type="checkbox" data-testid="parallel-collect-lane-text" checked={output.source.kind !== 'none'} onchange={(event) => { if (!setLaneCollectsText(lane.id, event.currentTarget.checked)) event.currentTarget.checked = false }} />Collect lane text</label>
        <button class="btn btn-xs btn-primary" type="button" data-testid="parallel-lane-add-before-output" onclick={(event) => openLaneInsertion(lane.id, itemIndex, 'Insert lane action', event)}>Add action</button>
      </div>
    </div>
    {#if output.source.kind !== 'none'}
      <div class="macro-row parallel-output-fields">
        <label>Output id<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-output-id-input" value={output.id} oninput={(event) => { if (!setLaneOutputId(lane.id, output.id, event.currentTarget.value)) event.currentTarget.value = output.id }} /></label>
        <label>Source<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-output-source" value={parallelOutputSourceKey(output.source)} onchange={(event) => setLaneOutputSource(lane.id, output.id, event.currentTarget.value)}><option value="">none</option>{#each laneArtifactChoices(lane, output.id) as choice}<option value={artifactSourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
      </div>
    {/if}
  </article>
{/snippet}
