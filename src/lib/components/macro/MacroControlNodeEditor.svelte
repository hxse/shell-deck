<script lang="ts">
  import type { Snippet } from 'svelte'
  import type {
    FlowV2Node,
    MacroDefinitionV5,
    MacroTerminalReference,
    SimpleTextMatchOp,
    TextListItem,
    TextMatchCondition,
  } from '../../macro/macroDefinitionTypes'
  import {
    artifactSourceFromKey,
    artifactSourceKey,
    type ArtifactChoice,
  } from '../../macro/macroArtifactChoices'
  import type { BodyPath } from '../../macro/flowV2EditorCommands'
  import { LOOP_INDEX_TEMPLATE_TOKEN, LOOP_KEY_TEMPLATE_TOKEN, LOOP_VALUE_TEMPLATE_TOKEN } from '../../macro/scopedTextTemplate'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import type { TerminalChoice } from '../../macro/macroTerminalChoices'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import LineNumberedTextarea from './LineNumberedTextarea.svelte'
  import MacroIconButton from './MacroIconButton.svelte'
  import ParallelLaneTabs from './ParallelLaneTabs.svelte'

  type ControlEditorNode = Extract<FlowV2Node, {
    type: 'if' | 'for' | 'parallel' | 'break' | 'continue' | 'finish'
  }>
  type NodeListRenderer = Snippet<[
    nodes: FlowV2Node[],
    bodyPath: BodyPath,
    allowLoopControls: boolean,
    label: string,
    actionOnly: boolean,
    templateScope: TextTemplateScope | null,
    depth: number,
  ]>

  let {
    node,
    bodyPath,
    index,
    allowLoopControls,
    templateScope,
    depth,
    artifactChoices,
    isIfBranchCollapsed,
    toggleIfBranchCollapsed,
    addElifAt,
    ensureElseAt,
    removeElifAt,
    removeElseAt,
    setForRangeMode,
    textListItemEditorKey,
    insertTextListItem,
    updateTextListItem,
    removeTextListItem,
    moveTextListItem,
    onUpdate,
    renderNodeList,
    draft,
    updateDraft,
    terminalChoices,
    adoptTerminalSelection,
    choiceFromIndex,
    insertionPaletteMode,
    currentNodeId = null,
  } = $props<{
    node: ControlEditorNode
    bodyPath: BodyPath
    index: number
    allowLoopControls: boolean
    templateScope: TextTemplateScope | null
    depth: number
    artifactChoices: ArtifactChoice[]
    isIfBranchCollapsed: (nodeId: string, branch: number | 'else') => boolean
    toggleIfBranchCollapsed: (nodeId: string, branch: number | 'else') => void
    addElifAt: (bodyPath: BodyPath, index: number, afterBranchIndex: number, nodeId: string) => void
    ensureElseAt: (bodyPath: BodyPath, index: number) => void
    removeElifAt: (bodyPath: BodyPath, index: number, branchIndex: number, nodeId: string) => void
    removeElseAt: (bodyPath: BodyPath, index: number, nodeId: string) => void
    setForRangeMode: (nodeId: string, mode: 'count' | 'forever' | 'text-list') => boolean
    textListItemEditorKey: (nodeId: string, itemIndex: number) => string
    insertTextListItem: (nodeId: string, insertionIndex: number) => void
    updateTextListItem: (nodeId: string, itemIndex: number, field: keyof TextListItem, value: string) => void
    removeTextListItem: (nodeId: string, itemIndex: number) => void
    moveTextListItem: (nodeId: string, itemIndex: number, offset: -1 | 1) => void
    onUpdate: (mutator: (item: FlowV2Node) => void) => void
    renderNodeList: NodeListRenderer
    draft: MacroDefinitionV5
    updateDraft: (mutator: (template: MacroDefinitionV5) => void) => void
    terminalChoices: () => TerminalChoice[]
    adoptTerminalSelection: (template: MacroDefinitionV5, terminalIndex: number) => boolean
    choiceFromIndex: (target: number) => string
    insertionPaletteMode: MacroInsertionPaletteMode
    currentNodeId?: string | null
  }>()

  function forBodyTemplateScope(
    item: Extract<FlowV2Node, { type: 'for' }>,
    inherited: TextTemplateScope | null,
  ): TextTemplateScope | null {
    return item.range.kind === 'text-list'
      ? { forStepId: item.id, shadowedForStepId: inherited?.forStepId }
      : inherited
  }

  function setSimpleMatcherOp(condition: TextMatchCondition, op: SimpleTextMatchOp): TextMatchCondition {
    if (condition.matcher.kind !== 'simple') return condition
    return { ...condition, matcher: { kind: 'simple', op, text: condition.matcher.text } }
  }

  function setSimpleMatcherText(condition: TextMatchCondition, text: string): TextMatchCondition {
    if (condition.matcher.kind !== 'simple') return condition
    return { ...condition, matcher: { kind: 'simple', op: condition.matcher.op, text } }
  }

  function setRegexMatcherPattern(condition: TextMatchCondition, pattern: string): TextMatchCondition {
    if (condition.matcher.kind !== 'regex') return condition
    return { ...condition, matcher: { kind: 'regex', pattern, flags: condition.matcher.flags } }
  }

  function setRegexMatcherFlags(condition: TextMatchCondition, flags: string): TextMatchCondition {
    if (condition.matcher.kind !== 'regex') return condition
    return { ...condition, matcher: { kind: 'regex', pattern: condition.matcher.pattern, flags } }
  }
