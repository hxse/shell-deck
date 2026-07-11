import { expect, test } from "bun:test"
import { validateRunEvent } from "../../src/lib/runLog/runEventSchema"
import type { RunEvent } from "../../src/lib/runLog/runEventTypes"

const base = {
  schemaVersion: 1,
  eventId: "evt_loop_schema_1",
  eventSeq: 1,
  runId: "run_loop_schema_1",
  configId: "local",
  createdAt: "2026-07-11T00:00:00.000Z",
  summary: "loop iteration fixture",
} satisfies Omit<RunEvent, "kind" | "data">

test("loop iteration events are step-scoped and accept occurrence-aware finite data", () => {
  const data = {
    executionPath: [
      { kind: "for", stepId: "outer_loop", iterationIndex: 0 },
      { kind: "for", stepId: "inner_loop", iterationIndex: 1 },
    ],
    iterationIndex: 1,
    iteration: 2,
    total: 3,
  }

  for (const rangeKind of ["count", "text-list"] as const) {
    const rangeData = { ...data, rangeKind }
    for (const kind of ["loop_iteration_started", "loop_iteration_completed"] as const) {
      expect(validateRunEvent({ ...base, kind, stepId: "inner_loop", data: rangeData })).toEqual({ ok: true, issues: [] })

      const missingStep = validateRunEvent({ ...base, kind, data: rangeData })
      expect(missingStep.ok).toBe(false)
      expect(issueText(missingStep)).toContain("step-scoped event requires stepId")
    }
  }
})

test("forever iteration data uses an explicit null total", () => {
  const valid = validateRunEvent({
    ...base,
    kind: "loop_iteration_started",
    stepId: "loop_forever",
    data: {
      executionPath: [{ kind: "for", stepId: "loop_forever", iterationIndex: 4 }],
      iterationIndex: 4,
      iteration: 5,
      rangeKind: "forever",
      total: null,
    },
  })
  expect(valid).toEqual({ ok: true, issues: [] })

  const finiteTotal = validateRunEvent({
    ...base,
    kind: "loop_iteration_completed",
    stepId: "loop_forever",
    data: {
      executionPath: [{ kind: "for", stepId: "loop_forever", iterationIndex: 4 }],
      iterationIndex: 4,
      iteration: 5,
      rangeKind: "forever",
      total: 5,
    },
  })
  expect(issueText(finiteTotal)).toContain("forever loop total must be null")
})

test("loop iteration schema rejects inconsistent positions and malformed execution paths", () => {
  const inconsistent = validateRunEvent({
    ...base,
    kind: "loop_iteration_completed",
    stepId: "loop_count",
    data: {
      executionPath: [{ kind: "for", stepId: "other_loop", iterationIndex: 0 }],
      iterationIndex: 1,
      iteration: 1,
      rangeKind: "count",
      total: 1,
    },
  })
  const inconsistentIssues = issueText(inconsistent)
  expect(inconsistentIssues).toContain("iteration must equal iterationIndex + 1")
  expect(inconsistentIssues).toContain("iterationIndex must be less than total")
  expect(inconsistentIssues).toContain("executionPath must end at the current loop iteration")

  const missingPath = validateRunEvent({
    ...base,
    kind: "loop_iteration_started",
    stepId: "loop_count",
    data: { iterationIndex: 0, iteration: 1, rangeKind: "count", total: 1 },
  })
  expect(issueText(missingPath)).toContain("executionPath must be an array")
})

test("all run events validate executionPath when present while legacy omission remains valid", () => {
  const valid = validateRunEvent({
    ...base,
    kind: "terminal_text_sent",
    stepId: "send_nested",
    data: {
      executionPath: [
        { kind: "for", stepId: "outer_loop", iterationIndex: 2 },
        { kind: "parallel-lane", stepId: "parallel_review", laneId: "lane_a" },
      ],
    },
  })
  expect(valid).toEqual({ ok: true, issues: [] })

  const malformed = validateRunEvent({
    ...base,
    kind: "terminal_text_sent",
    stepId: "send_nested",
    data: { executionPath: "not-an-array" },
  })
  expect(issueText(malformed)).toContain("data.executionPath executionPath must be an array")

  const malformedSegment = validateRunEvent({
    ...base,
    kind: "run_paused",
    data: {
      executionPath: [{ kind: "parallel-lane", stepId: "parallel_review", laneId: 4 }],
    },
  })
  expect(issueText(malformedSegment)).toContain("data.executionPath[0].laneId")

  const malformedNext = validateRunEvent({
    ...base,
    kind: "run_paused",
    data: {
      nextStepId: "../next",
      nextExecutionPath: [{ kind: "for", stepId: "loop", iterationIndex: -1 }],
    },
  })
  expect(issueText(malformedNext)).toContain("data.nextStepId")
  expect(issueText(malformedNext)).toContain("data.nextExecutionPath[0].iterationIndex")

  const legacyWithoutPath = validateRunEvent({
    ...base,
    kind: "terminal_text_sent",
    stepId: "legacy_send",
    data: {},
  })
  expect(legacyWithoutPath).toEqual({ ok: true, issues: [] })
})

function issueText(result: { issues: Array<{ path: string; message: string }> }): string {
  return result.issues.map((issue) => issue.path + " " + issue.message).join("\n")
}
