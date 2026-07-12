import type { FlowV2IfBranch, FlowV2Node, MacroTemplate } from "./templateTypes"

export type BodyPathSegment =
  | { kind: "if-branch"; nodeId: string; branchIndex: number }
  | { kind: "if-else"; nodeId: string }
  | { kind: "for"; nodeId: string }
  | { kind: "control"; nodeId: string }

export type BodyPath = BodyPathSegment[]

export type NodePosition = {
  bodyPath: BodyPath
  index: number
}

export type InsertionAnchor =
  | { kind: "before"; parentPath: BodyPath; index: number; anchorNodeId?: string }
  | { kind: "after"; parentPath: BodyPath; index: number; anchorNodeId?: string }
  | { kind: "inside"; parentPath: BodyPath; index: number; slot: "if" | "elif" | "else" | "for" | "control"; branchIndex?: number; anchorNodeId?: string }

export type CommandResult = {
  ok: boolean
  reason?: "body_not_found" | "node_not_found" | "invalid_target" | "out_of_bounds"
}

export function cloneBodyPath(path: BodyPath): BodyPath {
  return path.map((segment) => ({ ...segment }))
}

export function resolveBodyPath(template: MacroTemplate, path: BodyPath): FlowV2Node[] | undefined {
  let body = template.body
  for (const segment of path) {
    const node = body.find((candidate) => candidate.id === segment.nodeId)
    if (!node) return undefined
    if (segment.kind === "for") {
      if (node.type !== "for") return undefined
      body = node.body
    } else if (segment.kind === "control") {
      if (!isControlTerminalNode(node)) return undefined
      if (!node.body) return undefined
      body = node.body
    } else if (segment.kind === "if-else") {
      if (node.type !== "if") return undefined
      if (!node.else) return undefined
      body = node.else
    } else {
      if (node.type !== "if") return undefined
      const branch = node.branches[segment.branchIndex]
      if (!branch) return undefined
      body = branch.body
    }
  }
  return body
}

export function insertNodeAtAnchor(template: MacroTemplate, anchor: InsertionAnchor, node: FlowV2Node): CommandResult {
  if (anchor.kind === "before" || anchor.kind === "after") {
    const body = resolveBodyPath(template, anchor.parentPath)
    if (!body) return { ok: false, reason: "body_not_found" }
    if (anchor.anchorNodeId && body[anchor.index]?.id !== anchor.anchorNodeId) return { ok: false, reason: "node_not_found" }
    const insertIndex = anchor.kind === "before" ? anchor.index : anchor.index + 1
    if (insertIndex < 0 || insertIndex > body.length) return { ok: false, reason: "out_of_bounds" }
    if (isActionOnlyBodyPath(anchor.parentPath) && !isActionNode(node)) return { ok: false, reason: "invalid_target" }
    body.splice(insertIndex, 0, node)
    return { ok: true }
  }

  const parentBody = resolveBodyPath(template, anchor.parentPath)
  if (!parentBody) return { ok: false, reason: "body_not_found" }
  const target = parentBody[anchor.index]
  if (!target) return { ok: false, reason: "node_not_found" }
  if (anchor.anchorNodeId && target.id !== anchor.anchorNodeId) return { ok: false, reason: "node_not_found" }

  const innerBody = bodyForInsideAnchor(target, anchor)
  if (!innerBody) return { ok: false, reason: "invalid_target" }
  const innerPath = insideAnchorBodyPath(target, anchor.parentPath, anchor)
  if (innerPath && isActionOnlyBodyPath(innerPath) && !isActionNode(node)) return { ok: false, reason: "invalid_target" }
  innerBody.push(node)
  return { ok: true }
}

export function removeNodeAtPosition(template: MacroTemplate, position: NodePosition): CommandResult {
  const body = resolveBodyPath(template, position.bodyPath)
  if (!body) return { ok: false, reason: "body_not_found" }
  if (position.index < 0 || position.index >= body.length) return { ok: false, reason: "out_of_bounds" }
  body.splice(position.index, 1)
  return { ok: true }
}

