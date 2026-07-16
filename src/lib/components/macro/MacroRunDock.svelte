<script lang="ts">
  import LineNumberedTextarea from './LineNumberedTextarea.svelte'
  import type { MacroRunnerSnapshot } from '../../macro/runnerTypes'

  let {
    runner,
    statusText,
    runnerInput,
    runnerInputSyncing = false,
    preparing = false,
    prepareDisabled = false,
    prepareDisabledReason = '',
    startDisabled = false,
    startDisabledReason = '',
    runtimeInputDisabled = false,
    onPrepare,
    onRunnerInputChange,
    onSubmitRunnerInput,
    onRefreshRunner,
    onMacroControl,
  } = $props<{
    runner: MacroRunnerSnapshot | null
    statusText: string
    runnerInput: string
    runnerInputSyncing?: boolean
    preparing?: boolean
    prepareDisabled?: boolean
    prepareDisabledReason?: string
    startDisabled?: boolean
    startDisabledReason?: string
    runtimeInputDisabled?: boolean
    onPrepare: () => void
    onRunnerInputChange: (value: string) => void
    onSubmitRunnerInput: () => void
    onRefreshRunner: () => void
    onMacroControl: (action: 'start' | 'pause' | 'resume' | 'stop') => void
  }>()

  function pauseResumeAction(): 'pause' | 'resume' { return runner?.status === 'paused' ? 'resume' : 'pause' }
  function pauseResumeDisabled(): boolean { return !runner || !['running', 'paused'].includes(runner.status) }
</script>

<section class="macro-run-status macro-run-status-dock" data-testid="macro-run-status">
  <div class="macro-run-status-line">
    <strong>{runner?.status ?? 'idle'}</strong>
    <span>{runner?.runId ?? 'no active run'}</span>
    {#if statusText}<span>{statusText}</span>{/if}
    {#if runner?.currentNodeId}<span>step: {runner.currentNodeId}</span>{/if}
    {#if runner?.error}<span>{runner.error}</span>{/if}
    {#if runner?.runningMacro}<span data-testid="macro-running-identity">Running Macro: {runner.runningMacro.definition.name} · {runner.runningMacro.recordId} · r{runner.runningMacro.recordRevision}</span>{/if}
  </div>
  <div class="macro-run-controls" data-testid="macro-run-controls">
    <button type="button" class="macro-prepare-terminals" data-testid="macro-prepare-terminals" title={prepareDisabled ? prepareDisabledReason : 'Prepare current draft terminal layout'} aria-disabled={prepareDisabled || preparing} onclick={onPrepare}>{preparing ? 'Preparing…' : 'Prepare terminals'}</button>
    <button type="button" data-testid="macro-control-start" title={startDisabled ? startDisabledReason : 'Start saved macro revision'} aria-disabled={startDisabled} onclick={() => onMacroControl('start')}>Start</button>
    <button type="button" data-testid="macro-control-pause-resume" title={pauseResumeDisabled() ? 'No live run to pause or resume' : pauseResumeAction() === 'resume' ? 'Resume run' : 'Pause run'} aria-disabled={pauseResumeDisabled()} onclick={() => onMacroControl(pauseResumeAction())}>{pauseResumeAction() === 'resume' ? 'Resume' : 'Pause'}</button>
    <button type="button" data-testid="macro-control-stop" title="Stop active run" aria-disabled={!runner || !['running', 'paused', 'waiting_input', 'stopping'].includes(runner.status)} onclick={() => onMacroControl('stop')}>Stop</button>
  </div>
  <details class="macro-debug-refresh" data-testid="macro-debug-refresh"><summary data-testid="macro-debug-toggle">Debug</summary><button type="button" data-testid="macro-run-refresh" onclick={onRefreshRunner}>Refresh</button></details>
  {#if runner?.runtimeInput}
    <div class="runner-input-line" data-testid="macro-run-input">
      <label>{runner.runtimeInput.prompt}<LineNumberedTextarea testId="macro-run-input-text" value={runnerInput} maxRows={4} ariaLabel="Runtime input line" disabled={runtimeInputDisabled} onInput={onRunnerInputChange} /></label>
      <button type="button" data-testid="macro-run-input-submit" aria-disabled={runtimeInputDisabled || runnerInputSyncing} onclick={onSubmitRunnerInput}>{runnerInputSyncing ? 'Syncing…' : 'Send'}</button>
    </div>
  {/if}
</section>
