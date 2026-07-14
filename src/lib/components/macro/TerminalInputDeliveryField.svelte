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

<div class="input-delivery-field macro-field-typography">
  <div class="input-delivery-label">
    <label for={selectId}>Input delivery</label>
    <span class="input-delivery-help-anchor">
      <button
        type="button"
        class="input-delivery-help"
        data-testid={testId + "-help"}
        aria-label="Input delivery help"
        aria-describedby={showHelp ? tooltipId : undefined}
        onmouseenter={() => helpHovered = true}
        onmouseleave={() => helpHovered = false}
        onfocus={() => helpFocused = true}
        onblur={() => helpFocused = false}
      >?</button>
      {#if showHelp}
        <span id={tooltipId} class="input-delivery-tooltip" role="tooltip">{helpText}</span>
      {/if}
    </span>
  </div>
  <select id={selectId} data-testid={testId} {value} onchange={(event) => onChange(event.currentTarget.value as TerminalInputDelivery)}>
    <option value="auto">Auto (recommended)</option>
    <option value="direct">Direct bytes</option>
    <option value="bracketed-paste">Bracketed paste</option>
  </select>
</div>

<style>
  .input-delivery-field {
    display: grid;
    min-width: 0;
    gap: 4px;
  }

  .input-delivery-label {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .input-delivery-label label {
    display: inline;
  }

  .input-delivery-help-anchor {
    position: relative;
    display: inline-flex;
  }

  .input-delivery-help {
    display: inline-grid;
    width: 17px;
    height: 17px;
    place-items: center;
    padding: 0;
    border: 1px solid #9aa8b5;
    border-radius: 999px;
    background: #f4f7fa;
    color: #3d4a57;
    font: inherit;
    font-size: 11px;
    line-height: 1;
    cursor: help;
  }

  .input-delivery-help:focus-visible {
    outline: 2px solid #1769aa;
    outline-offset: 2px;
  }

  .input-delivery-tooltip {
    position: absolute;
    z-index: 20;
    top: calc(100% + 6px);
    left: 0;
    width: min(320px, 70vw);
    padding: 7px 9px;
    border: 1px solid #9aa8b5;
    border-radius: 5px;
    background: #18222c;
    color: #ffffff;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.4;
    box-shadow: 0 4px 12px rgb(24 34 44 / 20%);
  }
</style>
