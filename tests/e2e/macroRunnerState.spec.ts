import { expect, test } from "playwright/test"

const template = {
  schemaVersion: 1,
  id: "runner_input_template",
  name: "Runner Input Template",
  description: "e2e runner template",
  configId: "runner-e2e",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  steps: [
    { id: "ask", type: "input_line", terminal: { kind: "alias", value: "terminal_1" }, prompt: "Direction", allowEmpty: false, next: "done" },
    { id: "done", type: "complete", reason: "ok" },
  ],
}

const otherTemplate = {
  schemaVersion: 1,
  id: "runner_other_template",
  name: "Runner Other Template",
  description: "parallel config runner template",
  configId: "runner-other-e2e",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-06-30T00:00:00.000Z",
  steps: [
    { id: "send", type: "send_line", terminal: { kind: "alias", value: "terminal_1" }, text: "other-run", next: "done" },
    { id: "done", type: "complete", reason: "ok" },
  ],
}

test("macro runner starts selected template, pauses, isolates configs, sends input and completes", async ({ page, request }) => {
  await request.post("/api/configs/runner-e2e/terminals?backend=fake")
  const imported = await request.post("/api/configs/runner-e2e/templates/import", { data: template })
  expect(imported.status()).toBe(201)
  await page.goto("/?configId=runner-e2e")
  await expect(page.getByTestId("macro-panel")).toBeVisible()
  await expect(page.getByTestId("macro-template-item")).toContainText("Runner Input Template")

  await page.getByTestId("macro-control-start").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("waiting_user_input")
  await expect(page.getByTestId("macro-run-input")).toBeVisible()

  await page.getByTestId("macro-control-pause").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("paused")
  await page.getByTestId("macro-control-resume").click()
  await page.waitForTimeout(100)
  await page.getByTestId("macro-run-refresh").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("waiting_user_input")

  await page.getByTestId("macro-control-start").click()
  await expect(page.getByText(/live_run_exists/)).toBeVisible()

  await request.post("/api/configs/runner-other-e2e/terminals?backend=fake")
  const importedOther = await request.post("/api/configs/runner-other-e2e/templates/import", { data: otherTemplate })
  expect(importedOther.status()).toBe(201)
  const otherPage = await page.context().newPage()
  await otherPage.goto("/?configId=runner-other-e2e")
  await expect(otherPage.getByTestId("macro-template-item")).toContainText("Runner Other Template")
  await otherPage.getByTestId("macro-control-start").click()
  await otherPage.waitForTimeout(100)
  await otherPage.getByTestId("macro-run-refresh").click()
  await expect(otherPage.getByTestId("macro-run-status")).toContainText("completed")
  await expect(otherPage.getByTestId("terminal-host").first()).toHaveAttribute("data-rendered-replay", /ECHO:other-run/)
  await otherPage.close()

  await page.getByTestId("macro-run-input-text").fill("from-ui")
  await page.getByTestId("macro-run-input-submit").click()
  await page.waitForTimeout(100)
  await page.getByTestId("macro-run-refresh").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("completed")
  await expect(page.getByTestId("terminal-host").first()).toHaveAttribute("data-rendered-replay", /ECHO:from-ui/)
})
