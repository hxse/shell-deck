import { expect, test } from "bun:test"
import { validateFlowV2Template } from "../../src/lib/macro/flowV2Schema"

test("parallel_all is rejected in the Flow V2 macro language", () => {
  const now = "2026-01-01T00:00:00.000Z"
  const result = validateFlowV2Template({
    schemaVersion: 2,
    id: "reject_parallel_all",
    name: "Reject parallel_all",
    description: "",
    configId: "local",
    createdAt: now,
    updatedAt: now,
    body: [{ id: "parallel", type: "parallel_all", lanes: [], join: { mode: "all_success" } }],
  })
  expect(result.ok).toBe(false)
  expect(result.issues.map((issue) => issue.path + ":" + issue.message).join("\n")).toContain("body[0].type:unsupported Flow V2 node type")
})
