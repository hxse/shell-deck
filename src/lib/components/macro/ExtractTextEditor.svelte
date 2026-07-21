<script lang="ts">
  import type {
    FlowV2Node,
    ParallelLaneActionNode,
    SimpleTextMatchOp,
  } from '../../macro/macroDefinitionTypes'
  import {
    artifactSourceFromKey,
    artifactSourceKey,
    type ArtifactChoice,
  } from '../../macro/macroArtifactChoices'
  import { defaultTextFilter } from '../../macro/macroEditorDefaults'
  import MacroIconButton from './MacroIconButton.svelte'

  export type EditableExtractTextNode =
    | Extract<FlowV2Node, { type: 'extract_text' }>
    | Extract<ParallelLaneActionNode, { type: 'extract_text' }>

  let { variant, node, choices, onUpdate } = $props<{
    variant: 'root' | 'parallel'
    node: EditableExtractTextNode
    choices: ArtifactChoice[]
    onUpdate: (mutator: (item: EditableExtractTextNode) => void) => void
  }>()

  function groupInputValue(group: string | number): string {
    return String(group)
  }

  function groupFromInput(value: string): string | number {
    return /^\d+$/.test(value) ? Number(value) : value
  }

  function addTextFilter(): void {
    onUpdate((item: EditableExtractTextNode) => { item.filters.push(defaultTextFilter()) })
  }

  function removeTextFilter(index: number): void {
    onUpdate((item: EditableExtractTextNode) => { item.filters.splice(index, 1) })
  }
</script>

