import { expect, test } from "bun:test"
import { validateFlowV2Template } from "../../src/lib/macro/flowV2Schema"
import { renderScopedTemplate, scopedTemplateSyntaxIssue } from "../../src/lib/macro/scopedTextTemplate"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"

const worker = { kind: "alias" as const, value: "worker" }
const indexMap = [{ index: 1, terminalId: "term_worker", terminalAlias: "worker" }]

function template(body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-07-11T00:00:00.000Z"
  return { schemaVersion: 2, id: "tmpl_template_contract", name: "Template contract", description: "", configId: "local", body, createdAt: now, updatedAt: now }
}

function issueText(value: unknown): string {
  return validateFlowV2Template(value, { indexMap }).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
}

test("renderer preserves whitespace Unicode empty bindings and frozen inputs", () => {
  const templateText = "前缀\n{{text}}\n{{text}}后缀"
  const binding = Object.freeze({ text: "  阶段🚀\n", forStepId: "loop" })
  expect(renderScopedTemplate(templateText, binding)).toBe("前缀\n  阶段🚀\n\n  阶段🚀\n后缀")
  expect(renderScopedTemplate("[{{text}}]", Object.freeze({ text: "", forStepId: "loop" }))).toBe("[]")
  expect(binding).toEqual({ text: "  阶段🚀\n", forStepId: "loop" })
  expect(templateText).toBe("前缀\n{{text}}\n{{text}}后缀")
})

test("renderer preserves JavaScript replacement metacharacters in text-list items", () => {
  const items = ["$&", "$`", "$'", "$$", "$1", "$<text>"]
  for (const item of items) {
    expect(renderScopedTemplate("prefix{{text}}suffix", { text: item, forStepId: "loop" })).toBe("prefix" + item + "suffix")
  }
})

test("syntax rejects unknown, unclosed and isolated double-brace forms", () => {
  expect(scopedTemplateSyntaxIssue("{{text}} + {{other}}")).toContain("only supports")
  expect(scopedTemplateSyntaxIssue("{{text}} + {{")).toContain("only supports")
  expect(scopedTemplateSyntaxIssue("{{text}} + }}")).toContain("only supports")
})

test("if, else and control action bodies inherit the enclosing text-list binding", () => {
  const value = template([{
    id: "loop",
    type: "for",
    range: { kind: "text-list", items: ["one"] },
    body: [
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: worker, mode: "scrollback-tail", maxChars: 100 } },
      {
        id: "if_ready",
        type: "if",
        branches: [{
          kind: "if",
          condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "ready" }, scope: { kind: "whole" } },
          body: [{ id: "branch_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "branch {{text}}" }] }, enter: true }],
        }],
        else: [{ id: "finish", type: "finish", body: [{ id: "finish_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "finish {{text}}" }] }, enter: true }] }],
      },
    ],
  }])
  expect(validateFlowV2Template(value, { indexMap })).toEqual({ ok: true, issues: [] })
})

test("nested text-list scopes validate inner shadow and restore the outer scope", () => {
  const value = template([{
    id: "outer",
    type: "for",
    range: { kind: "text-list", items: ["outer"] },
    body: [
      { id: "outer_before", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "outer {{text}}" }] }, enter: true },
      {
        id: "inner",
        type: "for",
        range: { kind: "text-list", items: ["inner"] },
        body: [{ id: "inner_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "inner {{text}}" }] }, enter: true }],
      },
      { id: "outer_after", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "outer again {{text}}" }] }, enter: true },
    ],
  }])
  expect(validateFlowV2Template(value, { indexMap })).toEqual({ ok: true, issues: [] })
})

