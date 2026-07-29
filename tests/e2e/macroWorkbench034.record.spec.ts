import { expect, test } from 'playwright/test'

import { openTemplateDrawer } from './macroWorkbench034.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), { data: { expectedRoomGeneration: room.roomGeneration } })))
})

test('V6 Macro workbench saves without terminals, prepares only on click, and keeps JSON edit locked until Save or Cancel', async ({ page, request }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)

  await expect(page.getByTestId('macro-side-panel')).toBeVisible()
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('macro-prepare-terminals')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)

  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).not.toContainText('Auto-prepare')
  await expect(page.getByTestId('macro-insertion-placement')).toBeVisible()
  await expect(page.getByTestId('notification-volume')).toBeVisible()
  await page.getByTestId('settings-popover').getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-terminal-layout')).toHaveCount(0)
  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  await page.getByTestId('send-terminal').selectOption('1')
  await expect(page.getByTestId('send-terminal')).toHaveValue('1')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('terminal-tab-close').click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)

  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await page.getByTestId('macro-template-drawer').click()

  // Save is portable-only: it neither creates nor prepares a terminal.
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('macro-prepare-terminals')).toHaveAttribute('aria-disabled', 'false')

  await page.getByTestId('macro-prepare-terminals').click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
  await expect(page.getByTestId('text-box-editor')).toBeVisible()
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'false')

  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  await expect(page.getByTestId('macro-editor-lock-surface')).toBeEnabled()
  await expect(page.getByRole('button', { name: 'New shell', exact: true })).toBeEnabled()

  await openTemplateDrawer(page)
  await page.getByTestId('macro-description').fill('Editable after completed run')
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await page.getByTestId('macro-template-drawer').click()

  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"schemaVersion": 6')
  await expect(page.getByTestId('macro-json-preview')).not.toContainText('terminalId')
  await page.getByTestId('macro-edit-json').click()
  await expect(page.getByTestId('macro-json-editor')).toBeVisible()
  await expect(page.getByTestId('macro-tab-editor')).toBeDisabled()
  await expect(page.getByTestId('macro-tab-trace')).toBeDisabled()
  await page.getByTestId('macro-json-editor').fill('{')
  await page.getByTestId('macro-save-json').click()
  await expect(page.getByTestId('macro-json-error')).toContainText('Invalid JSON')
  await expect(page.getByTestId('macro-json-editor')).toBeVisible()
  await page.getByTestId('macro-cancel-json').click()
  await expect(page.getByTestId('macro-tab-editor')).toBeEnabled()

  await page.getByTestId('macro-tab-trace').click()
  await expect(page.getByTestId('macro-trace-runs')).toContainText('completed')
  await expect(page.getByTestId('macro-trace-view')).toContainText('run_started')
  await expect(page.getByRole('button', { name: /Duplicate|Import|Export/ })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('valid V6 JSON keeps its exact edit buffer open when update or create persistence fails', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-save').click()
  await page.getByTestId('macro-template-drawer').click()

  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  const updateCandidate = JSON.parse(await page.getByTestId('macro-json-editor').inputValue()) as Record<string, unknown>
  updateCandidate.name = 'V6 JSON update must survive'
  const updateText = JSON.stringify(updateCandidate, null, 2)
  await page.getByTestId('macro-json-editor').fill(updateText)
  await page.route('**/api/templates/*', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'content_revision_conflict' }) })
    } else await route.continue()
  })
  await page.getByTestId('macro-save-json').click()
  await expect(page.getByTestId('macro-json-error')).toContainText('content_revision_conflict')
  await expect(page.getByTestId('macro-json-editor')).toHaveValue(updateText)
  await expect(page.getByTestId('macro-tab-editor')).toBeDisabled()
  await page.unroute('**/api/templates/*')
  await page.getByTestId('macro-cancel-json').click()

  await page.getByTestId('macro-tab-editor').click()
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  const createCandidate = JSON.parse(await page.getByTestId('macro-json-editor').inputValue()) as Record<string, unknown>
  createCandidate.name = 'V6 JSON create must survive'
  const createText = JSON.stringify(createCandidate, null, 2)
  await page.getByTestId('macro-json-editor').fill(createText)
  await page.route('**/api/templates', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'synthetic_create_failure' }) })
    } else await route.continue()
  })
  await page.getByTestId('macro-save-json').click()
  await expect(page.getByTestId('macro-json-error')).toContainText('synthetic_create_failure')
  await expect(page.getByTestId('macro-json-editor')).toHaveValue(createText)
  await expect(page.getByTestId('macro-tab-editor')).toBeDisabled()
  await page.unroute('**/api/templates')
})
