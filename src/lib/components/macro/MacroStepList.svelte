<script lang="ts">
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

  type WaitMode = Extract<MacroStep, { type: 'wait' }>['mode']
  type TerminalChoice = { value: string; label: string }

  let {
    draft,
    validation,
    catalog,
    moveStep,
    removeStep,
    setStepId,
    updateStep,
    stepIds,
    legacyFlowLabel,
    terminalChoices,
    choiceFromTarget,
    targetFromChoice,
    setSleepFromUnit,
    waitStepForMode,
    captureSteps,
    defaultCaptureSource,
    setParserKind,
    profileFor,
    addRegexRule,
    removeRegexRule,
    parseSteps,
    parseSignals,
    stringFromBooleanNull,
    booleanNullFromString,
    addBranchCondition,
    removeBranchCondition,
    updateParallelLane,
    removeParallelLane,
    addParallelLane,
  } = $props<{
    draft: MacroTemplate | null
    validation: ValidationResult
    catalog: ProfileCatalogSummary | null
    moveStep: (stepId: string, offset: number) => void
    removeStep: (stepId: string) => void
    setStepId: (oldId: string, nextId: string) => void
    updateStep: (stepId: string, mutator: (step: MacroStep, template: MacroTemplate) => void) => void
    stepIds: (template: MacroTemplate) => string[]
    legacyFlowLabel: (step: MacroStep) => string | null
    terminalChoices: () => TerminalChoice[]
    choiceFromTarget: (target: TerminalTarget) => string
    targetFromChoice: (choice: string) => TerminalTarget
    setSleepFromUnit: (stepId: string, rawValue: string, unit: string) => void
    waitStepForMode: (template: MacroTemplate, id: string, mode: WaitMode) => Extract<MacroStep, { type: 'wait' }>
    captureSteps: (template: MacroTemplate) => Array<Extract<MacroStep, { type: 'capture-source' }>>
    defaultCaptureSource: (kind: CaptureSourceConfig['kind']) => CaptureSourceConfig
    setParserKind: (stepId: string, kind: ParserConfig['kind']) => void
    profileFor: (step: Extract<MacroStep, { type: 'parse' }>) => ProfileSummary | undefined
    addRegexRule: (stepId: string) => void
    removeRegexRule: (stepId: string, ruleIndex: number) => void
    parseSteps: (template: MacroTemplate) => Array<Extract<MacroStep, { type: 'parse' }>>
    parseSignals: (template: MacroTemplate, parseStepId: string) => SignalSummary[]
    stringFromBooleanNull: (value: boolean | null) => string
    booleanNullFromString: (value: string) => boolean | null
    addBranchCondition: (stepId: string) => void
    removeBranchCondition: (stepId: string, conditionIndex: number) => void
    updateParallelLane: (stepId: string, laneId: string, mutator: (lane: ParallelLane) => void) => void
    removeParallelLane: (stepId: string, laneId: string) => void
    addParallelLane: (stepId: string) => void
  }>()
