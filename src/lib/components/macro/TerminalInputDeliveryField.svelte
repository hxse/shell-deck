<script lang="ts">
  import type { TerminalInputDelivery } from '../../macro/macroDefinitionTypes'

  const helpText = "Auto uses Bracketed paste for Shell tabs and Direct bytes for Text tabs. Direct bytes and Bracketed paste force the selected mode."
  const componentId = $props.id()
  const selectId = componentId + "-select"
  const tooltipId = componentId + "-tooltip"

  let { value, onChange, testId } = $props<{
    value: TerminalInputDelivery
    onChange: (delivery: TerminalInputDelivery) => void
    testId: string
  }>()

  let helpHovered = $state(false)
  let helpFocused = $state(false)
  const showHelp = $derived(helpHovered || helpFocused)
</script>

<div class="input-delivery-field macro-field-typography grid min-w-0 gap-1">
  <div class="input-delivery-label flex items-center gap-1">
    <label for={selectId}>Input delivery</label>
    <span class="input-delivery-help-anchor relative inline-flex">
      <button
        type="button"
        class="input-delivery-help btn btn-circle btn-ghost btn-xs !size-[18px] !min-h-[18px] cursor-help !p-0 text-[11px]"
        data-testid={testId + "-help"}
        aria-label="Input delivery help"
        aria-describedby={showHelp ? tooltipId : undefined}
        onmouseenter={() => helpHovered = true}
        onmouseleave={() => helpHovered = false}
        onfocus={() => helpFocused = true}
        onblur={() => helpFocused = false}
      >?</button>
      {#if showHelp}
        <span id={tooltipId} class="input-delivery-tooltip absolute top-[calc(100%+6px)] left-0 z-20 w-[min(320px,70vw)] rounded-box border border-neutral-content/30 bg-neutral px-2.5 py-2 text-xs leading-snug font-normal text-neutral-content shadow-lg" role="tooltip">{helpText}</span>
      {/if}
    </span>
  </div>
  <select class="select box-border select-xs select-ghost w-full bg-base-content/15" id={selectId} data-testid={testId} {value} onchange={(event) => onChange(event.currentTarget.value as TerminalInputDelivery)}>
    <option value="auto">Auto (recommended)</option>
    <option value="direct">Direct bytes</option>
    <option value="bracketed-paste">Bracketed paste</option>
  </select>
</div>
