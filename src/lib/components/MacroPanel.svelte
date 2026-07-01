<script lang="ts">
  import type { TerminalIndexMapItem, TerminalSnapshot } from '../protocol'
  import { MacroTemplateClient } from '../macro/macroTemplateClient'
  import { MacroRunnerClient } from '../macro/macroRunnerClient'
  import type { ProfileCatalogSummary, ProfileSummary, SignalSummary } from '../macro/profileCatalogSummary'
  import { validateMacroTemplate } from '../macro/templateSchema'
  import type { MacroRunnerSnapshot } from '../macro/runnerTypes'
  import type {
    BranchCondition,
    CaptureSourceConfig,
    MacroStep,
    MacroTemplate,
    ParallelLane,
    ParserConfig,
    TemplateSummary,
    TerminalTarget,
  } from '../macro/templateTypes'

  type WaitMode = Extract<MacroStep, { type: 'wait' }>['mode']

  let { configId, terminals, indexMap } = $props<{
    configId: string
    terminals: TerminalSnapshot[]
    indexMap: TerminalIndexMapItem[]
  }>()

  let loadedConfigId = $state('')
  let catalog = $state<ProfileCatalogSummary | null>(null)
  let templates = $state<TemplateSummary[]>([])
  let draft = $state<MacroTemplate | null>(null)
  let selectedTemplateId = $state<string | null>(null)
  let statusText = $state('')
  let errorText = $state<string | null>(null)
  let importInput = $state<HTMLInputElement | null>(null)
  let macroView = $state<'editor' | 'json'>('editor')
  let runner = $state<MacroRunnerSnapshot | null>(null)
  let runnerInput = $state('')

  const validation = $derived(draft ? validateMacroTemplate(draft, { indexMap }) : { ok: true, issues: [] })
  const jsonPreview = $derived(draft ? JSON.stringify(draft, null, 2) : '')

  $effect(() => {
    if (loadedConfigId !== configId) {
      loadedConfigId = configId
      void reloadAll()
    }
  })

  function client() {
    return new MacroTemplateClient(configId)
  }

  function runnerClient() {
    return new MacroRunnerClient(configId)
  }

  async function reloadAll() {
    errorText = null
    statusText = 'Loading templates'
    try {
      const api = client()
      catalog = await api.profileCatalog()
      templates = await api.list()
      if (selectedTemplateId && templates.some((item) => item.id === selectedTemplateId)) {
        draft = await api.read(selectedTemplateId)
      } else if (templates[0]) {
        selectedTemplateId = templates[0].id
        draft = await api.read(templates[0].id)
      } else {
        selectedTemplateId = null
        draft = null
      }
      runner = await runnerClient().snapshot()
      statusText = 'Ready'
    } catch (error) {
      errorText = messageOf(error)
      statusText = 'Load failed'
    }
  }

  async function createTemplate() {
    errorText = null
    try {
      draft = await client().create()
      selectedTemplateId = draft.id
      templates = await client().list()
      statusText = 'Template created'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function selectTemplate(templateId: string) {
    errorText = null
    try {
      selectedTemplateId = templateId
      draft = await client().read(templateId)
      statusText = 'Template loaded'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function saveTemplate() {
    if (!draft) return
    if (!validation.ok) {
      errorText = 'Fix validation errors before save.'
      return
    }
    errorText = null
    try {
      draft = await client().save(draft)
      templates = await client().list()
      statusText = 'Saved'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function duplicateTemplate() {
    if (!draft) return
    errorText = null
    try {
      draft = await client().duplicate(draft.id)
      selectedTemplateId = draft.id
      templates = await client().list()
      statusText = 'Duplicated'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function deleteTemplate() {
    if (!draft) return
    if (!window.confirm('Delete macro template "' + draft.name + '"?')) {
      statusText = 'Delete cancelled'
      return
    }
    errorText = null
    try {
      await client().delete(draft.id)
      selectedTemplateId = null
      draft = null
      templates = await client().list()
      statusText = 'Deleted'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function exportTemplate() {
    if (!draft) return
    errorText = null
    try {
      const exported = await client().exportTemplate(draft.id)
      const blob = new Blob([JSON.stringify(exported, null, 2) + '\n'], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = exported.id + '.json'
      link.click()
      URL.revokeObjectURL(link.href)
      statusText = 'Exported'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function importTemplate(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    errorText = null
    try {
      const imported = JSON.parse(await file.text())
      draft = await client().importTemplate(imported)
      selectedTemplateId = draft.id
      templates = await client().list()
      statusText = 'Imported'
    } catch (error) {
      errorText = messageOf(error)
    } finally {
      input.value = ''
    }
  }

  function updateDraft(mutator: (template: MacroTemplate) => void) {
    if (!draft) return
    const next = JSON.parse(JSON.stringify(draft)) as MacroTemplate
    mutator(next)
    draft = next
  }

  function addStep(type: MacroStep['type']) {
    updateDraft((template) => {
      if (type === 'parse') ensureCaptureStep(template)
      if (type === 'branch') {
        addBranchPair(template)
        return
      }
      template.steps.push(defaultStep(template, type))
    })
  }

  function removeStep(stepId: string) {
    updateDraft((template) => {
      template.steps = template.steps.filter((step) => step.id !== stepId)
    })
  }

  function moveStep(stepId: string, offset: number) {
    updateDraft((template) => {
      const index = template.steps.findIndex((step) => step.id === stepId)
      const nextIndex = index + offset
      if (index === -1 || nextIndex < 0 || nextIndex >= template.steps.length) return
      const [step] = template.steps.splice(index, 1)
      template.steps.splice(nextIndex, 0, step)
    })
  }

  function updateStep(stepId: string, mutator: (step: MacroStep, template: MacroTemplate) => void) {
    updateDraft((template) => {
      const step = template.steps.find((candidate) => candidate.id === stepId)
      if (step) mutator(step, template)
    })
  }

  function setStepId(oldId: string, nextId: string) {
    updateDraft((template) => {
      const step = template.steps.find((candidate) => candidate.id === oldId)
      if (step) step.id = nextId
    })
  }

  function addRegexRule(stepId: string) {
    updateStep(stepId, (step) => {
      if (step.type !== 'parse' || step.parser.kind !== 'regex') return
      step.parser.rules.push({ signal: uniqueKey('signal', step.parser.rules.map((rule) => rule.signal)), type: 'boolean-null', pattern: 'ready|done|complete', flags: 'i', onMatch: true, onNoMatch: false })
    })
  }

  function removeRegexRule(stepId: string, ruleIndex: number) {
    updateStep(stepId, (step) => {
      if (step.type === 'parse' && step.parser.kind === 'regex') step.parser.rules.splice(ruleIndex, 1)
    })
  }

  function addBranchCondition(stepId: string) {
    updateStep(stepId, (step, template) => {
      if (step.type !== 'branch') return
      const signals = parseSignals(template, step.fromParseStep)
      step.conditions.push({ signal: signals[0]?.id ?? 'signal', op: '==', value: true, goto: step.else ?? template.steps.at(-1)?.id ?? step.id })
    })
  }

  function removeBranchCondition(stepId: string, conditionIndex: number) {
    updateStep(stepId, (step) => {
      if (step.type === 'branch') step.conditions.splice(conditionIndex, 1)
    })
  }

  function setParserKind(stepId: string, kind: ParserConfig['kind']) {
    updateStep(stepId, (step) => {
      if (step.type !== 'parse') return
      step.parser = kind === 'ai-json'
        ? { kind: 'ai-json', profileId: catalog?.profiles[0]?.profileId ?? 'review-routing-v1' }
        : { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready|done|complete', flags: 'i', onMatch: true, onNoMatch: false }] }
    })
  }

  function setSleepFromUnit(stepId: string, rawValue: string, unit: string) {
    const amount = Number(rawValue)
    const scale = unit === 'h' ? 3_600_000 : unit === 'min' ? 60_000 : unit === 's' ? 1000 : 1
    if (!Number.isFinite(amount) || amount < 1) return
    updateStep(stepId, (step) => {
      if (step.type === 'sleep') step.durationMs = Math.round(amount * scale)
    })
  }

  function booleanNullFromString(value: string): boolean | null {
    if (value === 'true') return true
    if (value === 'false') return false
    return null
  }

  function stringFromBooleanNull(value: boolean | null): string {
    return value === null ? 'null' : String(value)
  }

  function waitStepForMode(template: MacroTemplate, id: string, mode: WaitMode): Extract<MacroStep, { type: 'wait' }> {
    const terminal = firstTerminalTarget()
    if (mode === 'duration') return { id, type: 'wait', mode, durationMs: 1500 }
    if (mode === 'capture-ready-or-user') {
      ensureCaptureStep(template)
      return { id, type: 'wait', mode, captureStep: firstCaptureStepId(template), timeoutMs: 600000, onTimeout: 'pause' }
    }
    if (mode === 'user-continue') return { id, type: 'wait', mode, prompt: 'Continue when ready' }
    return { id, type: 'wait', mode: 'terminal-quiet', terminal, quietMs: 1000, maxMs: 600000, onTimeout: 'pause' }
  }

  function terminalChoices() {
    const aliases = indexMap.map((item: TerminalIndexMapItem) => ({ value: 'alias:' + item.terminalAlias, label: 'alias:' + item.terminalAlias }))
    const indices = indexMap.map((item: TerminalIndexMapItem) => ({ value: 'index:' + item.index, label: '#' + item.index + ' ' + item.terminalAlias }))
    const ids = terminals.map((terminal: TerminalSnapshot) => ({ value: 'id:' + terminal.terminalId, label: terminal.terminalId }))
    return [...aliases, ...indices, ...ids]
  }

  function targetFromChoice(choice: string): TerminalTarget {
    const [kind, value] = choice.split(':')
    if (kind === 'index') return { kind: 'index', value: Number(value) }
    if (kind === 'id') return { kind: 'id', value }
    return { kind: 'alias', value }
  }

  function choiceFromTarget(target: TerminalTarget): string {
    return target.kind + ':' + target.value
  }

  function firstTerminalTarget(): TerminalTarget {
    return indexMap[0]?.terminalAlias ? { kind: 'alias', value: indexMap[0].terminalAlias } : { kind: 'index', value: 1 }
  }

  function defaultCaptureSource(kind: CaptureSourceConfig['kind']): CaptureSourceConfig {
    const terminal = firstTerminalTarget()
    if (kind === 'agent-event') return { kind, terminal, agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook' }
    return { kind, terminal, mode: 'scrollback-tail', maxChars: 20000 }
  }

  function terminalTargetAt(index: number): TerminalTarget {
    const item = indexMap[index] ?? indexMap[0]
    return item?.terminalAlias ? { kind: 'alias', value: item.terminalAlias } : { kind: 'index', value: index + 1 }
  }

  function defaultParallelLane(template: MacroTemplate, prefix: string, terminal: TerminalTarget): ParallelLane {
    const laneId = uniqueKey(prefix, template.steps.flatMap((step) => step.type === 'parallel_all' ? step.lanes.map((lane) => lane.id) : []))
    const captureId = laneId + '_capture'
    const parseId = laneId + '_parse'
    return {
      id: laneId,
      terminal,
      steps: [
        { id: laneId + '_send', type: 'send_line', text: 'echo ready' },
        { id: laneId + '_wait', type: 'wait', mode: 'terminal-quiet', terminal, quietMs: 1000, maxMs: 600000, onTimeout: 'pause' },
        { id: captureId, type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 20000 } },
        { id: parseId, type: 'parse', captureStep: captureId, parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready|done|complete', flags: 'i', onMatch: true, onNoMatch: false }] } },
      ],
      success: { fromParseStep: parseId, mode: 'all', conditions: [{ signal: 'hasReadyText', op: '==', value: true }] },
    }
  }

  function addParallelLane(stepId: string) {
    updateStep(stepId, (step, template) => {
      if (step.type !== 'parallel_all') return
      step.lanes.push(defaultParallelLane(template, 'lane', terminalTargetAt(step.lanes.length)))
    })
  }

  function removeParallelLane(stepId: string, laneId: string) {
    updateStep(stepId, (step) => {
      if (step.type === 'parallel_all') step.lanes = step.lanes.filter((lane) => lane.id !== laneId)
    })
  }

  function updateParallelLane(stepId: string, laneId: string, mutator: (lane: ParallelLane) => void) {
    updateStep(stepId, (step) => {
      if (step.type !== 'parallel_all') return
      const lane = step.lanes.find((candidate) => candidate.id === laneId)
      if (lane) mutator(lane)
    })
  }

  function captureSteps(template: MacroTemplate) {
    return template.steps.filter((step): step is Extract<MacroStep, { type: 'capture-source' }> => step.type === 'capture-source')
  }

  function firstCaptureStepId(template: MacroTemplate): string {
    return captureSteps(template)[0]?.id ?? ''
  }

  function ensureCaptureStep(template: MacroTemplate) {
    if (captureSteps(template).length === 0) template.steps.push(defaultStep(template, 'capture-source'))
  }

  function defaultStep(template: MacroTemplate, type: MacroStep['type']): MacroStep {
    const id = uniqueKey(type.replace(/[^A-Za-z0-9_]/g, '_'), template.steps.map((step) => step.id))
    const terminal = firstTerminalTarget()
    if (type === 'send_line') return { id, type, terminal, text: 'echo ready' }
    if (type === 'sleep') return { id, type, durationMs: 1500 }
    if (type === 'input_line') return { id, type, terminal, prompt: 'Input line to send', allowEmpty: false }
    if (type === 'wait') return waitStepForMode(template, id, 'terminal-quiet')
    if (type === 'capture-source') return { id, type, capture: defaultCaptureSource('terminal-buffer') }
    if (type === 'parse') return { id, type, captureStep: firstCaptureStepId(template), parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready|done|complete', flags: 'i', onMatch: true, onNoMatch: false }] } }
    if (type === 'goto') return { id, type, goto: template.steps[0]?.id ?? id, loopGuard: { maxIterations: 5, onLimit: 'pause' } }
    if (type === 'parallel_all') return { id, type, lanes: [defaultParallelLane(template, 'lane_a', terminalTargetAt(0)), defaultParallelLane(template, 'lane_b', terminalTargetAt(1))], join: { mode: 'all_success', onLaneFail: 'pause', onTimeout: 'pause' } }
    if (type === 'complete') return { id, type }
    if (type === 'fail') return { id, type, reason: 'explicit-fail' }
    if (type === 'stop') return { id, type, reason: 'explicit-stop' }
    return { id, type: 'pause', reason: 'manual-pause' }
  }

  function addBranchPair(template: MacroTemplate) {
    const parseStep = [...template.steps].reverse().find((step) => step.type === 'parse')
    const branchId = uniqueKey('branch', template.steps.map((step) => step.id))
    const completeId = uniqueKey('complete', [...template.steps.map((step) => step.id), branchId])
    const signal = parseStep ? parseSignals(template, parseStep.id)[0]?.id : 'hasReadyText'
    template.steps.push({
      id: branchId,
      type: 'branch',
      fromParseStep: parseStep?.id ?? '',
      conditions: [{ signal: signal ?? 'hasReadyText', op: '==', value: true, goto: completeId }],
      else: completeId,
    })
    template.steps.push({ id: completeId, type: 'complete' })
  }

  function parseSteps(template: MacroTemplate) {
    return template.steps.filter((step): step is Extract<MacroStep, { type: 'parse' }> => step.type === 'parse')
  }

  function parseSignals(template: MacroTemplate, parseStepId: string): SignalSummary[] {
    const parseStep = parseSteps(template).find((step) => step.id === parseStepId)
    if (!parseStep) return []
    const parser = parseStep.parser
    if (parser.kind === 'regex') return parser.rules.map((rule) => ({ id: rule.signal, type: rule.type }))
    return catalog?.profiles.find((profile) => profile.profileId === parser.profileId)?.signals ?? []
  }

  function profileFor(step: Extract<MacroStep, { type: 'parse' }>): ProfileSummary | undefined {
    const parser = step.parser
    return parser.kind === 'ai-json' ? catalog?.profiles.find((profile) => profile.profileId === parser.profileId) : undefined
  }

  function stepIds(template: MacroTemplate) {
    return template.steps.map((step) => step.id)
  }

  function uniqueKey(prefix: string, used: string[]): string {
    const base = prefix.replace(/[^A-Za-z0-9_-]/g, '_') || 'item'
    for (let index = 1; index < 1000; index += 1) {
      const candidate = base + '_' + index
      if (!used.includes(candidate)) return candidate
    }
    return base + '_' + Date.now()
  }

  function legacyFlowLabel(step: MacroStep): string | null {
    if (step.type === 'branch') return 'legacy if/elif/else'
    if (step.type === 'goto') return 'legacy loop jump'
    if (step.type === 'complete') return 'legacy return'
    if (step.type === 'pause') return 'legacy pause'
    if (step.type === 'fail') return 'legacy fail'
    if (step.type === 'stop') return 'legacy stop'
    return null
  }

  async function macroControl(action: 'start' | 'pause' | 'resume' | 'stop') {
    errorText = null
    if (action === 'start' && !draft) {
      statusText = 'Create or select a template first'
      return
    }
    if (action === 'start' && !validation.ok) {
      errorText = 'Fix validation errors before start.'
      statusText = 'Start blocked'
      return
    }
    try {
      const api = runnerClient()
      if (action === 'start' && draft) {
        draft = await client().save(draft)
        selectedTemplateId = draft.id
        templates = await client().list()
        runner = await api.start({ templateId: draft.id })
      }
      if (action === 'pause') runner = await api.pause()
      if (action === 'resume') runner = await api.resume()
      if (action === 'stop') runner = await api.stop()
      statusText = 'Runner ' + (runner?.status ?? action)
      if (action === 'start' || action === 'resume') refreshRunnerSoon()
    } catch (error) {
      errorText = messageOf(error)
      statusText = 'Runner ' + action + ' failed'
    }
  }

  function refreshRunnerSoon(attempt = 0) {
    const isLiveRefreshStatus = runner?.status === 'running' || runner?.status === 'waiting'
    if (!isLiveRefreshStatus || attempt > 130) return
    const delayMs = attempt < 10 ? 100 : 1000
    window.setTimeout(async () => {
      await refreshRunner()
      refreshRunnerSoon(attempt + 1)
    }, delayMs)
  }

  async function submitRunnerInput() {
    errorText = null
    try {
      runner = await runnerClient().submitInput({ text: runnerInput })
      runnerInput = ''
      statusText = 'Runner ' + runner.status
      refreshRunnerSoon()
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function refreshRunner() {
    errorText = null
    try {
      runner = await runnerClient().snapshot()
      statusText = 'Runner ' + runner.status
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  function messageOf(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
</script>

<aside class="macro-panel" data-testid="macro-panel">
  <div class="macro-header">
    <div>
      <h2>Macro</h2>
      <p>{statusText || 'Template workbench'}</p>
    </div>
    <button type="button" data-testid="macro-create" onclick={createTemplate}>New</button>
  </div>

  <div class="macro-run-controls" data-testid="macro-run-controls">
    <button type="button" data-testid="macro-control-start" title="Start selected template" onclick={() => macroControl('start')}>Start</button>
    <button type="button" data-testid="macro-control-pause" title="Pause active run" onclick={() => macroControl('pause')}>Pause</button>
    <button type="button" data-testid="macro-control-resume" title="Resume paused run" onclick={() => macroControl('resume')}>Resume</button>
    <button type="button" data-testid="macro-control-stop" title="Stop active run" onclick={() => macroControl('stop')}>Stop</button>
  </div>

  <section class="macro-run-status" data-testid="macro-run-status">
    <div>
      <strong>{runner?.status ?? 'idle'}</strong>
      <span>{runner?.runId ?? 'no active run'}</span>
      {#if runner?.currentStepId}<span>step: {runner.currentStepId}</span>{/if}
      {#if runner?.pauseReason}<span>{runner.pauseReason.message}</span>{/if}
    </div>
    <button type="button" data-testid="macro-run-refresh" onclick={refreshRunner}>Refresh</button>
    {#if runner?.waitingInput}
      <div class="runner-input-line" data-testid="macro-run-input">
        <label>{runner.waitingInput.prompt}
          <input data-testid="macro-run-input-text" bind:value={runnerInput} onkeydown={(event) => { if (event.key === 'Enter') submitRunnerInput() }} />
        </label>
        <button type="button" data-testid="macro-run-input-submit" onclick={submitRunnerInput}>Send</button>
      </div>
    {/if}
  </section>

  <div class="macro-tabs" role="tablist" aria-label="Macro views">
    <button type="button" role="tab" aria-selected={macroView === 'editor'} class:active={macroView === 'editor'} data-testid="macro-tab-editor" onclick={() => { macroView = 'editor' }}>Editor</button>
    <button type="button" role="tab" aria-selected={macroView === 'json'} class:active={macroView === 'json'} data-testid="macro-tab-json" onclick={() => { macroView = 'json' }}>JSON</button>
  </div>

  {#if errorText}
    <div class="macro-error" role="alert">{errorText}</div>
  {/if}

  {#if macroView === 'editor'}
    <section class="macro-section">
      <div class="macro-section-title">
        <h3>Templates</h3>
      </div>
      <div class="template-list" data-testid="macro-template-list">
        {#each templates as template (template.id)}
          <button type="button" class:active={template.id === selectedTemplateId} data-testid="macro-template-item" onclick={() => selectTemplate(template.id)}>
            <span>{template.name}</span>
            <small>{template.stepCount} steps</small>
          </button>
        {/each}
        {#if templates.length === 0}<p class="empty-text">No templates yet.</p>{/if}
      </div>
      <div class="inline-actions" data-testid="macro-template-actions">
        <button type="button" data-testid="macro-save" onclick={saveTemplate} disabled={!draft}>Save</button>
        <button type="button" onclick={duplicateTemplate} disabled={!draft}>Duplicate</button>
        <button type="button" data-testid="macro-import" onclick={() => importInput?.click()}>Import</button>
        <button type="button" data-testid="macro-export" onclick={exportTemplate} disabled={!draft}>Export</button>
        <button type="button" data-testid="macro-delete" onclick={deleteTemplate} disabled={!draft}>Delete</button>
        <input class="hidden-file" data-testid="macro-import-file" type="file" accept="application/json,.json" bind:this={importInput} onchange={importTemplate} />
      </div>
    </section>

    {#if draft}
      <section class="macro-section">
        <div class="macro-section-title">
          <h3>Template</h3>
        </div>
        <label>Name
          <input data-testid="macro-name" value={draft.name} oninput={(event) => updateDraft((template) => { template.name = event.currentTarget.value })} />
        </label>
        <label>Description
          <textarea value={draft.description} oninput={(event) => updateDraft((template) => { template.description = event.currentTarget.value })}></textarea>
        </label>
        <code>{draft.id}</code>
      </section>

      <section class="macro-section">
        <div class="macro-section-title"><h3>Steps</h3></div>
        <div class="step-palette-grid">
          <div class="step-palette" data-testid="macro-actions-palette">
            <div class="palette-heading"><span>Actions</span><small>do work</small></div>
            <div class="step-actions">
              <button type="button" data-testid="add-step-send" onclick={() => addStep('send_line')}>send_line</button>
              <button type="button" data-testid="add-step-sleep" onclick={() => addStep('sleep')}>sleep</button>
              <button type="button" data-testid="add-step-input" onclick={() => addStep('input_line')}>input_line</button>
              <button type="button" data-testid="add-step-wait" onclick={() => addStep('wait')}>wait</button>
              <button type="button" data-testid="add-step-capture" onclick={() => addStep('capture-source')}>capture</button>
              <button type="button" data-testid="add-step-parse" onclick={() => addStep('parse')}>parse</button>
              <button type="button" data-testid="add-step-parallel" onclick={() => addStep('parallel_all')}>parallel_all</button>
            </div>
          </div>

          <div class="step-palette flow-palette" data-testid="macro-flow-palette">
            <div class="palette-heading"><span>Flow</span><small>structured V2</small></div>
            <div class="step-actions flow-v2-actions">
              <button type="button" class="flow-v2-button" data-testid="flow-v2-if" disabled title="Flow V2 block editor is not wired to the v1 runner yet">if</button>
              <button type="button" class="flow-v2-button" data-testid="flow-v2-elif" disabled title="Flow V2 block editor is not wired to the v1 runner yet">elif</button>
              <button type="button" class="flow-v2-button" data-testid="flow-v2-else" disabled title="Flow V2 block editor is not wired to the v1 runner yet">else</button>
              <button type="button" class="flow-v2-button" data-testid="flow-v2-for" disabled title="Flow V2 block editor is not wired to the v1 runner yet">for</button>
              <button type="button" class="flow-v2-button" data-testid="flow-v2-break" disabled title="Flow V2 block editor is not wired to the v1 runner yet">break</button>
              <button type="button" class="flow-v2-button" data-testid="flow-v2-continue" disabled title="Flow V2 block editor is not wired to the v1 runner yet">continue</button>
              <button type="button" class="flow-v2-button" data-testid="flow-v2-return" disabled title="Flow V2 block editor is not wired to the v1 runner yet">return</button>
            </div>
            <p class="hint">Flow V2 saves structured JSON; compiler/interpreter wiring is tracked separately.</p>
            <details class="legacy-flow-panel" data-testid="legacy-flow-panel">
              <summary>Legacy flow nodes</summary>
              <div class="step-actions legacy-step-actions">
                <button type="button" data-testid="add-step-branch" onclick={() => addStep('branch')}>branch</button>
                <button type="button" data-testid="add-step-goto" onclick={() => addStep('goto')}>goto</button>
                <button type="button" data-testid="add-step-pause" onclick={() => addStep('pause')}>pause</button>
                <button type="button" data-testid="add-step-complete" onclick={() => addStep('complete')}>complete</button>
                <button type="button" data-testid="add-step-fail" onclick={() => addStep('fail')}>fail</button>
                <button type="button" data-testid="add-step-stop" onclick={() => addStep('stop')}>stop</button>
              </div>
            </details>
          </div>
        </div>

        <div class="step-list" data-testid="macro-step-list">
          {#each draft.steps as step, index (step.id)}
            <article class="step-editor">
              <div class="step-title">
                <strong>{index + 1}. {step.type}{#if legacyFlowLabel(step)} <span class="legacy-badge" data-testid="legacy-flow-badge">{legacyFlowLabel(step)}</span>{/if}</strong>
                <div class="inline-actions">
                  <button type="button" onclick={() => moveStep(step.id, -1)}>Up</button>
                  <button type="button" onclick={() => moveStep(step.id, 1)}>Down</button>
                  <button type="button" onclick={() => removeStep(step.id)}>Remove</button>
                </div>
              </div>
              <div class="macro-row">
                <label>Step id
                  <input value={step.id} oninput={(event) => setStepId(step.id, event.currentTarget.value)} />
                </label>
                {#if 'next' in step}
                  <label>Next
                    <select value={step.next ?? ''} onchange={(event) => updateStep(step.id, (item) => { if ('next' in item) item.next = event.currentTarget.value || undefined })}>
                      <option value="">none</option>
                      {#each stepIds(draft) as stepId}<option value={stepId}>{stepId}</option>{/each}
                    </select>
                  </label>
                {/if}
              </div>

              {#if step.type === 'send_line'}
                <label>Terminal
                  <select data-testid="send-line-terminal" value={choiceFromTarget(step.terminal)} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'send_line') item.terminal = targetFromChoice(event.currentTarget.value) })}>
                    {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
                  </select>
                </label>
                <label>Text
                  <textarea data-testid="send-line-text" value={step.text} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'send_line') item.text = event.currentTarget.value })}></textarea>
                </label>
              {:else if step.type === 'sleep'}
                <div class="macro-row">
                  <label>Duration ms
                    <input data-testid="sleep-ms" type="number" value={step.durationMs} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'sleep') item.durationMs = Number(event.currentTarget.value) })} />
                  </label>
                  <label>Set as
                    <span class="duration-tools">
                      <input data-testid="sleep-unit-amount" type="number" min="1" value="1" oninput={(event) => setSleepFromUnit(step.id, event.currentTarget.value, (event.currentTarget.nextElementSibling as HTMLSelectElement).value)} />
                      <select data-testid="sleep-unit" onchange={(event) => { const input = event.currentTarget.previousElementSibling as HTMLInputElement; setSleepFromUnit(step.id, input.value, event.currentTarget.value) }}>
                        <option value="ms">ms</option><option value="s">s</option><option value="min">min</option><option value="h">h</option>
                      </select>
                    </span>
                  </label>
                </div>
              {:else if step.type === 'input_line'}
                <label>Terminal
                  <select data-testid="input-line-terminal" value={choiceFromTarget(step.terminal)} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'input_line') item.terminal = targetFromChoice(event.currentTarget.value) })}>
                    {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
                  </select>
                </label>
                <label>Prompt
                  <input value={step.prompt} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'input_line') item.prompt = event.currentTarget.value })} />
                </label>
                <label class="checkbox-row"><input type="checkbox" checked={step.allowEmpty} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'input_line') item.allowEmpty = event.currentTarget.checked })} />Allow empty</label>
              {:else if step.type === 'wait'}
                <label>Mode
                  <select value={step.mode} onchange={(event) => updateStep(step.id, (item, template) => { if (item.type === 'wait') Object.assign(item, waitStepForMode(template, item.id, event.currentTarget.value as WaitMode)) })}>
                    <option value="duration">duration</option><option value="capture-ready-or-user">capture-ready-or-user</option><option value="terminal-quiet">terminal-quiet</option><option value="user-continue">user-continue</option>
                  </select>
                </label>
                {#if step.mode === 'duration'}
                  <label>Duration ms
                    <input type="number" value={step.durationMs} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'wait' && item.mode === 'duration') item.durationMs = Number(event.currentTarget.value) })} />
                  </label>
                {:else if step.mode === 'capture-ready-or-user'}
                  <div class="macro-row">
                    <label>Capture step
                      <select value={step.captureStep} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'wait' && item.mode === 'capture-ready-or-user') item.captureStep = event.currentTarget.value })}>
                        {#each captureSteps(draft) as captureStep}<option value={captureStep.id}>{captureStep.id}</option>{/each}
                      </select>
                    </label>
                    <label>Timeout ms
                      <input type="number" value={step.timeoutMs} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'wait' && item.mode === 'capture-ready-or-user') item.timeoutMs = Number(event.currentTarget.value) })} />
                    </label>
                    <label>On timeout
                      <select value={step.onTimeout} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'wait' && item.mode === 'capture-ready-or-user') item.onTimeout = event.currentTarget.value as 'pause' | 'fail' })}>
                        <option value="pause">pause</option><option value="fail">fail</option>
                      </select>
                    </label>
                  </div>
                {:else if step.mode === 'terminal-quiet'}
                  <label>Terminal
                    <select value={choiceFromTarget(step.terminal)} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.terminal = targetFromChoice(event.currentTarget.value) })}>
                      {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
                    </select>
                  </label>
                  <div class="macro-row">
                    <label>Quiet ms<input type="number" value={step.quietMs} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.quietMs = Number(event.currentTarget.value) })} /></label>
                    <label>Max ms<input type="number" value={step.maxMs} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.maxMs = Number(event.currentTarget.value) })} /></label>
                    <label>On timeout
                      <select value={step.onTimeout} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.onTimeout = event.currentTarget.value as 'pause' | 'fail' })}>
                        <option value="pause">pause</option><option value="fail">fail</option>
                      </select>
                    </label>
                  </div>
                {:else}
                  <label>Prompt
                    <input value={step.prompt} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'wait' && item.mode === 'user-continue') item.prompt = event.currentTarget.value })} />
                  </label>
                {/if}
              {:else if step.type === 'capture-source'}
                <label>Capture kind
                  <select data-testid="capture-step-kind" value={step.capture.kind} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'capture-source') item.capture = defaultCaptureSource(event.currentTarget.value as CaptureSourceConfig['kind']) })}>
                    <option value="terminal-buffer">terminal-buffer</option><option value="agent-event">agent-event</option>
                  </select>
                </label>
                <label>Terminal
                  <select data-testid="capture-step-terminal" value={choiceFromTarget(step.capture.terminal)} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'capture-source') item.capture.terminal = targetFromChoice(event.currentTarget.value) })}>
                    {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
                  </select>
                </label>
                {#if step.capture.kind === 'terminal-buffer'}
                  <label>Max chars
                    <input type="number" value={step.capture.maxChars} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'capture-source' && item.capture.kind === 'terminal-buffer') item.capture.maxChars = Number(event.currentTarget.value) })} />
                  </label>
                {:else}
                  <p class="hint">codex / agent.output / codex-stop-hook</p>
                {/if}
              {:else if step.type === 'parse'}
                <label>Capture step
                  <select data-testid="parse-step-source" value={step.captureStep} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'parse') item.captureStep = event.currentTarget.value })}>
                    {#each captureSteps(draft) as captureStep}<option value={captureStep.id}>{captureStep.id}</option>{/each}
                  </select>
                </label>
                <label>Parser
                  <select value={step.parser.kind} onchange={(event) => setParserKind(step.id, event.currentTarget.value as ParserConfig['kind'])}>
                    <option value="regex">regex</option><option value="ai-json">ai-json</option>
                  </select>
                </label>
                {#if step.parser.kind === 'ai-json'}
                  <label>Profile
                    <select value={step.parser.profileId} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'parse' && item.parser.kind === 'ai-json') item.parser.profileId = event.currentTarget.value })}>
                      {#each catalog?.profiles ?? [] as profile}<option value={profile.profileId}>{profile.name}</option>{/each}
                    </select>
                  </label>
                  <p class="hint">{profileFor(step)?.signals.map((signal) => signal.id).join(', ')}</p>
                {:else}
                  <div class="rule-list">
                    {#each step.parser.rules as rule, ruleIndex}
                      <div class="macro-row regex-rule-row">
                        <input aria-label="signal" value={rule.signal} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].signal = event.currentTarget.value })} />
                        <input aria-label="pattern" value={rule.pattern} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].pattern = event.currentTarget.value })} />
                        <input aria-label="flags" value={rule.flags ?? ''} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].flags = event.currentTarget.value })} />
                        <select aria-label="on match" value={stringFromBooleanNull(rule.onMatch)} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].onMatch = booleanNullFromString(event.currentTarget.value) })}>
                          <option value="true">match true</option><option value="false">match false</option><option value="null">match null</option>
                        </select>
                        <select aria-label="on no match" value={stringFromBooleanNull(rule.onNoMatch)} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].onNoMatch = booleanNullFromString(event.currentTarget.value) })}>
                          <option value="true">miss true</option><option value="false">miss false</option><option value="null">miss null</option>
                        </select>
                        <button type="button" onclick={() => removeRegexRule(step.id, ruleIndex)}>Remove</button>
                      </div>
                    {/each}
                    <button type="button" onclick={() => addRegexRule(step.id)}>Add rule</button>
                  </div>
                {/if}
              {:else if step.type === 'branch'}
                <label>From parse step
                  <select value={step.fromParseStep} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'branch') item.fromParseStep = event.currentTarget.value })}>
                    {#each parseSteps(draft) as parseStep}<option value={parseStep.id}>{parseStep.id}</option>{/each}
                  </select>
                </label>
                {#each step.conditions as condition, conditionIndex}
                  <div class="condition-row">
                    <select value={condition.signal} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'branch') item.conditions[conditionIndex].signal = event.currentTarget.value })}>
                      {#each parseSignals(draft, step.fromParseStep) as signal}<option value={signal.id}>{signal.id}</option>{/each}
                    </select>
                    <select value={condition.op} onchange={(event) => updateStep(step.id, (item) => {
                      if (item.type !== 'branch') return
                      const nextOp = event.currentTarget.value as BranchCondition['op']
                      item.conditions[conditionIndex].op = nextOp
                      if (nextOp === 'is_null') delete item.conditions[conditionIndex].value
                      else item.conditions[conditionIndex].value = item.conditions[conditionIndex].value ?? true
                    })}>
                      <option value="==">==</option><option value="!=">!=</option><option value="is_null">is_null</option>
                    </select>
                    {#if condition.op !== 'is_null'}
                      <select value={String(condition.value)} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'branch') item.conditions[conditionIndex].value = event.currentTarget.value === 'true' })}>
                        <option value="true">true</option><option value="false">false</option>
                      </select>
                    {/if}
                    <select value={condition.goto} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'branch') item.conditions[conditionIndex].goto = event.currentTarget.value })}>
                      {#each stepIds(draft) as stepId}<option value={stepId}>{stepId}</option>{/each}
                    </select>
                    <button type="button" onclick={() => removeBranchCondition(step.id, conditionIndex)}>Remove</button>
                  </div>
                {/each}
                <button type="button" onclick={() => addBranchCondition(step.id)}>Add condition</button>
                <label>Else
                  <select value={step.else ?? ''} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'branch') item.else = event.currentTarget.value || undefined })}>
                    <option value="">none</option>{#each stepIds(draft) as stepId}<option value={stepId}>{stepId}</option>{/each}
                  </select>
                </label>
              {:else if step.type === 'parallel_all'}
                <div class="parallel-lane-editor" data-testid="parallel-all-editor">
                  <div class="macro-row">
                    <label>On lane fail
                      <select value={step.join.onLaneFail} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'parallel_all') item.join.onLaneFail = event.currentTarget.value as 'pause' | 'fail' })}>
                        <option value="pause">pause</option><option value="fail">fail</option>
                      </select>
                    </label>
                    <label>On timeout
                      <select value={step.join.onTimeout ?? 'pause'} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'parallel_all') item.join.onTimeout = event.currentTarget.value as 'pause' | 'fail' })}>
                        <option value="pause">pause</option><option value="fail">fail</option>
                      </select>
                    </label>
                  </div>
                  {#each step.lanes as lane (lane.id)}
                    <div class="parallel-lane-row">
                      <input aria-label="lane id" value={lane.id} oninput={(event) => updateParallelLane(step.id, lane.id, (item) => { item.id = event.currentTarget.value })} />
                      <select aria-label="lane terminal" value={choiceFromTarget(lane.terminal)} onchange={(event) => updateParallelLane(step.id, lane.id, (item) => { item.terminal = targetFromChoice(event.currentTarget.value) })}>
                        {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
                      </select>
                      <span>{lane.steps.length} lane steps</span>
                      <span>{lane.success.conditions.length} conditions</span>
                      <button type="button" onclick={() => removeParallelLane(step.id, lane.id)}>Remove</button>
                    </div>
                  {/each}
                  <button type="button" onclick={() => addParallelLane(step.id)}>Add lane</button>
                </div>
              {:else if step.type === 'goto'}
                <label>Goto
                  <select value={step.goto} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'goto') item.goto = event.currentTarget.value })}>
                    {#each stepIds(draft) as stepId}<option value={stepId}>{stepId}</option>{/each}
                  </select>
                </label>
                <div class="macro-row">
                  <label>Max iterations<input type="number" value={step.loopGuard?.maxIterations ?? 5} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'goto') item.loopGuard = { maxIterations: Number(event.currentTarget.value), onLimit: item.loopGuard?.onLimit ?? 'pause' } })} /></label>
                  <label>On limit
                    <select value={step.loopGuard?.onLimit ?? 'pause'} onchange={(event) => updateStep(step.id, (item) => { if (item.type === 'goto') item.loopGuard = { maxIterations: item.loopGuard?.maxIterations ?? 5, onLimit: event.currentTarget.value as 'pause' | 'fail' } })}>
                      <option value="pause">pause</option><option value="fail">fail</option>
                    </select>
                  </label>
                </div>
              {:else}
                <label>Reason
                  <input value={step.reason ?? ''} oninput={(event) => updateStep(step.id, (item) => { if (item.type === 'pause' || item.type === 'fail' || item.type === 'stop') item.reason = event.currentTarget.value || undefined })} />
                </label>
              {/if}
            </article>
          {/each}
        </div>
      </section>

      <section class="macro-section">
        <div class="macro-section-title"><h3>Validation</h3><span class:ok={validation.ok}>{validation.ok ? 'OK' : validation.issues.length + ' issues'}</span></div>
        {#if validation.issues.length > 0}
          <ul class="validation-list" data-testid="macro-validation">
            {#each validation.issues as issue}<li><code>{issue.path}</code> {issue.message}</li>{/each}
          </ul>
        {/if}
      </section>
    {/if}
  {:else}
    <section class="macro-section macro-json-section" data-testid="macro-json-view">
      <div class="macro-section-title">
        <h3>JSON</h3>
        <div class="inline-actions">
          <button type="button" data-testid="macro-save-json" onclick={saveTemplate} disabled={!draft || !validation.ok}>Save</button>
          <button type="button" data-testid="macro-export-json" onclick={exportTemplate} disabled={!draft}>Export</button>
        </div>
      </div>
      {#if draft}<pre data-testid="macro-json-preview">{jsonPreview}</pre>{:else}<p class="empty-text">No template selected.</p>{/if}
    </section>
  {/if}
</aside>
