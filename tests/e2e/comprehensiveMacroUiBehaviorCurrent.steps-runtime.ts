import { expect, type Page } from 'playwright/test'
import { macroRuntimeControlInventory } from '../ui-baseline/031B/controlInventory'
import {
  addMessageText,
  clickWithDialog,
  closeTemplateDrawer,
  flowBody,
  insertInside,
  insertRoot,
  nodeControl,
  openTemplateDrawer,
  selectOptionContaining,
  terminalHost,
  terminalTab,
  type MacroJourneyState,
} from './comprehensiveMacroUiBehaviorCurrent.helpers'

export async function completeMacro(page: Page, state: MacroJourneyState): Promise<void> {
  let { mainTemplateId } = state
  const captureText = await insertRoot(page, 'add-step-capture', 'capture_text_box')
  await selectOptionContaining(captureText.getByTestId('capture-step-terminal'), '5 · text')
  await expect(captureText.getByTestId('capture-kind-fixed')).toContainText('text-box')

  const repairCapture = await insertRoot(page, 'add-step-capture', 'capture_repair')
  await selectOptionContaining(repairCapture.getByTestId('capture-step-terminal'), '4 · shell')

  const input = await insertRoot(page, 'add-step-input', 'input_root')
  await selectOptionContaining(input.getByTestId('input-terminal'), '1 · shell')
  await input.getByTestId('input-prompt').fill('Dogfood runtime input')
  await input.getByTestId('input-allow-empty').uncheck()
  await input.getByTestId('input-input-delivery').selectOption('auto')
  await input.getByTestId('input-ending-sequence').selectOption('cr')
  await input.getByTestId('input-default-source').selectOption('capture_text_box:captured_text')

  const finish = await insertRoot(page, 'add-flow-finish', 'finish_root')
  await finish.getByTestId('flow-control-reason').fill('031B completed')
  await insertInside(flowBody(page, 'finish action body').last(), 'add-step-send')
  const finishBodySend = flowBody(page, 'finish action body').last().locator(':scope > [data-flow-node-type="send"]').last()
  await addMessageText(finishBodySend, 'FINISH_BODY')
  await clickWithDialog(nodeControl(finishBodySend, 'node-remove'), 'accept')

  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
  await expect(page.getByTestId('macro-template-select')).toHaveValue(/^tmpl_/)
  mainTemplateId = await page.getByTestId('macro-template-select').inputValue()
  await closeTemplateDrawer(page)
  state.mainTemplateId = mainTemplateId
}

export async function exerciseSavedRecords(page: Page, state: MacroJourneyState): Promise<void> {
  const { mainTemplateId } = state
  await page.getByTestId("macro-tab-json").click()
  await page.getByTestId("macro-json-copy").click()
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain("\"parallel_root\"")

  await page.getByTestId("macro-edit-json").click()
  await page.getByTestId("macro-json-editor").fill("{")
  await page.getByTestId("macro-save-json").click()
  await expect(page.getByTestId("macro-json-error")).toContainText("Invalid JSON")
  const currentJson = await page.evaluate(() => navigator.clipboard.readText())
  await page.getByTestId("macro-json-editor").fill(currentJson.replace("\"schemaVersion\": 6", "\"schemaVersion\": 5"))
  await page.getByTestId("macro-save-json").click()
  await expect(page.getByTestId("macro-json-error")).toContainText("schemaVersion")
  await page.getByTestId("macro-cancel-json").click()
  await page.getByTestId("macro-tab-editor").click()

  await openTemplateDrawer(page)
  await page.getByTestId("macro-name").fill("Cancelled current edit")
  await page.getByTestId("macro-cancel-edit").click()
  await expect(page.getByTestId("macro-name")).toHaveValue("031B Full Offline Dogfood")
  await page.getByTestId("macro-edit").click()
  await expect(page.getByTestId("macro-name")).toBeEnabled()
  await page.getByTestId("macro-cancel-edit").click()

  await page.getByTestId("macro-create").click()
  await page.getByTestId("macro-name").fill("Temporary selectable Macro")
  await page.getByTestId("macro-save").click()
  await expect(page.getByTestId("macro-template-metadata")).not.toContainText("unsaved new macro")
  await expect(page.getByTestId("macro-template-select").locator("option:checked")).toContainText("Temporary selectable Macro")
  const temporaryTemplateId = await page.getByTestId("macro-template-select").inputValue()
  expect(temporaryTemplateId).not.toBe(mainTemplateId)
  await page.getByTestId("macro-template-search").fill("031B Full")
  await page.getByTestId("macro-template-select").selectOption(mainTemplateId)
  await page.getByTestId("macro-template-search").fill("")
  await page.getByTestId("macro-template-select").selectOption(temporaryTemplateId)
  await expect(page.getByTestId("macro-name")).toHaveValue("Temporary selectable Macro")
  await clickWithDialog(
    page.getByTestId("macro-delete"),
    "dismiss",
    "Delete Temporary selectable Macro?",
  )
  await clickWithDialog(page.getByTestId("macro-delete"), "accept")
  await page.getByTestId("macro-template-select").selectOption(mainTemplateId)
  await closeTemplateDrawer(page)
  await expect(page.getByTestId("macro-validation-summary")).toHaveText("success")
  await page.getByTestId("macro-prepare-terminals").click()
  await expect(page.getByTestId("macro-control-start")).toBeEnabled()
}

