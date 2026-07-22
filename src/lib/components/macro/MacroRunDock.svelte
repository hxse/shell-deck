<script lang="ts">
  import LineNumberedTextarea from './LineNumberedTextarea.svelte'
  import type { FlowV2Node, MacroDefinitionV5 } from '../../macro/macroDefinitionTypes'
  import { isActiveMacroRunnerStatus, type MacroRunnerSnapshot } from '../../macro/runnerTypes'

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

  type RunStage = { id: string; type: string; lane?: string }

  const currentStage = $derived(resolveCurrentStage(runner))

  function resolveCurrentStage(snapshot: MacroRunnerSnapshot | null): RunStage | null {
    const nodeId = snapshot?.currentNodeId
    const definition = snapshot?.runningMacro?.definition
    if (!nodeId || !definition) return null
    return findStage(definition, nodeId) ?? { id: nodeId, type: 'node' }
  }

  function findStage(definition: MacroDefinitionV5, nodeId: string): RunStage | null {
    return findStageInNodes(definition.body, nodeId)
  }

  function findStageInNodes(nodes: FlowV2Node[], nodeId: string): RunStage | null {
    for (const node of nodes) {
      if (node.id === nodeId) return { id: node.id, type: node.type }
      if (node.type === 'parallel') {
        for (const lane of node.lanes) {
          const item = lane.body.find((candidate) => candidate.id === nodeId)
          if (item) return { id: item.id, type: item.type, lane: lane.label || lane.id }
        }
      } else if (node.type === 'if') {
        for (const branch of node.branches) {
          const stage = findStageInNodes(branch.body, nodeId)
          if (stage) return stage
        }
        if (node.else) {
          const stage = findStageInNodes(node.else, nodeId)
          if (stage) return stage
        }
      } else if (node.type === 'for') {
        const stage = findStageInNodes(node.body, nodeId)
        if (stage) return stage
      } else if ((node.type === 'break' || node.type === 'continue' || node.type === 'finish') && node.body) {
        const stage = findStageInNodes(node.body, nodeId)
        if (stage) return stage
      }
    }
    return null
  }
</script>

<section class="macro-run-status macro-run-status-dock grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded-field border border-base-300 bg-base-100 px-1.5 py-1 text-[11px]" data-testid="macro-run-status" data-run-status={runner?.status ?? 'idle'}>
  <div class="macro-run-summary grid min-w-0 gap-1">
    <div class="macro-run-status-line flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
      <strong class="macro-run-status-badge badge badge-sm box-border min-w-16 text-center text-[11px] tracking-wide uppercase" class:badge-success={runner?.status === 'running' || runner?.status === 'starting'} class:badge-warning={runner?.status === 'paused' || runner?.status === 'waiting_input'} class:badge-neutral={!runner || runner.status === 'idle' || runner.status === 'completed' || runner.status === 'failed' || runner.status === 'cancelled'}>{runner?.status ?? 'idle'}</strong>
      <span class="min-w-0 overflow-hidden text-ellipsis text-base-content/60">{runner?.runId ?? 'no active run'}</span>
      {#if statusText}<span class="min-w-0 overflow-hidden text-ellipsis text-base-content/60">Draft: {statusText}</span>{/if}
      {#if runner?.error}<span class="min-w-0 overflow-hidden text-ellipsis text-error">{runner.error}</span>{/if}
      {#if runner?.runningMacro}<span class="min-w-0 overflow-hidden text-ellipsis text-base-content/60" data-testid="macro-running-identity">Running Macro: {runner.runningMacro.definition.name} · {runner.runningMacro.recordId} · r{runner.runningMacro.recordRevision}</span>{/if}
    </div>
    {#if runner && isActiveMacroRunnerStatus(runner.status)}
      <div class="macro-current-stage flex min-w-0 items-center gap-2 rounded-field border-2 border-warning bg-warning/15 px-2 py-1 font-bold text-warning-content ring-2 ring-warning/20" data-testid="macro-current-stage" data-current-node-id={runner.currentNodeId ?? undefined}>
        <span class="macro-current-stage-label shrink-0 border-r border-warning/50 pr-2 text-[10px] tracking-wide uppercase">Current stage</span>
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{currentStage ? `${currentStage.type} · ${currentStage.id}${currentStage.lane ? ` · lane ${currentStage.lane}` : ''}` : runner.status === 'starting' ? 'Preparing run…' : runner.status === 'stopping' ? 'Stopping run…' : 'Waiting for next node…'}</span>
      </div>
    {/if}
  </div>
  <div class="macro-run-controls flex flex-wrap items-center gap-1" data-testid="macro-run-controls">
    <button class="macro-prepare-terminals btn btn-xs btn-outline min-w-[50px] !pointer-events-auto" type="button" data-testid="macro-prepare-terminals" title={prepareDisabled ? prepareDisabledReason : 'Prepare current draft terminal layout'} aria-disabled={prepareDisabled || preparing} onclick={onPrepare}>{preparing ? 'Preparing…' : 'Prepare terminals'}</button>
    <button class="btn btn-xs btn-success min-w-[50px] !pointer-events-auto" type="button" data-testid="macro-control-start" title={startDisabled ? startDisabledReason : 'Start saved macro revision'} aria-disabled={startDisabled} onclick={() => onMacroControl('start')}>Start</button>
    <button class="btn btn-xs btn-warning btn-outline min-w-[50px] !pointer-events-auto" type="button" data-testid="macro-control-pause-resume" title={pauseResumeDisabled() ? 'No live run to pause or resume' : pauseResumeAction() === 'resume' ? 'Resume run' : 'Pause run'} aria-disabled={pauseResumeDisabled()} onclick={() => onMacroControl(pauseResumeAction())}>{pauseResumeAction() === 'resume' ? 'Resume' : 'Pause'}</button>
    <button class="btn btn-xs btn-error btn-outline min-w-[50px] !pointer-events-auto" type="button" data-testid="macro-control-stop" title="Stop active run" aria-disabled={!runner || !['running', 'paused', 'waiting_input', 'stopping'].includes(runner.status)} onclick={() => onMacroControl('stop')}>Stop</button>
  </div>
  <details class="macro-debug-refresh relative text-[11px]" data-testid="macro-debug-refresh"><summary class="whitespace-nowrap" data-testid="macro-debug-toggle">Debug</summary><button class="btn btn-xs absolute top-[calc(100%+4px)] right-0 z-[4] shadow-lg" type="button" data-testid="macro-run-refresh" onclick={onRefreshRunner}>Refresh</button></details>
  {#if runner?.runtimeInput}
    <div class="runner-input-line col-span-full grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-field border-2 border-error bg-error/10 p-2 ring-2 ring-error/15" data-testid="macro-run-input">
      <label>{runner.runtimeInput.prompt}<LineNumberedTextarea testId="macro-run-input-text" value={runnerInput} maxRows={4} ariaLabel="Runtime input line" disabled={runtimeInputDisabled} onInput={onRunnerInputChange} /></label>
      <button class="btn btn-xs btn-error !pointer-events-auto" type="button" data-testid="macro-run-input-submit" aria-disabled={runtimeInputDisabled || runnerInputSyncing} onclick={onSubmitRunnerInput}>{runnerInputSyncing ? 'Syncing…' : 'Send'}</button>
    </div>
  {/if}
</section>