test("text-list range is strict and validation does not normalize items", () => {
  const value = template([{
    id: "loop",
    type: "for",
    range: { kind: "text-list", items: ["  first\n", "", "first"] },
    body: [{ id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "{{text}}" }] }, enter: true }],
  }])
  const before = structuredClone(value)
  expect(validateFlowV2Template(value, { indexMap })).toEqual({ ok: true, issues: [] })
  expect(value).toEqual(before)

  const aliases = structuredClone(value) as unknown as { body: Array<Record<string, unknown>> }
  aliases.body[0].range = { kind: "text-list", values: ["x"], as: "text" }
  const aliasIssues = issueText(aliases)
  expect(aliasIssues).toContain("range.values:extra Flow V2 field is not allowed")
  expect(aliasIssues).toContain("range.as:extra Flow V2 field is not allowed")
  expect(aliasIssues).toContain("text-list items must be an array")

  const wrongItem = structuredClone(value) as unknown as { body: Array<{ range: Record<string, unknown> }> }
  wrongItem.body[0].range.items = ["x", 1]
  expect(issueText(wrongItem)).toContain("text-list item must be a string")
})

test("unsupported text fields stay literal and reject template objects", () => {
  const literal = template([{
    id: "loop",
    type: "for",
    range: { kind: "text-list", items: ["x"] },
    body: [
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: worker, mode: "scrollback-tail", maxChars: 100 } },
      {
        id: "if_literal",
        type: "if",
        branches: [{
          kind: "if",
          condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "{{text}}" }, scope: { kind: "whole" } },
          body: [{ id: "break_literal", type: "break", reason: "{{text}}" }],
        }],
      },
    ],
  }])
  expect(validateFlowV2Template(literal, { indexMap })).toEqual({ ok: true, issues: [] })

  const objects = structuredClone(literal)
  const ifNode = objects.body[0]
  if (ifNode.type !== "for" || ifNode.body[1]?.type !== "if") throw new Error("missing if fixture")
  ifNode.body[1].branches[0].condition.matcher = { kind: "simple", op: "contains", text: { kind: "template", template: "{{text}}" } as never }
  const breakNode = ifNode.body[1].branches[0].body[0]
  if (breakNode.type !== "break") throw new Error("missing break fixture")
  breakNode.reason = { kind: "template", template: "{{text}}" } as never
  const objectIssues = issueText(objects)
  expect(objectIssues).toContain("matcher.text:value must be a string")
  expect(objectIssues).toContain("reason:value must be a string")
})

type UnsupportedMatrixCase = {
  group: string
  path: Array<string | number>
  expectedIssue: string
}