export function moveNodeAtPosition(template: MacroTemplate, position: NodePosition, offset: -1 | 1): CommandResult {
  const body = resolveBodyPath(template, position.bodyPath)
  if (!body) return { ok: false, reason: "body_not_found" }
  const targetIndex = position.index + offset
  if (position.index < 0 || position.index >= body.length) return { ok: false, reason: "out_of_bounds" }
  if (targetIndex < 0 || targetIndex >= body.length) return { ok: false, reason: "out_of_bounds" }
  const [node] = body.splice(position.index, 1)
  body.splice(targetIndex, 0, node)
  return { ok: true }
}

export function findNodePosition(template: MacroTemplate, nodeId: string): NodePosition | undefined {
  return findNodePositionInBody(template.body, nodeId, [])
}

export function canMoveNodeToAnchor(template: MacroTemplate, nodeId: string, anchor: InsertionAnchor): boolean {
  const sourcePosition = findNodePosition(template, nodeId)
  const source = sourcePosition ? findNodeById(template, nodeId) : undefined
  if (!sourcePosition || !source) return false

  const probe = cloneTemplateForCommandProbe(template)
  const target = resolveInsertionTarget(probe, anchor, true)
  if (!target) return false
  if (isActionOnlyBodyPath(target.bodyPath) && !isActionNode(source)) return false
  if (target.bodyPath.some((segment) => segment.nodeId === nodeId)) return false
  if (sameBodyPath(sourcePosition.bodyPath, target.bodyPath) && (target.index === sourcePosition.index || target.index === sourcePosition.index + 1)) return false
  return true
}

export function isInsertionAnchorValid(template: MacroTemplate, anchor: InsertionAnchor): boolean {
  return resolveInsertionTarget(template, anchor, false) !== undefined
}

export function moveNodeToAnchor(template: MacroTemplate, nodeId: string, anchor: InsertionAnchor): CommandResult {
  const sourcePosition = findNodePosition(template, nodeId)
  if (!sourcePosition) return { ok: false, reason: "node_not_found" }
  const sourceBody = resolveBodyPath(template, sourcePosition.bodyPath)
  if (!sourceBody) return { ok: false, reason: "body_not_found" }
  const sourceNode = sourceBody[sourcePosition.index]
  const target = resolveInsertionTarget(template, anchor, true)
  if (!target) return { ok: false, reason: "invalid_target" }
  if (target.bodyPath.some((segment) => segment.nodeId === nodeId)) return { ok: false, reason: "invalid_target" }
  if (isActionOnlyBodyPath(target.bodyPath) && !isActionNode(sourceNode)) return { ok: false, reason: "invalid_target" }
  if (sameBodyPath(sourcePosition.bodyPath, target.bodyPath) && (target.index === sourcePosition.index || target.index === sourcePosition.index + 1)) return { ok: false, reason: "invalid_target" }

  if (sourcePosition.index < 0 || sourcePosition.index >= sourceBody.length) return { ok: false, reason: "out_of_bounds" }

  let insertIndex = target.index
  if (sameBodyPath(sourcePosition.bodyPath, target.bodyPath) && sourcePosition.index < insertIndex) insertIndex -= 1
  if (insertIndex < 0 || insertIndex > target.body.length) return { ok: false, reason: "out_of_bounds" }

  const [node] = sourceBody.splice(sourcePosition.index, 1)
  target.body.splice(insertIndex, 0, node)
  return { ok: true }
}

export function insertElifBranchAfter(template: MacroTemplate, position: NodePosition, afterBranchIndex: number, branch: FlowV2IfBranch): CommandResult {
  const body = resolveBodyPath(template, position.bodyPath)
  if (!body) return { ok: false, reason: "body_not_found" }
  const node = body[position.index]
  if (!node) return { ok: false, reason: "node_not_found" }
  if (node.type !== "if") return { ok: false, reason: "invalid_target" }
  if (branch.kind !== "elif") return { ok: false, reason: "invalid_target" }
  if (afterBranchIndex < 0 || afterBranchIndex >= node.branches.length) return { ok: false, reason: "out_of_bounds" }
  node.branches.splice(afterBranchIndex + 1, 0, branch)
  return { ok: true }
}