export async function runMacro(page: Page, state: MacroJourneyState): Promise<void> {
  const { fakeOneId, fakeTwoId, textId } = state
  await page.getByTestId('macro-debug-toggle').click()
  await page.getByTestId('macro-run-refresh').click()
  await page.getByTestId('macro-debug-toggle').click()

  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('running')
  await page.getByTestId('macro-control-pause-resume').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('paused', { timeout: 10_000 })
  await page.getByTestId('macro-control-pause-resume').click()

  await expect(page.getByTestId('macro-run-input-text')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('notice-item')).toBeVisible()
  await page.getByTestId('notice-dismiss').click()
  await expect(page.getByTestId('notice-item')).toHaveCount(0)
  await page.getByTestId('macro-run-input-text').fill('DOG_INPUT_031B')
  await page.getByTestId('macro-run-input-submit').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 30_000 })

  await terminalTab(page, fakeOneId).click()
  await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /DOG_ROOT/)
  await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /LOOP/)
  await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /PARALLEL_ALPHA/)
  await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /DOG_INPUT_031B/)
  await terminalTab(page, fakeTwoId).click()
  await expect(terminalHost(page, fakeTwoId)).toHaveAttribute('data-rendered-tail', /IF_MATCH/)
  await expect(terminalHost(page, fakeTwoId)).toHaveAttribute('data-rendered-tail', /PARALLEL_BETA/)
  await terminalTab(page, textId).click()
  await expect(page.getByTestId('text-box-editor')).toHaveValue(/PARALLEL_ALPHA/)
  await expect(page.getByTestId('text-box-editor')).toHaveValue(/PARALLEL_BETA/)

  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('running')
  await page.getByTestId('macro-control-stop').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('stopped', { timeout: 10_000 })

  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-input-text')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('notice-item')).toBeVisible()
  await page.getByTestId('notice-dismiss-layer').click({ position: { x: 2, y: 2 } })
  await expect(page.getByTestId('notice-item')).toHaveCount(0)
  await page.getByTestId('macro-run-input-text').fill('DOG_INPUT_SECOND')
  await page.getByTestId('macro-run-input-submit').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 30_000 })
}

export async function inspectTrace(page: Page): Promise<void> {
  await page.getByTestId("macro-tab-trace").click()
  await expect(page.getByTestId("macro-trace-view")).toContainText("run_started")
  await expect(page.getByTestId("macro-trace-runs")).toContainText("completed")
  await page.getByTestId("macro-tab-editor").click()
}

export async function repairCapabilities(page: Page, state: MacroJourneyState): Promise<void> {
  const { spareShellId } = state
  await openTemplateDrawer(page)
  await page.getByTestId("macro-edit").click()
  await closeTemplateDrawer(page)

  await clickWithDialog(
    terminalTab(page, spareShellId).getByTestId("terminal-tab-close"),
    "accept",
    "Close terminal",
  )
  await expect(page.getByTestId("terminal-tab")).toHaveCount(4)

  const repairCapture = flowBody(page, "Root body").locator(":scope > [data-flow-node-id=\"capture_repair\"]")
  await expect(repairCapture.getByTestId("capture-kind-repair")).toBeVisible()
  await repairCapture.getByTestId("capture-kind-repair").click()
  await repairCapture.getByTestId("capture-step-terminal").selectOption("4")

  const parallel = flowBody(page, "Root body").locator(":scope > [data-flow-node-id=\"parallel_root\"]")
  await parallel.getByTestId("parallel-lane-tab").filter({ hasText: "Repair lane" }).click()
  const repairLane = parallel.getByTestId("parallel-lane-editor")
  await expect(repairLane.getByTestId("parallel-capture-kind-repair")).toBeVisible()
  await repairLane.getByTestId("parallel-capture-kind-repair").click()
  await repairLane.getByTestId("parallel-capture-terminal").selectOption("4")
  await expect(page.getByTestId("macro-validation-summary")).toHaveText("success")
}

export async function verifyRuntimeInventory(page: Page, state: MacroJourneyState): Promise<void> {
  const { externalRequests } = state
  const evidence = await page.evaluate(() => window.__sdUiCoverage ?? {})
  const missing = macroRuntimeControlInventory
    .filter((entry) => (evidence[entry.key]?.length ?? 0) === 0)
    .map((entry) => entry.key)
  expect(missing, 'controls without real UI event evidence').toEqual([])
  expect(externalRequests, 'the .031B journey must stay offline').toEqual([])
  expect(await page.evaluate(() => window.__sdSystemNotifications?.length ?? 0)).toBeGreaterThan(0)
}
