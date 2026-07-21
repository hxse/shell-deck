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
  await expect(page.getByTestId('macro-json-preview')).toContainText('"schemaVersion": 5')
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
  await parallel.getByTestId('parallel-lane-terminal').selectOption('1')
  await parallel.getByTestId('parallel-lane-add-before-output').click()
  await page.getByTestId('parallel-add-capture').click()
  const laneCapture = parallel.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="capture-source"]').first()
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

test('Library Macro JSON list visibly isolates invalid definitions like the Macro list', async ({ page, request }) => {
  const validId = 'lib_d6gU92rYGn8qqiTBj1WCPo'
  const invalidId = 'lib_5tQdPmwEQbXEQzJDuBzCHF'
  await page.route('**/api/library/items?*', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== 'GET' || url.pathname !== '/api/library/items' || url.searchParams.get('kind') !== 'macro-template') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [{ itemId: validId, kind: 'macro-template', revision: 1, title: 'Valid Library Macro', tags: [], updatedAt: '2026-07-21T00:00:00.000Z' }],
        invalidItems: [{ itemId: invalidId, error: 'invalid_library_macro_definition' }],
      }),
    })
  })

  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await page.getByTestId('library-panel-toggle').click()

  await expect(page.getByTestId('library-list-problem')).toContainText(`Invalid Library items ignored: ${invalidId} (invalid_library_macro_definition)`)
  await expect(page.getByTestId('library-selector').locator('option')).toContainText(['Valid Library Macro'])
  await expect(page.getByTestId('library-selector').locator('option')).not.toContainText([invalidId])
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
      inputWidth: inputRect.width,
      inputHeight: inputRect.height,
      inputPadding: inputStyle.padding,
      centerDelta: Math.abs((inputRect.top + inputRect.height / 2) - (textRect.top + textRect.height / 2)),
    }
  })
  expect(metrics).toMatchObject({ display: 'flex', inputWidth: 14, inputHeight: 14, inputPadding: '0px' })
  expect(metrics.centerDelta).toBeLessThanOrEqual(1)
}
