<script lang="ts">
  import type { MacroStep, MacroTemplate } from '../../macro/templateTypes'

  let { draft, addStep, macroControl } = $props<{
    draft: MacroTemplate | null
    addStep: (type: MacroStep['type']) => void
    macroControl: (action: 'start' | 'pause' | 'resume' | 'stop') => void
  }>()
</script>

<aside class="step-tool-rail" data-testid="macro-step-tool-rail" aria-label="Macro step tools">
  <section class="rail-run-card" data-testid="macro-run-card">
    <div class="rail-heading"><span>Run</span></div>
    <div class="macro-run-controls rail-run-controls" data-testid="macro-run-controls">
      <button type="button" data-testid="macro-control-start" title="Start selected template" onclick={() => macroControl('start')}>Start</button>
      <button type="button" data-testid="macro-control-pause" title="Pause active run" onclick={() => macroControl('pause')}>Pause</button>
      <button type="button" data-testid="macro-control-resume" title="Resume paused run" onclick={() => macroControl('resume')}>Resume</button>
      <button type="button" data-testid="macro-control-stop" title="Stop active run" onclick={() => macroControl('stop')}>Stop</button>
    </div>
  </section>
  {#if draft}
    <div class="step-palette-grid">
      <div class="step-palette" data-testid="macro-actions-palette">
        <div class="palette-heading"><span>Actions</span><small>do work</small></div>
        <div class="step-actions">
          <button type="button" data-testid="add-step-send" title="send_line" onclick={() => addStep('send_line')}><span class="tool-icon">S</span><span class="tool-label">send</span></button>
          <button type="button" data-testid="add-step-sleep" title="sleep" onclick={() => addStep('sleep')}><span class="tool-icon">Z</span><span class="tool-label">sleep</span></button>
          <button type="button" data-testid="add-step-input" title="input_line" onclick={() => addStep('input_line')}><span class="tool-icon">I</span><span class="tool-label">input</span></button>
          <button type="button" data-testid="add-step-wait" title="wait" onclick={() => addStep('wait')}><span class="tool-icon">W</span><span class="tool-label">wait</span></button>
          <button type="button" data-testid="add-step-capture" title="capture" onclick={() => addStep('capture-source')}><span class="tool-icon">C</span><span class="tool-label">capture</span></button>
          <button type="button" data-testid="add-step-parse" title="parse" onclick={() => addStep('parse')}><span class="tool-icon">P</span><span class="tool-label">parse</span></button>
          <button type="button" data-testid="add-step-parallel" title="parallel_all" onclick={() => addStep('parallel_all')}><span class="tool-icon">||</span><span class="tool-label">parallel</span></button>
        </div>
      </div>

      <div class="step-palette flow-palette" data-testid="macro-flow-palette">
        <div class="palette-heading"><span>Flow</span><small>advanced</small></div>
        <p class="hint" data-testid="flow-v2-hidden-note">New flow controls are not runnable yet.</p>
        <details class="legacy-flow-panel" data-testid="legacy-flow-panel">
          <summary>Legacy flow nodes</summary>
          <div class="step-actions legacy-step-actions">
            <button type="button" data-testid="add-step-branch" title="branch" onclick={() => addStep('branch')}><span class="tool-icon">?</span><span class="tool-label">branch</span></button>
            <button type="button" data-testid="add-step-goto" title="goto" onclick={() => addStep('goto')}><span class="tool-icon">G</span><span class="tool-label">goto</span></button>
            <button type="button" data-testid="add-step-pause" title="pause" onclick={() => addStep('pause')}><span class="tool-icon">Pa</span><span class="tool-label">pause</span></button>
            <button type="button" data-testid="add-step-complete" title="complete" onclick={() => addStep('complete')}><span class="tool-icon">Ok</span><span class="tool-label">done</span></button>
            <button type="button" data-testid="add-step-fail" title="fail" onclick={() => addStep('fail')}><span class="tool-icon">!</span><span class="tool-label">fail</span></button>
            <button type="button" data-testid="add-step-stop" title="stop" onclick={() => addStep('stop')}><span class="tool-icon">X</span><span class="tool-label">stop</span></button>
          </div>
        </details>
      </div>
    </div>
  {/if}
</aside>
