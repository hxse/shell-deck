import { expect, test } from 'playwright/test'
import {
  closeCapturedWebSocket,
  installWebSocketCapture,
  openTemplateDrawer,
} from './roomRuntimeSync035.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('reconnect preserves a dirty Macro buffer and reconciles the missed saved-content notice', async ({ browser, request }) => {
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  await installWebSocketCapture(first)
  const firstRoom = await request.post('/api/rooms')
  const secondRoom = await request.post('/api/rooms')
  const firstUrl = (await firstRoom.json() as { url: string }).url
  const secondUrl = (await secondRoom.json() as { url: string }).url

  await first.goto(firstUrl)
  await openTemplateDrawer(first)
  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Reconnect base')
  await first.getByTestId('macro-save').click()
  await expect(first.getByTestId('macro-template-metadata')).toContainText('revision 1')
  const recordId = await first.getByTestId('macro-template-select').inputValue()
  await first.getByTestId('macro-name').fill('Local disconnected draft')

  await second.goto(secondUrl)
  await expect(second.getByTestId('room-control-status')).toHaveText('Control: This device')
  await openTemplateDrawer(second)
  await second.getByTestId('macro-template-select').selectOption(recordId)
  await expect(second.getByTestId('macro-template-metadata')).toContainText('revision 1')
  second.once('dialog', async (dialog) => dialog.accept())
  await second.getByTestId('macro-edit').click()
  await expect(second.getByTestId('macro-name')).toBeEnabled()
  await closeCapturedWebSocket(first)
  await expect(first.getByTestId('room-identity')).toContainText('disconnected')
  await second.getByTestId('macro-name').fill('Remote reconnect revision')
  await second.getByTestId('macro-save').click()
  await expect(second.getByTestId('macro-template-metadata')).toContainText('revision 2')

  await expect(first.getByTestId('room-identity')).toContainText('connected')
  await expect(first.getByTestId('macro-name')).toHaveValue('Local disconnected draft')
  await expect(first.locator('.macro-error')).toHaveText('macro_record_changed_elsewhere')
  expect(await first.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await firstContext.close()
  await secondContext.close()
})

test('reconnect retries a failed Macro list read and installs current truth only into a clean readonly view', async ({ browser, request }) => {
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  await installWebSocketCapture(first)
  const firstRoom = await request.post('/api/rooms')
  const secondRoom = await request.post('/api/rooms')
  const firstUrl = (await firstRoom.json() as { url: string }).url
  const secondUrl = (await secondRoom.json() as { url: string }).url

  await first.goto(firstUrl)
  await openTemplateDrawer(first)
  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Clean reconnect base')
  await first.getByTestId('macro-save').click()
  await expect(first.getByTestId('macro-template-metadata')).toContainText('revision 1')
  const recordId = await first.getByTestId('macro-template-select').inputValue()
  await first.getByTestId('macro-cancel-edit').click()

  await second.goto(secondUrl)
  await expect(second.getByTestId('room-control-status')).toHaveText('Control: This device')
  await openTemplateDrawer(second)
  await second.getByTestId('macro-template-select').selectOption(recordId)
  await expect(second.getByTestId('macro-template-metadata')).toContainText('revision 1')
  await second.getByTestId('macro-edit').click()
  await expect(second.getByTestId('macro-name')).toBeEnabled()
  let failedLists = 0
  await first.route('**/api/templates', async (route) => {
    if (route.request().method() === 'GET' && failedLists === 0) {
      failedLists += 1
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'one_shot_list_failure' }) })
      return
    }
    await route.continue()
  })
  await closeCapturedWebSocket(first)
  await expect(first.getByTestId('room-identity')).toContainText('disconnected')
  await second.getByTestId('macro-name').fill('Clean reconnect latest')
  await second.getByTestId('macro-save').click()
  await expect(second.getByTestId('macro-template-metadata')).toContainText('revision 2')

  await expect(first.getByTestId('room-identity')).toContainText('connected')
  await expect(first.getByTestId('macro-name')).toHaveValue('Clean reconnect latest')
  await expect(first.getByTestId('macro-template-metadata')).toContainText('revision 2')
  expect(failedLists).toBe(1)
  await firstContext.close()
  await secondContext.close()
})
