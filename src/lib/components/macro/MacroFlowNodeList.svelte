<script lang="ts">
  import { tick } from 'svelte'
  import type {
    FlowV2ActionNode,
    FlowV2Node,
    MacroDefinitionV5,
    MacroTerminalReference,
    ParallelNode,
    TextListItem,
  } from '../../macro/macroDefinitionTypes'
  import { artifactChoicesBefore } from '../../macro/macroArtifactChoices'
  import {
    allMacroNodeIds,
    defaultCaptureSource,
    defaultFlowNode,
    defaultTextMatchCondition,
    unassignedArtifactSource,
  } from '../../macro/macroEditorDefaults'
  import {
    canMoveNodeToAnchor,
    cloneBodyPath,
    ensureElseForIfNode,
    findNodePosition,
    insertElifBranchAfter,
    isInsertionAnchorValid,
    insertNodeAtAnchor,
    moveNodeAtPosition,
    moveNodeToAnchor,
    removeElseFromIfNode,
    removeIfBranchAt,
    removeNodeAtPosition,
    resolveBodyPath,
    type BodyPath,
    type InsertionAnchor,
  } from '../../macro/flowV2EditorCommands'
  import { LOOP_INDEX_TEMPLATE_TOKEN, LOOP_KEY_TEMPLATE_TOKEN, LOOP_VALUE_TEMPLATE_TOKEN } from '../../macro/scopedTextTemplate'
  import { hasNonDefaultTextListItems, type TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import type { TerminalChoice } from '../../macro/macroTerminalChoices'
  import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'
  import MacroActionNodeEditor from './MacroActionNodeEditor.svelte'
  import MacroControlNodeEditor from './MacroControlNodeEditor.svelte'
  import MacroInsertionPalette, { type MacroPaletteItem } from './MacroInsertionPalette.svelte'
  import NodeActionControls from './NodeActionControls.svelte'

  type InsertionPalettePosition = {
    x: number
    y: number
    placement: 'above' | 'below'
    maxHeight?: number
  }
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

  let insertionAnchor = $state<InsertionAnchor | null>(null)
  let insertionSummary = $state('')
  let insertionAllowsLoopControls = $state(false)
  let insertionPosition = $state<InsertionPalettePosition | null>(null)
  let insertionActionOnly = $state(false)
  let insertionTriggerElement = $state<HTMLElement | null>(null)
  let insertionPaletteElement = $state<HTMLElement | null>(null)
  let insertionNotice = $state('')
  let moveNodeId = $state('')
  let collapsedNodeIds = $state<string[]>([])
  let collapsedIfBranchKeys = $state<string[]>([])
  let idEditNotice = $state('')
  let textListStructureVersions = $state<Record<string, number>>({})

  const insertionPaletteAnchored = $derived(insertionPaletteMode === 'anchored' && insertionPosition !== null)
  const insertionPaletteStyle = $derived(insertionPaletteAnchored && insertionPosition
    ? '--palette-x: ' + insertionPosition.x + 'px; --palette-y: ' + insertionPosition.y + 'px;'
      + (insertionPosition.maxHeight ? ' --palette-max-height: ' + insertionPosition.maxHeight + 'px;' : '')
    : '')

  const actionPaletteItems: MacroPaletteItem[] = [
    { type: 'send', label: 'send', testId: 'add-step-send' },
    { type: 'notify', label: 'notify', testId: 'add-step-notify' },
    { type: 'input', label: 'input', testId: 'add-step-input' },
    { type: 'wait', label: 'wait', testId: 'add-step-wait' },
    { type: 'capture-source', label: 'capture', testId: 'add-step-capture' },
    { type: 'extract_text', label: 'extract', testId: 'add-step-extract' },
    { type: 'parallel', label: 'parallel', testId: 'add-step-parallel' },
  ]
  const flowPaletteItems: MacroPaletteItem[] = [
    { type: 'if', label: 'if', testId: 'add-flow-if' },
    { type: 'for', label: 'for', testId: 'add-flow-for' },
    { type: 'finish', label: 'finish', testId: 'add-flow-finish' },
    { type: 'break', label: 'break', testId: 'add-flow-break', loopOnly: true },
    { type: 'continue', label: 'continue', testId: 'add-flow-continue', loopOnly: true },
  ]
  $effect(() => {
    const anchor = insertionAnchor
    if (!anchor) return
    if (isOpenInsertionAnchorValid(anchor)) return
    insertionNotice = 'Insertion target changed. Choose an insertion point again.'
    closeInsertion(false)
  })

  function isOpenInsertionAnchorValid(anchor: InsertionAnchor): boolean {
    if (isInsertionAnchorValid(draft, anchor)) return true
    if (anchor.kind === 'inside' && anchor.slot === 'control' && anchor.anchorNodeId) {
      return findNodePosition(draft, anchor.anchorNodeId) !== undefined
    }
    return false
  }

  function openInsertion(
    anchor: InsertionAnchor,
    summary: string,
    allowLoopControls: boolean,
    event?: MouseEvent,
    actionOnly = false,
  ): void {
    const target = event?.currentTarget
    insertionTriggerElement = target instanceof HTMLElement ? target : null
    insertionNotice = ''
    insertionAnchor = { ...anchor, parentPath: cloneBodyPath(anchor.parentPath) }
    insertionSummary = summary
    insertionAllowsLoopControls = allowLoopControls
    insertionActionOnly = actionOnly
    insertionPosition = insertionPaletteMode === 'anchored' ? positionInsertionPalette(event) : null
    moveNodeId = ''
    void settleInsertionPalette(true)
  }

  function positionInsertionPalette(event?: MouseEvent): InsertionPalettePosition | null {
    const target = event?.currentTarget
    if (!(target instanceof HTMLElement)) return null
    const rect = target.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const estimatedHalfWidth = 180
    const estimatedHeight = Math.min(360, Math.max(0, window.innerHeight - margin * 2))
    const preferred = rect.top > window.innerHeight / 2 ? 'above' : 'below'
    const aboveSpace = Math.max(0, rect.top - gap - margin)
    const belowSpace = Math.max(0, window.innerHeight - rect.bottom - gap - margin)
    const placement = preferred === 'above'
      ? aboveSpace >= Math.min(estimatedHeight, belowSpace) ? 'above' : 'below'
      : belowSpace >= Math.min(estimatedHeight, aboveSpace) ? 'below' : 'above'
    const availableHeight = placement === 'above' ? aboveSpace : belowSpace
    const maxHeight = Math.max(0, availableHeight)
    const x = clamp(rect.left + rect.width / 2, margin + estimatedHalfWidth, window.innerWidth - margin - estimatedHalfWidth)
    const y = placement === 'above' ? rect.top - gap : rect.bottom + gap
    return { x, y, placement, maxHeight }
  }

  async function settleInsertionPalette(shouldFocus: boolean): Promise<void> {
    await tick()
    clampInsertionPaletteToViewport()
    if (shouldFocus) focusInsertionPalette()
  }

  function clampInsertionPaletteToViewport(): void {
    if (!insertionPaletteAnchored || !insertionPosition || !insertionPaletteElement || !insertionTriggerElement) return
    const triggerRect = insertionTriggerElement.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const width = insertionPaletteElement.offsetWidth
    const height = insertionPaletteElement.offsetHeight
    if (width <= 0 || height <= 0) return
    const preferred = triggerRect.top > window.innerHeight / 2 ? 'above' : 'below'
    const aboveSpace = Math.max(0, triggerRect.top - gap - margin)
    const belowSpace = Math.max(0, window.innerHeight - triggerRect.bottom - gap - margin)
    const placement = preferred === 'above'
      ? aboveSpace >= Math.min(height, belowSpace) ? 'above' : 'below'
      : belowSpace >= Math.min(height, aboveSpace) ? 'below' : 'above'
    const availableHeight = placement === 'above' ? aboveSpace : belowSpace
    const maxHeight = Math.max(0, availableHeight)
    const effectiveHeight = maxHeight > 0 ? Math.min(height, maxHeight) : height
    const x = clamp(triggerRect.left + triggerRect.width / 2, margin + width / 2, window.innerWidth - margin - width / 2)
    const rawY = placement === 'above' ? triggerRect.top - gap : triggerRect.bottom + gap
    const y = placement === 'above'
      ? clamp(rawY, margin + effectiveHeight, window.innerHeight - margin)
      : clamp(rawY, margin, window.innerHeight - margin)
    insertionPosition = { x, y, placement, maxHeight }
  }

  function focusInsertionPalette(): void {
    const focusable = insertionPaletteElement?.querySelector<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled])')
    focusable?.focus()
  }

  function handleInsertionResize(): void {
    if (insertionAnchor) void settleInsertionPalette(false)
  }

  function handleInsertionKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && insertionAnchor) cancelInsertion()
  }

  function clamp(value: number, min: number, max: number): number {
    if (max < min) return min
    return Math.max(min, Math.min(max, value))
  }

  function closeInsertion(restoreFocus: boolean): void {
    const trigger = insertionTriggerElement
    insertionAnchor = null
    insertionSummary = ''
    insertionAllowsLoopControls = false
    insertionActionOnly = false
    insertionPosition = null
    insertionTriggerElement = null
    insertionPaletteElement = null
    moveNodeId = ''
    if (restoreFocus && trigger) void tick().then(() => trigger.focus())
  }

  function cancelInsertion(): void {
    closeInsertion(true)
  }

  function insertFromPalette(type: FlowV2Node['type']): void {
    if (!insertionAnchor) return
    const anchor = insertionAnchor
    let inserted = false
    let reason = 'unknown'
    updateDraft((template: MacroDefinitionV5) => {
      const result = insertNodeAtAnchor(template, anchor, defaultFlowNode(template, type))
      inserted = result.ok
      reason = result.reason ?? 'unknown'
    })
    if (inserted) cancelInsertion()
    else {
      insertionNotice = 'Insertion failed: ' + reason
      void settleInsertionPalette(false)
    }
  }

  function moveExistingNodeFromPalette(): void {
    if (!insertionAnchor || !moveNodeId) return
    const anchor = { ...insertionAnchor, parentPath: cloneBodyPath(insertionAnchor.parentPath) } as InsertionAnchor
    const nodeId = moveNodeId
    let moved = false
    updateDraft((template: MacroDefinitionV5) => { moved = moveNodeToAnchor(template, nodeId, anchor).ok })
    if (moved) cancelInsertion()
  }

  function movableNodeChoices(): Array<{ id: string; type: FlowV2Node['type'] }> {
    const anchor = insertionAnchor
    if (!anchor) return []
    return allNodeChoices(draft.body)
      .filter((choice) => (!insertionActionOnly || isActionType(choice.type)) && canMoveNodeToAnchor(draft, choice.id, anchor))
  }

  function isNodeCollapsed(nodeId: string): boolean {
    return collapsedNodeIds.includes(nodeId)
  }

  function toggleNodeCollapsed(nodeId: string): void {
    collapsedNodeIds = isNodeCollapsed(nodeId)
      ? collapsedNodeIds.filter((id) => id !== nodeId)
      : [...collapsedNodeIds, nodeId]
  }

  function ifBranchCollapseKey(nodeId: string, branch: number | 'else'): string {
    return nodeId + ':branch:' + branch
  }

  function isIfBranchCollapsed(nodeId: string, branch: number | 'else'): boolean {
    return collapsedIfBranchKeys.includes(ifBranchCollapseKey(nodeId, branch))
  }

  function toggleIfBranchCollapsed(nodeId: string, branch: number | 'else'): void {
    const key = ifBranchCollapseKey(nodeId, branch)
    collapsedIfBranchKeys = collapsedIfBranchKeys.includes(key)
      ? collapsedIfBranchKeys.filter((item) => item !== key)
      : [...collapsedIfBranchKeys, key]
  }

  function shiftIfBranchCollapseKeys(
    nodeId: string,
    fromIndex: number,
    offset: -1 | 1,
    removedIndex?: number,
  ): void {
    const prefix = nodeId + ':branch:'
    collapsedIfBranchKeys = collapsedIfBranchKeys.flatMap((key) => {
      if (!key.startsWith(prefix)) return [key]
      const suffix = key.slice(prefix.length)
      if (suffix === 'else') return [key]
      const branchIndex = Number(suffix)
      if (!Number.isInteger(branchIndex)) return [key]
      if (removedIndex === branchIndex) return []
      return [branchIndex >= fromIndex ? prefix + (branchIndex + offset) : key]
    })
  }

  function beforeAnchor(bodyPath: BodyPath, index: number, anchorNodeId?: string): InsertionAnchor {
    return { kind: 'before', parentPath: cloneBodyPath(bodyPath), index, anchorNodeId }
  }

  function afterAnchor(bodyPath: BodyPath, index: number, anchorNodeId?: string): InsertionAnchor {
    return { kind: 'after', parentPath: cloneBodyPath(bodyPath), index, anchorNodeId }
  }

  function insideAnchor(
    bodyPath: BodyPath,
    index: number,
    slot: 'if' | 'elif' | 'else' | 'for' | 'control',
    branchIndex?: number,
    anchorNodeId?: string,
  ): InsertionAnchor {
    return { kind: 'inside', parentPath: cloneBodyPath(bodyPath), index, slot, branchIndex, anchorNodeId }
  }

  function insertIntoEmptyBody(
    bodyPath: BodyPath,
    label: string,
    allowLoopControls: boolean,
    event?: MouseEvent,
    actionOnly = false,
  ): void {
    const anchor = emptyBodyInsertionAnchor(bodyPath)
    if (!anchor) {
      insertionNotice = 'Insertion failed: body_not_found'
      return
    }
    openInsertion(anchor, 'Insert into ' + label, allowLoopControls, event, actionOnly)
  }

  function emptyBodyInsertionAnchor(bodyPath: BodyPath): InsertionAnchor | null {
    const last = bodyPath[bodyPath.length - 1]
    if (last?.kind === 'control') {
      const position = findNodePosition(draft, last.nodeId)
      if (!position) return null
      return insideAnchor(position.bodyPath, position.index, 'control', undefined, last.nodeId)
    }
    return { kind: 'before', parentPath: cloneBodyPath(bodyPath), index: 0 }
  }

  function moveNodeAt(bodyPath: BodyPath, index: number, offset: -1 | 1): void {
    updateDraft((template: MacroDefinitionV5) => { moveNodeAtPosition(template, { bodyPath: cloneBodyPath(bodyPath), index }, offset) })
  }

  function removeNodeAt(bodyPath: BodyPath, index: number, nodeId: string): void {
    if (!confirm('Remove macro node ' + nodeId + '?')) return
    const removedNode = resolveBodyPath(draft, bodyPath)?.[index]
    const removedNodeIds = removedNode ? allMacroNodeIds([removedNode]) : [nodeId]
    updateDraft((template: MacroDefinitionV5) => { removeNodeAtPosition(template, { bodyPath: cloneBodyPath(bodyPath), index }) })
    clearCollapseStateForNodeIds(removedNodeIds)
  }

  function addElifAt(bodyPath: BodyPath, index: number, afterBranchIndex: number, nodeId: string): void {
    let inserted = false
    updateDraft((template: MacroDefinitionV5) => {
      inserted = insertElifBranchAfter(
        template,
        { bodyPath: cloneBodyPath(bodyPath), index },
        afterBranchIndex,
        { kind: 'elif', condition: defaultTextMatchCondition(unassignedArtifactSource()), body: [] },
      ).ok
    })
    if (inserted) shiftIfBranchCollapseKeys(nodeId, afterBranchIndex + 1, 1)
    else insertionNotice = 'Add elif failed.'
  }

  function ensureElseAt(bodyPath: BodyPath, index: number): void {
    updateDraft((template: MacroDefinitionV5) => { ensureElseForIfNode(template, { bodyPath: cloneBodyPath(bodyPath), index }) })
  }

  function removeElifAt(bodyPath: BodyPath, index: number, branchIndex: number, nodeId: string): void {
    if (!confirm('Remove elif branch and its contents?')) return
    const node = resolveBodyPath(draft, bodyPath)?.[index]
    const removedNodeIds = node?.type === 'if' ? allMacroNodeIds(node.branches[branchIndex]?.body ?? []) : []
    updateDraft((template: MacroDefinitionV5) => { removeIfBranchAt(template, { bodyPath: cloneBodyPath(bodyPath), index }, branchIndex) })
    clearCollapseStateForNodeIds(removedNodeIds)
    shiftIfBranchCollapseKeys(nodeId, branchIndex + 1, -1, branchIndex)
  }

  function removeElseAt(bodyPath: BodyPath, index: number, nodeId: string): void {
    if (!confirm('Remove else branch and its contents?')) return
    const node = resolveBodyPath(draft, bodyPath)?.[index]
    const removedNodeIds = node?.type === 'if' ? allMacroNodeIds(node.else ?? []) : []
    updateDraft((template: MacroDefinitionV5) => { removeElseFromIfNode(template, { bodyPath: cloneBodyPath(bodyPath), index }) })
    clearCollapseStateForNodeIds(removedNodeIds)
    collapsedIfBranchKeys = collapsedIfBranchKeys.filter((key) => key !== ifBranchCollapseKey(nodeId, 'else'))
  }

  function updateNode(nodeId: string, mutator: (node: FlowV2Node) => void): void {
    updateDraft((template: MacroDefinitionV5) => {
      const node = findNode(template.body, nodeId)
      if (node) mutator(node)
    })
  }

  function updateNodeTerminal(
    nodeId: string,
    terminal: MacroTerminalReference,
    mutator: (node: FlowV2Node) => void,
  ): boolean {
    let updated = false
    updateDraft((template: MacroDefinitionV5) => {
      if (terminal.kind === 'terminal_index' && !adoptTerminalSelection(template, terminal.index)) return
      const node = findNode(template.body, nodeId)
      if (!node) return
      mutator(node)
      updated = true
    })
    return updated
  }

  function setNodeId(oldId: string, nextId: string): boolean {
    if (nextId !== oldId && allMacroNodeIds(draft.body).includes(nextId)) {
      idEditNotice = 'Duplicate node id blocked: ' + nextId
      return false
    }
    idEditNotice = ''
    updateNode(oldId, (node) => { node.id = nextId })
    collapsedNodeIds = collapsedNodeIds.map((id) => id === oldId ? nextId : id)
    const prefix = oldId + ':branch:'
    collapsedIfBranchKeys = collapsedIfBranchKeys.map((key) => key.startsWith(prefix) ? nextId + ':branch:' + key.slice(prefix.length) : key)
    return true
  }

  function clearCollapseStateForNodeIds(nodeIds: string[]): void {
    if (nodeIds.length === 0) return
    const removed = new Set(nodeIds)
    collapsedNodeIds = collapsedNodeIds.filter((id) => !removed.has(id))
    collapsedIfBranchKeys = collapsedIfBranchKeys.filter((key) => !nodeIds.some((nodeId) => key.startsWith(nodeId + ':branch:')))
  }

  function findNode(nodes: FlowV2Node[], nodeId: string): FlowV2Node | undefined {
    for (const node of nodes) {
      if (node.id === nodeId) return node
      if (node.type === 'if') {
        for (const branch of node.branches) {
          const found = findNode(branch.body, nodeId)
          if (found) return found
        }
        if (node.else) {
          const found = findNode(node.else, nodeId)
          if (found) return found
        }
      }
      if (node.type === 'for') {
        const found = findNode(node.body, nodeId)
        if (found) return found
      }
      if (isControlTerminalNode(node) && node.body) {
        const found = findNode(node.body, nodeId)
        if (found) return found
      }
    }
  }

  function expectedTerminalTypeAt(reference: MacroTerminalReference): 'shell' | 'text' | undefined {
    return reference.kind === 'terminal_index' ? draft.terminalLayout[reference.index - 1]?.type : undefined
  }

  function setForRangeMode(nodeId: string, mode: 'count' | 'forever' | 'text-list'): boolean {
    const current = findNode(draft.body, nodeId)
    if (current?.type !== 'for') return false
    if (current.range.kind === 'text-list' && mode !== 'text-list' && hasNonDefaultTextListItems(current.range.items)) {
      if (!confirm('Switching from text-list will discard its items. Continue?')) return false
    }
    updateNode(nodeId, (node) => {
      if (node.type !== 'for') return
      if (mode === 'text-list') node.range = { kind: 'text-list', items: [{ key: '', value: '' }] }
      else if (mode === 'forever') node.range = { kind: 'forever' }
      else node.range = { kind: 'count', count: 1 }
    })
    return true
  }

  function bumpTextListStructureVersion(nodeId: string): void {
    textListStructureVersions = {
      ...textListStructureVersions,
      [nodeId]: (textListStructureVersions[nodeId] ?? 0) + 1,
    }
  }

  function textListItemEditorKey(nodeId: string, itemIndex: number): string {
    return nodeId + ':' + (textListStructureVersions[nodeId] ?? 0) + ':' + itemIndex
  }

  function insertTextListItem(nodeId: string, insertionIndex: number): void {
    let changed = false
    updateNode(nodeId, (node) => {
      if (node.type !== 'for' || node.range.kind !== 'text-list') return
      const targetIndex = Math.max(0, Math.min(insertionIndex, node.range.items.length))
      node.range.items.splice(targetIndex, 0, { key: '', value: '' })
      changed = true
    })
    if (changed) bumpTextListStructureVersion(nodeId)
  }

  function updateTextListItem(
    nodeId: string,
    itemIndex: number,
    field: keyof TextListItem,
    value: string,
  ): void {
    updateNode(nodeId, (node) => {
      if (node.type === 'for' && node.range.kind === 'text-list' && node.range.items[itemIndex]) {
        node.range.items[itemIndex][field] = value
      }
    })
  }

  function removeTextListItem(nodeId: string, itemIndex: number): void {
    let changed = false
    updateNode(nodeId, (node) => {
      if (node.type !== 'for' || node.range.kind !== 'text-list' || node.range.items.length <= 1) return
      node.range.items.splice(itemIndex, 1)
      changed = true
    })
    if (changed) bumpTextListStructureVersion(nodeId)
  }

  function moveTextListItem(nodeId: string, itemIndex: number, offset: -1 | 1): void {
    let changed = false
    updateNode(nodeId, (node) => {
      if (node.type !== 'for' || node.range.kind !== 'text-list') return
      const target = itemIndex + offset
      if (target < 0 || target >= node.range.items.length) return
      const [item] = node.range.items.splice(itemIndex, 1)
      node.range.items.splice(target, 0, item)
      changed = true
    })
    if (changed) bumpTextListStructureVersion(nodeId)
  }

  function allNodeChoices(nodes: FlowV2Node[]): Array<{ id: string; type: FlowV2Node['type'] }> {
    return nodes.flatMap((node) => {
      const nested = node.type === 'if'
        ? [
            ...node.branches.flatMap((branch) => allNodeChoices(branch.body)),
            ...(node.else ? allNodeChoices(node.else) : []),
          ]
        : node.type === 'for'
          ? allNodeChoices(node.body)
          : isControlTerminalNode(node) && node.body
            ? allNodeChoices(node.body)
            : []
      return [{ id: node.id, type: node.type }, ...nested]
    })
  }

  function isActionType(type: FlowV2Node['type']): boolean {
    return type === 'send' || type === 'notify' || type === 'input' || type === 'wait'
      || type === 'capture-source' || type === 'extract_text' || type === 'parallel'
  }

  function isActionEditorNode(node: FlowV2Node): node is EditableActionNode {
    return node.type === 'send' || node.type === 'notify' || node.type === 'input'
      || node.type === 'wait' || node.type === 'capture-source' || node.type === 'extract_text'
  }

  function isControlTerminalNode(
    node: FlowV2Node,
  ): node is Extract<FlowV2Node, { type: 'break' | 'continue' | 'finish' }> {
    return node.type === 'break' || node.type === 'continue' || node.type === 'finish'
  }

  function parallelContainsCurrentNode(node: ParallelNode): boolean {
    return Boolean(currentNodeId && node.lanes.some((lane) => lane.body.some((item) => item.id === currentNodeId)))
  }

