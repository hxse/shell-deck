<script lang="ts">
  import type {
    FlowV2ActionNode,
    FlowV2Node,
    MacroDefinitionV5,
    ParallelNode,
  } from '../../macro/macroDefinitionTypes'
  import { buildArtifactChoiceIndex } from '../../macro/macroArtifactChoices'
  import type { BodyPath } from '../../macro/flowV2EditorCommands'
  import { LOOP_INDEX_TEMPLATE_TOKEN, LOOP_KEY_TEMPLATE_TOKEN, LOOP_VALUE_TEMPLATE_TOKEN } from '../../macro/scopedTextTemplate'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import type { TerminalChoice } from '../../macro/macroTerminalChoices'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import MacroActionNodeEditor from './MacroActionNodeEditor.svelte'
  import MacroControlNodeEditor from './MacroControlNodeEditor.svelte'
  import MacroInsertionPalette, {
    MacroInsertionPaletteLifecycle,
  } from './MacroInsertionPalette.svelte'
  import NodeActionControls from './NodeActionControls.svelte'
  import { createMacroFlowInsertionController } from './macroFlowInsertionController.svelte'
  import { createMacroFlowTreeController } from './macroFlowTreeController.svelte'

  type EditableActionNode = Exclude<FlowV2ActionNode, ParallelNode>

  let {
    draft,
    updateDraft,
    terminalChoices,
    adoptTerminalSelection,
    choiceFromIndex,
    insertionPaletteMode,
    telegramProfileIds = [],
    telegramProfilesError = '',
    currentNodeId = null,
  } = $props<{
    draft: MacroDefinitionV5
    updateDraft: (mutator: (template: MacroDefinitionV5) => void) => void
    terminalChoices: () => TerminalChoice[]
    adoptTerminalSelection: (template: MacroDefinitionV5, terminalIndex: number) => boolean
    choiceFromIndex: (target: number) => string
    insertionPaletteMode: MacroInsertionPaletteMode
    telegramProfileIds?: string[]
    telegramProfilesError?: string
    currentNodeId?: string | null
  }>()

  const insertion = createMacroFlowInsertionController({
    draft: () => draft,
    updateDraft: (mutator) => updateDraft(mutator),
    insertionPaletteMode: () => insertionPaletteMode,
    adoptTerminalSelection: (template, terminalIndex) => (
      adoptTerminalSelection(template, terminalIndex)
    ),
    lifecycle: new MacroInsertionPaletteLifecycle(),
  })
  const tree = createMacroFlowTreeController({
    draft: () => draft,
    updateDraft: (mutator) => updateDraft(mutator),
    setInsertionNotice: insertion.setNotice,
  })
  const artifactChoiceIndex = $derived(buildArtifactChoiceIndex(draft))
  const idEditNotice = $derived(tree.idEditNotice)
  const isNodeCollapsed = tree.isNodeCollapsed
  const toggleNodeCollapsed = tree.toggleNodeCollapsed
  const isIfBranchCollapsed = tree.isIfBranchCollapsed
  const toggleIfBranchCollapsed = tree.toggleIfBranchCollapsed
  const moveNodeAt = tree.moveNodeAt
  const removeNodeAt = tree.removeNodeAt
  const addElifAt = tree.addElifAt
  const ensureElseAt = tree.ensureElseAt
  const removeElifAt = tree.removeElifAt
  const removeElseAt = tree.removeElseAt
  const updateNode = tree.updateNode
  const setNodeId = tree.setNodeId
  const setForRangeMode = tree.setForRangeMode
  const insertTextListItem = tree.insertTextListItem
  const updateTextListItem = tree.updateTextListItem
  const removeTextListItem = tree.removeTextListItem
  const moveTextListItem = tree.moveTextListItem
  const openInsertion = insertion.openInsertion
  const handleInsertionResize = insertion.handleResize
  const handleInsertionKeydown = insertion.handleKeydown
  const cancelInsertion = insertion.cancelInsertion
  const insertFromPalette = insertion.insertFromPalette
  const moveExistingNodeFromPalette = insertion.moveExistingNodeFromPalette
  const movableNodeChoices = insertion.movableNodeChoices
  const beforeAnchor = insertion.beforeAnchor
  const afterAnchor = insertion.afterAnchor
  const insertIntoEmptyBody = insertion.insertIntoEmptyBody
  const updateNodeTerminal = insertion.updateNodeTerminal
  const expectedTerminalTypeAt = insertion.expectedTerminalTypeAt

  function isActionEditorNode(node: FlowV2Node): node is EditableActionNode {
    return node.type === 'send' || node.type === 'notify' || node.type === 'input'
      || node.type === 'wait' || node.type === 'capture-source' || node.type === 'extract_text'
  }

  function parallelContainsCurrentNode(node: ParallelNode): boolean {
    return Boolean(currentNodeId && node.lanes.some((lane) => lane.body.some((item) => item.id === currentNodeId)))
  }

