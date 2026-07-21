import { expect, test } from 'playwright/test'

import { deferredGate, forceInput, openTemplateDrawer } from './macroWorkbench034.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), { data: { expectedRoomGeneration: room.roomGeneration } })))
})

test('dirty Start serializes Save and keeps the visual draft inert until the bound response commits', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  await page.getByTestId('send-terminal').selectOption('1')
  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-prepare-terminals').click()
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'false')

  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await page.getByTestId('macro-name').fill('Dirty bound start')
  await page.getByTestId('macro-template-drawer').click()

  const gate = deferredGate()
  let updatePending = false
  let startRequested = false
  await page.route('**/api/templates/*', async (route) => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    const response = await route.fetch()
    updatePending = true
    await gate.wait
    await route.fulfill({ response })
  })
  await page.route('**/api/rooms/*/runner/start', async (route) => {
    startRequested = true
    await route.continue()
  })

  await page.getByTestId('macro-control-start').click()
  await expect.poll(() => updatePending).toBe(true)
  expect(startRequested).toBe(false)
  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-name')).toBeDisabled()
  await forceInput(page.getByTestId('macro-name'), 'stale mutation')
  await expect(page.getByTestId('notice-item')).toContainText('Wait for the current operation')
  await page.getByTestId('notice-item').getByRole('button', { name: 'Dismiss notice' }).click()
  await page.getByTestId('macro-template-drawer').click()
  expect(startRequested).toBe(false)

  gate.release()
  await expect.poll(() => startRequested).toBe(true)
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  await page.getByTestId('macro-tab-editor').click()
  await expect(page.getByTestId('macro-editor-lock-surface')).toBeEnabled()
  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('Dirty bound start')
  await expect(page.getByTestId('macro-json-preview')).not.toContainText('stale mutation')
})

test('Macro panel visibility preserves in-memory draft and unsaved work guards page unload without browser storage', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await page.getByRole('button', { name: 'New shell', exact: true }).click()
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-name').fill('Page memory Macro')
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) => value.includes('Page memory Macro')))).toBe(false)

  await expect(page.getByTestId('macro-panel-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('macro-panel-toggle').click()
  await expect(page.getByTestId('macro-panel-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('macro-side-panel')).toBeHidden()
  await page.getByTestId('macro-panel-toggle').click()
  await expect(page.getByTestId('macro-panel-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('macro-side-panel')).toBeVisible()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-name')).toHaveValue('Page memory Macro')
  await expect(page.getByTestId('macro-template-metadata')).toContainText('unsaved new macro')
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
  await page.getByTestId('macro-template-drawer').click()

  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await page.getByTestId('macro-cancel-json').click()
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
})

test('a delayed Prepare HTTP snapshot cannot roll back newer Room WebSocket truth', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await page.getByTestId('send-terminal').selectOption('1')
  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await page.getByTestId('macro-template-drawer').click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('terminal-tab-close').click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)

  const gate = deferredGate()
  let prepareCommitted = false
  await page.route('**/api/rooms/*/terminals/prepare', async (route) => {
    const response = await route.fetch()
    prepareCommitted = true
    await gate.wait
    await route.fulfill({ response })
  })
  await page.getByTestId('macro-prepare-terminals').click()
  await expect.poll(() => prepareCommitted).toBe(true)
  await expect(page.getByTestId('terminal-tab')).toHaveCount(1)

  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
  gate.release()
  await expect(page.getByTestId('macro-prepare-terminals')).toBeEnabled()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
})
