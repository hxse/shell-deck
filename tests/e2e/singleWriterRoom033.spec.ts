import { expect, test } from 'playwright/test'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('same Room has one writer while observer keeps local controls and can explicitly take over', async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const created = await request.post('/api/rooms')
  expect(created.status()).toBe(201)
  const room = await created.json() as { url: string }
  await first.goto(room.url)
  await expect(first.getByTestId('room-control-status')).toHaveText('Control: This device')
  await first.getByRole('button', { name: 'New text' }).click()
  await expect(first.getByTestId('text-box-editor')).toBeEditable()
  await first.getByTestId('text-box-editor').fill('from first')

  const second = await context.newPage()
  await second.goto(first.url())
  await expect(second.getByTestId('take-control')).toHaveText('Read-only · Take control')
  await expect(second.getByRole('button', { name: 'New shell' })).toBeDisabled()
  await expect(second.getByRole('button', { name: 'New text' })).toBeDisabled()
  await expect(second.getByTestId('terminal-tab-close')).toBeDisabled()
  await expect(second.getByTestId('text-box-editor')).toHaveAttribute('readonly', '')
  await expect(second.getByTestId('text-box-editor')).toHaveValue('from first')
  await expect(second.getByTestId('text-box-copy')).toBeEnabled()

  await second.getByTestId('settings-button').click()
  await second.getByTestId('tab-drag-toggle').click()
  await expect(second.getByTestId('tab-drag-toggle')).toHaveAttribute('aria-pressed', 'true')
  await second.getByTestId('settings-popover').getByRole('button', { name: 'Close', exact: true }).click()

  second.once('dialog', (dialog) => void dialog.accept())
  await second.getByTestId('take-control').click()
  await expect(second.getByTestId('room-control-status')).toHaveText('Control: This device')
  await expect(second.getByTestId('text-box-editor')).toBeEditable()
  await expect(first.getByTestId('take-control')).toHaveText('Read-only · Take control')
  await expect(first.getByTestId('text-box-editor')).toHaveAttribute('readonly', '')

  await second.getByTestId('text-box-editor').fill('from second')
  await expect(first.getByTestId('text-box-editor')).toHaveValue('from second')
  await expect(first.getByTestId('terminal-tab')).toHaveAttribute('title', await second.getByTestId('terminal-tab').getAttribute('title') ?? '')

  await context.close()
})

test('the controller tab reclaims available control after reload without promoting ordinary observers', async ({ browser, request }) => {
  const context = await browser.newContext()
  const controller = await context.newPage()
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await controller.goto(room.url)
  await expect(controller.getByTestId('room-control-status')).toHaveText('Control: This device')
  await controller.reload()
  await expect(controller.getByTestId('room-control-status')).toHaveText('Control: This device')
  await expect(controller.getByRole('button', { name: 'New text' })).toBeEnabled()

  const observer = await context.newPage()
  await observer.goto(room.url)
  await expect(observer.getByTestId('take-control')).toHaveText('Read-only · Take control')
  await controller.close()
  await expect(observer.getByTestId('take-control')).toHaveText('Read-only · Take control')
  await expect(observer.getByRole('button', { name: 'New text' })).toBeDisabled()
  await context.close()
})
