import { expect, test } from "bun:test"
import { validateFlowV2Template } from "../../src/lib/macro/flowV2Schema"
import { renderScopedTemplate, scopedTemplateSyntaxIssue } from "../../src/lib/macro/scopedTextTemplate"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"

const worker = { kind: "alias" as const, value: "worker" }
const indexMap = [{ index: 1, terminalId: "term_worker", terminalAlias: "worker" }]

function textListItem(value: string, key = value) {
  return { key, value }
}

function template(body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-07-11T00:00:00.000Z"
  return { schemaVersion: 2, id: "tmpl_template_contract", name: "Template contract", description: "", configId: "local", body, createdAt: now, updatedAt: now }
}

function issueText(value: unknown): string {
  return validateFlowV2Template(value, { indexMap }).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
}

test("renderer preserves index key value whitespace Unicode empty values and frozen inputs", () => {
  const templateText = "{{index}}|{{key}}|{{value}}|{{value}}"
  const binding = Object.freeze({ index: 2, key: "  阶段🚀  ", value: "\n正文🚀\n", forStepId: "loop" })
  expect(renderScopedTemplate(templateText, binding)).toBe("2|  阶段🚀  |\n正文🚀\n|\n正文🚀\n")
  expect(renderScopedTemplate("[{{key}}][{{value}}]", Object.freeze({ index: 1, key: "", value: "", forStepId: "loop" }))).toBe("[][]")
  expect(binding).toEqual({ index: 2, key: "  阶段🚀  ", value: "\n正文🚀\n", forStepId: "loop" })
  expect(templateText).toBe("{{index}}|{{key}}|{{value}}|{{value}}")
})

test("renderer preserves replacement metacharacters and never rescans inserted key or value", () => {
  const dollar = String.fromCharCode(36)
  const apostrophe = String.fromCharCode(39)
  const payloads = [
    dollar + "&",
    dollar + "`",
    dollar + apostrophe,
    dollar + dollar,
    dollar + "1",
    dollar + "<text>",
    "{{index}}",
    "{{key}}",
    "{{value}}",
    "{{text}}",
  ]
  for (const payload of payloads) {
    const binding = { index: 3, key: payload, value: payload, forStepId: "loop" }
    expect(renderScopedTemplate("{{index}}:{{key}}:{{value}}", binding)).toBe("3:" + payload + ":" + payload)
  }
})

test("syntax rejects unknown, unclosed and isolated double-brace forms", () => {
  expect(scopedTemplateSyntaxIssue("{{index}} + {{key}} + {{value}}")).toBeNull()
  expect(scopedTemplateSyntaxIssue("{{value}} + {{other}}")).toContain("only supports")
  expect(scopedTemplateSyntaxIssue("{{text}}")).toContain("must contain")
  expect(scopedTemplateSyntaxIssue("{{value}} + {{")).toContain("only supports")
  expect(scopedTemplateSyntaxIssue("{{value}} + }}")).toContain("only supports")
})

test("if, else and control action bodies inherit the enclosing text-list binding", () => {
  const value = template([{
    id: "loop",
    type: "for",
    range: { kind: "text-list", items: [textListItem("one")] },
    body: [
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: worker, mode: "scrollback-tail", maxChars: 100 } },
      {
        id: "if_ready",
        type: "if",
        branches: [{
          kind: "if",
          condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "ready" }, scope: { kind: "whole" } },
          body: [{ id: "branch_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "branch {{value}}" }] }, delivery: "direct", ending: "cr" }],
        }],
        else: [{ id: "finish", type: "finish", body: [{ id: "finish_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "finish {{value}}" }] }, delivery: "direct", ending: "cr" }] }],
      },
    ],
  }])
  expect(validateFlowV2Template(value, { indexMap })).toEqual({ ok: true, issues: [] })
})

test("nested text-list scopes validate inner shadow and restore the outer scope", () => {
  const value = template([{
    id: "outer",
    type: "for",
    range: { kind: "text-list", items: [textListItem("outer")] },
    body: [
      { id: "outer_before", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "outer {{value}}" }] }, delivery: "direct", ending: "cr" },
      {
        id: "inner",
        type: "for",
        range: { kind: "text-list", items: [textListItem("inner")] },
        body: [{ id: "inner_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "inner {{value}}" }] }, delivery: "direct", ending: "cr" }],
      },
      { id: "outer_after", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "outer again {{value}}" }] }, delivery: "direct", ending: "cr" },
    ],
  }])
  expect(validateFlowV2Template(value, { indexMap })).toEqual({ ok: true, issues: [] })
})

