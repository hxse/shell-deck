<script lang="ts">
  import { tick } from 'svelte'
  import type {
    FlowV2Node,
    MacroDefinitionV5,
    MacroTerminalReference,
    ParallelLane,
    ParallelLaneActionNode,
    ParallelLaneOutputNode,
    ParallelNode,
  } from '../../macro/macroDefinitionTypes'
  import {
    allMacroNodeIds,
    defaultParallelLane,
    defaultParallelLaneAction,
    nextParallelLaneId,
  } from '../../macro/macroEditorDefaults'
  import {
    artifactSourceKey,
    laneArtifactChoices,
    parallelMessageChoices,
    parallelOutputSourceFromKey,
    parallelOutputSourceKey,
    type ArtifactChoice,
  } from '../../macro/macroArtifactChoices'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import {
    isCaptureKindAllowed,
    terminalChoiceForIndex,
    type CapabilityCaptureKind,
    type TerminalChoice,
  } from '../../macro/macroTerminalChoices'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import MacroTerminalSelect from './MacroTerminalSelect.svelte'
  import ParallelLaneActionEditor from './ParallelLaneActionEditor.svelte'

  type LaneActionType = ParallelLaneActionNode['type']
  type InsertionPalettePosition = {
    x: number
    y: number
    placement: 'above' | 'below'
    maxHeight?: number
  }

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
  let laneInsertionTriggerElement = $state<HTMLElement | null>(null)
  let laneInsertionPaletteElement = $state<HTMLElement | null>(null)
  let collapsedLaneActionIds = $state<string[]>([])
  let editNotice = $state('')
  const parallelNode = $derived(findParallel(draft.body, nodeId))
  const selectedLane = $derived(parallelNode?.lanes.find((lane) => lane.id === selectedLaneId) ?? parallelNode?.lanes[0])
  const collectsAnyLaneText = $derived(Boolean(parallelNode?.lanes.some((lane) => laneOutput(lane)?.source.kind !== 'none')))
  const laneInsertionAnchored = $derived(insertionPaletteMode === 'anchored' && laneInsertionPosition !== null)
  const laneInsertionPaletteStyle = $derived(laneInsertionAnchored && laneInsertionPosition
    ? '--palette-x: ' + laneInsertionPosition.x + 'px; --palette-y: ' + laneInsertionPosition.y + 'px;'
      + (laneInsertionPosition.maxHeight ? ' --palette-max-height: ' + laneInsertionPosition.maxHeight + 'px;' : '')
    : '')
  const laneActionPaletteItems: Array<{ type: LaneActionType; label: string; testId: string }> = [
    { type: 'send', label: 'send', testId: 'parallel-add-send' },
    { type: 'wait', label: 'wait', testId: 'parallel-add-wait' },
    { type: 'capture-source', label: 'capture', testId: 'parallel-add-capture' },
    { type: 'extract_text', label: 'extract', testId: 'parallel-add-extract' },
  ]

  $effect(() => {
    if (!parallelNode) return
    if (!parallelNode.lanes.some((lane) => lane.id === selectedLaneId)) {
      selectedLaneId = parallelNode.lanes[0]?.id ?? ''
      closeLaneInsertion(false)
    } else if (laneInsertion && !parallelNode.lanes.some((lane) => lane.id === laneInsertion?.laneId)) {
      closeLaneInsertion(false)
    }
  })

  function updateParallel(mutator: (node: ParallelNode) => void): void {
    updateDraft((template: MacroDefinitionV5) => {
      const node = findParallel(template.body, nodeId)
      if (node) mutator(node)
    })
  }

  function updateLane(laneId: string, mutator: (lane: ParallelLane) => void): void {
    updateParallel((node) => {
      const lane = node.lanes.find((candidate) => candidate.id === laneId)
      if (lane) mutator(lane)
    })
  }

  function updateLaneAction(
    laneId: string,
    actionId: string,
    mutator: (action: ParallelLaneActionNode) => void,
  ): void {
    updateLane(laneId, (lane) => {
      const action = lane.body.find((item): item is ParallelLaneActionNode => item.id === actionId && item.type !== 'output')
      if (action) mutator(action)
    })
  }

  function choiceForIndex(target: number): TerminalChoice | undefined {
    return terminalChoiceForIndex(target, terminalChoices())
  }

  function expectedTerminalTypeAt(terminal: MacroTerminalReference): 'shell' | 'text' | undefined {
    return terminal.kind === 'terminal_index' ? draft.terminalLayout[terminal.index - 1]?.type : undefined
  }

  function laneChoice(lane: ParallelLane): TerminalChoice | undefined {
    return lane.terminal.kind === 'terminal_index' ? choiceForIndex(lane.terminal.index) : undefined
  }

  function laneAllowsAction(lane: ParallelLane, type: LaneActionType): boolean {
    const capabilities = laneChoice(lane)?.capabilities
    if (!capabilities) return true
    if (type === 'wait') return capabilities.canWaitQuiet
    return true
  }

  function laneActionPaletteItemsFor(
    lane: ParallelLane,
  ): Array<{ type: LaneActionType; label: string; testId: string }> {
    return laneActionPaletteItems.filter((item) => laneAllowsAction(lane, item.type))
  }

  function laneCaptureKinds(lane: ParallelLane): CapabilityCaptureKind[] {
    return laneChoice(lane)?.capabilities.captureKinds ?? ['terminal-buffer', 'agent-event', 'text-box']
  }

  function laneCaptureAllowed(
    lane: ParallelLane,
    action: Extract<ParallelLaneActionNode, { type: 'capture-source' }>,
  ): boolean {
    const choice = laneChoice(lane)
    return choice ? isCaptureKindAllowed(choice.capabilities, action.capture.kind) : true
  }

  function incompatibleLaneActionIds(lane: ParallelLane, target: number): string[] {
    const targetChoice = choiceForIndex(target)
    if (!targetChoice) return []
    return lane.body.flatMap((item) => {
      if (item.type === 'output') return []
      if (item.type === 'wait') return targetChoice.capabilities.canWaitQuiet ? [] : [item.id]
      if (item.type === 'capture-source') {
        return isCaptureKindAllowed(targetChoice.capabilities, item.capture.kind) ? [] : [item.id]
      }
      return []
    })
  }

  function setLaneId(laneId: string, nextId: string): boolean {
    const node = parallelNode
    if (!node) return false
    if (nextId !== laneId && node.lanes.some((lane) => lane.id === nextId)) {
      editNotice = 'Duplicate lane id blocked: ' + nextId
      return false
    }
    editNotice = ''
    updateParallel((parallel) => {
      const lane = parallel.lanes.find((candidate) => candidate.id === laneId)
      if (!lane) return
      lane.id = nextId
      selectedLaneId = nextId
    })
    return true
  }

  function setLaneLabel(laneId: string, nextLabel: string): boolean {
    const node = parallelNode
    if (!node) return false
    const normalized = nextLabel.trim()
    if (normalized && node.lanes.some((lane) => lane.id !== laneId && lane.label.trim() === normalized)) {
      editNotice = 'Duplicate lane label blocked: ' + normalized
      return false
    }
    editNotice = ''
    updateLane(laneId, (lane) => { lane.label = nextLabel })
    return true
  }

  function setLaneActionId(laneId: string, actionId: string, nextId: string): boolean {
    if (nextId !== actionId && allMacroNodeIds(draft.body).includes(nextId)) {
      editNotice = 'Duplicate action id blocked: ' + nextId
      return false
    }
    editNotice = ''
    updateLaneAction(laneId, actionId, (action) => { action.id = nextId })
    if (collapsedLaneActionIds.includes(actionId)) {
      collapsedLaneActionIds = collapsedLaneActionIds.map((id) => id === actionId ? nextId : id)
    }
    return true
  }

  function isLaneActionCollapsed(actionId: string): boolean {
    return collapsedLaneActionIds.includes(actionId)
  }

  function toggleLaneActionCollapsed(actionId: string): void {
    collapsedLaneActionIds = isLaneActionCollapsed(actionId)
      ? collapsedLaneActionIds.filter((id) => id !== actionId)
      : [...collapsedLaneActionIds, actionId]
  }

  function setLaneOutputId(laneId: string, outputId: string, nextId: string): boolean {
    if (nextId !== outputId && allMacroNodeIds(draft.body).includes(nextId)) {
      editNotice = 'Duplicate output id blocked: ' + nextId
      return false
    }
    editNotice = ''
    updateLane(laneId, (lane) => {
      const output = lane.body.find((candidate): candidate is ParallelLaneOutputNode => candidate.id === outputId && candidate.type === 'output')
      if (output) output.id = nextId
    })
    return true
  }

  function setLaneCollectsText(laneId: string, enabled: boolean): boolean {
    const lane = parallelNode?.lanes.find((candidate) => candidate.id === laneId)
    const output = lane ? laneOutput(lane) : undefined
    if (!lane || !output) return false
    if (!enabled) {
      editNotice = ''
      updateLane(laneId, (item) => {
        const target = laneOutput(item)
        if (target) target.source = { kind: 'none' }
      })
      return true
    }
    const choices = laneArtifactChoices(lane, output.id)
    const source = choices.at(-1)?.source
    if (!source) {
      editNotice = 'Add Capture or Extract before collecting lane text.'
      return false
    }
    editNotice = ''
    updateLane(laneId, (item) => {
      const target = laneOutput(item)
      if (target) target.source = { ...source }
    })
    return true
  }

  function setLaneOutputSource(laneId: string, outputId: string, value: string): void {
    editNotice = ''
    updateLane(laneId, (lane) => {
      const output = lane.body.find((candidate): candidate is ParallelLaneOutputNode => candidate.id === outputId && candidate.type === 'output')
      if (output) output.source = parallelOutputSourceFromKey(value)
    })
  }

  function addLane(): void {
    updateDraft((template: MacroDefinitionV5) => {
      const node = findParallel(template.body, nodeId)
      if (!node) return
      const terminal: MacroTerminalReference = { kind: 'unassigned' }
      const lane = defaultParallelLane(template, nextParallelLaneId(node.lanes), terminal, node.lanes.map((item) => item.id))
      node.lanes.push(lane)
      selectedLaneId = lane.id
      closeLaneInsertion(false)
    })
  }

  function removeLane(laneId: string): void {
    const node = parallelNode
    const lane = node?.lanes.find((candidate) => candidate.id === laneId)
    if (!node || !lane || node.lanes.length <= 1) return
    if (!confirm('Remove parallel lane ' + laneId + '?')) return
    const removedActionIds = new Set(lane.body.filter((item) => item.type !== 'output').map((item) => item.id))
    updateParallel((parallel) => {
      parallel.lanes = parallel.lanes.filter((candidate) => candidate.id !== laneId)
      if (selectedLaneId === laneId) selectedLaneId = parallel.lanes[0]?.id ?? ''
      if (laneInsertion?.laneId === laneId) closeLaneInsertion(false)
    })
    collapsedLaneActionIds = collapsedLaneActionIds.filter((id) => !removedActionIds.has(id))
  }

  function setLaneTerminalReference(laneId: string, terminal: MacroTerminalReference): boolean {
    const lane = parallelNode?.lanes.find((candidate) => candidate.id === laneId)
    if (!lane) return false
    const incompatible = terminal.kind === 'terminal_index' ? incompatibleLaneActionIds(lane, terminal.index) : []
    if (incompatible.length > 0) {
      const target = terminal.kind === 'terminal_index' ? choiceForIndex(terminal.index) : undefined
      editNotice = 'Lane terminal change blocked; incompatible actions for ' + (target?.label ?? 'terminal') + ': ' + incompatible.join(', ')
      return false
    }
    editNotice = ''
    let updated = false
    updateDraft((template: MacroDefinitionV5) => {
      if (terminal.kind === 'terminal_index' && !adoptTerminalSelection(template, terminal.index)) return
      const node = findParallel(template.body, nodeId)
      const item = node?.lanes.find((candidate) => candidate.id === laneId)
      if (!item) return
      item.terminal = terminal
      updated = true
    })
    return updated
  }

  function isTerminalChoiceUsedByOtherLane(laneId: string, choiceValue: string): boolean {
    const node = parallelNode
    if (!node) return false
    return node.lanes.some((lane) => lane.id !== laneId
      && lane.terminal.kind === 'terminal_index'
      && choiceFromIndex(lane.terminal.index) === choiceValue)
  }

  function unavailableLaneTerminalValues(laneId: string): string[] {
    return terminalChoices()
      .filter((choice: TerminalChoice) => isTerminalChoiceUsedByOtherLane(laneId, choice.value))
      .map((choice: TerminalChoice) => choice.value)
  }

  function addAction(laneId: string, type: LaneActionType, insertionIndex?: number): boolean {
    let added = false
    updateDraft((template: MacroDefinitionV5) => {
      const node = findParallel(template.body, nodeId)
      const lane = node?.lanes.find((candidate) => candidate.id === laneId)
      if (!lane) return
      const output = outputIndex(lane)
      const maxIndex = output < 0 ? lane.body.length : output
      const targetIndex = Math.max(0, Math.min(insertionIndex ?? maxIndex, maxIndex))
      const captureKind = laneCaptureKinds(lane)[0] ?? 'terminal-buffer'
      lane.body.splice(targetIndex, 0, defaultParallelLaneAction(template, type, captureKind))
      selectedLaneId = lane.id
      editNotice = ''
      added = true
    })
    return added
  }

  function openLaneInsertion(laneId: string, index: number, summary: string, event?: MouseEvent): void {
    const target = event?.currentTarget
    selectedLaneId = laneId
    laneInsertionTriggerElement = target instanceof HTMLElement ? target : null
    laneInsertion = { laneId, index, summary }
    laneInsertionPosition = insertionPaletteMode === 'anchored' ? positionLaneInsertionPalette(event) : null
    void settleLaneInsertionPalette(true)
  }

  function positionLaneInsertionPalette(event?: MouseEvent): InsertionPalettePosition | null {
    const target = event?.currentTarget
    if (!(target instanceof HTMLElement)) return null
    const rect = target.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const estimatedHalfWidth = 180
    const estimatedHeight = Math.min(360, Math.max(0, window.innerHeight - margin * 2))
    const preferred = rect.top > window.innerHeight / 2 ? 'above' : 'below'
    const aboveSpace = Math.max(0, rect.top - gap - margin)
    const belowSpace = Math.max(0, window.innerHeight - rect.bottom - gap - margin)
    const placement = preferred === 'above'
      ? aboveSpace >= Math.min(estimatedHeight, belowSpace) ? 'above' : 'below'
      : belowSpace >= Math.min(estimatedHeight, aboveSpace) ? 'below' : 'above'
    const availableHeight = placement === 'above' ? aboveSpace : belowSpace
    const maxHeight = Math.max(0, availableHeight)
    const x = clamp(rect.left + rect.width / 2, margin + estimatedHalfWidth, window.innerWidth - margin - estimatedHalfWidth)
    const y = placement === 'above' ? rect.top - gap : rect.bottom + gap
    return { x, y, placement, maxHeight }
  }

  async function settleLaneInsertionPalette(shouldFocus: boolean): Promise<void> {
    await tick()
    clampLaneInsertionPaletteToViewport()
    if (shouldFocus) focusLaneInsertionPalette()
  }

  function clampLaneInsertionPaletteToViewport(): void {
    if (!laneInsertionAnchored || !laneInsertionPosition || !laneInsertionPaletteElement || !laneInsertionTriggerElement) return
    const triggerRect = laneInsertionTriggerElement.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const width = laneInsertionPaletteElement.offsetWidth
    const height = laneInsertionPaletteElement.offsetHeight
    if (width <= 0 || height <= 0) return
    const preferred = triggerRect.top > window.innerHeight / 2 ? 'above' : 'below'
    const aboveSpace = Math.max(0, triggerRect.top - gap - margin)
    const belowSpace = Math.max(0, window.innerHeight - triggerRect.bottom - gap - margin)
    const placement = preferred === 'above'
      ? aboveSpace >= Math.min(height, belowSpace) ? 'above' : 'below'
      : belowSpace >= Math.min(height, aboveSpace) ? 'below' : 'above'
    const availableHeight = placement === 'above' ? aboveSpace : belowSpace
    const maxHeight = Math.max(0, availableHeight)
    const effectiveHeight = maxHeight > 0 ? Math.min(height, maxHeight) : height
    const x = clamp(triggerRect.left + triggerRect.width / 2, margin + width / 2, window.innerWidth - margin - width / 2)
    const rawY = placement === 'above' ? triggerRect.top - gap : triggerRect.bottom + gap
    const y = placement === 'above'
      ? clamp(rawY, margin + effectiveHeight, window.innerHeight - margin)
      : clamp(rawY, margin, window.innerHeight - margin)
    laneInsertionPosition = { x, y, placement, maxHeight }
  }

  function focusLaneInsertionPalette(): void {
    const focusable = laneInsertionPaletteElement?.querySelector<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled])')
    focusable?.focus()
  }

  function closeLaneInsertion(restoreFocus: boolean): void {
    const trigger = laneInsertionTriggerElement
    laneInsertion = null
    laneInsertionPosition = null
    laneInsertionTriggerElement = null
    laneInsertionPaletteElement = null
    if (restoreFocus && trigger) void tick().then(() => trigger.focus())
  }

  function handleLaneInsertionKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && laneInsertion) cancelLaneInsertion()
  }

  function handleLaneInsertionResize(): void {
    if (laneInsertion) void settleLaneInsertionPalette(false)
  }

  function clamp(value: number, min: number, max: number): number {
    if (max < min) return min
    return Math.max(min, Math.min(max, value))
  }

  function insertLaneAction(type: LaneActionType): void {
    if (!laneInsertion) return
    if (addAction(laneInsertion.laneId, type, laneInsertion.index)) closeLaneInsertion(true)
  }

  function cancelLaneInsertion(): void {
    closeLaneInsertion(true)
  }

  function removeAction(laneId: string, actionId: string): void {
    updateLane(laneId, (lane) => {
      const index = lane.body.findIndex((item) => item.id === actionId)
      if (index < 0 || lane.body[index]?.type === 'output') return
      if (!confirm('Remove parallel lane action ' + actionId + '?')) return
      lane.body.splice(index, 1)
      collapsedLaneActionIds = collapsedLaneActionIds.filter((id) => id !== actionId)
    })
  }

  function moveAction(laneId: string, actionId: string, offset: -1 | 1): void {
    updateLane(laneId, (lane) => {
      const index = lane.body.findIndex((item) => item.id === actionId)
      const output = outputIndex(lane)
      const target = index + offset
      if (index < 0 || lane.body[index]?.type === 'output') return
      if (target < 0 || target >= (output < 0 ? lane.body.length : output)) return
      const [item] = lane.body.splice(index, 1)
      lane.body.splice(target, 0, item)
    })
  }

  function outputIndex(lane: ParallelLane): number {
    return lane.body.findIndex((item) => item.type === 'output')
  }

  function laneOutput(lane: ParallelLane): ParallelLaneOutputNode | undefined {
    return lane.body.find((item): item is ParallelLaneOutputNode => item.type === 'output')
  }

  function findParallel(nodes: FlowV2Node[], id: string): ParallelNode | undefined {
    for (const node of nodes) {
      if (node.type === 'parallel' && node.id === id) return node
      if (node.type === 'if') {
        for (const branch of node.branches) {
          const found = findParallel(branch.body, id)
          if (found) return found
        }
        if (node.else) {
          const found = findParallel(node.else, id)
          if (found) return found
        }
      }
      if (node.type === 'for') {
        const found = findParallel(node.body, id)
        if (found) return found
      }
      if ((node.type === 'break' || node.type === 'continue' || node.type === 'finish') && node.body) {
        const found = findParallel(node.body, id)
        if (found) return found
      }
    }
  }
