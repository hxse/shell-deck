import { expect, test } from "bun:test"
import { validateFlowV2Template } from "../../src/lib/macro/flowV2Schema"
import { renderScopedTemplate, renderTemplatableScalar, scopedTemplateSyntaxIssue } from "../../src/lib/macro/scopedTextTemplate"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"

const worker = { kind: "alias" as const, value: "worker" }
const reviewer = { kind: "alias" as const, value: "reviewer" }
const indexMap = [
  { index: 1, terminalId: "term_worker", terminalAlias: "worker" },
  { index: 2, terminalId: "term_reviewer", terminalAlias: "reviewer" },
]

function textListItem(value: string, key = value) {
  return { key, value }
}

function template(body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return { schemaVersion: 2, id: "tmpl_scoped_text", name: "Scoped text", description: "", configId: "local", body, createdAt: now, updatedAt: now }
}

function issueText(value: unknown): string {
  return validateFlowV2Template(value, { indexMap }).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
}

test("scoped template renderer replaces index key and value once while literals stay exact", () => {
  const binding = { index: 2, key: "phase-key", value: "item {{index}}/{{key}}/{{value}}\n", forStepId: "loop" }
  expect(renderScopedTemplate("{{index}}:{{key}}:{{value}}/{{value}}", binding)).toBe("2:phase-key:item {{index}}/{{key}}/{{value}}\n/item {{index}}/{{key}}/{{value}}\n")
  expect(renderTemplatableScalar("literal {{index}}/{{key}}/{{value}}/{{text}}", binding)).toBe("literal {{index}}/{{key}}/{{value}}/{{text}}")
  expect(renderTemplatableScalar({ kind: "template", template: "{{key}}={{value}}" }, binding)).toBe("phase-key=item {{index}}/{{key}}/{{value}}\n")
  expect(() => renderScopedTemplate("{{value}}", undefined)).toThrow("missing_template_binding")
})

test("scoped template syntax accepts only exact index key and value tokens", () => {
  expect(scopedTemplateSyntaxIssue("{{index}}")).toBeNull()
  expect(scopedTemplateSyntaxIssue("{{key}}")).toBeNull()
  expect(scopedTemplateSyntaxIssue("{{value}}")).toBeNull()
  expect(scopedTemplateSyntaxIssue("x {{index}} {{key}} {{value}}")).toBeNull()
  expect(scopedTemplateSyntaxIssue("literal only")).toContain("must contain")
  expect(scopedTemplateSyntaxIssue("{{ index }}")).toContain("must contain")
  expect(scopedTemplateSyntaxIssue("{{text}}")).toContain("must contain")
  expect(scopedTemplateSyntaxIssue("{{foo}} {{value}}")).toContain("only supports")
  expect(scopedTemplateSyntaxIssue("{{value}} tail }}")).toContain("only supports")
})

test("text-list scope enables only explicit message and scalar templates", () => {
  const value = template([{
    id: "loop",
    type: "for",
    range: { kind: "text-list", items: [textListItem("phase 1"), textListItem(""), textListItem("phase {{value}}")] },
    body: [
      { id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "send {{index}}/{{key}}/{{value}}" }, { kind: "text", text: "literal {{value}}" }] }, enter: true },
      { id: "notify", type: "notify", level: "info", title: { kind: "template", template: "title {{index}}" }, message: { parts: [{ kind: "template", template: "body {{key}}={{value}}" }] }, channels: [{ kind: "app", toast: true, sound: "none" }], onFailure: "continue" },
      { id: "input", type: "input", terminal: worker, prompt: { kind: "template", template: "input {{key}}" }, allowEmpty: true, enter: false },
      { id: "continue_wait", type: "wait", mode: "user-continue", prompt: { kind: "template", template: "continue {{index}}" } },
      {
        id: "parallel",
        type: "parallel",
        lanes: [
          { id: "lane_worker", label: "Worker", terminal: worker, body: [{ id: "lane_send_worker", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "lane {{index}}/{{key}}/{{value}}" }] }, enter: true }, { id: "lane_output_worker", type: "output", source: { kind: "none" } }] },
          { id: "lane_reviewer", label: "Reviewer", terminal: reviewer, body: [{ id: "lane_output_reviewer", type: "output", source: { kind: "none" } }] },
        ],
        merge: { kind: "sectioned_text", separator: "{laneId}", includeEmptyOutputs: true },
        onLaneFail: "pause",
      },
    ],
  }])
  expect(validateFlowV2Template(value, { indexMap })).toEqual({ ok: true, issues: [] })
})

test("count and if descendants inherit outer text-list scope", () => {
  const value = template([{
    id: "outer",
    type: "for",
    range: { kind: "text-list", items: [textListItem("outer")] },
    body: [{
      id: "inner_count",
      type: "for",
      range: { kind: "count", count: 1 },
      body: [{ id: "send_inner", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "{{value}}" }] }, enter: true }],
    }],
  }])
  expect(validateFlowV2Template(value, { indexMap }).ok).toBe(true)
})

test("templates outside text-list scope and malformed list/templates fail loudly", () => {
  const outside = template([{ id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "{{value}}" }] }, enter: true }])
  expect(issueText(outside)).toContain("template requires an enclosing text-list for")

  const literal = template([{ id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "{{value}}" }] }, enter: true }])
  expect(validateFlowV2Template(literal, { indexMap }).ok).toBe(true)

  const malformed = template([{ id: "loop", type: "for", range: { kind: "text-list", items: [] }, body: [{ id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "{{foo}}" }] }, enter: true }] }])
  const malformedIssues = issueText(malformed)
  expect(malformedIssues).toContain("text-list items must not be empty")
  expect(malformedIssues).toContain("template must contain exact {{index}}, {{key}} or {{value}} token")

  const unsupported = template([{ id: "loop", type: "for", range: { kind: "text-list", items: [textListItem("x")] }, body: [{ id: "finish", type: "finish", reason: { kind: "template", template: "{{value}}" } as never }] }])
  expect(issueText(unsupported)).toContain("reason:value must be a string")
})