test("text-list range is strict and validation does not normalize items", () => {
  const value = template([{
    id: "loop",
    type: "for",
    range: { kind: "text-list", items: [textListItem("  first\n", "  duplicate  "), textListItem("", ""), textListItem("first", "  duplicate  ")] },
    body: [{ id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "{{value}}" }] }, delivery: "direct", ending: "cr" }],
  }])
  const before = structuredClone(value)
  expect(validateFlowV2Template(value, { indexMap })).toEqual({ ok: true, issues: [] })
  expect(value).toEqual(before)

  const aliases = structuredClone(value) as unknown as { body: Array<Record<string, unknown>> }
  aliases.body[0].range = { kind: "text-list", values: ["x"], as: "text" }
  const aliasIssues = issueText(aliases)
  expect(aliasIssues).toContain("range.values:extra Flow V2 field is not allowed")
  expect(aliasIssues).toContain("range.as:extra Flow V2 field is not allowed")
  expect(aliasIssues).toContain("text-list range must own an enumerable items field")

  const legacyStrings = structuredClone(value) as unknown as { body: Array<{ range: Record<string, unknown> }> }
  legacyStrings.body[0].range.items = ["legacy"]
  expect(issueText(legacyStrings)).toContain("text-list item must be an object")

  const mixedItems = structuredClone(value) as unknown as { body: Array<{ range: Record<string, unknown> }> }
  mixedItems.body[0].range.items = [{ key: "valid", value: "value" }, "legacy"]
  expect(issueText(mixedItems)).toContain("items[1]:text-list item must be an object")

  const entryList = structuredClone(value) as unknown as { body: Array<{ range: Record<string, unknown> }> }
  entryList.body[0].range = { kind: "entry-list", items: [{ key: "key", value: "value" }] }
  expect(issueText(entryList)).toContain("range.kind:for range kind must be count, forever or text-list")

  const unknownItemField = structuredClone(value) as unknown as { body: Array<{ range: Record<string, unknown> }> }
  unknownItemField.body[0].range.items = [{ key: "", value: "", index: 1 }]
  expect(issueText(unknownItemField)).toContain("items[0].index:extra Flow V2 field is not allowed")

  const missingFields = structuredClone(value) as unknown as { body: Array<{ range: Record<string, unknown> }> }
  missingFields.body[0].range.items = [{ value: "missing key" }, { key: "missing value" }]
  const missingIssues = issueText(missingFields)
  expect(missingIssues).toContain("items[0].key:value must be a string")
  expect(missingIssues).toContain("items[1].value:value must be a string")

  const inheritedFields = structuredClone(value) as unknown as { body: Array<{ range: Record<string, unknown> }> }
  inheritedFields.body[0].range.items = [Object.create({ key: "inherited key", value: "inherited value" })]
  const inheritedIssues = issueText(inheritedFields)
  expect(inheritedIssues).toContain("items[0].key:value must be a string")
  expect(inheritedIssues).toContain("items[0].value:value must be a string")

  const hiddenFields = structuredClone(value) as unknown as { body: Array<{ range: Record<string, unknown> }> }
  const hiddenItem: Record<string, unknown> = {}
  Object.defineProperties(hiddenItem, {
    key: { value: "hidden key", enumerable: false },
    value: { value: "hidden value", enumerable: false },
  })
  hiddenFields.body[0].range.items = [hiddenItem]
  const hiddenIssues = issueText(hiddenFields)
  expect(hiddenIssues).toContain("items[0].key:value must be a string")
  expect(hiddenIssues).toContain("items[0].value:value must be a string")

  const multilineKey = structuredClone(value) as unknown as { body: Array<{ range: Record<string, unknown> }> }
  multilineKey.body[0].range.items = [{ key: "bad\nkey", value: "allowed\r\nvalue" }]
  expect(issueText(multilineKey)).toContain("items[0].key:text-list item key must not contain CR or LF")
})