{#if variant === 'root'}
  <label>Source
    <select data-testid="extract-text-source" class:artifact-source-unassigned={node.source.kind === 'unassigned'} value={artifactSourceKey(node.source)} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.source = artifactSourceFromKey(event.currentTarget.value) })}>
      <option value="">Unassigned</option>
      {#each choices as choice}<option value={artifactSourceKey(choice.source)}>{choice.label}</option>{/each}
    </select>
  </label>
  {#if node.source.kind === 'unassigned'}<small class="artifact-source-warning" data-testid="extract-text-source-warning">Source is unassigned. Save is allowed, but Start requires an earlier compatible output.</small>{/if}
{:else}
  <label>Source<select data-testid="parallel-extract-source" class:artifact-source-unassigned={node.source.kind === 'unassigned'} value={artifactSourceKey(node.source)} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.source = artifactSourceFromKey(event.currentTarget.value) })}><option value="">Unassigned</option>{#each choices as choice}<option value={artifactSourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
  {#if node.source.kind === 'unassigned'}<small class="artifact-source-warning" data-testid="parallel-extract-source-warning">Source is unassigned. Save is allowed, but Start requires an earlier compatible output.</small>{/if}
{/if}

{#if variant === 'parallel'}
  <div class="macro-row"><label>Select<select data-testid="parallel-extract-select-mode" value={node.select.mode} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { const mode = event.currentTarget.value; item.select = mode === 'all' ? { mode } : mode === 'range' ? { mode, start: 0, end: 1 } : { mode: 'index', index: 0 } })}><option value="all">all</option><option value="index">index</option><option value="range">range</option></select></label><label>Trim<select data-testid="parallel-extract-trim" value={node.trim} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.trim = event.currentTarget.value as typeof item.trim })}><option value="none">none</option><option value="left">left</option><option value="right">right</option><option value="both">both</option></select></label><label>On empty<select data-testid="parallel-extract-on-empty" value={node.onEmpty} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.onEmpty = event.currentTarget.value as 'pause' | 'fail' })}><option value="pause">pause</option><option value="fail">fail</option></select></label></div>
{:else}
  <div class="macro-row">
    <label>Split
      <select data-testid="extract-text-split-kind" value={node.split.kind} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.split = event.currentTarget.value === 'regex' ? { kind: 'regex', pattern: '\\n+', flags: '', keepEmpty: false } : { kind: 'lines', keepEmpty: false } })}>
        <option value="lines">lines</option><option value="regex">regex</option>
      </select>
    </label>
    <label class="checkbox-row"><input type="checkbox" data-testid="extract-text-keep-empty" checked={node.split.keepEmpty} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.split.keepEmpty = event.currentTarget.checked })} />Keep empty</label>
  </div>
  {#if node.split.kind === 'regex'}
    <div class="macro-row"><label>Split pattern<input data-testid="extract-text-split-pattern" value={node.split.pattern} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { if (item.split.kind === 'regex') item.split.pattern = event.currentTarget.value })} /></label><label>Flags<input data-testid="extract-text-split-flags" value={node.split.flags ?? ''} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { if (item.split.kind === 'regex') item.split.flags = event.currentTarget.value })} /></label></div>
  {/if}

  <div class="step-title"><strong>Filters</strong><button type="button" data-testid="extract-add-filter" onclick={addTextFilter}>Add filter</button></div>
  {#each node.filters as filter, filterIndex}
    <div class="message-part-row" data-testid="extract-filter-row">
      <div class="macro-row">
        <label>Mode<select data-testid="extract-filter-mode" value={filter.kind} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.filters[filterIndex].kind = event.currentTarget.value as 'include' | 'exclude' })}><option value="include">include</option><option value="exclude">exclude</option></select></label>
        <label>Matcher<select data-testid="extract-filter-matcher-kind" value={filter.matcher.kind} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.filters[filterIndex].matcher = event.currentTarget.value === 'regex' ? { kind: 'regex', pattern: 'READY', flags: '' } : { kind: 'simple', op: 'contains', text: 'READY' } })}><option value="simple">simple</option><option value="regex">regex</option></select></label>
        <MacroIconButton kind="remove" testId="extract-filter-remove" onClick={() => removeTextFilter(filterIndex)} />
      </div>
      {#if filter.matcher.kind === 'simple'}
        <div class="macro-row"><label>Op<select data-testid="extract-filter-simple-op" value={filter.matcher.op} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { const target = item.filters[filterIndex]; if (target.matcher.kind === 'simple') target.matcher.op = event.currentTarget.value as SimpleTextMatchOp })}><option value="contains">contains</option><option value="not_contains">not_contains</option><option value="equals">equals</option><option value="not_equals">not_equals</option><option value="starts_with">starts_with</option><option value="ends_with">ends_with</option></select></label><label>Text<input data-testid="extract-filter-simple-text" value={filter.matcher.text} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { const target = item.filters[filterIndex]; if (target.matcher.kind === 'simple') target.matcher.text = event.currentTarget.value })} /></label></div>
      {:else}
        <div class="macro-row"><label>Pattern<input data-testid="extract-filter-regex-pattern" value={filter.matcher.pattern} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { const target = item.filters[filterIndex]; if (target.matcher.kind === 'regex') target.matcher.pattern = event.currentTarget.value })} /></label><label>Flags<input data-testid="extract-filter-regex-flags" value={filter.matcher.flags ?? ''} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { const target = item.filters[filterIndex]; if (target.matcher.kind === 'regex') target.matcher.flags = event.currentTarget.value })} /></label></div>
      {/if}
    </div>
  {/each}

  <div class="macro-row">
    <label>Select
      <select data-testid="extract-text-select-mode" value={node.select.mode} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { const mode = event.currentTarget.value; item.select = mode === 'index' ? { mode, index: 0 } : mode === 'range' ? { mode, start: 0 } : { mode: 'all' } })}>
        <option value="all">all</option><option value="index">index</option><option value="range">range</option>
      </select>
    </label>
    {#if node.select.mode === 'index'}<label>Index<input data-testid="extract-text-select-index" type="number" value={node.select.index} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { if (item.select.mode === 'index') item.select.index = Number(event.currentTarget.value) })} /></label>{/if}
    {#if node.select.mode === 'range'}<label>Start<input data-testid="extract-text-select-start" type="number" value={node.select.start} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { if (item.select.mode === 'range') item.select.start = Number(event.currentTarget.value) })} /></label><label>End<input data-testid="extract-text-select-end" type="number" value={node.select.end ?? ''} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { if (item.select.mode === 'range') item.select.end = event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value) })} /></label>{/if}
  </div>

  <div class="macro-row">
    <label>Extract
      <select data-testid="extract-text-extract-kind" value={node.extract.kind} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.extract = event.currentTarget.value === 'regex' ? { kind: 'regex', pattern: '(.*)', flags: '', group: 1 } : { kind: 'none' } })}>
        <option value="none">none</option><option value="regex">regex group</option>
      </select>
    </label>
    <label>Trim<select data-testid="extract-text-trim" value={node.trim} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.trim = event.currentTarget.value as never })}><option value="none">none</option><option value="left">left</option><option value="right">right</option><option value="both">both</option></select></label>
    <label>On empty<select data-testid="extract-text-on-empty" value={node.onEmpty} onchange={(event) => onUpdate((item: EditableExtractTextNode) => { item.onEmpty = event.currentTarget.value as never })}><option value="pause">pause</option><option value="continue">continue</option><option value="fail">fail</option><option value="finish">finish</option></select></label>
  </div>
  {#if node.extract.kind === 'regex'}
    <div class="macro-row"><label>Pattern<input data-testid="extract-text-regex-pattern" value={node.extract.pattern} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { if (item.extract.kind === 'regex') item.extract.pattern = event.currentTarget.value })} /></label><label>Flags<input data-testid="extract-text-regex-flags" value={node.extract.flags ?? ''} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { if (item.extract.kind === 'regex') item.extract.flags = event.currentTarget.value })} /></label><label>Group<input data-testid="extract-text-regex-group" value={groupInputValue(node.extract.group)} oninput={(event) => onUpdate((item: EditableExtractTextNode) => { if (item.extract.kind === 'regex') item.extract.group = groupFromInput(event.currentTarget.value) })} /></label></div>
  {/if}
{/if}

<style>
  select.artifact-source-unassigned {
    border-color: #d79a35;
    background: #fff9eb;
    color: #725013;
  }

  .artifact-source-warning {
    color: #8a5b0a;
    font-size: 11px;
    line-height: 1.3;
  }
</style>