export function removeIfBranchAt(template: MacroTemplate, position: NodePosition, branchIndex: number): CommandResult {
  const body = resolveBodyPath(template, position.bodyPath)
  if (!body) return { ok: false, reason: "body_not_found" }
  const node = body[position.index]
  if (!node) return { ok: false, reason: "node_not_found" }
  if (node.type !== "if") return { ok: false, reason: "invalid_target" }
  if (branchIndex === 0) return { ok: false, reason: "invalid_target" }
  if (branchIndex < 0 || branchIndex >= node.branches.length) return { ok: false, reason: "out_of_bounds" }
  if (node.branches[branchIndex].kind !== "elif") return { ok: false, reason: "invalid_target" }
  node.branches.splice(branchIndex, 1)
  return { ok: true }
}

export function ensureElseForIfNode(template: MacroTemplate, position: NodePosition): CommandResult {
  const body = resolveBodyPath(template, position.bodyPath)
  if (!body) return { ok: false, reason: "body_not_found" }
  const node = body[position.index]
  if (!node) return { ok: false, reason: "node_not_found" }
  if (node.type !== "if") return { ok: false, reason: "invalid_target" }
  node.else ??= []
  return { ok: true }
}

export function removeElseFromIfNode(template: MacroTemplate, position: NodePosition): CommandResult {
  const body = resolveBodyPath(template, position.bodyPath)
  if (!body) return { ok: false, reason: "body_not_found" }
  const node = body[position.index]
  if (!node) return { ok: false, reason: "node_not_found" }
  if (node.type !== "if") return { ok: false, reason: "invalid_target" }
  if (!node.else) return { ok: false, reason: "out_of_bounds" }
  delete node.else
  return { ok: true }
}

type InsertionTarget = {
  body: FlowV2Node[]
  bodyPath: BodyPath
  index: number
}

function findNodePositionInBody(nodes: FlowV2Node[], nodeId: string, bodyPath: BodyPath): NodePosition | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node.id === nodeId) return { bodyPath: cloneBodyPath(bodyPath), index }
    if (node.type === "if") {
      for (let branchIndex = 0; branchIndex < node.branches.length; branchIndex += 1) {
        const found = findNodePositionInBody(node.branches[branchIndex].body, nodeId, [...bodyPath, { kind: "if-branch", nodeId: node.id, branchIndex }])
        if (found) return found
      }
      if (node.else) {
        const found = findNodePositionInBody(node.else, nodeId, [...bodyPath, { kind: "if-else", nodeId: node.id }])
        if (found) return found
      }
    }
    if (node.type === "for") {
      const found = findNodePositionInBody(node.body, nodeId, [...bodyPath, { kind: "for", nodeId: node.id }])
      if (found) return found
    }
    if (isControlTerminalNode(node) && node.body) {
      const found = findNodePositionInBody(node.body, nodeId, [...bodyPath, { kind: "control", nodeId: node.id }])
      if (found) return found
    }
  }
  return undefined
}

function resolveInsertionTarget(template: MacroTemplate, anchor: InsertionAnchor, createMissingBody: boolean): InsertionTarget | undefined {
  if (anchor.kind === "before" || anchor.kind === "after") {
    const body = resolveBodyPath(template, anchor.parentPath)
    if (!body) return undefined
    if (anchor.anchorNodeId && body[anchor.index]?.id !== anchor.anchorNodeId) return undefined
    const index = anchor.kind === "before" ? anchor.index : anchor.index + 1
    if (index < 0 || index > body.length) return undefined
    return { body, bodyPath: cloneBodyPath(anchor.parentPath), index }
  }

  const parentBody = resolveBodyPath(template, anchor.parentPath)
  if (!parentBody) return undefined
  const target = parentBody[anchor.index]
  if (!target) return undefined
  if (anchor.anchorNodeId && target.id !== anchor.anchorNodeId) return undefined
  const bodyPath = insideAnchorBodyPath(target, anchor.parentPath, anchor)
  if (!bodyPath) return undefined
  const body = createMissingBody ? bodyForInsideAnchor(target, anchor) : maybeBodyForInsideAnchor(target, anchor)
  if (!body) return undefined
  return { body, bodyPath, index: body.length }
}

