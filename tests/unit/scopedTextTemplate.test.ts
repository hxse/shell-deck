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

function template(body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return { schemaVersion: 2, id: "tmpl_scoped_text", name: "Scoped text", description: "", configId: "local", body, createdAt: now, updatedAt: now }
}

function issueText(value: unknown): string {
  return validateFlowV2Template(value, { indexMap }).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
}

test("scoped text renderer performs exact one-pass replacement and preserves literal strings", () => {
  const binding = { text: "item {{text}}\n", forStepId: "loop" }
  expect(renderScopedTemplate("A={{text}}; B={{text}}", binding)).toBe("A=item {{text}}\n; B=item {{text}}\n")
  expect(renderTemplatableScalar("literal {{text}}", binding)).toBe("literal {{text}}")
  expect(renderTemplatableScalar({ kind: "template", template: "value={{text}}" }, binding)).toBe("value=item {{text}}\n")
  expect(() => renderScopedTemplate("{{text}}", undefined)).toThrow("missing_template_binding")
})

test("scoped template syntax only accepts exact {{text}}", () => {
  expect(scopedTemplateSyntaxIssue("{{text}}")).toBeNull()
  expect(scopedTemplateSyntaxIssue("x {{text}} y {{text}}")).toBeNull()
  expect(scopedTemplateSyntaxIssue("literal only")).toContain("must contain")
  expect(scopedTemplateSyntaxIssue("{{ text }}")).toContain("must contain")
  expect(scopedTemplateSyntaxIssue("{{foo}} {{text}}")).toContain("only supports")
  expect(scopedTemplateSyntaxIssue("{{text}} tail }}")).toContain("only supports")
})

test("text-list scope enables only explicit message and scalar templates", () => {
  const value = template([{
    id: "loop",
    type: "for",
    range: { kind: "text-list", items: ["phase 1", "", "phase {{text}}"] },
    body: [
      { id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "send {{text}}" }, { kind: "text", text: "literal {{text}}" }] }, enter: true },
      { id: "notify", type: "notify", level: "info", title: { kind: "template", template: "title {{text}}" }, message: { parts: [{ kind: "template", template: "body {{text}}" }] }, channels: [{ kind: "app", toast: true, sound: "none" }], onFailure: "continue" },
      { id: "input", type: "input", terminal: worker, prompt: { kind: "template", template: "input {{text}}" }, allowEmpty: true, enter: false },
      { id: "continue_wait", type: "wait", mode: "user-continue", prompt: { kind: "template", template: "continue {{text}}" } },
      {
        id: "parallel",
        type: "parallel",
        lanes: [
          { id: "lane_worker", label: "Worker", terminal: worker, body: [{ id: "lane_send_worker", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "lane {{text}}" }] }, enter: true }, { id: "lane_output_worker", type: "output", source: { kind: "none" } }] },
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
    range: { kind: "text-list", items: ["outer"] },
    body: [{
      id: "inner_count",
      type: "for",
      range: { kind: "count", count: 1 },
      body: [{ id: "send_inner", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "{{text}}" }] }, enter: true }],
    }],
  }])
  expect(validateFlowV2Template(value, { indexMap }).ok).toBe(true)
})

test("templates outside text-list scope and malformed list/templates fail loudly", () => {
  const outside = template([{ id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "{{text}}" }] }, enter: true }])
  expect(issueText(outside)).toContain("template requires an enclosing text-list for")

  const literal = template([{ id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "{{text}}" }] }, enter: true }])
  expect(validateFlowV2Template(literal, { indexMap }).ok).toBe(true)

  const malformed = template([{ id: "loop", type: "for", range: { kind: "text-list", items: [] }, body: [{ id: "send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "{{foo}}" }] }, enter: true }] }])
  const malformedIssues = issueText(malformed)
  expect(malformedIssues).toContain("text-list items must not be empty")
  expect(malformedIssues).toContain("template must contain exact {{text}} token")

  const unsupported = template([{ id: "loop", type: "for", range: { kind: "text-list", items: ["x"] }, body: [{ id: "finish", type: "finish", reason: { kind: "template", template: "{{text}}" } as never }] }])
  expect(issueText(unsupported)).toContain("reason:value must be a string")
})
