<script lang="ts">
  import type {
    CaptureSourceConfig,
    MacroTerminalReference,
    ParallelCaptureSourceConfig,
  } from '../../macro/macroDefinitionTypes'
  import type { CapabilityCaptureKind, TerminalChoice } from '../../macro/macroTerminalChoices'
  import MacroTerminalSelect from './MacroTerminalSelect.svelte'

  type CaptureValue = CaptureSourceConfig | ParallelCaptureSourceConfig

  let {
    variant,
    capture,
    allowedKinds,
    captureAllowed,
    terminalChoices = () => [],
    expectedTerminalType = undefined,
    onTerminalChange = () => false,
    onKindChange,
    onChange,
  } = $props<{
    variant: 'root' | 'parallel'
    capture: CaptureValue
    allowedKinds: CapabilityCaptureKind[]
    captureAllowed: boolean
    terminalChoices?: () => TerminalChoice[]
    expectedTerminalType?: 'shell' | 'text'
    onTerminalChange?: (terminal: MacroTerminalReference) => boolean
    onKindChange: (kind: CaptureSourceConfig['kind']) => void
    onChange: (capture: CaptureValue) => void
  }>()

  function changeCapture(next: CaptureValue): void {
    onChange(next)
  }
</script>

{#if variant === 'root' && 'terminal' in capture}
  <label>Source tab<MacroTerminalSelect testId="capture-step-terminal" reference={capture.terminal} expectedType={expectedTerminalType} choices={terminalChoices()} onChange={onTerminalChange} /></label>
{/if}

{#if allowedKinds.length > 1}
  {#if variant === 'root'}
    <label>Capture kind<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="capture-step-kind" value={capture.kind} onchange={(event) => onKindChange(event.currentTarget.value as CaptureSourceConfig['kind'])}>{#each allowedKinds as kind}<option value={kind}>{kind}</option>{/each}</select></label>
  {:else}
    <label>Capture kind<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-capture-kind" value={capture.kind} onchange={(event) => onKindChange(event.currentTarget.value as CaptureSourceConfig['kind'])}>{#each allowedKinds as kind}<option value={kind}>{kind}</option>{/each}</select></label>
  {/if}
{:else if variant === 'root'}
  <p class="hint" data-testid="capture-kind-fixed">Capture kind: {allowedKinds[0] ?? capture.kind}</p>
{:else}
  <p class="hint" data-testid="parallel-capture-kind-fixed">Capture kind: {allowedKinds[0] ?? capture.kind}</p>
{/if}

{#if !captureAllowed}
  {#if variant === 'root'}
    <p class="macro-insertion-notice alert alert-warning py-2 text-xs" data-testid="capture-kind-invalid">Capture kind {capture.kind} is not valid for this source tab.</p>
    {#if allowedKinds[0]}<button class="btn btn-warning btn-xs" type="button" data-testid="capture-kind-repair" onclick={() => onKindChange(allowedKinds[0])}>Use {allowedKinds[0]}</button>{/if}
  {:else}
    <p class="macro-insertion-notice alert alert-warning py-2 text-xs" data-testid="parallel-capture-kind-invalid">Capture kind {capture.kind} is not valid for this lane tab.</p>
    {#if allowedKinds[0]}<button class="btn btn-warning btn-xs" type="button" data-testid="parallel-capture-kind-repair" onclick={() => onKindChange(allowedKinds[0])}>Use {allowedKinds[0]}</button>{/if}
  {/if}
{:else if capture.kind === 'terminal-buffer'}
  {#if variant === 'root'}
    <label>Mode<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="capture-terminal-buffer-mode" value={capture.mode} onchange={(event) => changeCapture({ ...capture, mode: event.currentTarget.value as 'scrollback-tail' | 'raw-stream-tail' })}><option value="scrollback-tail">screen text tail</option><option value="raw-stream-tail">raw stream tail (debug only)</option></select></label>
    <label>Max chars<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="capture-max-chars" type="number" value={capture.maxChars} oninput={(event) => changeCapture({ ...capture, maxChars: Number(event.currentTarget.value) })} /></label>
  {:else}
    <div class="macro-row">
      <label>Mode<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-capture-mode" value={capture.mode} onchange={(event) => changeCapture({ ...capture, mode: event.currentTarget.value as 'scrollback-tail' | 'raw-stream-tail' })}><option value="scrollback-tail">screen text</option><option value="raw-stream-tail">raw stream tail</option></select></label>
      <label>Max chars<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-capture-max-chars" type="number" value={capture.maxChars} oninput={(event) => changeCapture({ ...capture, maxChars: Number(event.currentTarget.value) })} /></label>
    </div>
  {/if}
{:else if capture.kind === 'agent-event'}
  {#if variant === 'root'}
    <label>Agent<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="capture-agent-kind" value={capture.agent.kind} onchange={() => changeCapture({ ...capture, agent: { kind: 'codex' } })}><option value="codex">codex</option></select></label>
    <label>Mode<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="capture-agent-mode" value={capture.captureMode ?? 'result_only'} onchange={(event) => changeCapture({ ...capture, captureMode: event.currentTarget.value as 'result_only' | 'prompt_only' | 'prompt_and_result' })}><option value="result_only">result only</option><option value="prompt_only">prompt only</option><option value="prompt_and_result">prompt + result</option></select></label>
  {:else}
    <div class="macro-row"><label>Agent<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-capture-agent-kind" value={capture.agent.kind} onchange={(event) => changeCapture({ ...capture, agent: { kind: event.currentTarget.value as 'codex' } })}><option value="codex">codex</option></select></label><label>Mode<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-capture-agent-mode" value={capture.captureMode ?? 'result_only'} onchange={(event) => changeCapture({ ...capture, captureMode: event.currentTarget.value as 'result_only' | 'prompt_only' | 'prompt_and_result' })}><option value="result_only">result only</option><option value="prompt_only">prompt only</option><option value="prompt_and_result">prompt + result</option></select></label></div>
  {/if}
  {#if variant === 'root'}
    <div class="agent-wait-limit">
      <label class="checkbox-row agent-timeout-toggle">
        <input class="checkbox checkbox-xs !size-3.5 !min-h-3.5" data-testid="capture-agent-timeout-enabled" type="checkbox" checked={capture.waitLimit.kind === 'timeout'} onchange={(event) => changeCapture({ ...capture, waitLimit: event.currentTarget.checked ? { kind: 'timeout', timeoutMs: 600000 } : { kind: 'unbounded' } })} />
        <span>Enable timeout</span>
      </label>
      {#if capture.waitLimit.kind === 'timeout'}
        <label class="agent-timeout-duration"><span>Timeout ms</span><input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="capture-agent-timeout-ms" type="number" min="1" step="1" value={capture.waitLimit.timeoutMs} oninput={(event) => { if (capture.kind === 'agent-event' && capture.waitLimit.kind === 'timeout') changeCapture({ ...capture, waitLimit: { kind: 'timeout', timeoutMs: Number(event.currentTarget.value) } }) }} /></label>
      {:else}
        <p class="hint agent-timeout-hint" data-testid="capture-agent-unbounded-hint">Wait until result or Stop</p>
      {/if}
    </div>
  {:else}
    <div class="agent-wait-limit">
      <label class="checkbox-row agent-timeout-toggle">
        <input class="checkbox checkbox-xs !size-3.5 !min-h-3.5" data-testid="parallel-capture-agent-timeout-enabled" type="checkbox" checked={capture.waitLimit.kind === 'timeout'} onchange={(event) => changeCapture({ ...capture, waitLimit: event.currentTarget.checked ? { kind: 'timeout', timeoutMs: 600000 } : { kind: 'unbounded' } })} />
        <span>Enable timeout</span>
      </label>
      {#if capture.waitLimit.kind === 'timeout'}
        <label class="agent-timeout-duration"><span>Timeout ms</span><input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-capture-agent-timeout-ms" type="number" min="1" step="1" value={capture.waitLimit.timeoutMs} oninput={(event) => { if (capture.kind === 'agent-event' && capture.waitLimit.kind === 'timeout') changeCapture({ ...capture, waitLimit: { kind: 'timeout', timeoutMs: Number(event.currentTarget.value) } }) }} /></label>
      {:else}
        <p class="hint agent-timeout-hint" data-testid="parallel-capture-agent-unbounded-hint">Wait until result or Stop</p>
      {/if}
    </div>
  {/if}
  {#if variant === 'root'}<p class="hint">Codex hook fields only: UserPromptSubmit.prompt and Stop.last_assistant_message</p>{/if}
{:else}
  {#if variant === 'root'}
    <p class="hint">Captures this text tab as plain text.</p>
  {:else}
    <p class="hint">Captures this text lane tab as plain text.</p>
  {/if}
{/if}
