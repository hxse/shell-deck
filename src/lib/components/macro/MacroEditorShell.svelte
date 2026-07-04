<script lang="ts">
  import type { TerminalIndexMapItem, TerminalSnapshot } from '../../protocol'
  import type { ProfileCatalogSummary, ProfileSummary, SignalSummary } from '../../macro/profileCatalogSummary'
  import type {
    BranchCondition,
    CaptureSourceConfig,
    MacroStep,
    MacroTemplate,
    ParallelLane,
    ParserConfig,
    TerminalTarget,
    ValidationResult,
  } from '../../macro/templateTypes'
  import MacroActionPalette from './MacroActionPalette.svelte'
  import MacroStepList from './MacroStepList.svelte'

  type WaitMode = Extract<MacroStep, { type: 'wait' }>['mode']

  let { draft = $bindable<MacroTemplate | null>(), catalog, terminals, indexMap, validation, macroControl } = $props<{
    draft: MacroTemplate | null
    catalog: ProfileCatalogSummary | null
    terminals: TerminalSnapshot[]
    indexMap: TerminalIndexMapItem[]
    validation: ValidationResult
    macroControl: (action: 'start' | 'pause' | 'resume' | 'stop') => void
  }>()

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
    return catalog?.profiles.find((profile: ProfileSummary) => profile.profileId === parser.profileId)?.signals ?? []
  }

  function profileFor(step: Extract<MacroStep, { type: 'parse' }>): ProfileSummary | undefined {
    const parser = step.parser
    return parser.kind === 'ai-json' ? catalog?.profiles.find((profile: ProfileSummary) => profile.profileId === parser.profileId) : undefined
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
</script>

<div class="macro-editor-layout" data-testid="macro-editor-layout">
  <div class="macro-editor-main" data-testid="macro-editor-main">
    <MacroStepList
      {draft}
      {validation}
      {catalog}
      {moveStep}
      {removeStep}
      {setStepId}
      {updateStep}
      {stepIds}
      {legacyFlowLabel}
      {terminalChoices}
      {choiceFromTarget}
      {targetFromChoice}
      {setSleepFromUnit}
      {waitStepForMode}
      {captureSteps}
      {defaultCaptureSource}
      {setParserKind}
      {profileFor}
      {addRegexRule}
      {removeRegexRule}
      {parseSteps}
      {parseSignals}
      {stringFromBooleanNull}
      {booleanNullFromString}
      {addBranchCondition}
      {removeBranchCondition}
      {updateParallelLane}
      {removeParallelLane}
      {addParallelLane}
    />
  </div>

  <MacroActionPalette {draft} {addStep} {macroControl} />
</div>
