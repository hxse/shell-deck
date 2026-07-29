import { expect, test } from 'playwright/test'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), { data: { expectedRoomGeneration: room.roomGeneration } })))
})

test('root and Parallel AgentEvent captures default to unbounded and expose an explicit timeout branch', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await page.getByRole('button', { name: 'New shell', exact: true }).click()

  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await closeTemplateDrawer(page)
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-capture').click()

  const capture = page.locator('[data-flow-node-type="capture-source"]').first()
  await capture.getByTestId('capture-step-terminal').selectOption('1')
  await capture.getByTestId('capture-step-kind').selectOption('agent-event')
  await expect(capture.getByTestId('capture-agent-timeout-enabled')).not.toBeChecked()
  await expect(capture.getByTestId('capture-agent-unbounded-hint')).toHaveText('Wait until result or Stop')
  await expect(capture.getByTestId('capture-agent-timeout-ms')).toHaveCount(0)
  await expectTimeoutToggleAligned(capture.getByTestId('capture-agent-timeout-enabled'))

  await capture.getByTestId('capture-agent-timeout-enabled').check()
  await expect(capture.getByTestId('capture-agent-timeout-ms')).toHaveValue('600000')
  await capture.getByTestId('capture-agent-timeout-ms').fill('1800000')
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"schemaVersion": 6')
  await expect(page.getByTestId('macro-json-preview')).toContainText('"kind": "timeout"')
  await expect(page.getByTestId('macro-json-preview')).toContainText('"timeoutMs": 1800000')
  await page.getByTestId('macro-tab-editor').click()
  await capture.getByTestId('capture-agent-timeout-enabled').uncheck()
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"kind": "unbounded"')
  await expect(page.getByTestId('macro-json-preview')).not.toContainText('"timeoutMs"')
  await page.getByTestId('macro-tab-editor').click()

  await capture.getByTestId('node-add-after').click()
  await page.getByTestId('add-step-parallel').click()
  const parallel = page.locator('[data-flow-node-type="parallel"]').first()
  await parallel.getByTestId('parallel-lane-add-empty').click()
  await page.getByTestId('parallel-add-capture').click()
  const laneCapture = parallel.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="capture-source"]').first()
  await laneCapture.getByTestId('parallel-capture-terminal').selectOption('1')
  await laneCapture.getByTestId('parallel-capture-kind').selectOption('agent-event')
  await expect(laneCapture.getByTestId('parallel-capture-agent-timeout-enabled')).not.toBeChecked()
  await expect(laneCapture.getByTestId('parallel-capture-agent-unbounded-hint')).toHaveText('Wait until result or Stop')
  await expectTimeoutToggleAligned(laneCapture.getByTestId('parallel-capture-agent-timeout-enabled'))
  await laneCapture.getByTestId('parallel-capture-agent-timeout-enabled').check()
  await laneCapture.getByTestId('parallel-capture-agent-timeout-ms').fill('900000')
  await expect(laneCapture.getByTestId('parallel-capture-agent-timeout-ms')).toHaveValue('900000')
  await laneCapture.getByTestId('parallel-capture-agent-timeout-enabled').uncheck()
  await expect(laneCapture.getByTestId('parallel-capture-agent-timeout-ms')).toHaveCount(0)
})

async function openTemplateDrawer(page: import('playwright/test').Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) await page.getByTestId('macro-template-drawer').click()
}

async function closeTemplateDrawer(page: import('playwright/test').Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() > 0) await page.getByTestId('macro-template-drawer').click()
}

async function expectTimeoutToggleAligned(checkbox: import('playwright/test').Locator) {
  const metrics = await checkbox.evaluate((input) => {
    const label = input.closest('label')
    const text = label?.querySelector('span')
    if (!label || !text) throw new Error('timeout toggle label is incomplete')
    const inputRect = input.getBoundingClientRect()
    const textRect = text.getBoundingClientRect()
    const inputStyle = getComputedStyle(input)
    return {
      display: getComputedStyle(label).display,
      nativeCheckbox: input.classList.contains('checkbox'),
      inputWidth: inputRect.width,
      inputHeight: inputRect.height,
      appearance: inputStyle.appearance,
      centerDelta: Math.abs((inputRect.top + inputRect.height / 2) - (textRect.top + textRect.height / 2)),
    }
  })
  expect(metrics).toMatchObject({ display: 'flex', nativeCheckbox: true, inputWidth: 14, inputHeight: 14, appearance: 'none' })
  expect(metrics.centerDelta).toBeLessThanOrEqual(1)
}
