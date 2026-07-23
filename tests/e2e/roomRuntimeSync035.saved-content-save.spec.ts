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