</script>

{#if node.type === 'if'}
  {#each node.branches as branch, branchIndex}
    <div class="flow-branch-card card grid min-w-0 gap-2 bg-base-200/60 p-2 shadow-sm [&.collapsed]:opacity-75" class:collapsed={isIfBranchCollapsed(node.id, branchIndex)} data-testid="if-branch-section" data-flow-branch-kind={branch.kind} data-flow-branch-index={branchIndex}>
      <div class="step-title flow-branch-title flex min-w-0 flex-wrap items-center justify-between gap-2" data-testid="flow-branch-title">
        <div class="flow-branch-label flex min-w-0 items-center gap-1.5">
          <strong>{branch.kind}</strong>
          {#if isIfBranchCollapsed(node.id, branchIndex)}<span class="collapse-state-badge badge badge-ghost badge-sm text-[10px]" data-testid="if-branch-collapsed-badge">Collapsed</span>{/if}
        </div>
        <div class="inline-actions flow-branch-actions flex flex-wrap gap-1" data-testid="flow-branch-actions">
          <MacroIconButton kind={isIfBranchCollapsed(node.id, branchIndex) ? 'expand' : 'collapse'} active={isIfBranchCollapsed(node.id, branchIndex)} expanded={!isIfBranchCollapsed(node.id, branchIndex)} testId="if-branch-toggle" onClick={() => toggleIfBranchCollapsed(node.id, branchIndex)} />
          <button class="btn btn-xs btn-primary" type="button" data-testid="add-flow-elif" onclick={() => addElifAt(bodyPath, index, branchIndex, node.id)}>Add elif</button>
          {#if !node.else}<button class="btn btn-xs btn-primary" type="button" data-testid="add-flow-else" onclick={() => ensureElseAt(bodyPath, index)}>Add else</button>{/if}
          {#if branch.kind === 'elif'}<MacroIconButton kind="remove" testId="remove-flow-elif" onClick={() => removeElifAt(bodyPath, index, branchIndex, node.id)} />{/if}
        </div>
      </div>
      {@render ConditionEditor(branch.condition, artifactChoices, (condition: TextMatchCondition) => onUpdate((item: FlowV2Node) => { if (item.type === 'if') item.branches[branchIndex].condition = condition }))}
      {@render renderNodeList(branch.body, [...bodyPath, { kind: 'if-branch', nodeId: node.id, branchIndex }], allowLoopControls, branch.kind + ' body', false, templateScope, depth + 1)}
    </div>
  {/each}
  {#if node.else}
    <div class="flow-branch-card card grid min-w-0 gap-2 bg-base-200/60 p-2 shadow-sm [&.collapsed]:opacity-75" class:collapsed={isIfBranchCollapsed(node.id, 'else')} data-testid="if-branch-section" data-flow-branch-kind="else">
      <div class="step-title flow-branch-title flex min-w-0 flex-wrap items-center justify-between gap-2" data-testid="flow-branch-title">
        <div class="flow-branch-label flex min-w-0 items-center gap-1.5">
          <strong>else</strong>
          {#if isIfBranchCollapsed(node.id, 'else')}<span class="collapse-state-badge badge badge-ghost badge-sm text-[10px]" data-testid="if-branch-collapsed-badge">Collapsed</span>{/if}
        </div>
        <div class="inline-actions flow-branch-actions flex flex-wrap gap-1" data-testid="flow-branch-actions">
          <MacroIconButton kind={isIfBranchCollapsed(node.id, 'else') ? 'expand' : 'collapse'} active={isIfBranchCollapsed(node.id, 'else')} expanded={!isIfBranchCollapsed(node.id, 'else')} testId="if-branch-toggle" onClick={() => toggleIfBranchCollapsed(node.id, 'else')} />
          <MacroIconButton kind="remove" testId="remove-flow-else" onClick={() => removeElseAt(bodyPath, index, node.id)} />
        </div>
      </div>
      {@render renderNodeList(node.else, [...bodyPath, { kind: 'if-else', nodeId: node.id }], allowLoopControls, 'else body', false, templateScope, depth + 1)}
    </div>
  {/if}
{:else if node.type === 'for'}
  <div class="macro-row"><label>Mode<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="for-range-mode" value={node.range.kind} onchange={(event) => { const previous = node.range.kind; const mode = event.currentTarget.value as 'count' | 'forever' | 'text-list'; if (!setForRangeMode(node.id, mode)) event.currentTarget.value = previous }}><option value="count">count</option><option value="forever">forever</option><option value="text-list">text-list</option></select></label>{#if node.range.kind === 'count'}<label>Count<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="for-range-count" type="number" value={node.range.count} oninput={(event) => onUpdate((item: FlowV2Node) => { if (item.type === 'for') item.range = { kind: 'count', count: Number(event.currentTarget.value) } })} /></label>{/if}</div>
  {#if node.range.kind === 'text-list'}
    <div class="text-list-items grid min-w-0 gap-2" data-testid="for-text-list-items">
      <div class="step-title flex min-w-0 items-center justify-between"><strong>Items</strong></div>
      {#each node.range.items as item, itemIndex (textListItemEditorKey(node.id, itemIndex))}
        <div class="message-part-row text-list-item-card card min-w-0 gap-2 bg-base-200/60 p-2 shadow-sm" data-testid="for-text-list-item-card">
          <div class="step-title flex min-w-0 flex-wrap items-center justify-between gap-2"><strong data-testid="for-text-list-index">{itemIndex + 1}</strong><div class="inline-actions flex flex-wrap gap-1"><MacroIconButton kind="insert-above" testId="for-text-list-item-insert-above" onClick={() => insertTextListItem(node.id, itemIndex)} /><MacroIconButton kind="insert-below" testId="for-text-list-item-insert-below" onClick={() => insertTextListItem(node.id, itemIndex + 1)} /><MacroIconButton kind="up" disabled={itemIndex === 0} testId="for-text-list-item-up" onClick={() => moveTextListItem(node.id, itemIndex, -1)} /><MacroIconButton kind="down" disabled={itemIndex === node.range.items.length - 1} testId="for-text-list-item-down" onClick={() => moveTextListItem(node.id, itemIndex, 1)} /><MacroIconButton kind="remove" disabled={node.range.items.length <= 1} testId="for-text-list-item-remove" onClick={() => removeTextListItem(node.id, itemIndex)} /></div></div>
          <label>Key<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="for-text-list-key" value={item.key} oninput={(event) => updateTextListItem(node.id, itemIndex, 'key', event.currentTarget.value)} /></label>
          <label>Value<LineNumberedTextarea testId="for-text-list-value" value={item.value} maxRows={3} ariaLabel={'Text-list item ' + (itemIndex + 1) + ' value'} onInput={(value: string) => updateTextListItem(node.id, itemIndex, 'value', value)} /></label>
        </div>
      {/each}
    </div>
  {/if}
  {@render renderNodeList(node.body, [...bodyPath, { kind: 'for', nodeId: node.id }], true, 'for body', false, forBodyTemplateScope(node, templateScope), depth + 1)}
{:else if node.type === 'parallel'}
  <ParallelLaneTabs {draft} nodeId={node.id} {updateDraft} {terminalChoices} {adoptTerminalSelection} {choiceFromIndex} outerArtifactChoices={artifactChoices} {templateScope} {insertionPaletteMode} {currentNodeId} />
{:else}
  <label>Reason<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="flow-control-reason" value={node.reason ?? ''} oninput={(event) => onUpdate((item: FlowV2Node) => { if ('reason' in item) item.reason = event.currentTarget.value || undefined })} /></label>
  {#if node.type === 'finish' || node.type === 'break' || node.type === 'continue'}
    {@render renderNodeList(node.body ?? [], [...bodyPath, { kind: 'control', nodeId: node.id }], false, node.type + ' action body', true, templateScope, depth + 1)}
  {/if}
{/if}

{#snippet ConditionEditor(condition: TextMatchCondition, choices: ArtifactChoice[], onChange: (condition: TextMatchCondition) => void)}
  <div class="condition-row grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-2">
    <label>Source<select class="select box-border select-xs select-ghost w-full bg-base-content/15" class:select-warning={condition.source.kind === 'unassigned'} data-testid="condition-source" class:artifact-source-unassigned={condition.source.kind === 'unassigned'} value={artifactSourceKey(condition.source)} onchange={(event) => onChange({ ...condition, source: artifactSourceFromKey(event.currentTarget.value) })}><option value="">Unassigned</option>{#each choices as choice}<option value={artifactSourceKey(choice.source)}>{choice.label}</option>{/each}</select></label>
    <label>Matcher<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-matcher-kind" value={condition.matcher.kind} onchange={(event) => onChange({ ...condition, matcher: event.currentTarget.value === 'regex' ? { kind: 'regex', pattern: 'READY', flags: 'i' } : { kind: 'simple', op: 'contains', text: 'READY' } })}><option value="simple">simple</option><option value="regex">regex</option></select></label>
    {#if condition.matcher.kind === 'simple'}
      <label>Op<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-simple-op" value={condition.matcher.op} onchange={(event) => onChange(setSimpleMatcherOp(condition, event.currentTarget.value as SimpleTextMatchOp))}><option value="contains">contains</option><option value="not_contains">not_contains</option><option value="equals">equals</option><option value="not_equals">not_equals</option><option value="starts_with">starts_with</option><option value="ends_with">ends_with</option></select></label>
      <label>Text<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-simple-text" value={condition.matcher.text} oninput={(event) => onChange(setSimpleMatcherText(condition, event.currentTarget.value))} /></label>
    {:else}
      <label>Pattern<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-regex-pattern" value={condition.matcher.pattern} oninput={(event) => onChange(setRegexMatcherPattern(condition, event.currentTarget.value))} /></label>
      <label>Flags<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="condition-regex-flags" value={condition.matcher.flags ?? ''} oninput={(event) => onChange(setRegexMatcherFlags(condition, event.currentTarget.value))} /></label>
    {/if}
    <label>Scope<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="condition-scope" value={condition.scope.kind === 'lines' ? 'lines:' + condition.scope.mode : 'whole'} onchange={(event) => { const value = event.currentTarget.value; onChange({ ...condition, scope: value === 'whole' ? { kind: 'whole' } : { kind: 'lines', mode: value.split(':')[1] as never, includeEmptyLines: false } }) }}><option value="whole">whole</option><option value="lines:first">lines.first</option><option value="lines:last">lines.last</option><option value="lines:any">lines.any</option><option value="lines:all">lines.all</option></select></label>
  </div>
  {#if condition.source.kind === 'unassigned'}<small class="artifact-source-warning text-[11px] leading-snug text-warning" data-testid="condition-source-warning">Source is unassigned. Save is allowed, but Start requires an earlier compatible output.</small>{/if}
{/snippet}
