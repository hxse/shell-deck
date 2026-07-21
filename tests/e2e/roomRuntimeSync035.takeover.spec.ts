import { expect, test } from 'playwright/test'

import { openTemplateDrawer } from './roomRuntimeSync035.helpers'

test.beforeEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('Home removes manual Refresh and updates the server Room registry automatically', async ({ page, request }) => {
  await request.post('/api/rooms')
  await page.goto('/')
  await expect(page.getByTestId('room-home')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0)
  await expect(page.getByTestId('room-list').locator('li')).toHaveCount(1)

  await request.post('/api/rooms')
  await expect(page.getByTestId('room-list').locator('li')).toHaveCount(2, { timeout: 3_000 })
})

test('Macro selection stays browser-local while observer writes are explained and direct Delete works after takeover', async ({ browser, request }) => {
  const context = await browser.newContext()
  const pageErrors: string[] = []
  const first = await context.newPage()
  const second = await context.newPage()
  first.on('pageerror', (error) => pageErrors.push(`first: ${error.stack ?? error.message}`))
  second.on('pageerror', (error) => pageErrors.push(`second: ${error.stack ?? error.message}`))

  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await first.goto(room.url)
  await openTemplateDrawer(first)

  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Shared Alpha')
  await first.getByTestId('macro-save').click()
  const firstSelector = first.getByTestId('macro-template-select')
  const alphaOption = firstSelector.locator('option', { hasText: 'Shared Alpha' })
  await expect(alphaOption).toHaveCount(1)
  const alphaId = await alphaOption.getAttribute('value')
  expect(alphaId).toBeTruthy()

  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Shared Beta')
  await first.getByTestId('macro-save').click()
  await expect(first.getByTestId('macro-name')).toHaveValue('Shared Beta')

  await second.goto(room.url)
  await openTemplateDrawer(second)
  const secondSelector = second.getByTestId('macro-template-select')
  await expect(secondSelector.locator(`option[value="${alphaId}"]`)).toHaveCount(1)
  await expect(secondSelector).toBeEnabled()
  await secondSelector.selectOption(alphaId!)
  await expect(second.getByTestId('macro-name')).toHaveValue('Shared Alpha')
  await expect(first.getByTestId('macro-name')).toHaveValue('Shared Beta')

  for (const testId of ['macro-edit', 'macro-create', 'macro-delete']) {
    await second.getByTestId(testId).click({ force: true })
    await expect(second.getByTestId('notice-item')).toContainText('This device is read-only')
    await second.getByTestId('notice-item').getByRole('button', { name: 'Dismiss notice' }).click()
    await expect(second.getByTestId('macro-name')).toHaveValue('Shared Alpha')
  }

  await second.getByTestId('macro-template-drawer').click()
  second.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Shared terminals and the active Macro run stay on the server and will not be lost')
    await dialog.accept()
  })
  await second.getByTestId('take-control').click()
  await expect(second.getByTestId('room-control-status')).toHaveText('Control: This device')
  await openTemplateDrawer(second)

  second.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete Shared Alpha?')
    await dialog.accept()
  })
  await second.getByTestId('macro-delete').click()
  await expect(secondSelector.locator(`option[value="${alphaId}"]`)).toHaveCount(0)
  await expect(firstSelector.locator(`option[value="${alphaId}"]`)).toHaveCount(0)
  await expect(first.getByTestId('macro-name')).toHaveValue('Shared Beta')
  expect(pageErrors).toEqual([])

  await context.close()
})

test('controller and content lease loss preserve the draft but keep Macro fields and structural actions read-only', async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await first.goto(room.url)
  await openTemplateDrawer(first)
  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Lease protected Macro')
  await first.getByTestId('macro-save').click()
  await first.getByTestId('macro-name').fill('Unsaved local draft')

  await second.goto(room.url)
  second.once('dialog', async (dialog) => dialog.accept())
  await second.getByTestId('take-control').click()
  await expect(first.getByTestId('take-control')).toBeVisible()
  await expect(first.getByTestId('macro-name')).toHaveValue('Unsaved local draft')
  await expect(first.getByTestId('macro-name')).toBeDisabled()
  await expect(first.getByTestId('notice-item')).toBeVisible()
  await first.getByTestId('notice-dismiss-layer').click()
  await first.getByTestId('macro-template-drawer').click()

  await first.getByTestId('empty-body-add').click()
  await first.getByTestId('add-step-send').click()
  await expect(first.getByTestId('notice-item')).toContainText('This device is read-only')
  await expect(first.locator('[data-flow-node-id]')).toHaveCount(0)
  await first.getByTestId('notice-dismiss-layer').click()
  await first.getByTestId('macro-insertion-cancel-scrim').click()

  await second.close()
  await first.getByTestId('take-control').click()
  await expect(first.getByTestId('room-control-status')).toHaveText('Control: This device')
  await openTemplateDrawer(first)
  await expect(first.getByTestId('macro-name')).toHaveValue('Unsaved local draft')
  await expect(first.getByTestId('macro-name')).toBeDisabled()
  await first.getByTestId('macro-template-drawer').click()

  await first.getByTestId('empty-body-add').click()
  await first.getByTestId('add-step-send').click()
  await expect(first.getByTestId('notice-item')).toContainText('This content edit lease moved elsewhere')
  await expect(first.locator('[data-flow-node-id]')).toHaveCount(0)
  await first.getByTestId('notice-dismiss-layer').click()

  await openTemplateDrawer(first)
  first.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Discard the unsaved draft')
    await dialog.accept()
  })
  await first.getByTestId('macro-edit').click()
  await expect(first.getByTestId('macro-name')).toBeEnabled()
  await expect(first.getByTestId('macro-name')).toHaveValue('Lease protected Macro')
  await context.close()
})
