import { expect, test } from "bun:test"
import { validateFlowV2Template } from "../../src/lib/macro/flowV2Schema"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"

const indexMap = [
  { index: 1, terminalId: "term_worker", terminalAlias: "worker" },
  { index: 2, terminalId: "term_reviewer", terminalAlias: "reviewer" },
]

function validTemplate(): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return {
    schemaVersion: 2,
    id: "tmpl_flow_v2",
    name: "Flow V2",
    description: "",
    configId: "local",
    createdAt: now,
    updatedAt: now,
    body: [
      { id: "send_worker", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "printf READY" }] } },
      { id: "wait_worker", type: "wait", mode: "terminal-quiet", terminal: { kind: "alias", value: "worker" }, quietMs: 10, maxMs: 1000, onTimeout: "pause" },
      { id: "capture_worker", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      {
        id: "if_ready",
        type: "if",
        branches: [{
          kind: "if",
          condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture_worker", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "READY" }, scope: { kind: "whole" } },
          body: [{ id: "return_ready", type: "return", reason: "ready" }],
        }],
      },
    ],
  }
}

function issues(template: unknown) {
  return validateFlowV2Template(template, { indexMap }).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
}

test("terminal-buffer accepts visible screen and raw stream tail modes", () => {
  const raw = validTemplate()
  const capture = raw.body[2]
  if (capture.type !== "capture-source" || capture.capture.kind !== "terminal-buffer") throw new Error("missing capture")
  capture.capture.mode = "raw-stream-tail"
  expect(validateFlowV2Template(raw, { indexMap }).ok).toBe(true)
})

test("Flow V2 accepts message parts, capture, text_match and return", () => {
  expect(validateFlowV2Template(validTemplate(), { indexMap }).ok).toBe(true)
})

test("Flow V2 hard-cuts v1 steps and legacy action names", () => {
  const template = validTemplate() as unknown as Record<string, unknown>
  template.schemaVersion = 1
  template.steps = [{ id: "old", type: "send_line", text: "legacy" }]
  const text = issues(template)
  expect(text).toContain("schemaVersion:Flow V2 template schemaVersion must be 2")
  expect(text).toContain("steps:legacy control/parser fields are not allowed in Flow V2")

  for (const type of ["sleep", "parse", "send_artifact", "parallel_all", "merge_parallel_results", "branch", "goto", "pause", "stop", "complete", "fail"]) {
    const bad = validTemplate()
    bad.body.push({ id: "bad_" + type, type } as never)
    expect(issues(bad)).toContain("legacy Flow V1 node type is unsupported in Flow V2")
  }
})

test("wait only supports duration, terminal-quiet and user-continue", () => {
  const template = validTemplate()
  template.body.push({ id: "wait_bad", type: "wait", mode: "capture-ready-or-user", captureStep: "capture_worker", timeoutMs: 1000, onTimeout: "pause" } as never)
  expect(issues(template)).toContain("legacy wait mode is not allowed in Flow V2")
})

test("legacy parser and wait tokens are allowed inside user text fields", () => {
  const template = validTemplate()
  template.body[0] = { id: "send_text", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "please mention ai-json and capture-ready-or-user literally" }] } }
  const ifNode = template.body[3]
  if (ifNode.type !== "if") throw new Error("missing if")
  ifNode.branches[0].condition.matcher = { kind: "simple", op: "contains", text: "ai-json" }
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)
})

test("send_line and input_line enforce message source rules", () => {
  const send = validTemplate()
  send.body[0] = { id: "send_bad", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "user_input" }] } } as never
  expect(issues(send)).toContain("message part kind must be text or artifact")

  const joined = validTemplate()
  joined.body[0] = { id: "send_join", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { join: "newline", parts: [{ kind: "text", text: "legacy" }] } } as never
  expect(issues(joined)).toContain("message.join:extra Flow V2 field is not allowed")

  const input = validTemplate()
  input.body[0] = { id: "input_bad", type: "input_line", terminal: { kind: "alias", value: "worker" }, prompt: "Prompt", allowEmpty: false, message: { parts: [{ kind: "text", text: "legacy" }] } } as never
  expect(issues(input)).toContain("message:extra Flow V2 field is not allowed")

  const defaultBeforeCapture = validTemplate()
  defaultBeforeCapture.body[0] = { id: "input_default_bad", type: "input_line", terminal: { kind: "alias", value: "worker" }, prompt: "Prompt", allowEmpty: false, defaultSource: { kind: "step_artifact", stepId: "capture_worker", artifact: "captured_text" } } as never
  expect(issues(defaultBeforeCapture)).toContain("artifact source must reference an earlier artifact-producing step")
})

test("artifact sources must reference visible predecessor outputs", () => {
  const template = validTemplate()
  template.body[0] = { id: "send_before_capture", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "capture_worker", artifact: "captured_text" } }] } } as never
  expect(issues(template)).toContain("artifact source must reference an earlier artifact-producing step")
})

