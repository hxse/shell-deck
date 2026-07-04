import { expect, test } from "bun:test"
import { validateFlowV2Template } from "../../src/lib/macro/flowV2Schema"
import type { MacroTemplate, ParallelSendCaptureNode } from "../../src/lib/macro/templateTypes"

const indexMap = [
  { index: 1, terminalId: "term_docs", terminalAlias: "docs" },
  { index: 2, terminalId: "term_tests", terminalAlias: "tests" },
  { index: 3, terminalId: "term_worker", terminalAlias: "worker" },
]

function template(): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return {
    schemaVersion: 2,
    id: "parallel_send_capture_template",
    name: "Parallel Send Capture",
    description: "",
    configId: "local",
    createdAt: now,
    updatedAt: now,
    body: [parallelNode()],
  }
}

function parallelNode(): ParallelSendCaptureNode {
  return {
    id: "parallel_review",
    type: "parallel_send_capture",
    items: [item("docs"), item("tests")],
    merge: { kind: "sectioned_text", separator: "===== {itemId} | {terminalAlias} =====", order: "item_order", includeEmptyCaptures: true },
    onItemFail: "pause",
  }
}

function item(alias: "docs" | "tests") {
  const terminal = { kind: "alias" as const, value: alias }
  return {
    id: alias,
    terminal,
    send: { id: "send_" + alias, type: "send_line" as const, terminal, message: { parts: [{ kind: "text" as const, text: "review " + alias }] } },
    wait: { id: "wait_" + alias, type: "wait" as const, mode: "terminal-quiet" as const, terminal, quietMs: 10, maxMs: 1000, onTimeout: "pause" as const },
    capture: { id: "capture_" + alias, type: "capture-source" as const, capture: { kind: "terminal-buffer" as const, terminal, mode: "scrollback-tail" as const, maxChars: 12000 } },
  }
}

function text(value: MacroTemplate) {
  return validateFlowV2Template(value, { indexMap }).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
}

test("parallel_send_capture validates reusable send/capture item schema", () => {
  const base = template()
  base.body.push({ id: "send_merged", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] } })
  expect(validateFlowV2Template(base, { indexMap }).ok).toBe(true)
})

test("parallel_send_capture rejects duplicate terminals and mismatched item terminals", () => {
  const duplicate = template()
  const parallel = duplicate.body[0]
  if (parallel.type !== "parallel_send_capture") throw new Error("missing parallel")
  parallel.items[1].terminal = { kind: "alias", value: "docs" }
  parallel.items[1].send.terminal = { kind: "alias", value: "docs" }
  parallel.items[1].capture.capture.terminal = { kind: "alias", value: "docs" }
  expect(text(duplicate)).toContain("duplicate parallel item terminal")

  const mismatch = template()
  const node = mismatch.body[0]
  if (node.type !== "parallel_send_capture") throw new Error("missing parallel")
  node.items[0].send.terminal = { kind: "alias", value: "worker" }
  expect(text(mismatch)).toContain("parallel item send terminal must match item terminal")
})

test("parallel_send_capture rejects lane-local workflow and legacy parallel_all", () => {
  const bad = template()
  const parallel = bad.body[0]
  if (parallel.type !== "parallel_send_capture") throw new Error("missing parallel")
  ;(parallel.items[0] as never as { body: unknown[] }).body = [{ id: "nested", type: "if" }]
  expect(text(bad)).toContain("extra Flow V2 field is not allowed")

  const legacy = template()
  legacy.body[0] = { id: "legacy_parallel", type: "parallel_all", lanes: [], join: { mode: "all_success" } } as never
  expect(text(legacy)).toContain("legacy Flow V1 node type is unsupported in Flow V2")
})
