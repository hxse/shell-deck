<script lang="ts">
  import type {
    CaptureSourceConfig,
    MacroTerminalReference,
  } from '../../macro/macroDefinitionTypes'
  import {
    compileStructuredJsonSchema,
    isJsonSchema,
    structuredJsonSubmissionPrompt,
    type JsonSchema,
  } from '../../macro/structuredJson'
  import type { CapabilityCaptureKind, TerminalChoice } from '../../macro/macroTerminalChoices'
  import LineNumberedTextarea from './LineNumberedTextarea.svelte'
  import MacroTerminalSelect from './MacroTerminalSelect.svelte'

  type CopyState = 'idle' | 'copied' | 'failed'

  const CODEX_LAUNCH_COMMAND = 'just -f "$SHELL_DECK_JUSTFILE" codex'

  let {
    variant,
    capture,
    allowedKinds,
    captureAllowed,
    terminalChoices = () => [],
    allTerminalChoices = undefined,
    disabledTerminalValues = [],
    expectedTerminalType = undefined,
    onTerminalChange = () => false,
    onKindChange,
    onChange,
  } = $props<{
    variant: 'root' | 'parallel'
    capture: CaptureSourceConfig
    allowedKinds: CapabilityCaptureKind[]
    captureAllowed: boolean
    terminalChoices?: () => TerminalChoice[]
    allTerminalChoices?: TerminalChoice[]
    disabledTerminalValues?: string[]
    expectedTerminalType?: 'shell' | 'text'
    onTerminalChange?: (terminal: MacroTerminalReference) => boolean
    onKindChange: (kind: CaptureSourceConfig['kind']) => void
    onChange: (capture: CaptureSourceConfig) => void
  }>()

  let submissionPromptDialog = $state<HTMLDialogElement | null>(null)
  let promptCopyState = $state<CopyState>('idle')
  let codexCommandCopyState = $state<CopyState>('idle')
  const submissionPrompt = $derived.by(() => {
    if (capture.kind !== 'structured-json') return null
    if (!compileStructuredJsonSchema(capture.schema).ok) return null
    return structuredJsonSubmissionPrompt(capture.schema)
  })

  function changeCapture(next: CaptureSourceConfig): void {
    onChange(next)
  }

  function schemaEditorValue(schema: JsonSchema): string {
    return typeof schema === 'string'
      ? schema
      : JSON.stringify(schema, null, 2)
  }

  function changeSchema(value: string): void {
    if (capture.kind !== 'structured-json') return
    let schema: unknown = value
    try {
      const parsed = JSON.parse(value)
      if (isJsonSchema(parsed) && compileStructuredJsonSchema(parsed).ok) schema = parsed
    } catch {
      // Keep invalid editor text in the draft so normal Macro validation blocks Save and Start.
    }
    changeCapture({ ...capture, schema: schema as JsonSchema })
  }

  function openSubmissionPrompt(): void {
    if (!submissionPrompt) return
    promptCopyState = 'idle'
    submissionPromptDialog?.showModal()
  }

  async function copySubmissionPrompt(): Promise<void> {
    if (!submissionPrompt) return
    try {
      await navigator.clipboard.writeText(submissionPrompt)
      promptCopyState = 'copied'
    } catch {
      promptCopyState = 'failed'
    }
  }

  async function copyCodexLaunchCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(CODEX_LAUNCH_COMMAND)
      codexCommandCopyState = 'copied'
    } catch {
      codexCommandCopyState = 'failed'
    }
  }
</script>

