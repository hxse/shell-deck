import { expect, test } from 'playwright/test'

import { openTemplateDrawer } from './macroWorkbench034.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), { data: { expectedRoomGeneration: room.roomGeneration } })))
})

test('V5 visual editor preserves anchored insertion, nested blocks and explicit collapse state', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByRole('button', { name: 'New shell', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Flow V2 Body' })).toBeVisible()
  await page.getByTestId('empty-body-add').click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await expect(page.getByTestId('add-step-send')).toBeFocused()
  await page.getByTestId('add-flow-for').click()

  const forBody = page.locator('[data-testid="flow-block"][data-flow-body-label="for body"]')
  await expect(forBody.getByTestId('empty-body-add')).toHaveText('Add inside')
  await forBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(forBody.getByTestId('node-id-input')).toHaveValue('send')

  const rootFor = page.locator('[data-testid="flow-block"][data-flow-body-label="Root body"] > .flow-node-editor').first()
  const rootToggle = rootFor.getByTestId('node-toggle-collapse').first()
  await rootToggle.click()
  await expect(rootFor.getByTestId('node-collapsed-badge').first()).toHaveText('Collapsed')
  await expect(rootToggle).toHaveAttribute('title', 'Expand')
  await rootToggle.click()
  await expect(rootFor.getByTestId('node-collapsed-badge')).toHaveCount(0)
})
