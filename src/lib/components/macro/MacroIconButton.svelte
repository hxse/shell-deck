<script lang="ts">
  let {
    kind,
    label: customLabel,
    disabled = false,
    active = false,
    expanded,
    testId,
    onClick,
  } = $props<{
    kind: "collapse" | "expand" | "up" | "down" | "remove"
    label?: string
    disabled?: boolean
    active?: boolean
    expanded?: boolean
    testId?: string
    onClick: () => void
  }>()

  const label = $derived(customLabel ?? (kind === "collapse" ? "Collapse" : kind === "expand" ? "Expand" : kind === "up" ? "Up" : kind === "down" ? "Down" : "Remove"))
</script>

<button class="macro-icon-button" class:macro-remove-button={kind === "remove"} class:active type="button" data-testid={testId} title={label} aria-label={label} aria-expanded={expanded} {disabled} onclick={onClick}>
  <svg viewBox={kind === "remove" ? "0 0 24 24" : "0 0 16 16"} aria-hidden="true" focusable="false">
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
    {:else}
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    {/if}
  </svg>
</button>