<label>Source tab<MacroTerminalSelect testId={variant === 'root' ? 'capture-step-terminal' : 'parallel-capture-terminal'} reference={capture.terminal} expectedType={expectedTerminalType} choices={terminalChoices()} allChoices={allTerminalChoices} disabledValues={disabledTerminalValues} onChange={onTerminalChange} /></label>

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
    <p class="macro-insertion-notice alert alert-warning py-2 text-xs" data-testid="parallel-capture-kind-invalid">Capture kind {capture.kind} is not valid for this source tab.</p>
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
{:else if capture.kind === 'structured-json'}
  <label>JSON Schema
    <LineNumberedTextarea
      testId="capture-structured-json-schema"
      value={schemaEditorValue(capture.schema)}
      ariaLabel="Structured JSON capture schema"
      onInput={changeSchema}
    />
  </label>
  <div class="agent-wait-limit">
    <label class="checkbox-row agent-timeout-toggle">
      <input class="checkbox checkbox-xs !size-3.5 !min-h-3.5" data-testid="capture-structured-json-timeout-enabled" type="checkbox" checked={capture.waitLimit.kind === 'timeout'} onchange={(event) => changeCapture({ ...capture, waitLimit: event.currentTarget.checked ? { kind: 'timeout', timeoutMs: 600000 } : { kind: 'unbounded' } })} />
      <span>Enable timeout</span>
    </label>
    {#if capture.waitLimit.kind === 'timeout'}
      <label class="agent-timeout-duration"><span>Timeout ms</span><input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="capture-structured-json-timeout-ms" type="number" min="1" step="1" value={capture.waitLimit.timeoutMs} oninput={(event) => { if (capture.kind === 'structured-json' && capture.waitLimit.kind === 'timeout') changeCapture({ ...capture, waitLimit: { kind: 'timeout', timeoutMs: Number(event.currentTarget.value) } }) }} /></label>
    {:else}
      <p class="hint agent-timeout-hint" data-testid="capture-structured-json-unbounded-hint">Wait until one valid submission or Stop</p>
    {/if}
  </div>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="hint">The target process submits one JSON value with <code>just submit-json</code>.</p>
    <button
      class="btn btn-xs btn-ghost"
      type="button"
      data-testid="capture-structured-json-view-prompt"
      aria-haspopup="dialog"
      disabled={!submissionPrompt}
      title={submissionPrompt ? 'View a suggested instruction for the target process' : 'Fix the JSON Schema before viewing the prompt'}
      onclick={openSubmissionPrompt}
    >View suggested prompt</button>
  </div>
  <dialog
    bind:this={submissionPromptDialog}
    class="modal"
    data-testid="capture-structured-json-prompt-dialog"
    aria-label="Structured JSON submission prompt"
    onclose={() => { promptCopyState = 'idle' }}
  >
    <div class="modal-box grid max-w-3xl gap-3">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-base font-bold">Suggested submission prompt</h3>
        <form method="dialog"><button class="btn btn-xs btn-ghost" type="submit" data-testid="capture-structured-json-prompt-close">Close</button></form>
      </div>
      <p class="hint">Paste this into the Send text that should instruct the target process, then edit it there for the task.</p>
      <textarea
        class="textarea box-border textarea-ghost min-h-64 w-full resize-y bg-base-content/15 font-mono text-xs text-base-content"
        data-testid="capture-structured-json-prompt-text"
        aria-label="Suggested structured JSON submission prompt"
        readonly
        value={submissionPrompt ?? ''}
      ></textarea>
      {#if promptCopyState === 'failed'}
        <div class="alert alert-warning py-2 text-xs" data-testid="capture-structured-json-prompt-copy-failed" role="status">Clipboard access failed. Click inside the prompt, then copy it manually with Ctrl/Cmd+A and Ctrl/Cmd+C.</div>
      {:else if promptCopyState === 'copied'}
        <p class="text-xs text-success" data-testid="capture-structured-json-prompt-copied" role="status">Copied to clipboard.</p>
      {/if}
      <div class="modal-action mt-0">
        <button class="btn btn-primary btn-sm" type="button" data-testid="capture-structured-json-prompt-copy" onclick={copySubmissionPrompt}>{promptCopyState === 'copied' ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  </dialog>
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
  {#if capture.agent.kind === 'codex'}
    <div class="grid gap-1" data-testid="capture-agent-codex-guidance">
      <div class="alert alert-info alert-soft box-border flex h-8 min-h-0 flex-nowrap items-center gap-1 px-2 py-0 text-xs" data-testid="capture-agent-codex-command-bar">
        <span class="badge badge-info badge-xs shrink-0">Codex</span>
        <div class="tooltip tooltip-top min-w-0 flex-1 text-left" data-testid="capture-agent-codex-command-tooltip" data-tip="Run this command in the selected Shell. Its current directory becomes the Codex workspace.">
          <code class="block select-all overflow-x-auto whitespace-nowrap font-mono" data-testid="capture-agent-codex-command">{CODEX_LAUNCH_COMMAND}</code>
        </div>
        <div class="tooltip tooltip-top shrink-0" data-testid="capture-agent-codex-command-copy-tooltip" data-tip="Copy Codex launch command">
          <button class="btn btn-xs btn-ghost" type="button" aria-label="Copy Codex launch command" data-testid="capture-agent-codex-command-copy" onclick={copyCodexLaunchCommand}>{codexCommandCopyState === 'copied' ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
      {#if codexCommandCopyState === 'failed'}
        <p class="text-xs text-warning" data-testid="capture-agent-codex-command-copy-failed" role="status">Clipboard access failed. Select the command and copy it manually.</p>
      {/if}
    </div>
  {/if}
  {#if variant === 'root'}<p class="hint">Codex hook fields only: UserPromptSubmit.prompt and Stop.last_assistant_message</p>{/if}
{:else}
  {#if variant === 'root'}
    <p class="hint">Captures this text tab as plain text.</p>
  {:else}
    <p class="hint">Captures this text tab as plain text.</p>
  {/if}
{/if}
