<script lang="ts">
  import type { RunLogUpdatedMessage } from '../protocol'
  import { RunLogClient } from '../runLog/runLogClient'
  import type { RunSnapshot, RunSummary } from '../runLog/runEventTypes'

  let { configId, refreshToken = 0, refreshEvent = null, templateId = null, templateName = null } = $props<{
    configId: string
    refreshToken?: number
    refreshEvent?: RunLogUpdatedMessage | null
    templateId?: string | null
    templateName?: string | null
  }>()

  let loadedConfigId = $state('')
  let loadedTemplateId = $state<string | null>(null)
  let seenRefreshToken = $state(-1)
  let runLogView = $state<'log' | 'ai'>('log')
  let runs = $state<RunSummary[]>([])
  let selectedRunId = $state<string | null>(null)
  let snapshot = $state<RunSnapshot | null>(null)
  let statusText = $state('Loading run logs')
  let errorText = $state<string | null>(null)
  let artifactPreview = $state<Record<string, { status: 'loading' | 'ready' | 'error'; content?: string; error?: string }>>({})
  let copyTraceLabel = $state('Copy trace')

  const aiTrace = $derived(snapshot ? JSON.stringify(snapshot, null, 2) : '')
  const traceTitle = $derived(templateId ? 'Trace for ' + (templateName || templateId) : 'Trace')

  $effect(() => {
    if (loadedConfigId !== configId || loadedTemplateId !== templateId) {
      loadedConfigId = configId
      loadedTemplateId = templateId
      selectedRunId = null
      snapshot = null
      seenRefreshToken = refreshToken
      void reloadAll()
    }
  })

  $effect(() => {
    const token = refreshToken
    if (loadedConfigId !== configId || token === seenRefreshToken) return
    seenRefreshToken = token
    void reloadFromUpdate(refreshEvent)
  })

  function client() {
    return new RunLogClient(configId)
  }

  function filterRuns(list: RunSummary[]): RunSummary[] {
    return templateId ? list.filter((run) => run.templateId === templateId) : list
  }

  function runData(data: Record<string, unknown> = {}): Record<string, unknown> {
    return templateId ? { ...data, templateId, templateName: templateName ?? templateId } : data
  }

  async function reloadAll() {
    errorText = null
    statusText = 'Loading run logs'
    try {
      const api = client()
      runs = filterRuns(await api.list())
      if (selectedRunId && runs.some((run) => run.runId === selectedRunId)) {
        snapshot = await api.snapshot(selectedRunId)
      } else if (runs[0]) {
        selectedRunId = runs[0].runId
        snapshot = await api.snapshot(runs[0].runId)
      } else {
        selectedRunId = null
        snapshot = null
      }
      statusText = 'Ready'
    } catch (error) {
      errorText = messageOf(error)
      statusText = 'Load failed'
    }
  }

  async function reloadFromUpdate(event: RunLogUpdatedMessage | null) {
    errorText = null
    try {
      const api = client()
      runs = filterRuns(await api.list())
      const targetRunId = selectedRunId ?? event?.runId ?? runs[0]?.runId ?? null
      if (targetRunId && runs.some((run) => run.runId === targetRunId)) {
        selectedRunId = targetRunId
        snapshot = await api.snapshot(targetRunId)
      } else if (runs[0]) {
        selectedRunId = runs[0].runId
        snapshot = await api.snapshot(runs[0].runId)
      } else {
        selectedRunId = null
        snapshot = null
      }
      statusText = event ? 'Live updated #' + event.eventSeq : 'Ready'
    } catch (error) {
      errorText = messageOf(error)
      statusText = 'Load failed'
    }
  }

  async function toggleArtifactPreview(ref: string) {
    if (!selectedRunId) return
    if (artifactPreview[ref]?.status === 'ready') {
      const next = { ...artifactPreview }
      delete next[ref]
      artifactPreview = next
      return
    }
    artifactPreview = { ...artifactPreview, [ref]: { status: 'loading' } }
    try {
      const content = await client().readArtifact(selectedRunId, ref)
      artifactPreview = { ...artifactPreview, [ref]: { status: 'ready', content } }
    } catch (error) {
      artifactPreview = { ...artifactPreview, [ref]: { status: 'error', error: messageOf(error) } }
    }
  }

  async function copyTrace() {
    await navigator.clipboard.writeText(aiTrace)
    copyTraceLabel = 'Copied'
    window.setTimeout(() => { copyTraceLabel = 'Copy trace' }, 900)
  }

  async function createRun() {
    errorText = null
    try {
      snapshot = await client().create(runData({ source: 'run-log-panel' }))
      selectedRunId = snapshot.runId
      runs = filterRuns(await client().list())
      statusText = 'Run created'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function selectRun(runId: string) {
    errorText = null
    try {
      selectedRunId = runId
      snapshot = await client().snapshot(runId)
      statusText = 'Run loaded'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function appendDemoEvents() {
    errorText = null
    try {
      const api = client()
      let run = snapshot
      if (!run) {
        run = await api.create(runData({ source: 'run-log-panel' }))
        selectedRunId = run.runId
      }
      const runId = run.runId

      await api.appendEvent(runId, { kind: 'step_started', stepId: 'send_review', summary: 'Started send_review', data: { terminalRef: { kind: 'alias', value: 'reviewer' } } })
      const sendArtifact = await api.writeArtifact(runId, { prefix: 'send-content', content: 'review docs only', extension: 'txt', stepId: 'send_review' })
      const sendWriteArtifact = await api.writeArtifact(runId, { prefix: 'send-write', content: 'review docs only\n', extension: 'txt', stepId: 'send_review' })
      await api.appendEvent(runId, { kind: 'terminal_text_sent', stepId: 'send_review', summary: 'Sent review prompt', data: { terminalRef: { kind: 'alias', value: 'reviewer' }, enter: true, enterSequence: 'lf', content: { artifactRef: sendArtifact.artifact.artifactRef, chars: 16 }, write: { artifactRef: sendWriteArtifact.artifact.artifactRef, chars: 17 } } })
      await api.appendEvent(runId, { kind: 'step_completed', stepId: 'send_review', summary: 'Completed send_review', data: {} })

      await api.appendEvent(runId, { kind: 'step_started', stepId: 'input_direction', summary: 'Started input_direction', data: {} })
      const inputArtifact = await api.writeArtifact(runId, { prefix: 'input', content: 'fix ai-fixable items first', extension: 'txt', stepId: 'input_direction' })
      await api.appendEvent(runId, { kind: 'user_input_requested', stepId: 'input_direction', summary: 'Requested user input', data: { prompt: 'Direction', artifactRef: inputArtifact.artifact.artifactRef } })
      await api.appendEvent(runId, { kind: 'user_input_submitted', stepId: 'input_direction', summary: 'Submitted user input', data: { artifactRef: inputArtifact.artifact.artifactRef } })
      await api.appendEvent(runId, { kind: 'step_completed', stepId: 'input_direction', summary: 'Completed input_direction', data: {} })

      await api.appendEvent(runId, { kind: 'step_started', stepId: 'wait_review', summary: 'Started wait_review', data: {} })
      const sleepArtifact = await api.writeArtifact(runId, { prefix: 'sleep', content: '{ "durationMs": 1500 }', extension: 'json', stepId: 'wait_review' })
      await api.appendEvent(runId, { kind: 'sleep_started', stepId: 'wait_review', summary: 'Started sleep 1500ms', data: { durationMs: 1500, artifactRef: sleepArtifact.artifact.artifactRef } })
      await api.appendEvent(runId, { kind: 'sleep_completed', stepId: 'wait_review', summary: 'Completed sleep 1500ms', data: { durationMs: 1500, artifactRef: sleepArtifact.artifact.artifactRef } })
      await api.appendEvent(runId, { kind: 'step_completed', stepId: 'wait_review', summary: 'Completed wait_review', data: {} })

      await api.appendEvent(runId, { kind: 'step_started', stepId: 'capture_review', summary: 'Started capture_review', data: {} })
      await api.writeArtifact(runId, { prefix: 'capture', content: 'terminal buffer tail: has ai-fixable findings', extension: 'txt', stepId: 'capture_review' })
      await api.appendEvent(runId, { kind: 'step_completed', stepId: 'capture_review', summary: 'Completed capture_review', data: {} })

      await api.appendEvent(runId, { kind: 'step_started', stepId: 'parse_review', summary: 'Started parse_review', data: {} })
      const parserArtifact = await api.writeArtifact(runId, { prefix: 'parser', content: '{ "hasAiFixable": true, "needsUserDecision": null }', extension: 'json', stepId: 'parse_review' })
      await api.appendEvent(runId, { kind: 'parser_normalized', stepId: 'parse_review', summary: 'Normalized parser result', data: { signals: { hasAiFixable: true, needsUserDecision: null }, artifactRef: parserArtifact.artifact.artifactRef } })
      await api.appendEvent(runId, { kind: 'step_completed', stepId: 'parse_review', summary: 'Completed parse_review', data: {} })

      await api.appendEvent(runId, { kind: 'step_started', stepId: 'branch_review', summary: 'Started branch_review', data: {} })
      const branchArtifact = await api.writeArtifact(runId, { prefix: 'branch', content: '{ "goto": "send_fix" }', extension: 'json', stepId: 'branch_review' })
      await api.appendEvent(runId, { kind: 'branch_decision', stepId: 'branch_review', summary: 'Branch selected send_fix', data: { signal: 'hasAiFixable', op: '==', value: true, goto: 'send_fix', artifactRef: branchArtifact.artifact.artifactRef } })
      await api.appendEvent(runId, { kind: 'step_completed', stepId: 'branch_review', summary: 'Completed branch_review', data: {} })

      await api.appendEvent(runId, { kind: 'step_started', stepId: 'control_flow', summary: 'Started control_flow', data: {} })
      const controlArtifact = await api.writeArtifact(runId, { prefix: 'control', content: '{ "from": "branch_review", "to": "send_fix" }', extension: 'json', stepId: 'control_flow' })
      await api.appendEvent(runId, { kind: 'control_transition', stepId: 'control_flow', summary: 'Transitioned to send_fix', data: { from: 'branch_review', to: 'send_fix', artifactRef: controlArtifact.artifact.artifactRef } })
      await api.appendEvent(runId, { kind: 'step_completed', stepId: 'control_flow', summary: 'Completed control_flow', data: {} })

      await api.appendEvent(runId, { kind: 'run_paused', summary: 'Paused for user decision', data: { reason: 'demo waiting for user input' } })
      snapshot = await api.snapshot(runId)
      runs = filterRuns(await api.list())
      statusText = 'Demo events appended'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  function messageOf(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
</script>

<aside class="run-log-panel" data-testid="run-log-panel">
  <div class="run-log-header">
    <div>
      <h2>{traceTitle}</h2>
      <p>{statusText}</p>
    </div>
    <div class="run-log-actions">
      <button type="button" data-testid="run-create" onclick={createRun}>New run</button>
      <button type="button" data-testid="run-append-demo" onclick={appendDemoEvents}>Append demo</button>
      <button type="button" data-testid="run-trace-copy" onclick={copyTrace} disabled={!snapshot}>{copyTraceLabel}</button>
      <details class="run-log-debug" data-testid="run-log-debug">
        <summary>Debug</summary>
        <button type="button" data-testid="run-log-refresh" onclick={reloadAll}>Refresh</button>
      </details>
    </div>
  </div>

  {#if errorText}
    <div class="run-log-error" role="alert">{errorText}</div>
  {/if}

  <div class="run-log-tabs" role="tablist" aria-label="Run trace views">
    <button type="button" role="tab" aria-selected={runLogView === 'log'} class:active={runLogView === 'log'} data-testid="run-tab-log" onclick={() => { runLogView = 'log' }}>Run Log</button>
    <button type="button" role="tab" aria-selected={runLogView === 'ai'} class:active={runLogView === 'ai'} data-testid="run-tab-ai" onclick={() => { runLogView = 'ai' }}>AI Trace</button>
  </div>

  {#if runLogView === 'log'}
    <section class="run-log-section compact-run-selector">
      <div class="run-log-section-title">
        <h3>Runs</h3>
        <span>{runs.length}</span>
      </div>
      <div class="run-list" data-testid="run-list">
        {#each runs as run (run.runId)}
          <button type="button" class:active={run.runId === selectedRunId} data-testid="run-list-item" onclick={() => selectRun(run.runId)}>
            <span>{run.runId}</span>
            <small>{run.status} · {run.eventCount}</small>
          </button>
        {/each}
        {#if runs.length === 0}<p class="empty-text">{templateId ? 'No runs for selected template.' : 'No runs yet.'}</p>{/if}
      </div>
    </section>

    {#if snapshot}
      <section class="run-log-section">
        <div class="run-log-section-title">
          <h3>Current Run</h3>
          <span data-testid="run-derived-status">{snapshot.derivedState.status}</span>
        </div>
        <dl class="run-derived-grid">
          <dt>runId</dt><dd>{snapshot.runId}</dd>
          <dt>events</dt><dd>{snapshot.derivedState.eventCount}</dd>
          <dt>currentStep</dt><dd>{snapshot.derivedState.currentStepId ?? 'none'}</dd>
          <dt>pauseReason</dt><dd>{snapshot.derivedState.pauseReason ?? 'none'}</dd>
        </dl>
        {#if snapshot.replay.error}
          <div class="run-log-error" data-testid="run-replay-error">{snapshot.replay.error.kind}: {snapshot.replay.error.message}</div>
        {/if}
        {#if snapshot.replay.diagnostics.length > 0}
          <ul class="run-log-diagnostics">
            {#each snapshot.replay.diagnostics as diagnostic}<li>{diagnostic}</li>{/each}
          </ul>
        {/if}
      </section>

      <section class="run-log-section">
        <div class="run-log-section-title"><h3>Node Logs</h3><span>{snapshot.nodeLogs.length}</span></div>
        <div class="run-node-list">
          {#each snapshot.nodeLogs as node (node.nodeId)}
            <details class="run-node-log" data-testid="run-node-log">
              <summary>
                <span>{node.title}</span>
                <small>{node.scope} · {node.events.length} events</small>
              </summary>
              {#if node.error}
                <div class="node-error" data-testid="run-node-error">{node.error}</div>
              {/if}
              {#if node.missingArtifactRefs.length > 0}
                <div class="artifact-list missing-artifact-list">
                  {#each node.missingArtifactRefs as ref}
                    <code data-testid="run-missing-artifact-ref">missing: {ref}</code>
                  {/each}
                </div>
              {/if}
              {#if node.failedEvent}
                <div class="failed-event" data-testid="run-node-failed-event">
                  <strong>failed event #{node.failedEvent.eventSeq} {node.failedEvent.kind}</strong>
                  <span>{node.failedEvent.summary}</span>
                  <pre>{JSON.stringify(node.failedEvent.data, null, 2)}</pre>
                </div>
              {/if}
              {#if node.artifactRefs.length > 0}
                <div class="artifact-list">
                  {#each node.artifactRefs as ref}
                    <button type="button" class="artifact-preview-trigger" data-testid="run-artifact-ref" onclick={() => toggleArtifactPreview(ref)}>{ref}</button>
                    {#if artifactPreview[ref]}
                      <div class="artifact-preview" data-testid="run-artifact-preview">
                        {#if artifactPreview[ref].status === 'loading'}
                          <span>Loading artifact</span>
                        {:else if artifactPreview[ref].status === 'error'}
                          <span>{artifactPreview[ref].error}</span>
                        {:else}
                          <pre>{artifactPreview[ref].content}</pre>
                        {/if}
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}
              <ol class="event-list">
                {#each node.events as event}
                  <li>
                    <strong>#{event.eventSeq} {event.kind}</strong>
                    <span>{event.summary}</span>
                    <pre>{JSON.stringify(event.data, null, 2)}</pre>
                  </li>
                {/each}
              </ol>
            </details>
          {/each}
        </div>
      </section>
    {/if}
  {:else}
    <section class="run-log-section run-ai-trace" data-testid="run-ai-panel">
      <div class="run-log-section-title"><h3>AI Trace</h3><span>{snapshot ? snapshot.derivedState.eventCount : 0}</span></div>
      {#if snapshot}
        <pre data-testid="run-ai-trace">{aiTrace}</pre>
      {:else}
        <p class="empty-text">No run selected.</p>
      {/if}
    </section>
  {/if}
</aside>
