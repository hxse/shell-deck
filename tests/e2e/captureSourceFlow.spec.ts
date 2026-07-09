import { expect, test } from "playwright/test"

const template = {
  schemaVersion: 2,
  id: "capture_terminal_buffer_template",
  name: "Capture Terminal Buffer",
  description: "terminal-buffer capture e2e",
  configId: "capture-e2e",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  body: [
    { id: "send_ready", type: "send", terminal: { kind: "alias", value: "shell_1" }, message: { parts: [{ kind: "text", text: "capture-ready" }] }, enter: true },
    { id: "capture_terminal", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "shell_1" }, mode: "scrollback-tail", maxChars: 12000 } },
    { id: "if_ready", type: "if", branches: [{ kind: "if", condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture_terminal", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "capture-ready" }, scope: { kind: "whole" } }, body: [{ id: "done", type: "finish", reason: "ok" }] }] },
  ],
}

test("terminal-buffer capture flow records source kind, terminal id and artifact refs", async ({ page, request }) => {
  await request.post("/api/configs/capture-e2e/terminals?backend=fake")
  const imported = await request.post("/api/configs/capture-e2e/templates/import", { data: template })
  expect(imported.status()).toBe(201)

  await page.goto("/?configId=capture-e2e")
  await page.getByTestId("macro-template-summary").click()
  await expect(page.getByTestId("macro-template-item")).toContainText("Capture Terminal Buffer")
  await page.getByTestId("macro-template-select").selectOption("capture_terminal_buffer_template")
  await page.getByTestId("macro-template-summary").click()
  await page.getByTestId("macro-control-start").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("completed", { timeout: 5000 })

  const runsResponse = await request.get("/api/configs/capture-e2e/runs")
  const runsBody = await runsResponse.json() as { runs: Array<{ runId: string }> }
  const runId = runsBody.runs[0].runId
  const runResponse = await request.get("/api/configs/capture-e2e/runs/" + runId)
  const runBody = await runResponse.json() as { run: { replay: { events: Array<{ kind: string; data: Record<string, unknown> }> } } }
  const captureEvent = runBody.run.replay.events.find((event) => event.kind === "capture_artifact_created")
  const branchEvent = runBody.run.replay.events.find((event) => event.kind === "branch_decision")

  expect(captureEvent?.data.captureKind).toBe("terminal-buffer")
  expect(captureEvent?.data.terminalId).toMatch(/^term_/)
  expect(String(captureEvent?.data.artifactRef).startsWith("artifacts/capture-normalized-")).toBe(true)
  expect(String(captureEvent?.data.rawArtifactRef).startsWith("artifacts/capture-raw-")).toBe(true)
  expect(captureEvent?.data.normalizedArtifactRef).toBe(captureEvent?.data.artifactRef)
  expect(branchEvent?.data.matched).toBe(true)
})
