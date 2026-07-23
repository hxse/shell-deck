<script lang="ts">
  import MacroIconButton from "./MacroIconButton.svelte"

  let {
    collapsed,
    moveUpDisabled,
    moveDownDisabled,
    groupTestId,
    toggleTestId,
    moveUpTestId,
    moveDownTestId,
    addBeforeTestId,
    addAfterTestId,
    removeTestId,
    onToggle,
    onMoveUp,
    onMoveDown,
    onAddBefore,
    onAddAfter,
    onRemove,
  } = $props<{
    collapsed: boolean
    moveUpDisabled: boolean
    moveDownDisabled: boolean
    groupTestId: string
    toggleTestId: string
    moveUpTestId: string
    moveDownTestId: string
    addBeforeTestId: string
    addAfterTestId: string
    removeTestId: string
    onToggle: () => void
    onMoveUp: () => void
    onMoveDown: () => void
    onAddBefore: (event: MouseEvent) => void
    onAddAfter: (event: MouseEvent) => void
    onRemove: () => void
  }>()
</script>

<div class="node-action-controls flex min-w-0 flex-wrap items-center justify-end gap-1" data-testid={groupTestId}>
  <MacroIconButton kind={collapsed ? "expand" : "collapse"} active={collapsed} expanded={!collapsed} testId={toggleTestId} onClick={onToggle} />
  <MacroIconButton kind="up" label="Move up" disabled={moveUpDisabled} testId={moveUpTestId} onClick={onMoveUp} />
  <MacroIconButton kind="down" label="Move down" disabled={moveDownDisabled} testId={moveDownTestId} onClick={onMoveDown} />
  <button class="macro-icon-button btn btn-square btn-primary btn-xs !size-6 !min-h-6 !min-w-6 !p-0 leading-none" type="button" data-testid={addBeforeTestId} title="Add before" aria-label="Add before" onclick={onAddBefore}>
    <svg class="block size-[15px] shrink-0 fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 3.5h10" />
      <path d="M8 7v6" />
      <path d="M5 10h6" />
    </svg>
  </button>
  <button class="macro-icon-button btn btn-square btn-primary btn-xs !size-6 !min-h-6 !min-w-6 !p-0 leading-none" type="button" data-testid={addAfterTestId} title="Add after" aria-label="Add after" onclick={onAddAfter}>
    <svg class="block size-[15px] shrink-0 fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 12.5h10" />
      <path d="M8 3v6" />
      <path d="M5 6h6" />
    </svg>
  </button>
  <MacroIconButton kind="remove" testId={removeTestId} onClick={onRemove} />
</div>
