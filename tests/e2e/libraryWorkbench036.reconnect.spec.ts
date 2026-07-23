import { expect, test, type BrowserContext, type Locator, type Page } from 'playwright/test'
import { libraryRuntimeControlInventory } from '../ui-baseline/031B/controlInventory'

import { clickWithDialog, closeCapturedWebSocket, ensureLibraryVisible, installWebSocketCapture, newRoomPage, selectLibraryItem } from './libraryWorkbench036.helpers'

test.describe.configure({ mode: 'serial' })

test('Library reconnect preserves a dirty buffer and reconciles a missed remote Save notice', async ({ browser }) => {
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  await installWebSocketCapture(firstContext)
  const page = await newRoomPage(firstContext)
  const otherRoom = await newRoomPage(secondContext)
  await ensureLibraryVisible(page)
  await ensureLibraryVisible(otherRoom)

  await page.getByTestId('library-tab-prompt').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Reconnect Library Prompt')
  await page.getByTestId('library-content').fill('initial')
  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await page.getByTestId('library-content').fill('local disconnected draft')

  await otherRoom.getByTestId('library-tab-prompt').click()
  await expect(otherRoom.getByTestId('library-selector').locator('option')).toContainText(['Reconnect Library Prompt'])
  await selectLibraryItem(otherRoom, 'Reconnect Library Prompt')
  await expect(otherRoom.getByTestId('library-title')).toHaveValue('Reconnect Library Prompt')
  await clickWithDialog(otherRoom.getByTestId('library-edit'), 'accept', 'Take over its edit lease')
  await expect(page.getByTestId('library-remote-notice')).toContainText('edit lease moved elsewhere')

  await closeCapturedWebSocket(page)
  await expect(page.getByTestId('room-identity')).toContainText('disconnected')
  await otherRoom.getByTestId('library-content').fill('remote reconnect revision')
  await otherRoom.getByTestId('library-save').click()
  await expect(otherRoom.getByTestId('library-status')).toHaveText('Saved')

  await expect(page.getByTestId('room-identity')).toContainText('connected')
  await expect(page.getByTestId('library-content')).toHaveValue('local disconnected draft')
  await expect(page.getByTestId('library-remote-notice')).toContainText('changed elsewhere')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await firstContext.close()
  await secondContext.close()
})

test('Library reconnect retries one failed list and installs current truth only into a clean readonly view', async ({ browser }) => {
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  await installWebSocketCapture(firstContext)
  const page = await newRoomPage(firstContext)
  const otherRoom = await newRoomPage(secondContext)
  await ensureLibraryVisible(page)
  await ensureLibraryVisible(otherRoom)

  await page.getByTestId('library-tab-prompt').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Clean Library reconnect')
  await page.getByTestId('library-content').fill('initial clean value')
  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await page.getByTestId('library-cancel').click()
  await expect(page.getByTestId('library-panel')).toHaveAttribute('data-editing', 'false')

  await otherRoom.getByTestId('library-tab-prompt').click()
  await expect(otherRoom.getByTestId('library-selector').locator('option')).toContainText(['Clean Library reconnect'])
  await selectLibraryItem(otherRoom, 'Clean Library reconnect')
  await expect(otherRoom.getByTestId('library-title')).toHaveValue('Clean Library reconnect')
  await otherRoom.getByTestId('library-edit').click()
  await expect(otherRoom.getByTestId('library-content')).not.toHaveAttribute('readonly', '')

  let failedLists = 0
  await page.route('**/api/library/items**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.pathname === '/api/library/items' && failedLists === 0) {
      failedLists += 1
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'one_shot_library_list_failure' }) })
      return
    }
    await route.continue()
  })
  await closeCapturedWebSocket(page)
  await expect(page.getByTestId('room-identity')).toContainText('disconnected')
  await otherRoom.getByTestId('library-content').fill('latest server value')
  await otherRoom.getByTestId('library-save').click()
  await expect(otherRoom.getByTestId('library-status')).toHaveText('Saved')

  await expect(page.getByTestId('room-identity')).toContainText('connected')
  await expect(page.getByTestId('library-content')).toHaveValue('latest server value')
  expect(failedLists).toBe(1)
  await firstContext.close()
  await secondContext.close()
})

test('Room Destroy entering Home clears Macro and Library aggregate unload guards', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await newRoomPage(context)
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-name').fill('Unsaved before Room Destroy')
  await page.getByTestId('macro-template-dismiss-layer').click({ position: { x: 8, y: 8 } })
  await ensureLibraryVisible(page)
  await page.getByTestId('library-tab-note').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-content').fill('also unsaved before Room Destroy')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)

  const roomId = new URL(page.url()).pathname.slice(1)
  const roomsResponse = await context.request.get('/api/rooms')
  const rooms = await roomsResponse.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  const room = rooms.rooms.find((candidate) => candidate.roomId === roomId)
  if (!room) throw new Error('room_not_found_for_destroy_test')
  await context.request.delete('/api/rooms/' + encodeURIComponent(roomId), { data: { expectedRoomGeneration: room.roomGeneration } })
  await expect(page.getByTestId('room-home')).toBeVisible()
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
  await context.close()
})

test('Library panel visibility preserves page-memory draft and participates in the native unload guard', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await newRoomPage(context)

  await expect(page.getByTestId('library-side-panel')).toBeHidden()
  await expect(page.getByTestId('library-panel-toggle')).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-panel-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('library-tab-prompt').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Page memory only')
  await page.getByTestId('library-content').fill('never persist this draft in browser storage')

  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) => value.includes('never persist this draft')))).toBe(false)

  await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-panel-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('library-side-panel')).toBeHidden()
  await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-panel-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('library-title')).toHaveValue('Page memory only')
  await expect(page.getByTestId('library-content')).toHaveValue('never persist this draft in browser storage')

  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
  await context.close()
})
