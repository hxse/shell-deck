<script lang="ts">
  import type {
    JsonMatchCondition,
    JsonMatchKind,
    MacroCondition,
    SimpleTextMatchOp,
    TextMatchCondition,
  } from '../../macro/macroDefinitionTypes'
  import {
    artifactSourceFromKey,
    artifactSourceKey,
    jsonArtifactChoices,
    jsonArtifactSourceFromKey,
    type ArtifactChoice,
  } from '../../macro/macroArtifactChoices'
  import {
    defaultJsonMatchCondition,
    defaultTextMatchCondition,
    unassignedArtifactSource,
  } from '../../macro/macroEditorDefaults'
  import type { JsonScalar } from '../../macro/structuredJson'

  let { condition, choices, onChange } = $props<{
    condition: MacroCondition
    choices: ArtifactChoice[]
    onChange: (condition: MacroCondition) => void
  }>()

  function setKind(kind: MacroCondition['kind']): void {
    onChange(kind === 'json_match'
      ? defaultJsonMatchCondition(unassignedArtifactSource())
      : defaultTextMatchCondition(unassignedArtifactSource()))
  }

  function setSimpleMatcherOp(item: TextMatchCondition, op: SimpleTextMatchOp): void {
    if (item.matcher.kind === 'simple') {
      onChange({ ...item, matcher: { kind: 'simple', op, text: item.matcher.text } })
    }
  }

  function setSimpleMatcherText(item: TextMatchCondition, text: string): void {
    if (item.matcher.kind === 'simple') {
      onChange({ ...item, matcher: { kind: 'simple', op: item.matcher.op, text } })
    }
  }

  function setRegexMatcher(item: TextMatchCondition, field: 'pattern' | 'flags', value: string): void {
    if (item.matcher.kind !== 'regex') return
    onChange({
      ...item,
      matcher: {
        kind: 'regex',
        pattern: field === 'pattern' ? value : item.matcher.pattern,
        flags: field === 'flags' ? value : item.matcher.flags,
      },
    })
  }

  function setJsonMatcherKind(item: JsonMatchCondition, kind: JsonMatchKind): void {
    const matcher = kind === 'exists' || kind === 'not_exists'
      ? { kind } as const
      : kind === 'equals' || kind === 'not_equals'
        ? { kind, value: '' } as const
        : { kind, value: 0 } as const
    onChange({ ...item, matcher })
  }

  function jsonScalarType(value: JsonScalar): 'string' | 'number' | 'boolean' | 'null' {
    if (value === null) return 'null'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    return 'string'
  }

  function scalarForType(type: string): JsonScalar {
    if (type === 'number') return 0
    if (type === 'boolean') return true
    if (type === 'null') return null
    return ''
  }

  function setJsonScalar(item: JsonMatchCondition, value: JsonScalar): void {
    if (item.matcher.kind === 'equals' || item.matcher.kind === 'not_equals') {
      onChange({ ...item, matcher: { ...item.matcher, value } })
    }
  }

  function setJsonNumber(item: JsonMatchCondition, value: number): void {
    if (
      item.matcher.kind === 'less_than'
      || item.matcher.kind === 'less_than_or_equal'
      || item.matcher.kind === 'greater_than'
      || item.matcher.kind === 'greater_than_or_equal'
    ) {
      onChange({ ...item, matcher: { ...item.matcher, value } })
    }
  }
</script>

<label>Condition kind
  <select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-kind" value={condition.kind} onchange={(event) => setKind(event.currentTarget.value as MacroCondition['kind'])}>
    <option value="text_match">text match</option>
    <option value="json_match">JSON match</option>
  </select>
</label>

