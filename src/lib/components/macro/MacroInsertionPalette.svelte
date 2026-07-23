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
    blocked = false,
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
    blocked?: boolean
    paletteElement?: HTMLElement | null
    onMoveNodeIdChange: (nodeId: string) => void
    onInsert: (type: FlowV2Node['type']) => void
    onMoveExisting: () => void
    onCancel: () => void
  }>()
</script>

<div class="macro-insertion-mode fixed inset-0 z-[80] bg-neutral/10 [&.centered]:grid [&.centered]:place-items-center [&.centered]:p-4" class:anchored class:centered={!anchored} data-testid="macro-insertion-mode" data-placement-mode={insertionPaletteMode}>
  <button type="button" class="macro-insertion-scrim fixed inset-0 !size-full !min-h-0 cursor-default !rounded-none !border-0 !bg-transparent !p-0" data-testid="macro-insertion-cancel-scrim" aria-label="Cancel insertion" onclick={onCancel}></button>
  <section bind:this={paletteElement} class="floating-insertion-palette relative z-[81] grid w-[min(360px,calc(100vw-32px))] max-h-[min(var(--palette-max-height,560px),calc(100vh-24px))] gap-2.5 overflow-auto rounded-box border border-base-300 bg-base-100 p-3 shadow-2xl [&.anchored]:fixed [&.anchored]:top-[var(--palette-y)] [&.anchored]:left-[var(--palette-x)] [&.anchored]:-translate-x-1/2 [&.anchored.above]:-translate-y-full [&.blocked]:pointer-events-none [&.blocked]:opacity-70" class:anchored class:above={position?.placement === 'above'} class:below={position?.placement === 'below'} class:blocked {style} data-testid="macro-insertion-palette" aria-label="Insert macro node">
    <div class="palette-heading flex min-w-0 items-baseline justify-between gap-2"><span class="font-bold">{summary}</span><small class="text-base-content/55">choose node</small></div>
    <div class="step-palette card grid gap-2 bg-base-200/60 p-2 shadow-sm" data-testid="macro-actions-palette">
      <div class="palette-heading flex min-w-0 items-baseline justify-between gap-2"><span class="font-bold">Actions</span><small class="text-base-content/55">do work</small></div>
      <div class="step-actions grid grid-cols-3 gap-1.5 [@media(max-width:760px)]:grid-cols-2">
        {#each actionItems as item}
          <button class="btn btn-sm btn-primary min-h-8" type="button" data-testid={item.testId} title={item.type} onclick={() => onInsert(item.type)}><span class="tool-label">{item.label}</span></button>
        {/each}
      </div>
    </div>
    {#if !actionOnly}
      <div class="step-palette flow-palette card grid gap-2 bg-base-200/60 p-2 shadow-sm" data-testid="macro-flow-palette">
        <div class="palette-heading flex min-w-0 items-baseline justify-between gap-2"><span class="font-bold">Flow</span><small class="text-base-content/55">py-like</small></div>
        <div class="step-actions grid grid-cols-3 gap-1.5 [@media(max-width:760px)]:grid-cols-2">
          {#each flowItems as item}
            {#if !item.loopOnly || allowsLoopControls}
              <button class="btn btn-sm btn-primary min-h-8" type="button" data-testid={item.testId} title={item.type} onclick={() => onInsert(item.type)}><span class="tool-label">{item.label}</span></button>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
    <div class="step-palette move-existing-palette card grid gap-2 bg-base-200/60 p-2 shadow-sm" data-testid="macro-move-existing-palette">
      <div class="palette-heading flex min-w-0 items-baseline justify-between gap-2"><span class="font-bold">Move existing</span><small class="text-base-content/55">move node id here</small></div>
      <div class="move-existing-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
        <select class="select box-border select-sm select-ghost min-h-8 bg-base-content/15" data-testid="macro-move-existing-select" value={moveNodeId} onchange={(event) => onMoveNodeIdChange(event.currentTarget.value)}>
          <option value="">Select node id</option>
          {#each movableNodeChoices as choice}
            <option value={choice.id}>{choice.id} · {choice.type}</option>
          {/each}
        </select>
        <button class="btn btn-sm btn-primary min-h-8" type="button" data-testid="macro-move-existing" onclick={onMoveExisting} disabled={!moveNodeId}>Move</button>
      </div>
    </div>
    <button class="btn btn-ghost btn-xs justify-self-end" type="button" data-testid="macro-insertion-cancel" onclick={onCancel}>Cancel</button>
  </section>
</div>
