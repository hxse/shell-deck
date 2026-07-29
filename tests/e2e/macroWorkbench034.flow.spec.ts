import { expect, test } from 'playwright/test'

import { openTemplateDrawer } from './macroWorkbench034.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), { data: { expectedRoomGeneration: room.roomGeneration } })))
})

test('V6 visual editor preserves anchored insertion, nested blocks and explicit collapse state', async ({ page, request }) => {
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

test('shared root and lane palette lifecycle clamps, focuses and restores its exact trigger', async ({ page, request }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()

  const rootTrigger = page.getByTestId('empty-body-add')
  await rootTrigger.click()
  await expect(page.getByTestId('macro-insertion-mode')).toHaveAttribute('data-placement-mode', 'anchored')
  await expect(page.getByTestId('add-step-send')).toBeFocused()
  await expectPaletteInsideViewport(page.getByTestId('macro-insertion-palette'), 900, 600)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  await expect(rootTrigger).toBeFocused()

  await page.getByTestId('settings-button').click()
  await page.getByTestId('macro-insertion-placement').click()
  await expect(page.getByTestId('macro-insertion-placement')).toContainText('center')
  await page.getByTestId('settings-dismiss-layer').click()
  await rootTrigger.click()
  await expect(page.getByTestId('macro-insertion-mode')).toHaveClass(/centered/)
  await expect(page.getByTestId('add-step-send')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(rootTrigger).toBeFocused()

  await page.getByTestId('settings-button').click()
  await page.getByTestId('macro-insertion-placement').click()
  await expect(page.getByTestId('macro-insertion-placement')).toContainText('near')
  await page.getByTestId('settings-dismiss-layer').click()
  await rootTrigger.click()
  await page.getByTestId('add-step-parallel').click()

  const laneTrigger = page.getByTestId('parallel-lane-add-empty')
  await laneTrigger.click()
  await expect(page.getByTestId('parallel-lane-insertion-mode')).toHaveAttribute('data-placement-mode', 'anchored')
  await expect(page.getByTestId('parallel-add-send')).toBeFocused()
  await expectPaletteInsideViewport(page.getByTestId('parallel-lane-action-palette'), 900, 600)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('parallel-lane-action-palette')).toHaveCount(0)
  await expect(laneTrigger).toBeFocused()
})

async function expectPaletteInsideViewport(
  palette: import('playwright/test').Locator,
  width: number,
  height: number,
): Promise<void> {
  const box = await palette.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(height)
}