function unsupportedMatrixFixture(): MacroTemplate {
  return template([{
    id: "matrix_loop",
    type: "for",
    range: { kind: "text-list", items: ["source {{text}}"] },
    body: [
      {
        id: "matrix_capture",
        type: "capture-source",
        capture: { kind: "terminal-buffer", terminal: worker, mode: "scrollback-tail", maxChars: 100 },
      },
      {
        id: "matrix_send",
        type: "send",
        terminal: worker,
        message: {
          parts: [
            { kind: "text", text: "literal {{text}}" },
            { kind: "artifact", source: { kind: "step_artifact", stepId: "matrix_capture", artifact: "captured_text" } },
          ],
        },
        enter: true,
      },
      {
        id: "matrix_input",
        type: "input",
        terminal: worker,
        prompt: "literal {{text}}",
        allowEmpty: true,
        enter: false,
        defaultSource: { kind: "step_artifact", stepId: "matrix_capture", artifact: "captured_text" },
      },
      {
        id: "matrix_notify",
        type: "notify",
        level: "info",
        title: "literal {{text}}",
        message: { parts: [{ kind: "text", text: "literal {{text}}" }] },
        channels: [
          { kind: "app", toast: true, sound: "none" },
          { kind: "telegram", profileId: "default" },
        ],
        onFailure: "continue",
      },
      { id: "matrix_duration", type: "wait", mode: "duration", durationMs: 1 },
      { id: "matrix_continue", type: "wait", mode: "user-continue", prompt: "literal {{text}}" },
      {
        id: "matrix_quiet",
        type: "wait",
        mode: "terminal-quiet",
        terminal: worker,
        quietMs: 1,
        maxMs: 2,
        onTimeout: "pause",
      },
      {
        id: "matrix_if",
        type: "if",
        branches: [{
          kind: "if",
          condition: {
            kind: "text_match",
            source: { kind: "step_artifact", stepId: "matrix_capture", artifact: "captured_text" },
            matcher: { kind: "simple", op: "contains", text: "{{text}}" },
            scope: { kind: "whole" },
          },
          body: [{ id: "matrix_branch_finish", type: "finish", reason: "{{text}}", body: [] }],
        }],
      },
      {
        id: "matrix_extract",
        type: "extract_text",
        source: { kind: "step_artifact", stepId: "matrix_capture", artifact: "captured_text" },
        split: { kind: "regex", pattern: "\\n+", flags: "", keepEmpty: false },
        filters: [
          { kind: "include", matcher: { kind: "simple", op: "contains", text: "{{text}}" } },
          { kind: "exclude", matcher: { kind: "regex", pattern: "^skip$", flags: "i" } },
        ],
        select: { mode: "all" },
        extract: { kind: "regex", pattern: "(.*)", flags: "", group: 1 },
        trim: "none",
        onEmpty: "pause",
      },
      {
        id: "matrix_parallel",
        type: "parallel",
        lanes: [{
          id: "matrix_lane",
          label: "literal {{text}}",
          terminal: worker,
          body: [
            {
              id: "matrix_lane_send",
              type: "send",
              terminal: worker,
              message: { parts: [{ kind: "text", text: "literal {{text}}" }] },
              enter: false,
            },
            { id: "matrix_lane_output", type: "output", source: { kind: "none" } },
          ],
        }],
        merge: { kind: "sectioned_text", separator: "{{text}} {laneId}", includeEmptyOutputs: true },
        onLaneFail: "pause",
      },
      { id: "matrix_finish", type: "finish", reason: "{{text}}", body: [] },
    ],
  }])
}

function matrixRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unsupported matrix path does not resolve to an object")
  return value as Record<string, unknown>
}

function replaceMatrixPath(root: unknown, path: Array<string | number>, replacement: unknown) {
  if (path.length === 0) throw new Error("unsupported matrix path must not be empty")
  let cursor = root
  for (const segment of path.slice(0, -1)) {
    if (typeof segment === "number") {
      if (!Array.isArray(cursor)) throw new Error("unsupported matrix path expected an array")
      cursor = cursor[segment]
    } else {
      cursor = matrixRecord(cursor)[segment]
    }
  }
  const finalSegment = path[path.length - 1]
  if (typeof finalSegment === "number") {
    if (!Array.isArray(cursor)) throw new Error("unsupported matrix path expected a final array")
    cursor[finalSegment] = replacement
  } else {
    matrixRecord(cursor)[finalSegment] = replacement
  }
}