</script>

        {#if draft}
      <section class="macro-section">
        <div class="macro-section-title"><h3>Steps</h3></div>
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
                    <select value={step.next ?? ''} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if ('next' in item) item.next = event.currentTarget.value || undefined })}>
                      <option value="">none</option>
                      {#each stepIds(draft) as stepId}<option value={stepId}>{stepId}</option>{/each}
                    </select>
                  </label>
                {/if}
              </div>

              {#if step.type === 'send_line'}
                <label>Terminal
                  <select data-testid="send-line-terminal" value={choiceFromTarget(step.terminal)} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'send_line') item.terminal = targetFromChoice(event.currentTarget.value) })}>
                    {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
                  </select>
                </label>
                <label>Text
                  <textarea data-testid="send-line-text" value={step.text} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'send_line') item.text = event.currentTarget.value })}></textarea>
                </label>
              {:else if step.type === 'sleep'}
                <div class="macro-row">
                  <label>Duration ms
                    <input data-testid="sleep-ms" type="number" value={step.durationMs} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'sleep') item.durationMs = Number(event.currentTarget.value) })} />
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
                  <select data-testid="input-line-terminal" value={choiceFromTarget(step.terminal)} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'input_line') item.terminal = targetFromChoice(event.currentTarget.value) })}>
                    {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
                  </select>
                </label>
                <label>Prompt
                  <input value={step.prompt} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'input_line') item.prompt = event.currentTarget.value })} />
                </label>
                <label class="checkbox-row"><input type="checkbox" checked={step.allowEmpty} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'input_line') item.allowEmpty = event.currentTarget.checked })} />Allow empty</label>
              {:else if step.type === 'wait'}
                <label>Mode
                  <select value={step.mode} onchange={(event) => updateStep(step.id, (item: MacroStep, template: MacroTemplate) => { if (item.type === 'wait') Object.assign(item, waitStepForMode(template, item.id, event.currentTarget.value as WaitMode)) })}>
                    <option value="duration">duration</option><option value="capture-ready-or-user">capture-ready-or-user</option><option value="terminal-quiet">terminal-quiet</option><option value="user-continue">user-continue</option>
                  </select>
                </label>
                {#if step.mode === 'duration'}
                  <label>Duration ms
                    <input type="number" value={step.durationMs} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'wait' && item.mode === 'duration') item.durationMs = Number(event.currentTarget.value) })} />
                  </label>
                {:else if step.mode === 'capture-ready-or-user'}
                  <div class="macro-row">
                    <label>Capture step
                      <select value={step.captureStep} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'wait' && item.mode === 'capture-ready-or-user') item.captureStep = event.currentTarget.value })}>
                        {#each captureSteps(draft) as captureStep}<option value={captureStep.id}>{captureStep.id}</option>{/each}
                      </select>
                    </label>
                    <label>Timeout ms
                      <input type="number" value={step.timeoutMs} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'wait' && item.mode === 'capture-ready-or-user') item.timeoutMs = Number(event.currentTarget.value) })} />
                    </label>
                    <label>On timeout
                      <select value={step.onTimeout} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'wait' && item.mode === 'capture-ready-or-user') item.onTimeout = event.currentTarget.value as 'pause' | 'fail' })}>
                        <option value="pause">pause</option><option value="fail">fail</option>
                      </select>
                    </label>
                  </div>
                {:else if step.mode === 'terminal-quiet'}
                  <label>Terminal
                    <select value={choiceFromTarget(step.terminal)} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.terminal = targetFromChoice(event.currentTarget.value) })}>
                      {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
                    </select>
                  </label>
                  <div class="macro-row">
                    <label>Quiet ms<input type="number" value={step.quietMs} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.quietMs = Number(event.currentTarget.value) })} /></label>
                    <label>Max ms<input type="number" value={step.maxMs} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.maxMs = Number(event.currentTarget.value) })} /></label>
                    <label>On timeout
                      <select value={step.onTimeout} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.onTimeout = event.currentTarget.value as 'pause' | 'fail' })}>
                        <option value="pause">pause</option><option value="fail">fail</option>
                      </select>
                    </label>
                  </div>
                {:else}
                  <label>Prompt
                    <input value={step.prompt} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'wait' && item.mode === 'user-continue') item.prompt = event.currentTarget.value })} />
                  </label>
                {/if}
              {:else if step.type === 'capture-source'}
                <label>Capture kind
                  <select data-testid="capture-step-kind" value={step.capture.kind} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'capture-source') item.capture = defaultCaptureSource(event.currentTarget.value as CaptureSourceConfig['kind']) })}>
                    <option value="terminal-buffer">terminal-buffer</option><option value="agent-event">agent-event</option>
                  </select>
                </label>
                <label>Terminal
                  <select data-testid="capture-step-terminal" value={choiceFromTarget(step.capture.terminal)} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'capture-source') item.capture.terminal = targetFromChoice(event.currentTarget.value) })}>
                    {#each terminalChoices() as choice}<option value={choice.value}>{choice.label}</option>{/each}
                  </select>
                </label>
                {#if step.capture.kind === 'terminal-buffer'}
                  <label>Max chars
                    <input type="number" value={step.capture.maxChars} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'capture-source' && item.capture.kind === 'terminal-buffer') item.capture.maxChars = Number(event.currentTarget.value) })} />
                  </label>
                {:else}
                  <p class="hint">codex / agent.output / codex-stop-hook</p>
                {/if}
              {:else if step.type === 'parse'}
                <label>Capture step
                  <select data-testid="parse-step-source" value={step.captureStep} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'parse') item.captureStep = event.currentTarget.value })}>
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
                    <select value={step.parser.profileId} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'parse' && item.parser.kind === 'ai-json') item.parser.profileId = event.currentTarget.value })}>
                      {#each catalog?.profiles ?? [] as profile}<option value={profile.profileId}>{profile.name}</option>{/each}
                    </select>
                  </label>
                  <p class="hint">{profileFor(step)?.signals.map((signal: SignalSummary) => signal.id).join(', ')}</p>
                {:else}
                  <div class="rule-list">
                    {#each step.parser.rules as rule, ruleIndex}
                      <div class="macro-row regex-rule-row">
                        <input aria-label="signal" value={rule.signal} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].signal = event.currentTarget.value })} />
                        <input aria-label="pattern" value={rule.pattern} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].pattern = event.currentTarget.value })} />
                        <input aria-label="flags" value={rule.flags ?? ''} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].flags = event.currentTarget.value })} />
                        <select aria-label="on match" value={stringFromBooleanNull(rule.onMatch)} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].onMatch = booleanNullFromString(event.currentTarget.value) })}>
                          <option value="true">match true</option><option value="false">match false</option><option value="null">match null</option>
                        </select>
                        <select aria-label="on no match" value={stringFromBooleanNull(rule.onNoMatch)} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'parse' && item.parser.kind === 'regex') item.parser.rules[ruleIndex].onNoMatch = booleanNullFromString(event.currentTarget.value) })}>
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
                  <select value={step.fromParseStep} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'branch') item.fromParseStep = event.currentTarget.value })}>
                    {#each parseSteps(draft) as parseStep}<option value={parseStep.id}>{parseStep.id}</option>{/each}
                  </select>
                </label>
                {#each step.conditions as condition, conditionIndex}
                  <div class="condition-row">
                    <select value={condition.signal} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'branch') item.conditions[conditionIndex].signal = event.currentTarget.value })}>
                      {#each parseSignals(draft, step.fromParseStep) as signal}<option value={signal.id}>{signal.id}</option>{/each}
                    </select>
                    <select value={condition.op} onchange={(event) => updateStep(step.id, (item: MacroStep) => {
                      if (item.type !== 'branch') return
                      const nextOp = event.currentTarget.value as BranchCondition['op']
                      item.conditions[conditionIndex].op = nextOp
                      if (nextOp === 'is_null') delete item.conditions[conditionIndex].value
                      else item.conditions[conditionIndex].value = item.conditions[conditionIndex].value ?? true
                    })}>
                      <option value="==">==</option><option value="!=">!=</option><option value="is_null">is_null</option>
                    </select>
                    {#if condition.op !== 'is_null'}
                      <select value={String(condition.value)} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'branch') item.conditions[conditionIndex].value = event.currentTarget.value === 'true' })}>
                        <option value="true">true</option><option value="false">false</option>
                      </select>
                    {/if}
                    <select value={condition.goto} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'branch') item.conditions[conditionIndex].goto = event.currentTarget.value })}>
                      {#each stepIds(draft) as stepId}<option value={stepId}>{stepId}</option>{/each}
                    </select>
                    <button type="button" onclick={() => removeBranchCondition(step.id, conditionIndex)}>Remove</button>
                  </div>
                {/each}
                <button type="button" onclick={() => addBranchCondition(step.id)}>Add condition</button>
                <label>Else
                  <select value={step.else ?? ''} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'branch') item.else = event.currentTarget.value || undefined })}>
                    <option value="">none</option>{#each stepIds(draft) as stepId}<option value={stepId}>{stepId}</option>{/each}
                  </select>
                </label>
              {:else if step.type === 'parallel_all'}
                <div class="parallel-lane-editor" data-testid="parallel-all-editor">
                  <div class="macro-row">
                    <label>On lane fail
                      <select value={step.join.onLaneFail} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'parallel_all') item.join.onLaneFail = event.currentTarget.value as 'pause' | 'fail' })}>
                        <option value="pause">pause</option><option value="fail">fail</option>
                      </select>
                    </label>
                    <label>On timeout
                      <select value={step.join.onTimeout ?? 'pause'} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'parallel_all') item.join.onTimeout = event.currentTarget.value as 'pause' | 'fail' })}>
                        <option value="pause">pause</option><option value="fail">fail</option>
                      </select>
                    </label>
                  </div>
                  {#each step.lanes as lane (lane.id)}
                    <div class="parallel-lane-row">
                      <input aria-label="lane id" value={lane.id} oninput={(event) => updateParallelLane(step.id, lane.id, (item: ParallelLane) => { item.id = event.currentTarget.value })} />
                      <select aria-label="lane terminal" value={choiceFromTarget(lane.terminal)} onchange={(event) => updateParallelLane(step.id, lane.id, (item: ParallelLane) => { item.terminal = targetFromChoice(event.currentTarget.value) })}>
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
                  <select value={step.goto} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'goto') item.goto = event.currentTarget.value })}>
                    {#each stepIds(draft) as stepId}<option value={stepId}>{stepId}</option>{/each}
                  </select>
                </label>
                <div class="macro-row">
                  <label>Max iterations<input type="number" value={step.loopGuard?.maxIterations ?? 5} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'goto') item.loopGuard = { maxIterations: Number(event.currentTarget.value), onLimit: item.loopGuard?.onLimit ?? 'pause' } })} /></label>
                  <label>On limit
                    <select value={step.loopGuard?.onLimit ?? 'pause'} onchange={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'goto') item.loopGuard = { maxIterations: item.loopGuard?.maxIterations ?? 5, onLimit: event.currentTarget.value as 'pause' | 'fail' } })}>
                      <option value="pause">pause</option><option value="fail">fail</option>
                    </select>
                  </label>
                </div>
              {:else}
                <label>Reason
                  <input value={step.reason ?? ''} oninput={(event) => updateStep(step.id, (item: MacroStep) => { if (item.type === 'pause' || item.type === 'fail' || item.type === 'stop') item.reason = event.currentTarget.value || undefined })} />
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
