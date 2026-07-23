import type {
  FlowV2Node,
  MacroDefinitionV5,
  MacroTerminalReference,
} from '../../macro/macroDefinitionTypes'
import { defaultFlowNode } from '../../macro/macroEditorDefaults'
import {
  canMoveNodeToAnchor,
  cloneBodyPath,
  findNodePosition,
  isInsertionAnchorValid,
  insertNodeAtAnchor,
  moveNodeToAnchor,
  type BodyPath,
  type InsertionAnchor,
} from '../../macro/flowV2EditorCommands'
import type { MacroInsertionPaletteMode } from '../../workspace/uiLayoutTypes'

type InsertionPalettePosition = {
  x: number
  y: number
  placement: 'above' | 'below'
  maxHeight?: number
}

type MacroPaletteItem = {
  type: FlowV2Node['type']
  label: string
  testId: string
  loopOnly?: boolean
}

type InsertionPaletteLifecycle = {
  open(
    event: MouseEvent | undefined,
    mode: MacroInsertionPaletteMode,
  ): InsertionPalettePosition | null
  settle(
    mode: () => MacroInsertionPaletteMode,
    position: () => InsertionPalettePosition | null,
    paletteElement: () => HTMLElement | null,
    setPosition: (position: InsertionPalettePosition) => void,
    shouldFocus: boolean,
  ): Promise<void>
  close(clear: () => void, restoreFocus: boolean): void
  handleKeydown(event: KeyboardEvent, isOpen: boolean, cancel: () => void): void
}

type MacroFlowInsertionControllerOptions = {
  draft(): MacroDefinitionV5
  updateDraft(mutator: (template: MacroDefinitionV5) => void): void
  insertionPaletteMode(): MacroInsertionPaletteMode
  adoptTerminalSelection(template: MacroDefinitionV5, terminalIndex: number): boolean
  lifecycle: InsertionPaletteLifecycle
}

const ACTION_PALETTE_ITEMS: MacroPaletteItem[] = [
  { type: 'send', label: 'send', testId: 'add-step-send' },
  { type: 'notify', label: 'notify', testId: 'add-step-notify' },
  { type: 'input', label: 'input', testId: 'add-step-input' },
  { type: 'wait', label: 'wait', testId: 'add-step-wait' },
  { type: 'capture-source', label: 'capture', testId: 'add-step-capture' },
  { type: 'extract_text', label: 'extract', testId: 'add-step-extract' },
  { type: 'parallel', label: 'parallel', testId: 'add-step-parallel' },
]

const FLOW_PALETTE_ITEMS: MacroPaletteItem[] = [
  { type: 'if', label: 'if', testId: 'add-flow-if' },
  { type: 'for', label: 'for', testId: 'add-flow-for' },
  { type: 'finish', label: 'finish', testId: 'add-flow-finish' },
  { type: 'break', label: 'break', testId: 'add-flow-break', loopOnly: true },
  { type: 'continue', label: 'continue', testId: 'add-flow-continue', loopOnly: true },
]