test("text_match supports regex flags and line scopes", () => {
  const template = validTemplate()
  const ifNode = template.body[3]
  if (ifNode.type !== "if") throw new Error("missing if")
  ifNode.branches[0].condition = { kind: "text_match", source: { kind: "step_artifact", stepId: "capture_worker", artifact: "captured_text" }, matcher: { kind: "regex", pattern: "READY", flags: "g" }, scope: { kind: "lines", mode: "last", includeEmptyLines: false } }
  expect(issues(template)).toContain("regex flags must only contain i, m or s")

  const badPattern = validTemplate()
  const badIf = badPattern.body[3]
  if (badIf.type !== "if") throw new Error("missing if")
  badIf.branches[0].condition = { kind: "text_match", source: { kind: "step_artifact", stepId: "capture_worker", artifact: "captured_text" }, matcher: { kind: "regex", pattern: "(", flags: "i" }, scope: { kind: "whole" } }
  expect(issues(badPattern)).toContain("matcher.pattern:regex pattern must compile")
})

test("text-box capture produces captured_text for downstream text_match", () => {
  const template = validTemplate()
  template.body[2] = { id: "capture_notes", type: "capture-source", capture: { kind: "text-box", terminal: { kind: "alias", value: "worker" } } }
  const ifNode = template.body[3]
  if (ifNode.type !== "if") throw new Error("missing if")
  ifNode.branches[0].condition.source.stepId = "capture_notes"
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)

  const bad = structuredClone(template)
  bad.body[2] = { id: "capture_notes", type: "capture-source", capture: { kind: "text-box", terminal: { kind: "alias", value: "worker" }, maxChars: 12000 } } as never
  expect(issues(bad)).toContain("capture.maxChars:extra Flow V2 field is not allowed")
})

test("extract_text selects and extracts text into visible predecessor artifact", () => {
  const template = validTemplate()
  template.body.splice(3, 0, {
    id: "extract_last",
    type: "extract_text",
    source: { kind: "step_artifact", stepId: "capture_worker", artifact: "captured_text" },
    split: { kind: "lines", keepEmpty: false },
    filters: [{ kind: "exclude", matcher: { kind: "regex", pattern: "^\\s*[$#>]\\s*$" } }],
    select: { mode: "last" },
    extract: { kind: "none" },
    trim: "right",
    onEmpty: "pause",
  })
  const ifNode = template.body[4]
  if (ifNode.type !== "if") throw new Error("missing if")
  ifNode.branches[0].condition.source = { kind: "step_artifact", stepId: "extract_last", artifact: "extracted_text" }
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)

  const bad = structuredClone(template)
  const extract = bad.body[3]
  if (extract.type !== "extract_text") throw new Error("missing extract")
  extract.source = { kind: "step_artifact", stepId: "capture_worker", artifact: "captured_text" }
  extract.extract = { kind: "regex", pattern: "(", group: 1 }
  expect(issues(bad)).toContain("extract.pattern:regex pattern must compile")
})

test("agent-event capture requires explicit codex agent enum", () => {
  const template = validTemplate()
  template.body[2] = { id: "capture_codex", type: "capture-source", capture: { kind: "agent-event", agent: { kind: "codex" }, terminal: { kind: "alias", value: "worker" }, eventKind: "stop", field: "last_assistant_message" } }
  const ifNode = template.body[3]
  if (ifNode.type !== "if") throw new Error("missing if")
  ifNode.branches[0].condition.source.stepId = "capture_codex"
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)
})

test("parallel_send_capture reuses send_line and capture-source schema and produces merged_text", () => {
  const template = validTemplate()
  template.body.push({
    id: "parallel_review",
    type: "parallel_send_capture",
    items: [
      { id: "docs", terminal: { kind: "alias", value: "worker" }, send: { id: "send_docs", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "docs" }] } }, capture: { id: "capture_docs", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } } },
      { id: "tests", terminal: { kind: "alias", value: "reviewer" }, send: { id: "send_tests", type: "send_line", terminal: { kind: "alias", value: "reviewer" }, message: { parts: [{ kind: "text", text: "tests" }] } }, capture: { id: "capture_tests", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "reviewer" }, mode: "scrollback-tail", maxChars: 12000 } } },
    ],
    merge: { kind: "sectioned_text", separator: "===== {itemId} | {terminalAlias} =====", order: "item_order", includeEmptyCaptures: true },
    onItemFail: "pause",
  })
  template.body.push({ id: "send_merge", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] } })
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)

  const bad = structuredClone(template)
  const parallel = bad.body[4]
  if (parallel.type !== "parallel_send_capture") throw new Error("missing parallel")
  parallel.items[1].terminal = { kind: "alias", value: "worker" }
  expect(issues(bad)).toContain("duplicate parallel item terminal")

  const badReturn = structuredClone(template)
  const badParallel = badReturn.body[4]
  if (badParallel.type !== "parallel_send_capture") throw new Error("missing parallel")
  badParallel.items[0].wait = { id: "wait_docs", type: "wait", mode: "terminal-quiet", terminal: { kind: "alias", value: "worker" }, quietMs: 10, maxMs: 1000, onTimeout: "return" }
  expect(issues(badReturn)).toContain("parallel item wait onTimeout must be pause")
})
