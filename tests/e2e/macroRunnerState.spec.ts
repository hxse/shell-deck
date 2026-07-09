import { expect, test } from "playwright/test"

const template = {
  schemaVersion: 2,
  id: "runner_input_template",
  name: "Runner Input Template",
  description: "e2e runner template",
  configId: "runner-e2e",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  body: [
    { id: "ask", type: "input", terminal: { kind: "alias", value: "shell_1" }, prompt: "Direction", allowEmpty: false, enter: true },
    { id: "done", type: "finish", reason: "ok" },
  ],
}

const otherTemplate = {
  schemaVersion: 2,
  id: "runner_other_template",
  name: "Runner Other Template",
  description: "parallel config runner template",
  configId: "runner-other-e2e",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  body: [
    { id: "send", type: "send", terminal: { kind: "alias", value: "shell_1" }, message: { parts: [{ kind: "text", text: "other-run" }] }, enter: true },
    { id: "done", type: "finish", reason: "ok" },
  ],
}

const delayedTemplate = {
  schemaVersion: 2,
  id: "runner_delayed_template",
  name: "Runner Delayed Template",
  description: "e2e delayed runner refresh template",
  configId: "runner-delayed-e2e",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  body: [
    { id: "send", type: "send", terminal: { kind: "alias", value: "shell_1" }, message: { parts: [{ kind: "text", text: "delayed-run" }] }, enter: true },
    { id: "wait", type: "wait", mode: "duration", durationMs: 1200 },
    { id: "done", type: "finish", reason: "ok" },
  ],
}

test("macro runner starts selected template, pauses, isolates configs, sends input and completes", async ({ page, request }) => {
  await request.post("/api/configs/runner-e2e/terminals?backend=fake")
  const imported = await request.post("/api/configs/runner-e2e/templates/import", { data: template })
  expect(imported.status()).toBe(201)
  await page.goto("/?configId=runner-e2e")
  await page.getByTestId("macro-template-summary").click()
  await expect(page.getByTestId("macro-panel")).toBeVisible()
  await expect(page.getByTestId("macro-template-item")).toContainText("Runner Input Template")
  await page.getByTestId("macro-template-select").selectOption("runner_input_template")
  await page.getByTestId("macro-template-summary").click()

  await page.getByTestId("macro-control-start").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("waiting_user_input")
  await expect(page.getByTestId("macro-run-input")).toBeVisible()
  await expect(page.getByTestId("macro-control-pause-resume")).toHaveText("Pause")

  await page.getByTestId("macro-control-pause-resume").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("paused")
  await expect(page.getByTestId("macro-control-pause-resume")).toHaveText("Resume")
  await page.getByTestId("macro-control-pause-resume").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("waiting_user_input")

  await page.getByTestId("macro-control-start").click()
  await expect(page.getByText(/live_run_exists/)).toBeVisible()

  await request.post("/api/configs/runner-other-e2e/terminals?backend=fake")
  const importedOther = await request.post("/api/configs/runner-other-e2e/templates/import", { data: otherTemplate })
  expect(importedOther.status()).toBe(201)
  const otherPage = await page.context().newPage()
  await otherPage.goto("/?configId=runner-other-e2e")
  await otherPage.getByTestId("macro-template-summary").click()
  await expect(otherPage.getByTestId("macro-template-item")).toContainText("Runner Other Template")
  await otherPage.getByTestId("macro-template-select").selectOption("runner_other_template")
  await otherPage.getByTestId("macro-template-summary").click()
  await otherPage.getByTestId("macro-control-start").click()
  await expect(otherPage.getByTestId("macro-run-status")).toContainText("completed", { timeout: 5000 })
  await expect(otherPage.getByTestId("terminal-host").first()).toHaveAttribute("data-rendered-replay", /ECHO:other-run/)
  await otherPage.close()

  await page.getByTestId("macro-run-input-text").fill("from-ui")
  await page.getByTestId("macro-run-input-submit").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("completed", { timeout: 5000 })
  await expect(page.getByTestId("terminal-host").first()).toHaveAttribute("data-rendered-replay", /ECHO:from-ui/)
})

test("macro runner auto-saves draft before start and completes send", async ({ page, request }) => {
  await request.post("/api/configs/runner-draft-e2e/terminals?backend=fake")
  await page.goto("/?configId=runner-draft-e2e")
  await expect(page.getByTestId("macro-panel")).toBeVisible()
  await page.getByTestId("macro-template-summary").click()

  await page.getByTestId("macro-create").click()
  await page.getByTestId("macro-template-summary").click()
  await page.getByTestId("empty-body-add").first().click()
  await page.getByTestId("add-step-send").click()
  await page.getByTestId("message-add-text").first().click()
  await page.getByTestId("message-text-part").first().fill("draft-send-only")
  await page.getByTestId("macro-control-start").click()

  await expect(page.getByTestId("macro-run-status")).toContainText("completed", { timeout: 5000 })
  await expect(page.getByTestId("terminal-host").first()).toHaveAttribute("data-rendered-replay", /ECHO:draft-send-only/)
})

test("macro runner auto-refreshes after delayed live run completes without manual refresh", async ({ page, request }) => {
  await request.post("/api/configs/runner-delayed-e2e/terminals?backend=fake")
  const imported = await request.post("/api/configs/runner-delayed-e2e/templates/import", { data: delayedTemplate })
  expect(imported.status()).toBe(201)
  await page.goto("/?configId=runner-delayed-e2e")
  await page.getByTestId("macro-template-summary").click()
  await expect(page.getByTestId("macro-template-item")).toContainText("Runner Delayed Template")
  await page.getByTestId("macro-template-select").selectOption("runner_delayed_template")
  await page.getByTestId("macro-template-summary").click()

  await page.getByTestId("macro-control-start").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("running")
  await expect(page.getByTestId("macro-run-status")).toContainText("completed", { timeout: 5000 })
  await expect(page.getByTestId("terminal-host").first()).toHaveAttribute("data-rendered-replay", /ECHO:delayed-run/)
})
