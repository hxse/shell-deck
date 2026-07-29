import { expect, test } from 'playwright/test'
import {
  createMacroJourneyState,
  installOfflineBrowserHarness,
} from './comprehensiveMacroUiBehaviorCurrent.helpers'
import {
  buildMainActions,
  createMacroChrome,
  operateWorkspace,
} from './comprehensiveMacroUiBehaviorCurrent.steps-authoring'
import {
  buildFlowControl,
  buildParallelLanes,
} from './comprehensiveMacroUiBehaviorCurrent.steps-flow'
import {
  completeMacro,
  exerciseSavedRecords,
  inspectTrace,
  repairCapabilities,
  runMacro,
  verifyRuntimeInventory,
} from './comprehensiveMacroUiBehaviorCurrent.steps-runtime'

test.describe.configure({ mode: 'serial' })

test('current UI journey preserves the complex V6 Macro and exercises server-owned runtime input through visible controls', async ({ page }) => {
  test.setTimeout(600_000)
  page.setDefaultTimeout(10_000)
  page.setDefaultNavigationTimeout(15_000)
  const externalRequests: string[] = []

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await installOfflineBrowserHarness(page, externalRequests)
  await page.goto("/")
  if (await page.getByTestId('room-home').isVisible()) {
    await page.getByTestId('new-room').click()
  }
  await expect(page).toHaveURL(/\/room_[1-9A-HJ-NP-Za-km-z]{22}$/)
  await expect(page.getByTestId('room-identity')).toContainText('connected')
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
  await expect(page.getByTestId('macro-panel')).toBeVisible()

  const state = createMacroJourneyState(externalRequests)

  await test.step('workspace settings, panels and terminals are operated from an empty deck', async () => {
    await operateWorkspace(page, state)
  })

  await test.step('Macro template chrome creates the baseline record and exercises insertion cancellation', async () => {
    await createMacroChrome(page)
  })

  await test.step('visual editor builds and exercises every main action surface', async () => {
    await buildMainActions(page)
  })

  await test.step('If branches, loop templates and control-flow bodies are built through their local UI', async () => {
    await buildFlowControl(page)
  })

  await test.step('Parallel panes cover explicit targets, sharing, lane CRUD and all pane actions', async () => {
    await buildParallelLanes(page)
  })

  await test.step('final artifact send, text capture, runtime input, finish and validation are completed', async () => {
    await completeMacro(page, state)
  })

  await test.step("JSON edit and saved-record selection use current Copy/New/Edit/Delete semantics", async () => {
    await exerciseSavedRecords(page, state)
  })

  await test.step('the UI-created complex Macro pauses, resumes, accepts input and captures multiple terminal results', async () => {
    await runMacro(page, state)
  })

  await test.step("Trace renders the server-persisted completed run without legacy demo controls", async () => {
    await inspectTrace(page)
  })

  await test.step("capability repair remains explicit after a live index/type shift", async () => {
    await repairCapabilities(page, state)
  })

  await test.step('runtime inventory reports an actual browser event for every non-Codex control', async () => {
    await verifyRuntimeInventory(page, state)
  })
})
