import { expect, test, type Locator } from 'playwright/test'

async function openTemplateDrawer(page: { getByTestId: (id: string) => Locator }) {
  if (await page.getByTestId("macro-template-drawer-body").count() === 0) {
    await page.getByTestId("macro-template-drawer").click()
  }
  await expect(page.getByTestId("macro-template-drawer-body")).toBeVisible()
}

async function optionValue(select: Locator, text: string): Promise<string> {
  const value = await select.locator('option').filter({ hasText: text }).first().getAttribute('value')
  if (!value) throw new Error('missing option containing ' + text)
  return value
}

async function insertAfterLast(page: { getByTestId: (id: string) => Locator }, testId: string) {
  const buttons = page.getByTestId('node-add-after')
  await buttons.nth(await buttons.count() - 1).click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await page.getByTestId(testId).click()
}

test('macro controls filter wait and capture choices by live tab capability', async ({ page, request }) => {
  const configId = 'macro-tab-capability-e2e'
  await request.post(`/api/configs/${configId}/terminals?backend=fake`)
  await request.post(`/api/configs/${configId}/terminals?backend=fake`)
  await request.post(`/api/configs/${configId}/terminals?backend=text`)

  await page.goto(`/?configId=${configId}`)
  await expect(page.getByTestId('terminal-tab')).toHaveCount(3)
  await expect(page.getByTestId('terminal-tab').nth(0)).toHaveAttribute('data-terminal-alias', 'shell_1')
  await expect(page.getByTestId('terminal-tab').nth(1)).toHaveAttribute('data-terminal-alias', 'shell_2')
  await expect(page.getByTestId('terminal-tab').nth(2)).toHaveAttribute('data-terminal-alias', 'text_1')
  await openTemplateDrawer(page)

  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-summary').click()
  await page.getByTestId('empty-body-add').first().click()
  await page.getByTestId('add-step-wait').click()
  await page.getByTestId('wait-mode').selectOption('terminal-quiet')
  const waitTarget = page.getByTestId('wait-target-tab')
  await expect(waitTarget.locator('option').filter({ hasText: 'shell_1' })).toHaveCount(1)
  await expect(waitTarget.locator('option').filter({ hasText: 'shell_2' })).toHaveCount(1)
  await expect(waitTarget.locator('option').filter({ hasText: 'text_1' })).toHaveCount(0)
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')

  await insertAfterLast(page, 'add-step-capture')
  const captureSource = page.getByTestId('capture-step-terminal').last()
  await captureSource.selectOption(await optionValue(captureSource, 'text_1'))
  await expect(page.getByTestId('capture-kind-fixed').last()).toContainText('text-box')
  await expect(page.getByTestId('capture-terminal-buffer-mode')).toHaveCount(0)
  await expect(page.getByTestId('capture-agent-kind')).toHaveCount(0)
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')

  await captureSource.selectOption(await optionValue(captureSource, 'shell_2'))
  const captureKind = page.getByTestId('capture-step-kind').last()
  await expect(captureKind).toHaveValue('terminal-buffer')
  await expect(captureKind.locator('option').filter({ hasText: 'agent-event' })).toHaveCount(1)
  await expect(captureKind.locator('option').filter({ hasText: 'text-box' })).toHaveCount(0)

  await insertAfterLast(page, 'add-step-parallel')
  const firstLaneTarget = page.getByTestId('parallel-lane-terminal')
  const shellOneLaneValue = await optionValue(firstLaneTarget, 'shell_1')
  await page.getByTestId('parallel-lane-add-before-output').click()
  await page.getByTestId('parallel-add-wait').click()
  await firstLaneTarget.selectOption(await optionValue(firstLaneTarget, 'text_1'))
  await expect(page.getByTestId('parallel-id-edit-notice')).toContainText('Lane tab change blocked')
  await expect(firstLaneTarget).toHaveValue(shellOneLaneValue)

  await page.getByTestId('parallel-add-lane').click()
  await page.getByTestId('parallel-lane-tab').filter({ hasText: 'lane_2' }).click()
  const laneTarget = page.getByTestId('parallel-lane-terminal')
  await laneTarget.selectOption(await optionValue(laneTarget, 'text_1'))
  await page.getByTestId('parallel-lane-add-before-output').click()
  await expect(page.getByTestId('parallel-lane-action-palette')).toBeVisible()
  await expect(page.getByTestId('parallel-add-send')).toBeVisible()
  await expect(page.getByTestId('parallel-add-capture')).toBeVisible()
  await expect(page.getByTestId('parallel-add-extract')).toBeVisible()
  await expect(page.getByTestId('parallel-add-wait')).toHaveCount(0)
  await page.getByTestId('parallel-add-capture').click()
  await expect(page.getByTestId('parallel-capture-kind-fixed').last()).toContainText('text-box')
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
})