</script>

<svelte:window onkeydown={handleInsertionKeydown} onresize={handleInsertionResize} />

{#if insertion.notice}
  <p class="macro-insertion-notice alert alert-warning rounded-none py-2 text-xs" data-testid="macro-insertion-notice">{insertion.notice}</p>
{/if}
{#if idEditNotice}
  <p class="macro-insertion-notice alert alert-warning rounded-none py-2 text-xs" data-testid="macro-id-edit-notice">{idEditNotice}</p>
{/if}

<section class="macro-section grid min-w-0 gap-2 p-2">
  <div class="macro-section-title flex min-w-0 items-center justify-between"><h3>Flow V2 Body</h3></div>
  <div class="step-list grid min-w-0 gap-2" data-testid="macro-step-list">
    {@render NodeListEditor(draft.body, [], false, 'Root body', false, null, 0)}
  </div>
</section>

{#snippet NodeListEditor(nodes: FlowV2Node[], bodyPath: BodyPath, allowLoopControls: boolean, label: string, actionOnly: boolean, templateScope: TextTemplateScope | null, depth: number)}
  <div
    class="flow-block grid min-w-0 gap-2 border-l-4 pl-2"
    class:border-l-primary={depth % 4 === 0}
    class:border-l-secondary={depth % 4 === 1}
    class:border-l-accent={depth % 4 === 2}
    class:border-l-info={depth % 4 === 3}
    data-testid="flow-block"
    data-flow-body-label={label}
    data-flow-depth={depth}
  >
    {#if nodes.length === 0}
      <div class="empty-flow-body rounded-md border border-dashed border-base-300 bg-base-200/40 p-2 text-center" data-testid="empty-flow-body">
        <button class="btn btn-primary btn-xs" type="button" data-testid="empty-body-add" onclick={(event) => insertIntoEmptyBody(bodyPath, label, allowLoopControls, event, actionOnly)}>Add inside</button>
      </div>
    {/if}
    {#each nodes as node, index (node)}
      <article class="step-editor flow-node-editor card relative grid min-w-0 gap-2 bg-base-200/60 p-2 shadow-sm after:pointer-events-none after:absolute after:right-[8%] after:bottom-0 after:left-0 after:h-0.5 after:bg-linear-to-r after:to-transparent after:content-[''] [&.collapsed>:not(.step-title)]:hidden [&.contains-current-node]:bg-primary/5 [&.current-node]:bg-primary/15 {depth % 4 === 0 ? 'after:from-primary after:via-primary/70' : depth % 4 === 1 ? 'after:from-secondary after:via-secondary/70' : depth % 4 === 2 ? 'after:from-accent after:via-accent/70' : 'after:from-info after:via-info/70'}" class:collapsed={isNodeCollapsed(node.id)} class:current-node={currentNodeId === node.id} class:contains-current-node={node.type === 'parallel' && parallelContainsCurrentNode(node)} data-flow-node-id={node.id} data-flow-node-type={node.type} data-flow-node-depth={depth} data-flow-sibling={index > 0} data-current-node={currentNodeId === node.id ? 'true' : undefined}>
        <div class="step-title node-title-row flex min-w-0 flex-wrap items-center justify-between gap-2" data-testid="node-menu">
          <div class="node-title-cluster flex min-w-0 flex-wrap items-center gap-1.5">
            <strong>{index + 1}. {node.type}{#if node.type === 'for' && node.range.kind === 'text-list'} <small class="badge badge-info badge-soft badge-sm align-middle text-[10px] font-bold" data-testid="for-text-list-summary">text-list · {LOOP_INDEX_TEMPLATE_TOKEN} · {LOOP_KEY_TEMPLATE_TOKEN} · {LOOP_VALUE_TEMPLATE_TOKEN} · {node.range.items.length} items</small>{/if}</strong>
            {#if isNodeCollapsed(node.id)}<span class="collapse-state-badge badge badge-ghost badge-sm text-[10px]" data-testid="node-collapsed-badge">Collapsed</span>{/if}
          </div>
          <NodeActionControls collapsed={isNodeCollapsed(node.id)} moveUpDisabled={index === 0} moveDownDisabled={index === nodes.length - 1} groupTestId="node-action-controls" toggleTestId="node-toggle-collapse" moveUpTestId="node-move-up" moveDownTestId="node-move-down" addBeforeTestId="node-add-before" addAfterTestId="node-add-after" removeTestId="node-remove" onToggle={() => toggleNodeCollapsed(node.id)} onMoveUp={() => moveNodeAt(bodyPath, index, -1)} onMoveDown={() => moveNodeAt(bodyPath, index, 1)} onAddBefore={(event) => openInsertion(beforeAnchor(bodyPath, index, node.id), 'Insert before: ' + node.id, allowLoopControls, event, actionOnly)} onAddAfter={(event) => openInsertion(afterAnchor(bodyPath, index, node.id), 'Insert after: ' + node.id, allowLoopControls, event, actionOnly)} onRemove={() => removeNodeAt(bodyPath, index, node.id)} />
        </div>
        <div class="macro-row">
          <label>Node id<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="node-id-input" value={node.id} oninput={(event) => { if (!setNodeId(node.id, event.currentTarget.value)) event.currentTarget.value = node.id }} /></label>
        </div>

        {#if isActionEditorNode(node)}
          <MacroActionNodeEditor
            {node}
            artifactChoices={artifactChoiceIndex.before(node.id)}
            {templateScope}
            {terminalChoices}
            {expectedTerminalTypeAt}
            onUpdate={(mutator) => updateNode(node.id, mutator)}
            onUpdateTerminal={(terminal, mutator) => updateNodeTerminal(node.id, terminal, mutator)}
            {telegramProfileIds}
            {telegramProfilesError}
          />
        {:else}
          <MacroControlNodeEditor
            {node}
            {bodyPath}
            {index}
            {allowLoopControls}
            {templateScope}
            {depth}
            artifactChoices={artifactChoiceIndex.before(node.id)}
            {isIfBranchCollapsed}
            {toggleIfBranchCollapsed}
            {addElifAt}
            {ensureElseAt}
            {removeElifAt}
            {removeElseAt}
            {setForRangeMode}
            {insertTextListItem}
            {updateTextListItem}
            {removeTextListItem}
            {moveTextListItem}
            onUpdate={(mutator) => updateNode(node.id, mutator)}
            renderNodeList={NodeListEditor}
            {draft}
            {updateDraft}
            {terminalChoices}
            {adoptTerminalSelection}
            {choiceFromIndex}
            {insertionPaletteMode}
            {currentNodeId}
          />
        {/if}
      </article>
    {/each}
  </div>
{/snippet}

{#if insertion.anchor}
  <MacroInsertionPalette
    anchored={insertion.paletteAnchored}
    position={insertion.position}
    style={insertion.paletteStyle}
    {insertionPaletteMode}
    summary={insertion.summary}
    actionOnly={insertion.actionOnly}
    allowsLoopControls={insertion.allowsLoopControls}
    actionItems={insertion.actionPaletteItems}
    flowItems={insertion.flowPaletteItems}
    moveNodeId={insertion.moveNodeId}
    movableNodeChoices={movableNodeChoices()}
    blocked={insertion.notice.startsWith('Insertion failed:')}
    bind:paletteElement={insertion.paletteElement}
    onMoveNodeIdChange={insertion.setMoveNodeId}
    onInsert={insertFromPalette}
    onMoveExisting={moveExistingNodeFromPalette}
    onCancel={cancelInsertion}
  />
{/if}
