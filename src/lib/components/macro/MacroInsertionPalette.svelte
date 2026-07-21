<script lang="ts">
  import type { FlowV2Node } from '../../macro/macroDefinitionTypes'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'

  export type MacroPaletteItem = {
    type: FlowV2Node['type']
    label: string
    testId: string
    loopOnly?: boolean
  }

  let {
    anchored,
    position,
    style,
    insertionPaletteMode,
    summary,
    actionOnly,
    allowsLoopControls,
    actionItems,
    flowItems,
    moveNodeId,
    movableNodeChoices,
    paletteElement = $bindable<HTMLElement | null>(null),
    onMoveNodeIdChange,
    onInsert,
    onMoveExisting,
    onCancel,
  } = $props<{
    anchored: boolean
    position: { placement: 'above' | 'below' } | null
    style: string
    insertionPaletteMode: MacroInsertionPaletteMode
    summary: string
    actionOnly: boolean
    allowsLoopControls: boolean
    actionItems: MacroPaletteItem[]
    flowItems: MacroPaletteItem[]
    moveNodeId: string
    movableNodeChoices: Array<{ id: string; type: FlowV2Node['type'] }>
    paletteElement?: HTMLElement | null
    onMoveNodeIdChange: (nodeId: string) => void
    onInsert: (type: FlowV2Node['type']) => void
    onMoveExisting: () => void
    onCancel: () => void
  }>()
</script>

<div class="macro-insertion-mode" class:anchored class:centered={!anchored} data-testid="macro-insertion-mode" data-placement-mode={insertionPaletteMode}>
  <button type="button" class="macro-insertion-scrim" data-testid="macro-insertion-cancel-scrim" aria-label="Cancel insertion" onclick={onCancel}></button>
  <section bind:this={paletteElement} class="floating-insertion-palette" class:anchored class:above={position?.placement === 'above'} class:below={position?.placement === 'below'} {style} data-testid="macro-insertion-palette" aria-label="Insert macro node">
    <div class="palette-heading"><span>{summary}</span><small>choose node</small></div>
    <div class="step-palette" data-testid="macro-actions-palette">
      <div class="palette-heading"><span>Actions</span><small>do work</small></div>
      <div class="step-actions">
        {#each actionItems as item}
          <button type="button" data-testid={item.testId} title={item.type} onclick={() => onInsert(item.type)}><span class="tool-label">{item.label}</span></button>
        {/each}
      </div>
    </div>
    {#if !actionOnly}
      <div class="step-palette flow-palette" data-testid="macro-flow-palette">
        <div class="palette-heading"><span>Flow</span><small>py-like</small></div>
        <div class="step-actions">
          {#each flowItems as item}
            {#if !item.loopOnly || allowsLoopControls}
              <button type="button" data-testid={item.testId} title={item.type} onclick={() => onInsert(item.type)}><span class="tool-label">{item.label}</span></button>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
    <div class="step-palette move-existing-palette" data-testid="macro-move-existing-palette">
      <div class="palette-heading"><span>Move existing</span><small>move node id here</small></div>
      <div class="move-existing-row">
        <select data-testid="macro-move-existing-select" value={moveNodeId} onchange={(event) => onMoveNodeIdChange(event.currentTarget.value)}>
          <option value="">Select node id</option>
          {#each movableNodeChoices as choice}
            <option value={choice.id}>{choice.id} · {choice.type}</option>
          {/each}
        </select>
        <button type="button" data-testid="macro-move-existing" onclick={onMoveExisting} disabled={!moveNodeId}>Move</button>
      </div>
    </div>
    <button type="button" data-testid="macro-insertion-cancel" onclick={onCancel}>Cancel</button>
  </section>
</div>