function insideAnchorBodyPath(node: FlowV2Node, parentPath: BodyPath, anchor: Extract<InsertionAnchor, { kind: "inside" }>): BodyPath | undefined {
  if (anchor.slot === "control") return isControlTerminalNode(node) ? [...cloneBodyPath(parentPath), { kind: "control", nodeId: node.id }] : undefined
  if (anchor.slot === "for") return node.type === "for" ? [...cloneBodyPath(parentPath), { kind: "for", nodeId: node.id }] : undefined
  if (node.type !== "if") return undefined
  if (anchor.slot === "else") return [...cloneBodyPath(parentPath), { kind: "if-else", nodeId: node.id }]
  if (anchor.slot === "if") return node.branches[0] ? [...cloneBodyPath(parentPath), { kind: "if-branch", nodeId: node.id, branchIndex: 0 }] : undefined
  const branchIndex = anchor.branchIndex ?? 0
  const branch = node.branches[branchIndex]
  return branch?.kind === "elif" ? [...cloneBodyPath(parentPath), { kind: "if-branch", nodeId: node.id, branchIndex }] : undefined
}

function cloneTemplateForCommandProbe(template: MacroTemplate): MacroTemplate {
  return JSON.parse(JSON.stringify(template)) as MacroTemplate
}

function sameBodyPath(left: BodyPath, right: BodyPath): boolean {
  if (left.length !== right.length) return false
  return left.every((segment, index) => {
    const other = right[index]
    if (segment.kind !== other.kind || segment.nodeId !== other.nodeId) return false
    return segment.kind !== "if-branch" || other.kind !== "if-branch" || segment.branchIndex === other.branchIndex
  })
}

function findNodeById(template: MacroTemplate, nodeId: string): FlowV2Node | undefined {
  const position = findNodePosition(template, nodeId)
  if (!position) return undefined
  return resolveBodyPath(template, position.bodyPath)?.[position.index]
}

function isActionOnlyBodyPath(path: BodyPath): boolean {
  return path.some((segment) => segment.kind === "control")
}

function isActionNode(node: FlowV2Node): boolean {
  return node.type === "send" || node.type === "notify" || node.type === "input" || node.type === "wait" || node.type === "capture-source" || node.type === "extract_text" || node.type === "parallel"
}

function isControlTerminalNode(node: FlowV2Node): node is Extract<FlowV2Node, { type: "break" | "continue" | "finish" }> {
  return node.type === "break" || node.type === "continue" || node.type === "finish"
}

function maybeBodyForInsideAnchor(node: FlowV2Node, anchor: Extract<InsertionAnchor, { kind: "inside" }>): FlowV2Node[] | undefined {
  if (anchor.slot === "control") return isControlTerminalNode(node) ? node.body : undefined
  if (anchor.slot === "for") return node.type === "for" ? node.body : undefined
  if (node.type !== "if") return undefined
  if (anchor.slot === "else") return node.else
  if (anchor.slot === "if") return node.branches[0]?.body
  const branchIndex = anchor.branchIndex ?? 0
  const branch = node.branches[branchIndex]
  return branch?.kind === "elif" ? branch.body : undefined
}

function bodyForInsideAnchor(node: FlowV2Node, anchor: Extract<InsertionAnchor, { kind: "inside" }>): FlowV2Node[] | undefined {
  if (anchor.slot === "control") return isControlTerminalNode(node) ? (node.body ??= []) : undefined
  if (anchor.slot === "for") return node.type === "for" ? node.body : undefined
  if (node.type !== "if") return undefined
  if (anchor.slot === "else") return node.else ??= []
  if (anchor.slot === "if") return node.branches[0]?.body
  const branchIndex = anchor.branchIndex ?? 0
  const branch = node.branches[branchIndex]
  return branch?.kind === "elif" ? branch.body : undefined
}
