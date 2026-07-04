<script lang="ts">
  import LineNumberedTextarea from "./LineNumberedTextarea.svelte"
  import type { MacroRunnerSnapshot } from '../../macro/runnerTypes'

  let {
    runner,
    statusText,
    runnerInput,
    onRunnerInputChange,
    onSubmitRunnerInput,
    onRefreshRunner,
  } = $props<{
    runner: MacroRunnerSnapshot | null
    statusText: string
    runnerInput: string
    onRunnerInputChange: (value: string) => void
    onSubmitRunnerInput: () => void
    onRefreshRunner: () => void
  }>()
</script>

<section class="macro-run-status macro-run-status-dock" data-testid="macro-run-status">
  <div>
    <strong>{runner?.status ?? 'idle'}</strong>
    <span>{runner?.runId ?? 'no active run'}</span>
    {#if statusText}<span>{statusText}</span>{/if}
    {#if runner?.currentStepId}<span>step: {runner.currentStepId}</span>{/if}
    {#if runner?.pauseReason}<span>{runner.pauseReason.message}</span>{/if}
  </div>
  <details class="macro-debug-refresh" data-testid="macro-debug-refresh">
    <summary>Debug</summary>
    <button type="button" data-testid="macro-run-refresh" onclick={onRefreshRunner}>Refresh</button>
  </details>
  {#if runner?.waitingInput}
    <div class="runner-input-line" data-testid="macro-run-input">
      <label>{runner.waitingInput.prompt}
        <LineNumberedTextarea testId="macro-run-input-text" value={runnerInput} ariaLabel="Runtime input line" onInput={onRunnerInputChange} />
      </label>
      <button type="button" data-testid="macro-run-input-submit" onclick={onSubmitRunnerInput}>Send</button>
    </div>
  {/if}
</section>