</script>

<svelte:window onkeydown={handleInsertionKeydown} onresize={handleInsertionResize} />

{#if insertionNotice}
  <p class="macro-insertion-notice alert alert-warning rounded-none py-2 text-xs" data-testid="macro-insertion-notice">{insertionNotice}</p>
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
    {#each nodes as node, index (node.id)}
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
            artifactChoices={artifactChoicesBefore(draft, node.id)}
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
            artifactChoices={artifactChoicesBefore(draft, node.id)}
            {isIfBranchCollapsed}
            {toggleIfBranchCollapsed}
            {addElifAt}
            {ensureElseAt}
            {removeElifAt}
            {removeElseAt}
            {setForRangeMode}
            {textListItemEditorKey}
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

{#if insertionAnchor}
  <MacroInsertionPalette
    anchored={insertionPaletteAnchored}
    position={insertionPosition}
    style={insertionPaletteStyle}
    {insertionPaletteMode}
    summary={insertionSummary}
    actionOnly={insertionActionOnly}
    allowsLoopControls={insertionAllowsLoopControls}
    actionItems={actionPaletteItems}
    flowItems={flowPaletteItems}
    {moveNodeId}
    movableNodeChoices={movableNodeChoices()}
    blocked={insertionNotice.startsWith('Insertion failed:')}
    bind:paletteElement={insertionPaletteElement}
    onMoveNodeIdChange={(nodeId) => { moveNodeId = nodeId }}
    onInsert={insertFromPalette}
    onMoveExisting={moveExistingNodeFromPalette}
    onCancel={cancelInsertion}
  />
{/if}