const unsupportedMatrixCases: UnsupportedMatrixCase[] = [
  { group: "template metadata name", path: ["name"], expectedIssue: "name:value must be a string" },
  { group: "template metadata description", path: ["description"], expectedIssue: "description:value must be a string" },
  { group: "template identity id", path: ["id"], expectedIssue: "id:value must be a public id string" },
  { group: "template identity configId", path: ["configId"], expectedIssue: "configId:value must be a public id string" },
  { group: "node identity", path: ["body", 0, "id"], expectedIssue: "body[0].id:value must be a public id string" },
  { group: "parallel lane identity", path: ["body", 0, "body", 9, "lanes", 0, "id"], expectedIssue: "lanes[0].id:value must be a public id string" },
  { group: "parallel output identity", path: ["body", 0, "body", 9, "lanes", 0, "body", 1, "id"], expectedIssue: "body[1].id:value must be a public id string" },
  { group: "for source item", path: ["body", 0, "range", "items", 0], expectedIssue: "text-list item must be a string" },
  { group: "message artifact source", path: ["body", 0, "body", 1, "message", "parts", 1, "source"], expectedIssue: "source.kind:artifact source kind must be step_artifact" },
  { group: "input defaultSource", path: ["body", 0, "body", 2, "defaultSource"], expectedIssue: "defaultSource.kind:artifact source kind must be step_artifact" },
  { group: "notify level", path: ["body", 0, "body", 3, "level"], expectedIssue: "level:level must be info, success, warning or error" },
  { group: "notify sound", path: ["body", 0, "body", 3, "channels", 0, "sound"], expectedIssue: "sound:sound must be none, bell, chime, ping, pulse, success, warning or alert" },
  { group: "notification profile selector", path: ["body", 0, "body", 3, "channels", 1, "profileId"], expectedIssue: "profileId:value must be a public id string" },
  { group: "duration wait config", path: ["body", 0, "body", 4, "durationMs"], expectedIssue: "durationMs:value must be a positive integer" },
  { group: "terminal-quiet target", path: ["body", 0, "body", 6, "terminal"], expectedIssue: "terminal:terminal target must be" },
  { group: "terminal-quiet onTimeout", path: ["body", 0, "body", 6, "onTimeout"], expectedIssue: "onTimeout:value must be one of pause, finish" },
  { group: "capture terminal selector", path: ["body", 0, "body", 0, "capture", "terminal"], expectedIssue: "capture.terminal:terminal target must be" },
  { group: "capture mode", path: ["body", 0, "body", 0, "capture", "mode"], expectedIssue: "mode:terminal-buffer mode must be scrollback-tail or raw-stream-tail" },
  { group: "capture maxChars", path: ["body", 0, "body", 0, "capture", "maxChars"], expectedIssue: "maxChars:value must be a positive integer" },
  { group: "if condition matcher", path: ["body", 0, "body", 7, "branches", 0, "condition", "matcher", "text"], expectedIssue: "matcher.text:value must be a string" },
  { group: "extract split regex", path: ["body", 0, "body", 8, "split", "pattern"], expectedIssue: "split.pattern:value must be a string" },
  { group: "extract simple filter", path: ["body", 0, "body", 8, "filters", 0, "matcher", "text"], expectedIssue: "matcher.text:value must be a string" },
  { group: "extract regex filter", path: ["body", 0, "body", 8, "filters", 1, "matcher", "pattern"], expectedIssue: "matcher.pattern:value must be a string" },
  { group: "extract result regex", path: ["body", 0, "body", 8, "extract", "pattern"], expectedIssue: "extract.pattern:value must be a string" },
  { group: "extract result group", path: ["body", 0, "body", 8, "extract", "group"], expectedIssue: "extract.group:group must be an integer or non-empty named group" },
  { group: "parallel lane label", path: ["body", 0, "body", 9, "lanes", 0, "label"], expectedIssue: "label:value must be a string" },
  { group: "parallel merge separator", path: ["body", 0, "body", 9, "merge", "separator"], expectedIssue: "separator:value must be a string" },
  { group: "control reason", path: ["body", 0, "body", 10, "reason"], expectedIssue: "reason:value must be a string" },
  { group: "terminal selector", path: ["body", 0, "body", 1, "terminal"], expectedIssue: "terminal:terminal target must be" },
  { group: "artifact stepId reference", path: ["body", 0, "body", 1, "message", "parts", 1, "source", "stepId"], expectedIssue: "stepId:value must be a public id string" },
  { group: "artifact name reference", path: ["body", 0, "body", 1, "message", "parts", 1, "source", "artifact"], expectedIssue: "artifact:artifact must be captured_text, merged_text or extracted_text" },
]

test("unsupported schema matrix fixture keeps ordinary double-brace strings literal", () => {
  expect(validateFlowV2Template(unsupportedMatrixFixture(), { indexMap })).toEqual({ ok: true, issues: [] })
})

for (const matrixCase of unsupportedMatrixCases) {
  test("unsupported schema matrix rejects template object for " + matrixCase.group, () => {
    const candidate = unsupportedMatrixFixture()
    replaceMatrixPath(candidate, matrixCase.path, { kind: "template", template: "{{text}}" })
    expect(issueText(candidate)).toContain(matrixCase.expectedIssue)
  })
}
