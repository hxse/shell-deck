import { expect, test } from 'playwright/test'
import { deferred, openTemplateDrawer } from './roomRuntimeSync035.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('a delayed first Macro Create preserves the submitted buffer when another Room saves a newer revision first', async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()
  const firstRoom = await request.post('/api/rooms')
  const secondRoom = await request.post('/api/rooms')
  const firstRoomBody = await firstRoom.json() as { url: string }
  const secondRoomBody = await secondRoom.json() as { url: string }
  const createCommitted = deferred<void>()
  const releaseCreateResponse = deferred<void>()

  await first.goto(firstRoomBody.url)
  await second.goto(secondRoomBody.url)
  await openTemplateDrawer(first)
  await openTemplateDrawer(second)
  await first.route('**/api/templates', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const response = await route.fetch()
    createCommitted.resolve()
    await releaseCreateResponse.promise
    await route.fulfill({ response })
  })

  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Fresh Macro submitted by A')
  await first.getByTestId('macro-save').click()
  await createCommitted.promise
  await expect(first.getByTestId('macro-save')).toBeDisabled()

  const secondSelector = second.getByTestId('macro-template-select')
  const freshOption = secondSelector.locator('option', { hasText: 'Fresh Macro submitted by A' })
  await expect(freshOption).toHaveCount(1)
  const recordId = await freshOption.getAttribute('value')
  expect(recordId).toBeTruthy()
  await secondSelector.selectOption(recordId!)
  await expect(second.getByTestId('macro-name')).toHaveValue('Fresh Macro submitted by A')
  await second.getByTestId('macro-edit').click()
  await expect(second.getByTestId('macro-name')).toBeEnabled()
  await second.getByTestId('macro-name').fill('Fresh Macro saved later by B')

  const remoteSaveCommitted = deferred<void>()
  await second.route('**/api/templates/*', async (route) => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    const response = await route.fetch()
    remoteSaveCommitted.resolve()
    await route.fulfill({ response })
  })
  await second.getByTestId('macro-save').click()
  await remoteSaveCommitted.promise
  await expect(second.getByTestId('macro-template-metadata')).toContainText('revision 2')

  releaseCreateResponse.resolve()
  await expect(first.getByTestId('macro-template-metadata')).toContainText('revision 1')
  await expect(first.getByTestId('macro-name')).toHaveValue('Fresh Macro submitted by A')
  await expect(first.locator('.macro-error')).toHaveText('macro_record_changed_elsewhere')
  await expect(first.getByTestId('macro-template-select').locator(`option[value="${recordId}"]`)).toContainText('Fresh Macro saved later by B')
  expect(await first.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)

  first.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Take over its edit lease')
    await dialog.accept()
  })
  await first.getByTestId('macro-edit').click()
  await expect(first.getByTestId('macro-name')).toHaveValue('Fresh Macro saved later by B')
  expect(await first.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
  await context.close()
})

test('a delayed first Macro Create preserves the submitted buffer when another Room deletes the record first', async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()
  const firstRoom = await request.post('/api/rooms')
  const secondRoom = await request.post('/api/rooms')
  const firstRoomBody = await firstRoom.json() as { url: string }
  const secondRoomBody = await secondRoom.json() as { url: string }
  const createCommitted = deferred<void>()
  const releaseCreateResponse = deferred<void>()

  await first.goto(firstRoomBody.url)
  await second.goto(secondRoomBody.url)
  await openTemplateDrawer(first)
  await openTemplateDrawer(second)
  await first.route('**/api/templates', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const response = await route.fetch()
    createCommitted.resolve()
    await releaseCreateResponse.promise
    await route.fulfill({ response })
  })

  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Fresh Macro before Delete')
  await first.getByTestId('macro-save').click()
  await createCommitted.promise
  await expect(first.getByTestId('macro-save')).toBeDisabled()

  const secondSelector = second.getByTestId('macro-template-select')
  const freshOption = secondSelector.locator('option', { hasText: 'Fresh Macro before Delete' })
  await expect(freshOption).toHaveCount(1)
  const recordId = await freshOption.getAttribute('value')
  expect(recordId).toBeTruthy()
  await secondSelector.selectOption(recordId!)
  await second.getByTestId('macro-edit').click()
  await expect(second.getByTestId('macro-name')).toBeEnabled()

  const remoteDeleteCommitted = deferred<void>()
  const remoteDeleteHandler = async (route: import('playwright/test').Route) => {
    if (route.request().method() !== 'DELETE') { await route.continue(); return }
    const response = await route.fetch()
    remoteDeleteCommitted.resolve()
    await route.fulfill({ response })
  }
  await second.route('**/api/templates/*', remoteDeleteHandler)
  second.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete Fresh Macro before Delete?')
    await dialog.accept()
  })
  await second.getByTestId('macro-delete').click()
  await remoteDeleteCommitted.promise
  await expect(secondSelector.locator(`option[value="${recordId}"]`)).toHaveCount(0)

  releaseCreateResponse.resolve()
  await expect(first.getByTestId('macro-template-metadata')).toContainText('revision 1')
  await expect(first.getByTestId('macro-name')).toHaveValue('Fresh Macro before Delete')
  await expect(first.locator('.macro-error')).toHaveText('macro_record_deleted_elsewhere')
  await expect(first.getByTestId('macro-template-select').locator(`option[value="${recordId}"]`)).toContainText('selected')
  expect(await first.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)

  await first.getByTestId('macro-template-select').selectOption('')
  await expect(first.getByTestId('macro-template-summary')).toContainText('No macro selected')
  expect(await first.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
  await second.unroute('**/api/templates/*', remoteDeleteHandler)
  await context.close()
})

test('a committed Macro Create keeps its fresh identity when Room control changes before the response arrives', async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  const committed = deferred<void>()
  const release = deferred<void>()

  await first.goto(room.url)
  await second.goto(room.url)
  await openTemplateDrawer(first)
  await openTemplateDrawer(second)
  await first.route('**/api/templates', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const response = await route.fetch()
    committed.resolve()
    await release.promise
    await route.fulfill({ response })
  })

  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Committed before takeover')
  await first.getByTestId('macro-save').click()
  await committed.promise
  const option = second.getByTestId('macro-template-select').locator('option', { hasText: 'Committed before takeover' })
  await expect(option).toHaveCount(1)
  const recordId = await option.getAttribute('value')
  expect(recordId).toBeTruthy()

  await second.getByTestId('macro-template-dismiss-layer').click()
  second.once('dialog', async (dialog) => dialog.accept())
  await second.getByTestId('take-control').click()
  await expect(second.getByTestId('room-control-status')).toHaveText('Control: This device')
  release.resolve()

  await expect(first.getByTestId('macro-template-select')).toHaveValue(recordId!)
  await expect(first.getByTestId('macro-template-metadata')).toContainText('revision 1')
  await expect(first.getByTestId('macro-name')).toHaveValue('Committed before takeover')
  await expect(first.getByTestId('macro-template-select').locator(`option[value="${recordId}"]`)).toHaveCount(1)
  expect(await first.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await context.close()
})
