import { expect, test } from "playwright/test"

const template = {
  schemaVersion: 2,
  id: "parallel_send_capture_e2e_template",
  name: "Parallel Send Capture",
  description: "parallel_send_capture e2e",
  configId: "parallel-e2e",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  body: [
    {
      id: "parallel_review",
      type: "parallel_send_capture",
      items: [
        { id: "review", terminal: { kind: "alias", value: "terminal_1" }, send: { id: "send_review", type: "send_line", terminal: { kind: "alias", value: "terminal_1" }, message: { parts: [{ kind: "text", text: "review ready" }] } }, wait: { id: "wait_review", type: "wait", mode: "terminal-quiet", terminal: { kind: "alias", value: "terminal_1" }, quietMs: 20, maxMs: 1000, onTimeout: "pause" }, capture: { id: "capture_review", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "terminal_1" }, mode: "scrollback-tail", maxChars: 12000 } } },
        { id: "tests", terminal: { kind: "alias", value: "terminal_2" }, send: { id: "send_tests", type: "send_line", terminal: { kind: "alias", value: "terminal_2" }, message: { parts: [{ kind: "text", text: "tests ready" }] } }, wait: { id: "wait_tests", type: "wait", mode: "terminal-quiet", terminal: { kind: "alias", value: "terminal_2" }, quietMs: 20, maxMs: 1000, onTimeout: "pause" }, capture: { id: "capture_tests", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "terminal_2" }, mode: "scrollback-tail", maxChars: 12000 } } },
      ],
      merge: { kind: "sectioned_text", separator: "===== {itemId} | {terminalAlias} =====", order: "item_order", includeEmptyCaptures: true },
      onItemFail: "pause",
    },
    { id: "send_merged", type: "send_line", terminal: { kind: "alias", value: "terminal_1" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] } },
    { id: "done", type: "return", reason: "ok" },
  ],
}

test("parallel_send_capture e2e runs fan-out/fan-in and preserves merged artifact in run log", async ({ page, request }) => {
  await request.post("/api/configs/parallel-e2e/terminals?backend=fake")
  await request.post("/api/configs/parallel-e2e/terminals?backend=fake")
  const imported = await request.post("/api/configs/parallel-e2e/templates/import", { data: template })
  expect(imported.status()).toBe(201)

  await page.goto("/?configId=parallel-e2e")
  await page.getByTestId("macro-template-summary").click()
  await expect(page.getByTestId("macro-template-item")).toContainText("Parallel Send Capture")
  await page.getByTestId("macro-template-select").selectOption("parallel_send_capture_e2e_template")
  await page.getByTestId("macro-control-start").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("completed", { timeout: 5000 })

  const runsResponse = await request.get("/api/configs/parallel-e2e/runs")
  const runsBody = await runsResponse.json() as { runs: Array<{ runId: string }> }
  const runResponse = await request.get("/api/configs/parallel-e2e/runs/" + runsBody.runs[0].runId)
  const runBody = await runResponse.json() as { run: { replay: { events: Array<{ kind: string; data: Record<string, unknown> }> } } }
  const events = runBody.run.replay.events

  expect(events.some((event) => event.kind === "parallel_send_capture_joined")).toBe(true)
  expect(events.some((event) => event.kind === "parallel_send_capture_item_completed" && event.data.itemId === "review")).toBe(true)
  expect(events.some((event) => event.kind === "parallel_send_capture_item_completed" && event.data.itemId === "tests")).toBe(true)
  const mergedEvent = events.find((event) => event.kind === "parallel_send_capture_joined")
  expect(String(mergedEvent?.data.artifactRef)).toMatch(/^artifacts\/parallel-merged-/)
})
