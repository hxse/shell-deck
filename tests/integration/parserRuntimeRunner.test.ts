import { expect, test } from "bun:test"
import { validateFlowV2Template } from "../../src/lib/macro/flowV2Schema"

test("Flow V2 current allowlist rejects parse nodes; AI parsing is user-managed through terminals", () => {
  const now = "2026-01-01T00:00:00.000Z"
  const result = validateFlowV2Template({
    schemaVersion: 2,
    id: "reject_parser_action",
    name: "Reject parser action",
    description: "",
    configId: "local",
    createdAt: now,
    updatedAt: now,
    body: [
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "index", value: 1 }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "parse", type: "parse", captureStep: "capture", parser: { kind: "ai-json", profileId: "review-routing-v1" } },
    ],
  })
  expect(result.ok).toBe(false)
  const text = result.issues.map((issue) => issue.path + ":" + issue.message).join("\n")
  expect(text).toContain("body[1].type:unsupported Flow V2 node type")
})
