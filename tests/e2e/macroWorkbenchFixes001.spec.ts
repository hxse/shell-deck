import { expect, test, type Locator, type Page } from 'playwright/test'

import { openTemplateDrawer } from './macroWorkbench034.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), { data: { expectedRoomGeneration: room.roomGeneration } })))
})

test('Macro authoring exposes local item insertion, compact loop tokens and optional Parallel text collection', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()

  const forNode = await insertRoot(page, 'add-flow-for')
  await forNode.getByTestId('for-range-mode').selectOption('text-list')
  const items = forNode.getByTestId('for-text-list-item-card')
  await items.first().getByTestId('for-text-list-key').fill('first')
  await items.first().getByTestId('for-text-list-item-insert-below').click()
  await items.nth(1).getByTestId('for-text-list-key').fill('third')
  await items.nth(1).getByTestId('for-text-list-item-insert-above').click()
  await items.nth(1).getByTestId('for-text-list-key').fill('second')
  await expect(items).toHaveCount(3)
  expect(await forNode.getByTestId('for-text-list-key').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
    .toEqual(['first', 'second', 'third'])
  await expect(forNode.getByTestId('for-text-list-add')).toHaveCount(0)
  await expect(items.first().getByTestId('for-text-list-item-insert-above')).toHaveAttribute('aria-label', 'Insert item before')
  await expect(items.first().getByTestId('for-text-list-item-insert-below')).toHaveAttribute('aria-label', 'Insert item after')

  const forBody = flowBody(page, 'for body')
  await forBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  const loopSend = forBody.locator(':scope > [data-flow-node-type="send"]').last()
  await loopSend.getByTestId('message-add-text').click()
  await loopSend.getByTestId('message-template-toggle').check()
  await expect(loopSend.getByTestId('message-template-source')).toHaveCount(0)
  await expect(loopSend).not.toContainText('Available:')
  await assertCompactTokenButtons(loopSend, 'message-template')
  await expect(loopSend.getByTestId('node-add-before')).toHaveAttribute('aria-label', 'Insert before')
  await expect(loopSend.getByTestId('node-add-after')).toHaveAttribute('aria-label', 'Insert after')

  await nodeControl(loopSend, 'node-add-after').click()
  await page.getByTestId('add-step-notify').click()
  const notify = forBody.locator(':scope > [data-flow-node-type="notify"]').last()
  await notify.getByTestId('notify-title-template-toggle').check()
  await assertCompactTokenButtons(notify, 'notify-title-template')
  await expect(notify.getByTestId('notify-title-template-tools')).not.toContainText('Available:')
  await expect(notify.getByTestId('notify-app-repeat-count')).toHaveValue('3')
  await expect(notify.getByTestId('notify-app-repeat-interval-ms')).toHaveValue('1000')

  const parallel = await insertRoot(page, 'add-step-parallel')
  await expect(parallel.getByTestId('parallel-collect-lane-text')).not.toBeChecked()
  await expect(parallel.getByTestId('parallel-output-id-input')).toHaveCount(0)
  await expect(parallel.getByTestId('parallel-output-source')).toHaveCount(0)
  await expect(parallel.getByTestId('parallel-merge-separator')).toHaveCount(0)
  await parallel.getByTestId('parallel-collect-lane-text').click()
  await expect(parallel.getByTestId('parallel-collect-lane-text')).not.toBeChecked()
  await expect(parallel.getByTestId('parallel-id-edit-notice')).toContainText('Add Capture or Extract')

  await parallel.getByTestId('parallel-lane-add-before-output').click()
  await page.getByTestId('parallel-add-capture').click()
  let laneActions = parallel.getByTestId('parallel-lane-action')
  let captureAction = parallel.locator(
    '[data-testid="parallel-lane-action"][data-parallel-action-type="capture-source"]',
  ).first()
  await expect(captureAction.getByTestId('parallel-lane-add-before')).toHaveAttribute('aria-label', 'Insert before')
  await expect(captureAction.getByTestId('parallel-lane-add-after')).toHaveAttribute('aria-label', 'Insert after')
  await captureAction.getByTestId('parallel-lane-add-before').click()
  await page.getByTestId('parallel-add-wait').click()
  captureAction = parallel.locator(
    '[data-testid="parallel-lane-action"][data-parallel-action-type="capture-source"]',
  ).first()
  await captureAction.getByTestId('parallel-lane-add-after').click()
  await page.getByTestId('parallel-add-wait').click()
  laneActions = parallel.getByTestId('parallel-lane-action')
  expect(await laneActions.evaluateAll((actions) => actions.map((action) => action.getAttribute('data-parallel-action-type'))))
    .toEqual(['wait', 'capture-source', 'wait'])
  await parallel.getByTestId('parallel-collect-lane-text').check()
  await expect(parallel.getByTestId('parallel-collect-lane-text')).toBeChecked()
  await expect(parallel.getByTestId('parallel-output-source')).toHaveValue('capture_source:captured_text')
  await expect(parallel.getByTestId('parallel-merge-separator')).toBeVisible()
  await parallel.getByTestId('parallel-collect-lane-text').uncheck()
  await expect(parallel.getByTestId('parallel-output-source')).toHaveCount(0)
  await expect(parallel.getByTestId('parallel-merge-separator')).toHaveCount(0)
})

