<script lang="ts">
  import type { FlowV2Node, MacroTemplate } from "../../macro/templateTypes"

  let { draft, addNode, macroControl } = $props<{
    draft: MacroTemplate | null
    addNode: (type: FlowV2Node["type"]) => void
    macroControl: (action: "start" | "pause" | "resume" | "stop") => void
  }>()
</script>

<aside class="step-tool-rail" data-testid="macro-step-tool-rail" aria-label="Macro step tools">
  <section class="rail-run-card" data-testid="macro-run-card">
    <div class="rail-heading"><span>Run</span></div>
    <div class="macro-run-controls rail-run-controls" data-testid="macro-run-controls">
      <button type="button" data-testid="macro-control-start" title="Start selected template" onclick={() => macroControl("start")}>Start</button>
      <button type="button" data-testid="macro-control-pause" title="Pause active run" onclick={() => macroControl("pause")}>Pause</button>
      <button type="button" data-testid="macro-control-resume" title="Resume paused run" onclick={() => macroControl("resume")}>Resume</button>
      <button type="button" data-testid="macro-control-stop" title="Stop active run" onclick={() => macroControl("stop")}>Stop</button>
    </div>
  </section>
  {#if draft}
    <div class="step-palette-grid">
      <div class="step-palette" data-testid="macro-actions-palette">
        <div class="palette-heading"><span>Actions</span><small>do work</small></div>
        <div class="step-actions">
          <button type="button" data-testid="add-step-send" title="send_line" onclick={() => addNode("send_line")}><span class="tool-icon">S</span><span class="tool-label">send</span></button>
          <button type="button" data-testid="add-step-input" title="input_line" onclick={() => addNode("input_line")}><span class="tool-icon">I</span><span class="tool-label">input</span></button>
          <button type="button" data-testid="add-step-wait" title="wait" onclick={() => addNode("wait")}><span class="tool-icon">W</span><span class="tool-label">wait</span></button>
          <button type="button" data-testid="add-step-capture" title="capture" onclick={() => addNode("capture-source")}><span class="tool-icon">C</span><span class="tool-label">capture</span></button>
          <button type="button" data-testid="add-step-extract" title="extract_text" onclick={() => addNode("extract_text")}><span class="tool-icon">E</span><span class="tool-label">extract</span></button>
          <button type="button" data-testid="add-step-parallel-send-capture" title="parallel_send_capture" onclick={() => addNode("parallel_send_capture")}><span class="tool-icon">||</span><span class="tool-label">parallel</span></button>
        </div>
      </div>

      <div class="step-palette flow-palette" data-testid="macro-flow-palette">
        <div class="palette-heading"><span>Flow</span><small>py-like</small></div>
        <div class="step-actions">
          <button type="button" data-testid="add-flow-if" title="if" onclick={() => addNode("if")}><span class="tool-icon">if</span><span class="tool-label">if</span></button>
          <button type="button" data-testid="add-flow-for" title="for" onclick={() => addNode("for")}><span class="tool-icon">for</span><span class="tool-label">for</span></button>
          <button type="button" data-testid="add-flow-return" title="return" onclick={() => addNode("return")}><span class="tool-icon">ret</span><span class="tool-label">return</span></button>
        </div>
        <p class="hint">elif/else live inside if groups; break/continue live inside for bodies.</p>
      </div>
    </div>
  {/if}
</aside>