</script>

<svelte:window onkeydown={handleLaneInsertionKeydown} onresize={handleLaneInsertionResize} />

{#if parallelNode}
  <section class="parallel-tabs-editor grid min-w-0 gap-2.5" data-testid="parallel-lane-tabs">
    <div class="macro-row">
      <label>On lane fail<select data-testid="parallel-on-lane-fail" value={parallelNode.onLaneFail} onchange={(event) => updateParallel((node) => { node.onLaneFail = event.currentTarget.value as 'pause' | 'fail' })}><option value="pause">pause</option><option value="fail">fail</option></select></label>
      {#if collectsAnyLaneText}
        <label>Separator<input data-testid="parallel-merge-separator" value={parallelNode.merge.separator} oninput={(event) => updateParallel((node) => { node.merge.separator = event.currentTarget.value })} /></label>
        <label class="checkbox-row"><input type="checkbox" data-testid="parallel-include-empty-outputs" checked={parallelNode.merge.includeEmptyOutputs} onchange={(event) => updateParallel((node) => { node.merge.includeEmptyOutputs = event.currentTarget.checked })} />Include empty outputs</label>
      {/if}
    </div>

    <div class="parallel-tab-strip tabs tabs-box flex min-w-0 flex-wrap items-center gap-1 overflow-x-auto p-1" role="tablist">
      {#each parallelNode.lanes as lane}
        <button class="tab tab-sm h-7 min-h-7 border border-transparent px-2 text-xs [&.current-node]:border-primary [&.current-node]:ring-1 [&.current-node]:ring-primary" type="button" class:tab-active={selectedLane?.id === lane.id} class:active={selectedLane?.id === lane.id} class:current-node={Boolean(currentNodeId && lane.body.some((item) => item.id === currentNodeId))} data-testid="parallel-lane-tab" data-current-node={currentNodeId && lane.body.some((item) => item.id === currentNodeId) ? 'true' : undefined} onclick={() => { selectedLaneId = lane.id; closeLaneInsertion(false) }}>{lane.label || lane.id}</button>
      {/each}
    </div>

    {#if selectedLane}
      <div class="parallel-lane-card active-lane card grid min-w-0 gap-2 border border-primary/40 bg-base-200/30 p-2" data-testid="parallel-lane-editor">
        <div class="step-title flex min-w-0 flex-wrap items-center justify-between gap-2">
          <strong>{selectedLane.label || selectedLane.id}</strong>
          <div class="inline-actions parallel-lane-controls flex flex-wrap gap-1">
            <button class="btn btn-xs" type="button" data-testid="parallel-add-lane" onclick={addLane}>Add lane</button>
            <button class="btn btn-error btn-soft btn-xs" type="button" data-testid="parallel-remove-lane" disabled={parallelNode.lanes.length <= 1} onclick={() => removeLane(selectedLane.id)}>Remove lane</button>
          </div>
        </div>
        <div class="macro-row">
          <label>Lane id<input data-testid="parallel-lane-id-input" value={selectedLane.id} oninput={(event) => { if (!setLaneId(selectedLane.id, event.currentTarget.value)) event.currentTarget.value = selectedLane.id }} /></label>
          <label>Label<input data-testid="parallel-lane-label-input" value={selectedLane.label} oninput={(event) => { if (!setLaneLabel(selectedLane.id, event.currentTarget.value)) event.currentTarget.value = selectedLane.label }} /></label>
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
              <div class="step-palette grid gap-2 rounded-md border border-base-300 bg-base-200/40 p-2">
                <div class="palette-heading flex min-w-0 items-baseline justify-between gap-2"><span class="font-bold">Actions</span><small class="text-base-content/55">do lane work</small></div>
                <div class="step-actions grid grid-cols-3 gap-1.5 [@media(max-width:760px)]:grid-cols-2">
                  {#each laneActionPaletteItemsFor(selectedLane) as item}
                    <button class="btn btn-sm min-h-8" type="button" data-testid={item.testId} title={item.type} onclick={() => insertLaneAction(item.type)}><span class="tool-label">{item.label}</span></button>
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
  <article class="step-card parallel-output-card card grid min-w-0 gap-2 border border-secondary/40 bg-secondary/5 p-2" data-testid="parallel-lane-output">
    <div class="step-title flex min-w-0 flex-wrap items-center justify-between gap-2">
      <span class="parallel-output-title flex min-w-0 items-baseline gap-1.5"><strong>Lane result</strong><small class="text-base-content/55">{output.source.kind === 'none' ? 'no text collected' : 'collecting text'}</small></span>
      <div class="inline-actions parallel-output-actions flex min-w-0 flex-wrap items-center gap-1.5">
        <label class="checkbox-row flex w-fit cursor-pointer items-center gap-1.5"><input class="checkbox checkbox-xs" type="checkbox" data-testid="parallel-collect-lane-text" checked={output.source.kind !== 'none'} onchange={(event) => { if (!setLaneCollectsText(lane.id, event.currentTarget.checked)) event.currentTarget.checked = false }} />Collect lane text</label>
        <button class="btn btn-xs" type="button" data-testid="parallel-lane-add-before-output" onclick={(event) => openLaneInsertion(lane.id, itemIndex, 'Insert lane action', event)}>Add action</button>
      </div>
    </div>
    {#if output.source.kind !== 'none'}
      <div class="macro-row parallel-output-fields">
        <label>Output id<input data-testid="parallel-output-id-input" value={output.id} oninput={(event) => { if (!setLaneOutputId(lane.id, output.id, event.currentTarget.value)) event.currentTarget.value = output.id }} /></label>
        <label>Source<select data-testid="parallel-output-source" value={parallelOutputSourceKey(output.source)} onchange={(event) => setLaneOutputSource(lane.id, output.id, event.currentTarget.value)}><option value="">none</option>{#each laneArtifactChoices(lane, output.id) as choice}<option value={artifactSourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
      </div>
    {/if}
  </article>
{/snippet}
