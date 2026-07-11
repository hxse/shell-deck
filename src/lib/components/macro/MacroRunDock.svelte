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
    onMacroControl,
  } = $props<{
    runner: MacroRunnerSnapshot | null
    statusText: string
    runnerInput: string
    onRunnerInputChange: (value: string) => void
    onSubmitRunnerInput: () => void
    onRefreshRunner: () => void
    onMacroControl: (action: "start" | "pause" | "resume" | "stop") => void
  }>()

  function pauseResumeAction(): "pause" | "resume" {
    return runner?.status === "paused" || runner?.status === "waiting" || runner?.status === "interrupted" ? "resume" : "pause"
  }

  function pauseResumeLabel(): "Pause" | "Resume" {
    return pauseResumeAction() === "resume" ? "Resume" : "Pause"
  }

  function pauseResumeDisabled(): boolean {
    return !runner || runner.status === "idle" || runner.status === "completed" || runner.status === "failed" || runner.status === "stopped"
  }

  function pauseResumeTitle(): string {
    if (pauseResumeDisabled()) return "No live run to pause or resume"
    return pauseResumeAction() === "resume" ? "Resume paused or waiting run" : "Pause active run"
  }
</script>

<section class="macro-run-status macro-run-status-dock" data-testid="macro-run-status">
  <div class="macro-run-status-line">
    <strong>{runner?.status ?? 'idle'}</strong>
    <span>{runner?.runId ?? 'no active run'}</span>
    {#if statusText}<span>{statusText}</span>{/if}
    {#if runner?.currentStepId}<span>step: {runner.currentStepId}</span>{/if}
    {#if runner?.pauseReason}<span>{runner.pauseReason.message}</span>{/if}
  </div>
  <div class="macro-run-controls" data-testid="macro-run-controls">
    <button type="button" data-testid="macro-control-start" title="Start selected template" onclick={() => onMacroControl("start")}>Start</button>
    <button type="button" data-testid="macro-control-pause-resume" title={pauseResumeTitle()} disabled={pauseResumeDisabled()} onclick={() => onMacroControl(pauseResumeAction())}>{pauseResumeLabel()}</button>
    <button type="button" data-testid="macro-control-stop" title="Stop active run" onclick={() => onMacroControl("stop")}>Stop</button>
  </div>
  <details class="macro-debug-refresh" data-testid="macro-debug-refresh">
    <summary>Debug</summary>
    <button type="button" data-testid="macro-run-refresh" onclick={onRefreshRunner}>Refresh</button>
  </details>
  {#if runner?.waitingInput}
    <div class="runner-input-line" data-testid="macro-run-input">
      <label>{runner.waitingInput.prompt}
        <LineNumberedTextarea testId="macro-run-input-text" value={runnerInput} maxRows={4} ariaLabel="Runtime input line" onInput={onRunnerInputChange} />
      </label>
      <button type="button" data-testid="macro-run-input-submit" onclick={onSubmitRunnerInput}>Send</button>
    </div>
  {/if}
</section>
