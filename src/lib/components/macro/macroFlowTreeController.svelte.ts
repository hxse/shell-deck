import type { FlowV2Node, MacroDefinitionV5, TextListItem } from '../../macro/macroDefinitionTypes'
import {
  allMacroNodeIds,
  defaultTextMatchCondition,
  unassignedArtifactSource,
} from '../../macro/macroEditorDefaults'
import {
  cloneBodyPath,
  ensureElseForIfNode,
  insertElifBranchAfter,
  moveNodeAtPosition,
  removeElseFromIfNode,
  removeIfBranchAt,
  removeNodeAtPosition,
  resolveBodyPath,
  type BodyPath,
} from '../../macro/flowV2EditorCommands'
import { hasNonDefaultTextListItems } from '../../macro/scopedTextTemplateEditor'

type MacroFlowTreeControllerOptions = {
  draft(): MacroDefinitionV5
  updateDraft(mutator: (template: MacroDefinitionV5) => void): void
  setInsertionNotice(notice: string): void
}

export function createMacroFlowTreeController(options: MacroFlowTreeControllerOptions) {
  let collapsedNodeIds = $state<string[]>([])
  let collapsedIfBranchKeys = $state<string[]>([])
  let idEditNotice = $state('')
  let textListStructureVersions = $state<Record<string, number>>({})

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

  function moveNodeAt(bodyPath: BodyPath, index: number, offset: -1 | 1): void {
    options.updateDraft((template) => {
      moveNodeAtPosition(template, { bodyPath: cloneBodyPath(bodyPath), index }, offset)
    })
  }

  function removeNodeAt(bodyPath: BodyPath, index: number, nodeId: string): void {
    if (!confirm('Remove macro node ' + nodeId + '?')) return
    const removedNode = resolveBodyPath(options.draft(), bodyPath)?.[index]
    const removedNodeIds = removedNode ? allMacroNodeIds([removedNode]) : [nodeId]
    options.updateDraft((template) => {
      removeNodeAtPosition(template, { bodyPath: cloneBodyPath(bodyPath), index })
    })
    clearCollapseStateForNodeIds(removedNodeIds)
  }

  function addElifAt(
    bodyPath: BodyPath,
    index: number,
    afterBranchIndex: number,
    nodeId: string,
  ): void {
    let inserted = false
    options.updateDraft((template) => {
      inserted = insertElifBranchAfter(
        template,
        { bodyPath: cloneBodyPath(bodyPath), index },
        afterBranchIndex,
        { kind: 'elif', condition: defaultTextMatchCondition(unassignedArtifactSource()), body: [] },
      ).ok
    })
    if (inserted) shiftIfBranchCollapseKeys(nodeId, afterBranchIndex + 1, 1)
    else options.setInsertionNotice('Add elif failed.')
  }

  function ensureElseAt(bodyPath: BodyPath, index: number): void {
    options.updateDraft((template) => {
      ensureElseForIfNode(template, { bodyPath: cloneBodyPath(bodyPath), index })
    })
  }

  function removeElifAt(bodyPath: BodyPath, index: number, branchIndex: number, nodeId: string): void {
    if (!confirm('Remove elif branch and its contents?')) return
    const node = resolveBodyPath(options.draft(), bodyPath)?.[index]
    const removedNodeIds = node?.type === 'if' ? allMacroNodeIds(node.branches[branchIndex]?.body ?? []) : []
    options.updateDraft((template) => {
      removeIfBranchAt(template, { bodyPath: cloneBodyPath(bodyPath), index }, branchIndex)
    })
    clearCollapseStateForNodeIds(removedNodeIds)
    shiftIfBranchCollapseKeys(nodeId, branchIndex + 1, -1, branchIndex)
  }

  function removeElseAt(bodyPath: BodyPath, index: number, nodeId: string): void {
    if (!confirm('Remove else branch and its contents?')) return
    const node = resolveBodyPath(options.draft(), bodyPath)?.[index]
    const removedNodeIds = node?.type === 'if' ? allMacroNodeIds(node.else ?? []) : []
    options.updateDraft((template) => {
      removeElseFromIfNode(template, { bodyPath: cloneBodyPath(bodyPath), index })
    })
    clearCollapseStateForNodeIds(removedNodeIds)
    collapsedIfBranchKeys = collapsedIfBranchKeys.filter((key) => (
      key !== ifBranchCollapseKey(nodeId, 'else')
    ))
  }

  function updateNode(nodeId: string, mutator: (node: FlowV2Node) => void): void {
    options.updateDraft((template) => {
      const node = findNode(template.body, nodeId)
      if (node) mutator(node)
    })
  }

  function setNodeId(oldId: string, nextId: string): boolean {
    if (nextId !== oldId && allMacroNodeIds(options.draft().body).includes(nextId)) {
      idEditNotice = 'Duplicate node id blocked: ' + nextId
      return false
    }
    idEditNotice = ''
    updateNode(oldId, (node) => { node.id = nextId })
    collapsedNodeIds = collapsedNodeIds.map((id) => id === oldId ? nextId : id)
    const prefix = oldId + ':branch:'
    collapsedIfBranchKeys = collapsedIfBranchKeys.map((key) => (
      key.startsWith(prefix) ? nextId + ':branch:' + key.slice(prefix.length) : key
    ))
    return true
  }

  function clearCollapseStateForNodeIds(nodeIds: string[]): void {
    if (nodeIds.length === 0) return
    const removed = new Set(nodeIds)
    collapsedNodeIds = collapsedNodeIds.filter((id) => !removed.has(id))
    collapsedIfBranchKeys = collapsedIfBranchKeys.filter((key) => (
      !nodeIds.some((nodeId) => key.startsWith(nodeId + ':branch:'))
    ))
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

  function setForRangeMode(nodeId: string, mode: 'count' | 'forever' | 'text-list'): boolean {
    const current = findNode(options.draft().body, nodeId)
    if (current?.type !== 'for') return false
    if (current.range.kind === 'text-list' && mode !== 'text-list'
      && hasNonDefaultTextListItems(current.range.items)
      && !confirm('Switching from text-list will discard its items. Continue?')) return false
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

  return {
    get idEditNotice() { return idEditNotice },
    isNodeCollapsed,
    toggleNodeCollapsed,
    isIfBranchCollapsed,
    toggleIfBranchCollapsed,
    moveNodeAt,
    removeNodeAt,
    addElifAt,
    ensureElseAt,
    removeElifAt,
    removeElseAt,
    updateNode,
    setNodeId,
    findNode,
    setForRangeMode,
    textListItemEditorKey,
    insertTextListItem,
    updateTextListItem,
    removeTextListItem,
    moveTextListItem,
  }
}

function isControlTerminalNode(
  node: FlowV2Node,
): node is Extract<FlowV2Node, { type: 'break' | 'continue' | 'finish' }> {
  return node.type === 'break' || node.type === 'continue' || node.type === 'finish'
}
