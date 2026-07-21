import { expect, test } from 'playwright/test'

import { closeCapturedWebSocket, deferred, installWebSocketCapture, openTemplateDrawer } from './roomRuntimeSync035.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('pending Macro Save replays its acknowledgement and a later remote Save in server order', async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()
  const firstRoom = await request.post('/api/rooms')
  const secondRoom = await request.post('/api/rooms')
  const firstRoomBody = await firstRoom.json() as { url: string }
  const secondRoomBody = await secondRoom.json() as { url: string }
  let delayedSave: { committed: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> } | null = null

  await first.route('**/api/templates/*', async (route) => {
    if (route.request().method() !== 'PUT' || delayedSave === null) { await route.continue(); return }
    const current = delayedSave
    delayedSave = null
    const response = await route.fetch()
    current.committed.resolve()
    await current.release.promise
    await route.fulfill({ response })
  })

  await first.goto(firstRoomBody.url)
  await openTemplateDrawer(first)
  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Macro invalidation base')
  await first.getByTestId('macro-save').click()

  const ownAck = { committed: deferred<void>(), release: deferred<void>() }
  delayedSave = ownAck
  let ownAckListReads = 0
  let countOwnAckListReads = false
  const countOwnAckListRead = (requestEvent: import('playwright/test').Request) => {
    if (countOwnAckListReads && requestEvent.method() === 'GET' && new URL(requestEvent.url()).pathname === '/api/templates') ownAckListReads += 1
  }
  first.on('request', countOwnAckListRead)
  await first.getByTestId('macro-name').fill('Macro own acknowledgement')
  await first.getByTestId('macro-save').click()
  await ownAck.committed.promise
  countOwnAckListReads = true
  ownAck.release.resolve()
  await expect(first.getByTestId('macro-name')).toHaveValue('Macro own acknowledgement')
  await expect(first.getByTestId('macro-template-metadata')).toContainText('revision 2')
  await expect.poll(() => ownAckListReads).toBeGreaterThanOrEqual(2)
  await expect(first.locator('.macro-error')).toHaveCount(0)
  first.off('request', countOwnAckListRead)

  await second.goto(secondRoomBody.url)
  await openTemplateDrawer(second)
  const recordId = await first.getByTestId('macro-template-select').inputValue()
  await second.getByTestId('macro-template-select').selectOption(recordId)
  await expect(second.getByTestId('macro-name')).toHaveValue('Macro own acknowledgement')

  const remoteSave = { committed: deferred<void>(), release: deferred<void>() }
  delayedSave = remoteSave
  await first.getByTestId('macro-name').fill('Macro submitted by A')
  await first.getByTestId('macro-save').click()
  await remoteSave.committed.promise
  await expect(second.getByTestId('macro-name')).toHaveValue('Macro submitted by A')

  second.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Take over its edit lease')
    await dialog.accept()
  })
  await second.getByTestId('macro-edit').click()
  await second.getByTestId('macro-name').fill('Macro saved later by B')
  const remoteSaveCommitted = deferred<void>()
  const remoteSaveHandler = async (route: import('playwright/test').Route) => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    const response = await route.fetch()
    remoteSaveCommitted.resolve()
    await route.fulfill({ response })
  }
  await second.route('**/api/templates/*', remoteSaveHandler)
  await second.getByTestId('macro-save').click()
  await remoteSaveCommitted.promise
  await expect(second.getByTestId('macro-template-metadata')).toContainText('revision 4')

  remoteSave.release.resolve()
  await expect(first.getByTestId('macro-name')).toHaveValue('Macro submitted by A')
  await expect(first.locator('.macro-error')).toHaveText('macro_record_changed_elsewhere')
  await expect(first.getByTestId('macro-template-select').locator(`option[value="${recordId}"]`)).toContainText('Macro saved later by B')
  await second.unroute('**/api/templates/*', remoteSaveHandler)
  await context.close()
})

test('pending Macro Save replays a later remote Delete without discarding its submitted buffer', async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()
  const firstRoom = await request.post('/api/rooms')
  const secondRoom = await request.post('/api/rooms')
  const firstRoomBody = await firstRoom.json() as { url: string }
  const secondRoomBody = await secondRoom.json() as { url: string }
  const committed = deferred<void>()
  const release = deferred<void>()

  await first.goto(firstRoomBody.url)
  await openTemplateDrawer(first)
  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-name').fill('Macro delete race base')
  await first.getByTestId('macro-save').click()
  await expect(first.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
  const recordId = await first.getByTestId('macro-template-select').inputValue()
  expect(recordId).not.toBe('')

  await second.goto(secondRoomBody.url)
  await openTemplateDrawer(second)
  await second.getByTestId('macro-template-select').selectOption(recordId)
  await expect(second.getByTestId('macro-name')).toHaveValue('Macro delete race base')

  await first.route('**/api/templates/*', async (route) => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    const response = await route.fetch()
    committed.resolve()
    await release.promise
    await route.fulfill({ response })
  })
  await first.getByTestId('macro-name').fill('Macro submitted before Delete')
  await first.getByTestId('macro-save').click()
  await committed.promise
  await expect(second.getByTestId('macro-name')).toHaveValue('Macro submitted before Delete')

  second.once('dialog', async (dialog) => { await dialog.accept() })
  await second.getByTestId('macro-edit').click()
  await expect(second.getByTestId('macro-name')).toBeEnabled()
  second.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete Macro submitted before Delete?')
    await dialog.accept()
  })
  const remoteDeleteCommitted = deferred<void>()
  const remoteDeleteHandler = async (route: import('playwright/test').Route) => {
    if (route.request().method() !== 'DELETE') { await route.continue(); return }
    const response = await route.fetch()
    remoteDeleteCommitted.resolve()
    await route.fulfill({ response })
  }
  await second.route('**/api/templates/*', remoteDeleteHandler)
  await second.getByTestId('macro-delete').click()
  await remoteDeleteCommitted.promise
  await expect(second.getByTestId('macro-template-select').locator(`option[value="${recordId}"]`)).toHaveCount(0)

  release.resolve()
  await expect(first.getByTestId('macro-name')).toHaveValue('Macro submitted before Delete')
  await expect(first.locator('.macro-error')).toHaveText('macro_record_deleted_elsewhere')
  await second.unroute('**/api/templates/*', remoteDeleteHandler)
  await context.close()
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
