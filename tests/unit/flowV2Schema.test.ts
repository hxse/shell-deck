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
          body: [{ id: "finish_ready", type: "finish", reason: "ready" }],
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


test("Flow V2 allows empty root body for new templates", () => {
  const template = validTemplate()
  template.body = []
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)
})

test("Flow V2 accepts message parts, capture, text_match and finish", () => {
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

  const oldReturn = validTemplate()
  oldReturn.body.push({ id: "old_return", type: "return", reason: "old" } as never)
  expect(issues(oldReturn)).toContain("return is unsupported in Flow V2; use finish")
})

test("wait only supports duration, terminal-quiet and user-continue", () => {
  const template = validTemplate()
  template.body.push({ id: "wait_bad", type: "wait", mode: "capture-ready-or-user", captureStep: "capture_worker", timeoutMs: 1000, onTimeout: "pause" } as never)
  expect(issues(template)).toContain("legacy wait mode is not allowed in Flow V2")

  const timeoutContinue = validTemplate()
  const wait = timeoutContinue.body[1]
  if (wait.type !== "wait" || wait.mode !== "terminal-quiet") throw new Error("missing wait")
  wait.onTimeout = "continue"
  expect(issues(timeoutContinue)).toContain("onTimeout:value must be one of pause, finish")
})


test("for supports count and forever range modes", () => {
  const counted = validTemplate()
  counted.body.push({ id: "loop_count", type: "for", range: { kind: "count", count: 2 }, body: [{ id: "finish_loop", type: "finish", reason: "loop" }] })
  expect(validateFlowV2Template(counted, { indexMap }).ok).toBe(true)

  const legacyCount = validTemplate()
  legacyCount.body.push({ id: "loop_legacy_count", type: "for", range: { count: 2 }, body: [{ id: "finish_loop", type: "finish", reason: "loop" }] })
  expect(validateFlowV2Template(legacyCount, { indexMap }).ok).toBe(true)

  const forever = validTemplate()
  forever.body.push({ id: "loop_forever", type: "for", range: { kind: "forever" }, body: [{ id: "break_loop", type: "break", reason: "done" }] })
  expect(validateFlowV2Template(forever, { indexMap }).ok).toBe(true)

  const bad = validTemplate()
  bad.body.push({ id: "loop_bad", type: "for", range: { kind: "forever", count: 1 }, body: [{ id: "break_loop", type: "break", reason: "done" }] } as never)
  expect(issues(bad)).toContain("range.count:extra Flow V2 field is not allowed")
})

test("finish break and continue support action-only bodies", () => {
  const template = validTemplate()
  template.body.push({ id: "finish_with_action", type: "finish", reason: "done", body: [{ id: "send_before_finish", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "before finish" }] } }] })
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)

  const bad = validTemplate()
  bad.body.push({ id: "finish_with_flow", type: "finish", reason: "done", body: [{ id: "nested_if", type: "if", branches: [{ kind: "if", condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture_worker", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "READY" }, scope: { kind: "whole" } }, body: [{ id: "nested_finish", type: "finish", reason: "bad" }] }] }] } as never)
  expect(issues(bad)).toContain("finish/break/continue action body only supports action nodes")
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
  const emptyMessage = validTemplate()
  emptyMessage.body[0] = { id: "send_empty", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [] } }
  expect(validateFlowV2Template(emptyMessage, { indexMap }).ok).toBe(true)

  const artifactNone = validTemplate()
  artifactNone.body[0] = { id: "send_none", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact" }] } }
  expect(validateFlowV2Template(artifactNone, { indexMap }).ok).toBe(true)

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
    select: { mode: "index", index: -1 },
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

  const negativeRange = structuredClone(template)
  const rangeExtract = negativeRange.body[3]
  if (rangeExtract.type !== "extract_text") throw new Error("missing extract")
  rangeExtract.select = { mode: "range", start: -3, end: -1 }
  expect(validateFlowV2Template(negativeRange, { indexMap }).ok).toBe(true)

  const continueOnEmpty = structuredClone(template)
  const continueExtract = continueOnEmpty.body[3]
  if (continueExtract.type !== "extract_text") throw new Error("missing extract")
  continueExtract.onEmpty = "continue"
  expect(validateFlowV2Template(continueOnEmpty, { indexMap }).ok).toBe(true)
})

test("agent-event capture requires explicit codex agent enum", () => {
  const template = validTemplate()
  template.body[2] = { id: "capture_codex", type: "capture-source", capture: { kind: "agent-event", agent: { kind: "codex" }, terminal: { kind: "alias", value: "worker" }, eventKind: "stop", field: "last_assistant_message" } }
  const ifNode = template.body[3]
  if (ifNode.type !== "if") throw new Error("missing if")
  ifNode.branches[0].condition.source.stepId = "capture_codex"
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)
})

test("parallel lane output produces merged_text and must be final", () => {
  const template = validTemplate()
  template.body.push({
    id: "parallel_review",
    type: "parallel",
    lanes: [
      { id: "docs", label: "Docs", terminal: { kind: "alias", value: "worker" }, body: [
        { id: "capture_docs", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
        { id: "output_docs", type: "output", source: { kind: "step_artifact", stepId: "capture_docs", artifact: "captured_text" } },
      ] },
      { id: "tests", label: "Tests", terminal: { kind: "alias", value: "reviewer" }, body: [
        { id: "output_tests", type: "output", source: { kind: "none" } },
      ] },
    ],
    merge: { kind: "sectioned_text", separator: "===== {laneId} =====", includeEmptyOutputs: true },
    onLaneFail: "pause",
  })
  template.body.push({ id: "send_merge", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] } })
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)

  const bad = structuredClone(template)
  const parallel = bad.body[4]
  if (parallel.type !== "parallel") throw new Error("missing parallel")
  parallel.lanes[0].body.push({ id: "late_send", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [] } })
  expect(issues(bad)).toContain("parallel lane output must be the final node")
})
