<script lang="ts">
  import type { Snippet } from 'svelte'
  import type {
    FlowV2Node,
    MacroDefinitionV6,
    MacroTerminalReference,
    MacroCondition,
    TextListItem,
  } from '../../macro/macroDefinitionTypes'
  import type { ArtifactChoice } from '../../macro/macroArtifactChoices'
  import type { BodyPath } from '../../macro/flowV2EditorCommands'
  import { LOOP_INDEX_TEMPLATE_TOKEN, LOOP_KEY_TEMPLATE_TOKEN, LOOP_VALUE_TEMPLATE_TOKEN } from '../../macro/scopedTextTemplate'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import type { TerminalChoice } from '../../macro/macroTerminalChoices'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import LineNumberedTextarea from './LineNumberedTextarea.svelte'
  import MacroConditionEditor from './MacroConditionEditor.svelte'
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
    insertionPaletteMode,
    telegramProfileIds = [],
    telegramProfilesError = '',
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
    insertTextListItem: (nodeId: string, insertionIndex: number) => void
    updateTextListItem: (nodeId: string, itemIndex: number, field: keyof TextListItem, value: string) => void
    removeTextListItem: (nodeId: string, itemIndex: number) => void
    moveTextListItem: (nodeId: string, itemIndex: number, offset: -1 | 1) => void
    onUpdate: (mutator: (item: FlowV2Node) => void) => void
    renderNodeList: NodeListRenderer
    draft: MacroDefinitionV6
    updateDraft: (mutator: (template: MacroDefinitionV6) => void) => void
    terminalChoices: () => TerminalChoice[]
    adoptTerminalSelection: (template: MacroDefinitionV6, terminalIndex: number) => boolean
    insertionPaletteMode: MacroInsertionPaletteMode
    telegramProfileIds?: string[]
    telegramProfilesError?: string
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
      <MacroConditionEditor condition={branch.condition} choices={artifactChoices} onChange={(condition: MacroCondition) => onUpdate((item: FlowV2Node) => { if (item.type === 'if') item.branches[branchIndex].condition = condition })} />
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
      {#each node.range.items as item, itemIndex (item)}
        <div class="message-part-row text-list-item-card card min-w-0 gap-2 bg-base-200/60 p-2 shadow-sm" data-testid="for-text-list-item-card">
          <div class="step-title flex min-w-0 flex-wrap items-center justify-between gap-2"><strong data-testid="for-text-list-index">{itemIndex + 1}</strong><div class="inline-actions flex flex-wrap gap-1"><MacroIconButton kind="insert-before" label="Insert item before" testId="for-text-list-item-insert-above" onClick={() => insertTextListItem(node.id, itemIndex)} /><MacroIconButton kind="insert-after" label="Insert item after" testId="for-text-list-item-insert-below" onClick={() => insertTextListItem(node.id, itemIndex + 1)} /><MacroIconButton kind="up" disabled={itemIndex === 0} testId="for-text-list-item-up" onClick={() => moveTextListItem(node.id, itemIndex, -1)} /><MacroIconButton kind="down" disabled={itemIndex === node.range.items.length - 1} testId="for-text-list-item-down" onClick={() => moveTextListItem(node.id, itemIndex, 1)} /><MacroIconButton kind="remove" disabled={node.range.items.length <= 1} testId="for-text-list-item-remove" onClick={() => removeTextListItem(node.id, itemIndex)} /></div></div>
          <label>Key<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="for-text-list-key" value={item.key} oninput={(event) => updateTextListItem(node.id, itemIndex, 'key', event.currentTarget.value)} /></label>
          <label>Value<LineNumberedTextarea testId="for-text-list-value" value={item.value} maxRows={3} ariaLabel={'Text-list item ' + (itemIndex + 1) + ' value'} onInput={(value: string) => updateTextListItem(node.id, itemIndex, 'value', value)} /></label>
        </div>
      {/each}
    </div>
  {/if}
  {@render renderNodeList(node.body, [...bodyPath, { kind: 'for', nodeId: node.id }], true, 'for body', false, forBodyTemplateScope(node, templateScope), depth + 1)}
{:else if node.type === 'parallel'}
  <ParallelLaneTabs {draft} nodeId={node.id} {updateDraft} {terminalChoices} {adoptTerminalSelection} outerArtifactChoices={artifactChoices} {templateScope} {insertionPaletteMode} {telegramProfileIds} {telegramProfilesError} {currentNodeId} />
{:else}
  <label>Reason<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="flow-control-reason" value={node.reason ?? ''} oninput={(event) => onUpdate((item: FlowV2Node) => { if ('reason' in item) item.reason = event.currentTarget.value || undefined })} /></label>
  {#if node.type === 'finish' || node.type === 'break' || node.type === 'continue'}
    {@render renderNodeList(node.body ?? [], [...bodyPath, { kind: 'control', nodeId: node.id }], false, node.type + ' action body', true, templateScope, depth + 1)}
  {/if}
{/if}
