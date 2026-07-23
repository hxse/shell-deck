<script lang="ts">
  import { terminalSelectState, type TerminalChoice } from '../../macro/macroTerminalChoices'
  import type { MacroTerminalReference } from '../../macro/macroDefinitionTypes'

  let {
    reference,
    choices,
    allChoices,
    expectedType,
    disabledValues = [],
    testId,
    ariaLabel,
    onChange,
  } = $props<{
    reference: MacroTerminalReference
    choices: TerminalChoice[]
    allChoices?: TerminalChoice[]
    expectedType?: 'shell' | 'text'
    disabledValues?: string[]
    testId: string
    ariaLabel?: string
    onChange: (reference: MacroTerminalReference) => boolean | void
  }>()

  const disabledValueSet = $derived(new Set(disabledValues))
  const selectableChoices = $derived(choices.filter((choice: TerminalChoice) => !disabledValueSet.has(choice.value)))
  const state = $derived(terminalSelectState(reference, selectableChoices, allChoices ?? choices, expectedType))

  function handleChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement
    if (target.value === 'unassigned') {
      if (onChange({ kind: 'unassigned' }) === false) target.value = state.value
      return
    }
    const choice = choices.find((item: TerminalChoice) => item.value === target.value)
    if (!choice || disabledValueSet.has(choice.value)) {
      target.value = state.value
      return
    }
    if (onChange({ kind: 'terminal_index', index: choice.index }) === false) target.value = state.value
  }
</script>

<span class="terminal-reference-field grid gap-1">
  <select
    class="select box-border select-xs select-ghost w-full bg-base-content/15"
    class:select-warning={state.status === 'unassigned'}
    class:select-error={state.status !== 'selected' && state.status !== 'unassigned'}
    data-testid={testId}
    data-terminal-select-status={state.status}
    value={state.value}
    title={state.title}
    aria-label={ariaLabel}
    aria-invalid={state.status === 'selected' || state.status === 'unassigned' ? undefined : 'true'}
    class:terminal-target-warning={state.status === 'unassigned'}
    class:terminal-target-invalid={state.status !== 'selected' && state.status !== 'unassigned'}
    onchange={handleChange}
  >
    <option value="unassigned">Unassigned</option>
    {#if state.placeholder}<option value="" disabled>{state.placeholder}</option>{/if}
    {#each choices as choice}
      <option value={choice.value} title={choice.title} disabled={disabledValueSet.has(choice.value)}>{choice.label}</option>
    {/each}
  </select>
  {#if state.status === 'unassigned'}
    <small class="terminal-target-warning-text text-[11px] leading-snug text-warning" data-testid={`${testId}-warning`}>Target is unassigned. Save is allowed, but Start requires a compatible terminal selection.{choices.length === 0 ? ' Create a compatible terminal, then select it.' : ''}</small>
  {/if}
</span>
