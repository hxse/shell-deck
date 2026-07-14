<script lang="ts">
  import { terminalSelectState, type TerminalChoice } from '../../macro/macroTerminalChoices'

  let {
    selectedIndex,
    choices,
    allChoices,
    expectedType,
    disabledValues = [],
    testId,
    ariaLabel,
    onChange,
  } = $props<{
    selectedIndex: number
    choices: TerminalChoice[]
    allChoices?: TerminalChoice[]
    expectedType?: 'shell' | 'text'
    disabledValues?: string[]
    testId: string
    ariaLabel?: string
    onChange: (terminalIndex: number) => boolean | void
  }>()

  const disabledValueSet = $derived(new Set(disabledValues))
  const selectableChoices = $derived(choices.filter((choice: TerminalChoice) => !disabledValueSet.has(choice.value)))
  const state = $derived(terminalSelectState(selectedIndex, selectableChoices, allChoices ?? choices, expectedType))

  function handleChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement
    const choice = choices.find((item: TerminalChoice) => item.value === target.value)
    if (!choice || disabledValueSet.has(choice.value)) {
      target.value = state.value
      return
    }
    if (onChange(choice.index) === false) target.value = state.value
  }
</script>

<select
  data-testid={testId}
  data-terminal-select-status={state.status}
  value={state.value}
  title={state.title}
  aria-label={ariaLabel}
  aria-invalid={state.status === 'selected' ? undefined : 'true'}
  class:terminal-target-invalid={state.status !== 'selected'}
  onchange={handleChange}
>
  {#if state.placeholder}<option value="" disabled>{state.placeholder}</option>{/if}
  {#each choices as choice}
    <option value={choice.value} title={choice.title} disabled={disabledValueSet.has(choice.value)}>{choice.label}</option>
  {/each}
</select>

<style>
  select.terminal-target-invalid {
    border-color: #cf7182;
    background: #fff7f8;
    color: #782c3b;
  }
</style>
