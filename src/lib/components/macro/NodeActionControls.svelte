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
  <MacroIconButton kind="insert-before" testId={addBeforeTestId} onClick={onAddBefore} />
  <MacroIconButton kind="insert-after" testId={addAfterTestId} onClick={onAddAfter} />
  <MacroIconButton kind="remove" testId={removeTestId} onClick={onRemove} />
</div>