export function createMacroFlowInsertionController(
  options: MacroFlowInsertionControllerOptions,
) {
  let anchor = $state<InsertionAnchor | null>(null)
  let summary = $state('')
  let allowsLoopControls = $state(false)
  let position = $state<InsertionPalettePosition | null>(null)
  let actionOnly = $state(false)
  let paletteElement = $state<HTMLElement | null>(null)
  let notice = $state('')
  let moveNodeId = $state('')
  const lifecycle = options.lifecycle

  $effect(() => {
    const current = anchor
    if (!current || isOpenAnchorValid(current)) return
    notice = 'Insertion target changed. Choose an insertion point again.'
    closeInsertion(false)
  })

  function isOpenAnchorValid(current: InsertionAnchor): boolean {
    if (isInsertionAnchorValid(options.draft(), current)) return true
    const anchorNodeId = current.anchorNodeId
    return current.kind === 'inside'
      && current.slot === 'control'
      && anchorNodeId !== undefined
      && findNodePosition(options.draft(), anchorNodeId) !== undefined
  }

  function openInsertion(
    nextAnchor: InsertionAnchor,
    nextSummary: string,
    allowLoopControls: boolean,
    event?: MouseEvent,
    nextActionOnly = false,
  ): void {
    notice = ''
    anchor = { ...nextAnchor, parentPath: cloneBodyPath(nextAnchor.parentPath) }
    summary = nextSummary
    allowsLoopControls = allowLoopControls
    actionOnly = nextActionOnly
    position = lifecycle.open(event, options.insertionPaletteMode())
    moveNodeId = ''
    void settlePalette(true)
  }

  async function settlePalette(shouldFocus: boolean): Promise<void> {
    await lifecycle.settle(
      options.insertionPaletteMode,
      () => position,
      () => paletteElement,
      (nextPosition) => { position = nextPosition },
      shouldFocus,
    )
  }

  function handleResize(): void {
    if (anchor) void settlePalette(false)
  }

  function handleKeydown(event: KeyboardEvent): void {
    lifecycle.handleKeydown(event, anchor !== null, cancelInsertion)
  }

  function closeInsertion(restoreFocus: boolean): void {
    lifecycle.close(() => {
      anchor = null
      summary = ''
      allowsLoopControls = false
      actionOnly = false
      position = null
      paletteElement = null
      moveNodeId = ''
    }, restoreFocus)
  }

  function cancelInsertion(): void {
    closeInsertion(true)
  }

  function insertFromPalette(type: FlowV2Node['type']): void {
    if (!anchor) return
    const target = anchor
    let inserted = false
    let reason = 'unknown'
    options.updateDraft((template) => {
      const result = insertNodeAtAnchor(template, target, defaultFlowNode(template, type))
      inserted = result.ok
      reason = result.reason ?? 'unknown'
    })
    if (inserted) cancelInsertion()
    else {
      notice = 'Insertion failed: ' + reason
      void settlePalette(false)
    }
  }

  function moveExistingNodeFromPalette(): void {
    if (!anchor || !moveNodeId) return
    const target = { ...anchor, parentPath: cloneBodyPath(anchor.parentPath) } as InsertionAnchor
    const nodeId = moveNodeId
    let moved = false
    options.updateDraft((template) => {
      moved = moveNodeToAnchor(template, nodeId, target).ok
    })
    if (moved) cancelInsertion()
  }

  function movableNodeChoices(): Array<{ id: string; type: FlowV2Node['type'] }> {
    const target = anchor
    if (!target) return []
    return allNodeChoices(options.draft().body)
      .filter((choice) => (
        (!actionOnly || isActionType(choice.type))
        && canMoveNodeToAnchor(options.draft(), choice.id, target)
      ))
  }

  function beforeAnchor(
    bodyPath: BodyPath,
    index: number,
    anchorNodeId?: string,
  ): InsertionAnchor {
    return { kind: 'before', parentPath: cloneBodyPath(bodyPath), index, anchorNodeId }
  }

  function afterAnchor(
    bodyPath: BodyPath,
    index: number,
    anchorNodeId?: string,
  ): InsertionAnchor {
    return { kind: 'after', parentPath: cloneBodyPath(bodyPath), index, anchorNodeId }
  }

  function insideAnchor(
    bodyPath: BodyPath,
    index: number,
    slot: Extract<InsertionAnchor, { kind: 'inside' }>['slot'],
    branchIndex?: number,
    anchorNodeId?: string,
  ): InsertionAnchor {
    return {
      kind: 'inside',
      parentPath: cloneBodyPath(bodyPath),
      index,
      slot,
      branchIndex,
      anchorNodeId,
    }
  }

  function insertIntoEmptyBody(
    bodyPath: BodyPath,
    label: string,
    allowLoopControls: boolean,
    event?: MouseEvent,
    nextActionOnly = false,
  ): void {
    const emptyAnchor = emptyBodyInsertionAnchor(bodyPath)
    if (!emptyAnchor) {
      notice = 'Insertion failed: body_not_found'
      return
    }
    openInsertion(
      emptyAnchor,
      'Insert into ' + label,
      allowLoopControls,
      event,
      nextActionOnly,
    )
  }

  function emptyBodyInsertionAnchor(bodyPath: BodyPath): InsertionAnchor | null {
    const last = bodyPath[bodyPath.length - 1]
    if (last?.kind === 'control') {
      const nodePosition = findNodePosition(options.draft(), last.nodeId)
      if (!nodePosition) return null
      return insideAnchor(
        nodePosition.bodyPath,
        nodePosition.index,
        'control',
        undefined,
        last.nodeId,
      )
    }
    return { kind: 'before', parentPath: cloneBodyPath(bodyPath), index: 0 }
  }

  function updateNodeTerminal(
    nodeId: string,
    terminal: MacroTerminalReference,
    mutator: (node: FlowV2Node) => void,
  ): boolean {
    let updated = false
    options.updateDraft((template) => {
      if (terminal.kind === 'terminal_index'
        && !options.adoptTerminalSelection(template, terminal.index)) return
      const node = findNode(template.body, nodeId)
      if (!node) return
      mutator(node)
      updated = true
    })
    return updated
  }

  function expectedTerminalTypeAt(
    reference: MacroTerminalReference,
  ): 'shell' | 'text' | undefined {
    return reference.kind === 'terminal_index'
      ? options.draft().terminalLayout[reference.index - 1]?.type
      : undefined
  }

  function setNotice(nextNotice: string): void {
    notice = nextNotice
  }

  function setMoveNodeId(nodeId: string): void {
    moveNodeId = nodeId
  }

  return {
    get anchor() { return anchor },
    get summary() { return summary },
    get allowsLoopControls() { return allowsLoopControls },
    get position() { return position },
    get actionOnly() { return actionOnly },
    get paletteElement() { return paletteElement },
    set paletteElement(element: HTMLElement | null) { paletteElement = element },
    get notice() { return notice },
    get moveNodeId() { return moveNodeId },
    get paletteAnchored() {
      return options.insertionPaletteMode() === 'anchored' && position !== null
    },
    get paletteStyle() {
      return options.insertionPaletteMode() === 'anchored' && position
        ? '--palette-x: ' + position.x + 'px; --palette-y: ' + position.y + 'px;'
          + (position.maxHeight ? ' --palette-max-height: ' + position.maxHeight + 'px;' : '')
        : ''
    },
    actionPaletteItems: ACTION_PALETTE_ITEMS,
    flowPaletteItems: FLOW_PALETTE_ITEMS,
    setNotice,
    setMoveNodeId,
    openInsertion,
    handleResize,
    handleKeydown,
    cancelInsertion,
    insertFromPalette,
    moveExistingNodeFromPalette,
    movableNodeChoices,
    beforeAnchor,
    afterAnchor,
    insideAnchor,
    insertIntoEmptyBody,
    updateNodeTerminal,
    expectedTerminalTypeAt,
  }
}

function allNodeChoices(
  nodes: FlowV2Node[],
): Array<{ id: string; type: FlowV2Node['type'] }> {
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

function isActionType(type: FlowV2Node['type']): boolean {
  return type === 'send' || type === 'notify' || type === 'input' || type === 'wait'
    || type === 'capture-source' || type === 'extract_text' || type === 'parallel'
}

function isControlTerminalNode(
  node: FlowV2Node,
): node is Extract<FlowV2Node, { type: 'break' | 'continue' | 'finish' }> {
  return node.type === 'break' || node.type === 'continue' || node.type === 'finish'
}
