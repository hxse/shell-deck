<script lang="ts">
  type IconKind = "collapse" | "expand" | "up" | "down" | "insert-above" | "insert-below" | "remove"

  let {
    kind,
    label: customLabel,
    disabled = false,
    active = false,
    expanded,
    testId,
    onClick,
  } = $props<{
    kind: IconKind
    label?: string
    disabled?: boolean
    active?: boolean
    expanded?: boolean
    testId?: string
    onClick: () => void
  }>()

  const label = $derived(customLabel ?? defaultLabel(kind))

  function defaultLabel(value: IconKind): string {
    if (value === "collapse") return "Collapse"
    if (value === "expand") return "Expand"
    if (value === "up") return "Up"
    if (value === "down") return "Down"
    if (value === "insert-above") return "Insert item above"
    if (value === "insert-below") return "Insert item below"
    return "Remove"
  }
</script>

<button class="macro-icon-button btn btn-square btn-xs !size-6 !min-h-6 !min-w-6 !p-0 leading-none disabled:opacity-60 [&.macro-remove-button:hover:not(:disabled)]:border-error [&.macro-remove-button:hover:not(:disabled)]:bg-error/10 [&.macro-remove-button:hover:not(:disabled)]:text-error" class:btn-primary={active} class:macro-remove-button={kind === "remove"} class:active type="button" data-testid={testId} title={label} aria-label={label} aria-expanded={expanded} {disabled} onclick={onClick}>
  <svg class="block size-[15px] shrink-0 fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]" viewBox={kind === "remove" ? "0 0 24 24" : "0 0 16 16"} aria-hidden="true" focusable="false">
    {#if kind === "collapse"}
      <path d="m3.5 5.75 4.5 4.5 4.5-4.5" />
    {:else if kind === "expand"}
      <path d="m5.75 3.5 4.5 4.5-4.5 4.5" />
    {:else if kind === "up"}
      <path d="M8 13V3" />
      <path d="m4.5 6.5 3.5-3.5 3.5 3.5" />
    {:else if kind === "down"}
      <path d="M8 3v10" />
      <path d="m4.5 9.5 3.5 3.5 3.5-3.5" />
    {:else if kind === "insert-above"}
      <path d="M3 11.5h10" />
      <path d="M8 2.5v6" />
      <path d="M5 5.5h6" />
    {:else if kind === "insert-below"}
      <path d="M3 4.5h10" />
      <path d="M8 7.5v6" />
      <path d="M5 10.5h6" />
    {:else}
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    {/if}
  </svg>
</button>