test('active run visibly locks Macro authoring and highlights the frozen current stage until stop', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-name').fill('Run lock')
  await page.getByTestId('macro-template-drawer').click()
  await flowBody(page, 'Root body').getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-wait').click()
  const waitNode = rootNodes(page).first()
  await waitNode.getByTestId('wait-duration-ms').fill('10000')
  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await page.getByTestId('macro-template-drawer').click()

  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('running')
  const runLockNotice = page.getByTestId('macro-editor-lock-notice')
  await expect(runLockNotice).toHaveAttribute('data-lock-reason', 'macro_run_active')
  await expect(runLockNotice).toHaveAttribute('data-click-to-edit', 'false')
  await expect(runLockNotice).toHaveAttribute('role', 'status')
  await runLockNotice.click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('running')
  await expect(page.getByTestId('macro-editor-lock-surface')).toBeDisabled()
  await expect(waitNode).toHaveAttribute('data-current-node', 'true')
  const currentStage = page.getByTestId('macro-current-stage')
  await expect(currentStage).toContainText('wait · wait')
  await expect(currentStage).toHaveClass(/\balert-warning\b/)
  await expect(waitNode).toHaveClass(/\bcurrent-node\b/)
  expect(await currentStage.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')

  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-template-select')).toBeDisabled()
  await expect(page.getByTestId('macro-save')).toBeDisabled()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-edit-json')).toBeDisabled()
  await expect(page.getByTestId('macro-json-lock-notice')).toContainText('Active macro run')

  await page.getByTestId('macro-control-stop').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('stopped')
  await page.getByTestId('macro-tab-editor').click()
  await expect(page.getByTestId('macro-editor-lock-notice')).toHaveCount(0)
  await expect(page.getByTestId('macro-editor-lock-surface')).not.toBeDisabled()
  await expect(rootNodes(page).first().getByTestId('node-id-input')).toBeEnabled()
})

async function assertCompactTokenButtons(scope: Locator, prefix: string): Promise<void> {
  for (const [suffix, token] of [['index', '{{index}}'], ['key', '{{key}}'], ['value', '{{value}}']] as const) {
    const button = scope.getByTestId(`${prefix}-insert-${suffix}`)
    await expect(button).toHaveText(token)
    await expect(button).toHaveAttribute('title', `Insert ${token}`)
    await expect(button).toHaveCSS('font-size', '11px')
    expect((await button.boundingBox())?.height ?? 100).toBeLessThanOrEqual(24)
  }
}

function flowBody(page: Page, label: string): Locator {
  return page.locator(`[data-testid="flow-block"][data-flow-body-label="${label}"]`)
}

function rootNodes(page: Page): Locator {
  return flowBody(page, 'Root body').locator(':scope > [data-flow-node-id]')
}

function nodeControl(node: Locator, testId: string): Locator {
  return node.locator(`:scope > [data-testid="node-menu"] > [data-testid="node-action-controls"] > [data-testid="${testId}"]`)
}

async function insertRoot(page: Page, paletteTestId: string): Promise<Locator> {
  const roots = rootNodes(page)
  if (await roots.count() === 0) await flowBody(page, 'Root body').getByTestId('empty-body-add').click()
  else await nodeControl(roots.last(), 'node-add-after').click()
  await page.getByTestId(paletteTestId).click()
  return rootNodes(page).last()
}
