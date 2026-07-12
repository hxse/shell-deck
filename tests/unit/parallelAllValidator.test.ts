import { expect, test } from "bun:test"
import { validateFlowV2Template } from "../../src/lib/macro/flowV2Schema"
import type { MacroTemplate, ParallelLane, ParallelNode } from "../../src/lib/macro/templateTypes"

const indexMap = [
  { index: 1, terminalId: "term_docs", terminalAlias: "docs" },
  { index: 2, terminalId: "term_tests", terminalAlias: "tests" },
  { index: 3, terminalId: "term_worker", terminalAlias: "worker" },
]

function template(): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return { schemaVersion: 2, id: "parallel_template", name: "Parallel", description: "", configId: "local", createdAt: now, updatedAt: now, body: [parallelNode()] }
}

function parallelNode(): ParallelNode {
  return {
    id: "parallel_review",
    type: "parallel",
    lanes: [lane("docs"), lane("tests")],
    merge: { kind: "sectioned_text", separator: "===== {laneId} | {laneLabel} | {terminalAlias} =====", includeEmptyOutputs: true },
    onLaneFail: "pause",
  }
}

function lane(alias: "docs" | "tests"): ParallelLane {
  const terminal = { kind: "alias" as const, value: alias }
  return {
    id: alias,
    label: alias,
    terminal,
    body: [
      { id: "send_" + alias, type: "send" as const, terminal, message: { parts: [{ kind: "text" as const, text: "review " + alias }] }, ending: "cr" },
      { id: "wait_" + alias, type: "wait" as const, mode: "terminal-quiet" as const, terminal, quietMs: 10, maxMs: 1000, onTimeout: "pause" as const },
      { id: "capture_" + alias, type: "capture-source" as const, capture: { kind: "terminal-buffer" as const, terminal, mode: "scrollback-tail" as const, maxChars: 12000 } },
      { id: "output_" + alias, type: "output" as const, source: { kind: "step_artifact" as const, stepId: "capture_" + alias, artifact: "captured_text" as const } },
    ],
  }
}

function text(value: MacroTemplate) {
  return validateFlowV2Template(value, { indexMap }).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
}

test("parallel validates lane tabs with mandatory final output", () => {
  const base = template()
  base.body.push({ id: "send_merged", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] }, ending: "cr" })
  expect(validateFlowV2Template(base, { indexMap }).ok).toBe(true)
})

test("parallel rejects missing output and output before the end", () => {
  const missing = template()
  const parallel = missing.body[0] as ParallelNode
  parallel.lanes[0].body.pop()
  expect(text(missing)).toContain("parallel lane must declare final output")

  const notLast = template()
  const node = notLast.body[0] as ParallelNode
  const [output] = node.lanes[0].body.splice(3, 1)
  node.lanes[0].body.splice(1, 0, output)
  expect(text(notLast)).toContain("parallel lane output must be the final node")
})

test("parallel rejects duplicate terminals, duplicate lane ids and labels, mismatched terminals, and lane-local workflow", () => {
  const duplicate = template()
  const parallel = duplicate.body[0] as ParallelNode
  parallel.lanes[1].terminal = { kind: "alias", value: "docs" }
  expect(text(duplicate)).toContain("duplicate parallel lane terminal")

  const duplicateLaneId = template()
  const laneIdParallel = duplicateLaneId.body[0] as ParallelNode
  laneIdParallel.lanes[1].id = "docs"
  expect(text(duplicateLaneId)).toContain("duplicate parallel lane id")

  const duplicateLaneLabel = template()
  const laneLabelParallel = duplicateLaneLabel.body[0] as ParallelNode
  laneLabelParallel.lanes[1].label = "docs"
  expect(text(duplicateLaneLabel)).toContain("duplicate parallel lane label")

  const duplicateLaneActionId = template()
  const actionIdParallel = duplicateLaneActionId.body[0] as ParallelNode
  actionIdParallel.lanes[1].body[0].id = "send_docs"
  expect(text(duplicateLaneActionId)).toContain("duplicate Flow V2 node id")

  const mismatch = template()
  const node = mismatch.body[0] as ParallelNode
  const send = node.lanes[0].body[0]
  if (send.type !== "send") throw new Error("missing send")
  send.terminal = { kind: "alias", value: "worker" }
  expect(text(mismatch)).toContain("parallel lane send terminal must match lane terminal")

  const bad = template()
  const badParallel = bad.body[0] as ParallelNode
  badParallel.lanes[0].body.splice(1, 0, { id: "nested", type: "if", branches: [] } as never)
  expect(text(bad)).toContain("parallel lane only supports send, wait, capture-source, extract_text, and final output")
})

test("parallel output can be none and cannot reference another lane", () => {
  const none = template()
  const parallel = none.body[0] as ParallelNode
  const output = parallel.lanes[0].body[3]
  if (output.type !== "output") throw new Error("missing output")
  output.source = { kind: "none" }
  expect(validateFlowV2Template(none, { indexMap }).ok).toBe(true)

  const crossLane = template()
  const cross = crossLane.body[0] as ParallelNode
  const crossOutput = cross.lanes[0].body[3]
  if (crossOutput.type !== "output") throw new Error("missing output")
  crossOutput.source = { kind: "step_artifact", stepId: "capture_tests", artifact: "captured_text" }
  expect(text(crossLane)).toContain("artifact source must reference an earlier artifact-producing step")
})
