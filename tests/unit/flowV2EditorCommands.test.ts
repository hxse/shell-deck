import { expect, test } from "bun:test"
import { addElifToIfNode, canMoveNodeToAnchor, cloneBodyPath, ensureElseForIfNode, insertNodeAtAnchor, isInsertionAnchorValid, moveNodeAtPosition, moveNodeToAnchor, removeNodeAtPosition, resolveBodyPath, type BodyPath } from "../../src/lib/macro/flowV2EditorCommands"
import type { FlowV2Node, MacroTemplate } from "../../src/lib/macro/templateTypes"

function template(): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return {
    schemaVersion: 2,
    id: "tmpl_editor_commands",
    name: "Editor Commands",
    description: "",
    configId: "local",
    createdAt: now,
    updatedAt: now,
    body: [
      { id: "send_1", type: "send_line", terminal: { kind: "index", value: 1 }, message: { parts: [{ kind: "text", text: "one" }] } },
      {
        id: "if_ready",
        type: "if",
        branches: [{ kind: "if", condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture_1", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "READY" }, scope: { kind: "whole" } }, body: [] }],
      },
      { id: "loop", type: "for", range: { count: 2 }, body: [] },
    ],
  }
}

const finishNode = (id: string): FlowV2Node => ({ id, type: "finish", reason: id })

test("insertNodeAtAnchor inserts before, after and inside explicit body paths", () => {
  const t = template()
  expect(insertNodeAtAnchor(t, { kind: "before", parentPath: [], index: 1 }, finishNode("before_if")).ok).toBe(true)
  expect(t.body.map((node) => node.id)).toEqual(["send_1", "before_if", "if_ready", "loop"])

  expect(insertNodeAtAnchor(t, { kind: "after", parentPath: [], index: 1 }, finishNode("after_before")).ok).toBe(true)
  expect(t.body.map((node) => node.id)).toEqual(["send_1", "before_if", "after_before", "if_ready", "loop"])

  expect(insertNodeAtAnchor(t, { kind: "inside", parentPath: [], index: 3, slot: "if" }, finishNode("inside_if")).ok).toBe(true)
  const ifPath: BodyPath = [{ kind: "if-branch", nodeId: "if_ready", branchIndex: 0 }]
  expect(resolveBodyPath(t, ifPath)?.map((node) => node.id)).toEqual(["inside_if"])

  expect(insertNodeAtAnchor(t, { kind: "inside", parentPath: [], index: 4, slot: "for" }, finishNode("inside_for")).ok).toBe(true)
  expect(resolveBodyPath(t, [{ kind: "for", nodeId: "loop" }])?.map((node) => node.id)).toEqual(["inside_for"])
})

test("elif and else branches are explicit and support inside insertion", () => {
  const t = template()
  expect(addElifToIfNode(t, { bodyPath: [], index: 1 }, { kind: "elif", condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture_1", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "MAYBE" }, scope: { kind: "whole" } }, body: [] }).ok).toBe(true)
  expect(insertNodeAtAnchor(t, { kind: "inside", parentPath: [], index: 1, slot: "elif", branchIndex: 1 }, finishNode("inside_elif")).ok).toBe(true)
  expect(resolveBodyPath(t, [{ kind: "if-branch", nodeId: "if_ready", branchIndex: 1 }])?.map((node) => node.id)).toEqual(["inside_elif"])

  expect(ensureElseForIfNode(t, { bodyPath: [], index: 1 }).ok).toBe(true)
  expect(insertNodeAtAnchor(t, { kind: "inside", parentPath: [], index: 1, slot: "else" }, finishNode("inside_else")).ok).toBe(true)
  expect(resolveBodyPath(t, [{ kind: "if-else", nodeId: "if_ready" }])?.map((node) => node.id)).toEqual(["inside_else"])
})

test("move and remove stay in the same body", () => {
  const t = template()
  const forPath: BodyPath = [{ kind: "for", nodeId: "loop" }]
  const body = resolveBodyPath(t, forPath)
  if (!body) throw new Error("missing for body")
  body.push(finishNode("a"), finishNode("b"), finishNode("c"))

  expect(moveNodeAtPosition(t, { bodyPath: forPath, index: 1 }, -1).ok).toBe(true)
  expect(resolveBodyPath(t, forPath)?.map((node) => node.id)).toEqual(["b", "a", "c"])
  expect(moveNodeAtPosition(t, { bodyPath: forPath, index: 0 }, -1).ok).toBe(false)
  expect(t.body.map((node) => node.id)).toEqual(["send_1", "if_ready", "loop"])

  expect(removeNodeAtPosition(t, { bodyPath: forPath, index: 1 }).ok).toBe(true)
  expect(resolveBodyPath(t, forPath)?.map((node) => node.id)).toEqual(["b", "c"])
})

test("cloneBodyPath prevents editor state from sharing path objects", () => {
  const path: BodyPath = [{ kind: "for", nodeId: "loop" }]
  const cloned = cloneBodyPath(path)
  cloned[0].nodeId = "other"
  expect(path[0].nodeId).toBe("loop")
})

test("insertion anchors become stale when the original target node changes", () => {
  const t = template()
  expect(isInsertionAnchorValid(t, { kind: "after", parentPath: [], index: 0, anchorNodeId: "send_1" })).toBe(true)
  expect(isInsertionAnchorValid(t, { kind: "inside", parentPath: [], index: 1, slot: "if", anchorNodeId: "if_ready" })).toBe(true)

  t.body.splice(0, 1, { id: "replacement", type: "wait", mode: "duration", durationMs: 100 })
  expect(isInsertionAnchorValid(t, { kind: "after", parentPath: [], index: 0, anchorNodeId: "send_1" })).toBe(false)
  expect(insertNodeAtAnchor(t, { kind: "after", parentPath: [], index: 0, anchorNodeId: "send_1" }, finishNode("should_not_insert")).ok).toBe(false)

  t.body.splice(1, 1)
  expect(isInsertionAnchorValid(t, { kind: "inside", parentPath: [], index: 1, slot: "if", anchorNodeId: "if_ready" })).toBe(false)
})


test("insertion anchor validity is read-only for missing optional bodies", () => {
  const t = template()
  const ifNode = t.body[1]
  if (ifNode.type !== "if") throw new Error("missing if")
  expect(ifNode.else).toBeUndefined()
  expect(isInsertionAnchorValid(t, { kind: "inside", parentPath: [], index: 1, slot: "else", anchorNodeId: "if_ready" })).toBe(false)
  expect(ifNode.else).toBeUndefined()

  t.body.push({ id: "done", type: "finish", reason: "done" })
  const done = t.body[3]
  if (done.type !== "finish") throw new Error("missing finish")
  expect(done.body).toBeUndefined()
  expect(isInsertionAnchorValid(t, { kind: "inside", parentPath: [], index: 3, slot: "control", anchorNodeId: "done" })).toBe(false)
  expect(done.body).toBeUndefined()
})

test("canMoveNodeToAnchor allows action move into missing optional control body without mutating", () => {
  const t = template()
  t.body.push({ id: "done", type: "finish", reason: "done" })
  expect(canMoveNodeToAnchor(t, "send_1", { kind: "inside", parentPath: [], index: 3, slot: "control", anchorNodeId: "done" })).toBe(true)
  const done = t.body[3]
  if (done.type !== "finish") throw new Error("missing finish")
  expect(done.body).toBeUndefined()
  expect(canMoveNodeToAnchor(t, "if_ready", { kind: "inside", parentPath: [], index: 3, slot: "control", anchorNodeId: "done" })).toBe(false)
  expect(done.body).toBeUndefined()
})

test("inside control insertion creates missing optional body only during mutation", () => {
  const t = template()
  t.body.push({ id: "done", type: "finish", reason: "done" })
  const result = insertNodeAtAnchor(t, { kind: "inside", parentPath: [], index: 3, slot: "control", anchorNodeId: "done" }, { id: "send_before_finish", type: "send_line", terminal: { kind: "index", value: 1 }, message: { parts: [{ kind: "text", text: "before finish" }] } })
  expect(result.ok).toBe(true)
  const done = t.body[3]
  if (done.type !== "finish") throw new Error("missing finish")
  expect(done.body?.map((node) => node.id)).toEqual(["send_before_finish"])
})

test("moveNodeToAnchor moves existing nodes to explicit insertion anchors", () => {
  const t = template()
  expect(moveNodeToAnchor(t, "send_1", { kind: "after", parentPath: [], index: 2 }).ok).toBe(true)
  expect(t.body.map((node) => node.id)).toEqual(["if_ready", "loop", "send_1"])

  expect(moveNodeToAnchor(t, "send_1", { kind: "inside", parentPath: [], index: 1, slot: "for" }).ok).toBe(true)
  expect(t.body.map((node) => node.id)).toEqual(["if_ready", "loop"])
  expect(resolveBodyPath(t, [{ kind: "for", nodeId: "loop" }])?.map((node) => node.id)).toEqual(["send_1"])
})

test("moveNodeToAnchor rejects no-op moves to the same before or after anchor", () => {
  const t = template()
  expect(canMoveNodeToAnchor(t, "send_1", { kind: "before", parentPath: [], index: 0 })).toBe(false)
  expect(canMoveNodeToAnchor(t, "send_1", { kind: "after", parentPath: [], index: 0 })).toBe(false)
  expect(moveNodeToAnchor(t, "send_1", { kind: "before", parentPath: [], index: 0 }).ok).toBe(false)
  expect(moveNodeToAnchor(t, "send_1", { kind: "after", parentPath: [], index: 0 }).ok).toBe(false)
  expect(t.body.map((node) => node.id)).toEqual(["send_1", "if_ready", "loop"])
})

test("moveNodeToAnchor rejects moving a parent into its own descendant body", () => {
  const t = template()
  const forPath: BodyPath = [{ kind: "for", nodeId: "loop" }]
  const body = resolveBodyPath(t, forPath)
  if (!body) throw new Error("missing for body")
  body.push(finishNode("inside_loop"))

  const anchor = { kind: "after" as const, parentPath: forPath, index: 0 }
  expect(canMoveNodeToAnchor(t, "loop", anchor)).toBe(false)
  expect(moveNodeToAnchor(t, "loop", anchor).ok).toBe(false)
  expect(t.body.map((node) => node.id)).toEqual(["send_1", "if_ready", "loop"])
  expect(resolveBodyPath(t, forPath)?.map((node) => node.id)).toEqual(["inside_loop"])
})


test("control terminal bodies accept actions but reject flow nodes", () => {
  const t = template()
  t.body.push({ id: "done", type: "finish", reason: "done", body: [] })
  expect(insertNodeAtAnchor(t, { kind: "inside", parentPath: [], index: 3, slot: "control" }, { id: "send_before_finish", type: "send_line", terminal: { kind: "index", value: 1 }, message: { parts: [{ kind: "text", text: "before finish" }] } }).ok).toBe(true)
  expect(insertNodeAtAnchor(t, { kind: "inside", parentPath: [], index: 3, slot: "control" }, finishNode("nested_finish")).ok).toBe(false)
  expect(resolveBodyPath(t, [{ kind: "control", nodeId: "done" }])?.map((node) => node.id)).toEqual(["send_before_finish"])
})

test("moving existing flow nodes into control terminal bodies is rejected", () => {
  const t = template()
  t.body.push({ id: "done", type: "finish", reason: "done", body: [] })
  expect(canMoveNodeToAnchor(t, "send_1", { kind: "inside", parentPath: [], index: 3, slot: "control" })).toBe(true)
  expect(canMoveNodeToAnchor(t, "if_ready", { kind: "inside", parentPath: [], index: 3, slot: "control" })).toBe(false)
  expect(moveNodeToAnchor(t, "if_ready", { kind: "inside", parentPath: [], index: 3, slot: "control" }).ok).toBe(false)
  expect(t.body.map((node) => node.id)).toEqual(["send_1", "if_ready", "loop", "done"])
})
