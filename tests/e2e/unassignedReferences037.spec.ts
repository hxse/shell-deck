import { expect, test } from 'playwright/test'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), { data: { expectedRoomGeneration: room.roomGeneration } })))
})

test('V5 persists explicit Unassigned slots, never mutates them from terminal events, and only starts after explicit assignment', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)

  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await closeTemplateDrawer(page)
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()

  const send = page.locator('[data-flow-node-type="send"]').first()
  const target = send.getByTestId('send-terminal')
  await expect(target).toHaveValue('unassigned')
  await expect(target).toHaveAttribute('data-terminal-select-status', 'unassigned')
  await expect(send.getByTestId('send-terminal-warning')).toContainText('Save is allowed')

  await send.getByTestId('message-add-source').click()
  await expect(send.getByTestId('message-source-part')).toHaveValue('')
  await expect(send.getByTestId('message-source-warning')).toContainText('Save is allowed')
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success · 2 unassigned · not runnable')
  await expect(page.getByTestId('macro-runnable-warning')).toContainText('Save is allowed')
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('title', 'Assign 2 terminal or artifact references before Start')

  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
  await closeTemplateDrawer(page)
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"schemaVersion": 5')
  await expect(page.getByTestId('macro-json-preview')).toContainText('"terminal": {')
  await expect(page.getByTestId('macro-json-preview')).toContainText('"kind": "unassigned"')
  await expect(page.getByTestId('macro-json-runnable-warning')).toContainText('assign 2 terminal or artifact references before Start')
  await expect(page.getByTestId('macro-json-runnable-warning')).toContainText('body[0].terminal')
  await expect(page.getByTestId('macro-json-runnable-warning')).toContainText('body[0].message.parts[0].source')
  await page.getByTestId('macro-tab-editor').click()

  await page.getByRole('button', { name: 'New shell', exact: true }).click()
  await expect(target).toHaveValue('unassigned')
  await target.selectOption('1')
  await expect(send.getByTestId('send-terminal-warning')).toHaveCount(0)
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('title', 'Assign 1 terminal or artifact reference before Start')

  await send.getByTestId('node-add-before').click()
  await page.getByTestId('add-step-capture').click()
  const capture = page.locator('[data-flow-node-type="capture-source"]').first()
  await expect(capture.getByTestId('capture-step-terminal')).toHaveValue('unassigned')
  await capture.getByTestId('capture-step-terminal').selectOption('1')
  await send.getByTestId('message-source-part').selectOption('capture_source:captured_text')
  await expect(send.getByTestId('message-source-warning')).toHaveCount(0)
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')

  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await closeTemplateDrawer(page)
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'false')
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })

  await target.selectOption('unassigned')
  await expect(target).toHaveValue('unassigned')
  await expect(send.getByTestId('send-terminal-warning')).toBeVisible()
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'true')
})

test('Macro list visibly isolates an invalid record while retaining valid saved records', async ({ page, request }) => {
  const validId = 'tmpl_gNzZu98eDxBGnZo5T4QhbJ'
  const invalidId = 'tmpl_vgCJfqxJYHSVm3NAi2mAdv'
  await page.route('**/api/templates', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== 'GET' || url.pathname !== '/api/templates') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        templates: [{ id: validId, revision: 1, name: 'Valid saved Macro', description: '', updatedAt: '2026-07-18T00:00:00.000Z', stepCount: 0 }],
        invalidRecords: [{ recordId: invalidId, error: 'invalid_macro_record_definition' }],
      }),
    })
  })

  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)

  await expect(page.getByRole('alert')).toContainText(`Invalid Macro records ignored: ${invalidId} (invalid_macro_record_definition)`)
  await expect(page.getByTestId('macro-template-summary')).toContainText('1 saved')
  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-template-select').locator('option')).toContainText(['Valid saved Macro'])
})

async function openTemplateDrawer(page: import('playwright/test').Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) await page.getByTestId('macro-template-drawer').click()
}

async function closeTemplateDrawer(page: import('playwright/test').Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() > 0) await page.getByTestId('macro-template-drawer').click()
}
