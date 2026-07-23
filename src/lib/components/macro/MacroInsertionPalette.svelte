<script module lang="ts">
  import { tick } from 'svelte'
  import type { MacroInsertionPaletteMode as PaletteMode } from '../../workspace/uiLayoutTypes'

  export type InsertionPalettePosition = {
    x: number
    y: number
    placement: 'above' | 'below'
    maxHeight?: number
  }

  export class MacroInsertionPaletteLifecycle {
    #triggerElement: HTMLElement | null = null

    open(event: MouseEvent | undefined, mode: PaletteMode): InsertionPalettePosition | null {
      const target = event?.currentTarget
      this.#triggerElement = target instanceof HTMLElement ? target : null
      return mode === 'anchored' ? this.#initialPosition() : null
    }

    async settle(
      mode: () => PaletteMode,
      position: () => InsertionPalettePosition | null,
      paletteElement: () => HTMLElement | null,
      setPosition: (position: InsertionPalettePosition) => void,
      shouldFocus: boolean,
    ): Promise<void> {
      await tick()
      const element = paletteElement()
      if (mode() === 'anchored' && position() && element && this.#triggerElement) {
        const measured = this.#measuredPosition(element)
        if (measured) setPosition(measured)
      }
      if (shouldFocus) {
        const focusable = element?.querySelector<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled])',
        )
        focusable?.focus()
      }
    }

    close(clear: () => void, restoreFocus: boolean): void {
      const trigger = this.#triggerElement
      this.#triggerElement = null
      clear()
      if (restoreFocus && trigger) void tick().then(() => trigger.focus())
    }

    handleKeydown(event: KeyboardEvent, isOpen: boolean, cancel: () => void): void {
      if (event.key === 'Escape' && isOpen) cancel()
    }

    #initialPosition(): InsertionPalettePosition | null {
      if (!this.#triggerElement) return null
      const rect = this.#triggerElement.getBoundingClientRect()
      const margin = 12
      const gap = 8
      const estimatedHalfWidth = 180
      const estimatedHeight = Math.min(360, Math.max(0, window.innerHeight - margin * 2))
      const placement = choosePlacement(rect, estimatedHeight, margin, gap)
      const availableHeight = placement === 'above'
        ? Math.max(0, rect.top - gap - margin)
        : Math.max(0, window.innerHeight - rect.bottom - gap - margin)
      const x = clamp(
        rect.left + rect.width / 2,
        margin + estimatedHalfWidth,
        window.innerWidth - margin - estimatedHalfWidth,
      )
      const y = placement === 'above' ? rect.top - gap : rect.bottom + gap
      return { x, y, placement, maxHeight: Math.max(0, availableHeight) }
    }

    #measuredPosition(paletteElement: HTMLElement): InsertionPalettePosition | null {
      if (!this.#triggerElement) return null
      const triggerRect = this.#triggerElement.getBoundingClientRect()
      const margin = 12
      const gap = 8
      const width = paletteElement.offsetWidth
      const height = paletteElement.offsetHeight
      if (width <= 0 || height <= 0) return null
      const placement = choosePlacement(triggerRect, height, margin, gap)
      const availableHeight = placement === 'above'
        ? Math.max(0, triggerRect.top - gap - margin)
        : Math.max(0, window.innerHeight - triggerRect.bottom - gap - margin)
      const maxHeight = Math.max(0, availableHeight)
      const effectiveHeight = maxHeight > 0 ? Math.min(height, maxHeight) : height
      const x = clamp(
        triggerRect.left + triggerRect.width / 2,
        margin + width / 2,
        window.innerWidth - margin - width / 2,
      )
      const rawY = placement === 'above' ? triggerRect.top - gap : triggerRect.bottom + gap
      const y = placement === 'above'
        ? clamp(rawY, margin + effectiveHeight, window.innerHeight - margin)
        : clamp(rawY, margin, window.innerHeight - margin)
      return { x, y, placement, maxHeight }
    }
  }

  function choosePlacement(
    rect: DOMRect,
    desiredHeight: number,
    margin: number,
    gap: number,
  ): 'above' | 'below' {
    const preferred = rect.top > window.innerHeight / 2 ? 'above' : 'below'
    const aboveSpace = Math.max(0, rect.top - gap - margin)
    const belowSpace = Math.max(0, window.innerHeight - rect.bottom - gap - margin)
    return preferred === 'above'
      ? aboveSpace >= Math.min(desiredHeight, belowSpace) ? 'above' : 'below'
      : belowSpace >= Math.min(desiredHeight, aboveSpace) ? 'below' : 'above'
  }

  function clamp(value: number, min: number, max: number): number {
    if (max < min) return min
    return Math.max(min, Math.min(max, value))
  }
</script>

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