{#if condition.kind === 'text_match'}
  <div class="condition-row grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-2">
    <label>Source<select class="select box-border select-xs select-ghost w-full bg-base-content/15" class:select-warning={condition.source.kind === 'unassigned'} data-testid="condition-source" class:artifact-source-unassigned={condition.source.kind === 'unassigned'} value={artifactSourceKey(condition.source)} onchange={(event) => onChange({ ...condition, source: artifactSourceFromKey(event.currentTarget.value) })}><option value="">Unassigned</option>{#each choices as choice}<option value={artifactSourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
    <label>Matcher<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-matcher-kind" value={condition.matcher.kind} onchange={(event) => onChange({ ...condition, matcher: event.currentTarget.value === 'regex' ? { kind: 'regex', pattern: 'READY', flags: 'i' } : { kind: 'simple', op: 'contains', text: 'READY' } })}><option value="simple">simple</option><option value="regex">regex</option></select></label>
    {#if condition.matcher.kind === 'simple'}
      <label>Op<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-simple-op" value={condition.matcher.op} onchange={(event) => setSimpleMatcherOp(condition, event.currentTarget.value as SimpleTextMatchOp)}><option value="contains">contains</option><option value="not_contains">not_contains</option><option value="equals">equals</option><option value="not_equals">not_equals</option><option value="starts_with">starts_with</option><option value="ends_with">ends_with</option></select></label>
      <label>Text<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-simple-text" value={condition.matcher.text} oninput={(event) => setSimpleMatcherText(condition, event.currentTarget.value)} /></label>
    {:else}
      <label>Pattern<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-regex-pattern" value={condition.matcher.pattern} oninput={(event) => setRegexMatcher(condition, 'pattern', event.currentTarget.value)} /></label>
      <label>Flags<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-regex-flags" value={condition.matcher.flags ?? ''} oninput={(event) => setRegexMatcher(condition, 'flags', event.currentTarget.value)} /></label>
    {/if}
    <label>Scope<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-scope" value={condition.scope.kind === 'lines' ? 'lines:' + condition.scope.mode : 'whole'} onchange={(event) => { const value = event.currentTarget.value; onChange({ ...condition, scope: value === 'whole' ? { kind: 'whole' } : { kind: 'lines', mode: value.split(':')[1] as never, includeEmptyLines: false } }) }}><option value="whole">whole</option><option value="lines:first">lines.first</option><option value="lines:last">lines.last</option><option value="lines:any">lines.any</option><option value="lines:all">lines.all</option></select></label>
  </div>
  {#if condition.source.kind === 'unassigned'}<small class="artifact-source-warning text-[11px] leading-snug text-warning" data-testid="condition-source-warning">Source is unassigned. Save is allowed, but Start requires an earlier compatible output.</small>{/if}
{:else}
  <div class="condition-row grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-2">
    <label>JSON source<select class="select box-border select-xs select-ghost w-full bg-base-content/15" class:select-warning={condition.source.kind === 'unassigned'} data-testid="condition-json-source" value={artifactSourceKey(condition.source)} onchange={(event) => onChange({ ...condition, source: jsonArtifactSourceFromKey(event.currentTarget.value) })}><option value="">Unassigned</option>{#each jsonArtifactChoices(choices) as choice}<option value={artifactSourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
    <label>JSON Pointer<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-json-pointer" value={condition.pointer} placeholder="/decision" oninput={(event) => onChange({ ...condition, pointer: event.currentTarget.value })} /></label>
    <label>Matcher<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-json-matcher-kind" value={condition.matcher.kind} onchange={(event) => setJsonMatcherKind(condition, event.currentTarget.value as JsonMatchKind)}><option value="exists">exists</option><option value="not_exists">not exists</option><option value="equals">equals</option><option value="not_equals">not equals</option><option value="less_than">less than</option><option value="less_than_or_equal">less than or equal</option><option value="greater_than">greater than</option><option value="greater_than_or_equal">greater than or equal</option></select></label>
    {#if condition.matcher.kind === 'equals' || condition.matcher.kind === 'not_equals'}
      <label>Value type<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-json-value-type" value={jsonScalarType(condition.matcher.value)} onchange={(event) => setJsonScalar(condition, scalarForType(event.currentTarget.value))}><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="null">null</option></select></label>
      {#if typeof condition.matcher.value === 'string'}<label>Value<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-json-string-value" value={condition.matcher.value} oninput={(event) => setJsonScalar(condition, event.currentTarget.value)} /></label>
      {:else if typeof condition.matcher.value === 'number'}<label>Value<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-json-number-value" type="number" value={condition.matcher.value} oninput={(event) => setJsonScalar(condition, Number(event.currentTarget.value))} /></label>
      {:else if typeof condition.matcher.value === 'boolean'}<label>Value<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-json-boolean-value" value={String(condition.matcher.value)} onchange={(event) => setJsonScalar(condition, event.currentTarget.value === 'true')}><option value="true">true</option><option value="false">false</option></select></label>
      {:else}<p class="hint">Value: null</p>{/if}
    {:else if condition.matcher.kind !== 'exists' && condition.matcher.kind !== 'not_exists'}
      <label>Value<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-json-number-value" type="number" value={condition.matcher.value} oninput={(event) => setJsonNumber(condition, Number(event.currentTarget.value))} /></label>
    {/if}
  </div>
  {#if condition.source.kind === 'unassigned'}<small class="artifact-source-warning text-[11px] leading-snug text-warning" data-testid="condition-json-source-warning">JSON source is unassigned. Save is allowed, but Start requires an earlier structured JSON output.</small>{/if}
{/if}