test("unsupported text fields stay literal and reject template objects", () => {
  const literal = template([{
    id: "loop",
    type: "for",
    range: { kind: "text-list", items: [textListItem("x")] },
    body: [
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: worker, mode: "scrollback-tail", maxChars: 100 } },
      {
        id: "if_literal",
        type: "if",
        branches: [{
          kind: "if",
          condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "{{value}}" }, scope: { kind: "whole" } },
          body: [{ id: "break_literal", type: "break", reason: "{{value}}" }],
        }],
      },
    ],
  }])
  expect(validateFlowV2Template(literal, { indexMap })).toEqual({ ok: true, issues: [] })

  const objects = structuredClone(literal)
  const ifNode = objects.body[0]
  if (ifNode.type !== "for" || ifNode.body[1]?.type !== "if") throw new Error("missing if fixture")
  ifNode.body[1].branches[0].condition.matcher = { kind: "simple", op: "contains", text: { kind: "template", template: "{{value}}" } as never }
  const breakNode = ifNode.body[1].branches[0].body[0]
  if (breakNode.type !== "break") throw new Error("missing break fixture")
  breakNode.reason = { kind: "template", template: "{{value}}" } as never
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
    range: { kind: "text-list", items: [textListItem("source {{value}}")] },
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
            { kind: "text", text: "literal {{value}}" },
            { kind: "artifact", source: { kind: "step_artifact", stepId: "matrix_capture", artifact: "captured_text" } },
          ],
        },
        delivery: "direct",
        ending: "cr",
      },
      {
        id: "matrix_input",
        type: "input",
        terminal: worker,
        prompt: "literal {{value}}",
        allowEmpty: true,
        delivery: "direct",
        ending: "none",
        defaultSource: { kind: "step_artifact", stepId: "matrix_capture", artifact: "captured_text" },
      },
      {
        id: "matrix_notify",
        type: "notify",
        level: "info",
        title: "literal {{value}}",
        message: { parts: [{ kind: "text", text: "literal {{value}}" }] },
        channels: [
          { kind: "app", toast: true, sound: "none" },
          { kind: "telegram", profileId: "default" },
        ],
        onFailure: "continue",
      },
      { id: "matrix_duration", type: "wait", mode: "duration", durationMs: 1 },
      { id: "matrix_continue", type: "wait", mode: "user-continue", prompt: "literal {{value}}" },
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
            matcher: { kind: "simple", op: "contains", text: "{{value}}" },
            scope: { kind: "whole" },
          },
          body: [{ id: "matrix_branch_finish", type: "finish", reason: "{{value}}", body: [] }],
        }],
      },
      {
        id: "matrix_extract",
        type: "extract_text",
        source: { kind: "step_artifact", stepId: "matrix_capture", artifact: "captured_text" },
        split: { kind: "regex", pattern: "\\n+", flags: "", keepEmpty: false },
        filters: [
          { kind: "include", matcher: { kind: "simple", op: "contains", text: "{{value}}" } },
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
          label: "literal {{value}}",
          terminal: worker,
          body: [
            {
              id: "matrix_lane_send",
              type: "send",
              terminal: worker,
              message: { parts: [{ kind: "text", text: "literal {{value}}" }] },
              delivery: "direct",
              ending: "none",
            },
            { id: "matrix_lane_output", type: "output", source: { kind: "none" } },
          ],
        }],
        merge: { kind: "sectioned_text", separator: "{{value}} {laneId}", includeEmptyOutputs: true },
        onLaneFail: "pause",
      },
      { id: "matrix_finish", type: "finish", reason: "{{value}}", body: [] },
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
  { group: "for source item", path: ["body", 0, "range", "items", 0], expectedIssue: "items[0].kind:extra Flow V2 field is not allowed" },
  { group: "message artifact source", path: ["body", 0, "body", 1, "message", "parts", 1, "source"], expectedIssue: "source.kind:artifact source kind must be step_artifact" },
  { group: "input defaultSource", path: ["body", 0, "body", 2, "defaultSource"], expectedIssue: "defaultSource.kind:artifact source kind must be step_artifact" },
  { group: "notify level", path: ["body", 0, "body", 3, "level"], expectedIssue: "level:level must be info, success, warning or error" },
  { group: "notify sound", path: ["body", 0, "body", 3, "channels", 0, "sound"], expectedIssue: "sound:sound must be none, bell, chime, ping, pulse, success, warning or alert" },
  { group: "notification profile selector", path: ["body", 0, "body", 3, "channels", 1, "profileId"], expectedIssue: "profileId:value must be a public id string" },
  { group: "duration wait config", path: ["body", 0, "body", 4, "durationMs"], expectedIssue: "durationMs:value must be a positive integer" },
  { group: "terminal-quiet target", path: ["body", 0, "body", 6, "terminal"], expectedIssue: "terminal.template:extra terminal target field is not allowed" },
  { group: "terminal-quiet onTimeout", path: ["body", 0, "body", 6, "onTimeout"], expectedIssue: "onTimeout:value must be one of pause, finish" },
  { group: "capture terminal selector", path: ["body", 0, "body", 0, "capture", "terminal"], expectedIssue: "capture.terminal.template:extra terminal target field is not allowed" },
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
  { group: "terminal selector", path: ["body", 0, "body", 1, "terminal"], expectedIssue: "terminal.template:extra terminal target field is not allowed" },
  { group: "artifact stepId reference", path: ["body", 0, "body", 1, "message", "parts", 1, "source", "stepId"], expectedIssue: "stepId:value must be a public id string" },
  { group: "artifact name reference", path: ["body", 0, "body", 1, "message", "parts", 1, "source", "artifact"], expectedIssue: "artifact:artifact must be captured_text, merged_text or extracted_text" },
]

test("unsupported schema matrix fixture keeps ordinary double-brace strings literal", () => {
  expect(validateFlowV2Template(unsupportedMatrixFixture(), { indexMap })).toEqual({ ok: true, issues: [] })
})

for (const matrixCase of unsupportedMatrixCases) {
  test("unsupported schema matrix rejects template object for " + matrixCase.group, () => {
    const candidate = unsupportedMatrixFixture()
    replaceMatrixPath(candidate, matrixCase.path, { kind: "template", template: "{{value}}" })
    expect(issueText(candidate)).toContain(matrixCase.expectedIssue)
  })
}
