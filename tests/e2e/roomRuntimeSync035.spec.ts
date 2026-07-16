import { expect, test } from 'playwright/test'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('same URL tabs share server-owned run, takeover, notification and runtime input without sharing editor selection', async ({ browser, request }) => {
  const context = await browser.newContext()
  let runnerGetCount = 0
  context.on('request', (requestEvent) => {
    if (requestEvent.method() === 'GET' && /\/api\/rooms\/[^/]+\/runner$/.test(new URL(requestEvent.url()).pathname)) runnerGetCount += 1
  })
  const first = await context.newPage()
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await first.goto(room.url)

  await openTemplateDrawer(first)
  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-template-drawer').click()
  await first.getByTestId('macro-tab-json').click()
  await first.getByTestId('macro-edit-json').click()
  await first.getByTestId('macro-json-editor').fill(JSON.stringify(sharedRuntimeDefinition(), null, 2))
  await first.getByTestId('macro-save-json').click()
  await expect(first.getByTestId('macro-json-preview')).toContainText('Shared runtime')
  await first.getByTestId('macro-prepare-terminals').click()
  await expect(first.getByTestId('terminal-tab')).toHaveCount(1)

  const second = await context.newPage()
  await second.goto(first.url())
  await expect(second.getByTestId('macro-template-summary').locator('strong')).toHaveText('No macro selected')

  await first.getByTestId('macro-control-start').click()
  await expect(first.getByTestId('macro-run-status').locator('strong')).toHaveText('running')
  await expect(second.getByTestId('macro-run-status').locator('strong')).toHaveText('running')
  await expect(second.getByTestId('macro-running-identity')).toContainText('Shared runtime')
  await expect(second.getByTestId('macro-template-summary').locator('strong')).toHaveText('No macro selected')

  second.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('active Macro run stay on the server and will not be lost')
    await dialog.accept()
  })
  await second.getByTestId('take-control').click()
  await expect(second.getByTestId('room-control-status')).toHaveText('Control: This device')
  await expect(first.getByTestId('take-control')).toBeVisible()

  await second.getByTestId('macro-control-pause-resume').click()
  await expect(first.getByTestId('macro-run-status').locator('strong')).toHaveText('paused')
  await expect(second.getByTestId('macro-run-status').locator('strong')).toHaveText('paused')
  await second.getByTestId('macro-control-pause-resume').click()
  await expect(first.getByTestId('macro-run-status').locator('strong')).toHaveText('running')

  await expect(first.getByTestId('notice-item')).toContainText('Runtime notification', { timeout: 6_000 })
  await expect(second.getByTestId('notice-item')).toContainText('Runtime notification', { timeout: 6_000 })
  const firstNotice = await first.getByTestId('notice-item').textContent()
  const secondNotice = await second.getByTestId('notice-item').textContent()
  expect(firstNotice?.match(/notification_id: ([^\s]+)/)?.[1]).toBe(secondNotice?.match(/notification_id: ([^\s]+)/)?.[1])
  await first.getByTestId('notice-item').getByRole('button', { name: 'Dismiss notice' }).click()
  await second.getByTestId('notice-item').getByRole('button', { name: 'Dismiss notice' }).click()

  await expect(second.getByTestId('macro-run-status').locator('strong')).toHaveText('waiting_input', { timeout: 6_000 })
  await expect(first.getByTestId('macro-run-input-text')).toBeDisabled()
  await expect(second.getByTestId('macro-run-input-text')).toBeEditable()
  await second.getByTestId('macro-run-input-text').fill('draft from second')
  await expect(first.getByTestId('macro-run-input-text')).toHaveValue('draft from second')

  const roomUrl = first.url()
  await first.close()
  await second.close()
  await new Promise((resolve) => setTimeout(resolve, 200))

  const third = await context.newPage()
  await third.goto(roomUrl)
  await expect(third.getByTestId('macro-run-status').locator('strong')).toHaveText('waiting_input')
  await expect(third.getByTestId('macro-running-identity')).toContainText('Shared runtime')
  await expect(third.getByTestId('macro-run-input-text')).toHaveValue('draft from second')
  await expect(third.getByTestId('notice-item')).toHaveCount(0)
  await third.getByTestId('take-control').click()
  await expect(third.getByTestId('room-control-status')).toHaveText('Control: This device')
  await third.getByTestId('macro-run-input-submit').click()
  await expect(third.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  expect(runnerGetCount).toBe(0)

  await context.close()
})

test('a terminal runner delta gap repairs after one transient GET failure without a later delta', async ({ page, request }) => {
  let suppressedRunnerDeltas = 0
  let forwardedTerminalDeltas = 0
  await page.routeWebSocket('**/ws/rooms/**', (browserSocket) => {
    const serverSocket = browserSocket.connectToServer()
    serverSocket.onMessage((message) => {
      if (typeof message !== 'string') { browserSocket.send(message); return }
      let parsed: { type?: string; delta?: { status?: string } }
      try { parsed = JSON.parse(message) as typeof parsed }
      catch { browserSocket.send(message); return }
      if (parsed.type !== 'runner_delta') { browserSocket.send(message); return }
      if (parsed.delta?.status !== 'completed') {
        suppressedRunnerDeltas += 1
        return
      }
      forwardedTerminalDeltas += 1
      browserSocket.send(message)
    })
  })

  let repairGetCount = 0
  await page.route(/\/api\/rooms\/[^/]+\/runner$/, async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return }
    repairGetCount += 1
    if (repairGetCount === 1) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'transient_runner_repair_failure' }) })
      return
    }
    await route.continue()
  })

  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  await page.getByTestId('macro-json-editor').fill(JSON.stringify(gapRepairDefinition(), null, 2))
  await page.getByTestId('macro-save-json').click()

  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 8_000 })
  expect(suppressedRunnerDeltas).toBeGreaterThan(0)
  expect(forwardedTerminalDeltas).toBe(1)
  await expect.poll(() => repairGetCount).toBe(2)
  await page.waitForTimeout(500)
  expect(repairGetCount).toBe(2)
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

test('completed run preserves Macro editing and controller reload remains writable', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  await page.getByTestId('macro-json-editor').fill(JSON.stringify(completedRunDefinition(), null, 2))
  await page.getByTestId('macro-save-json').click()
  await page.getByTestId('macro-prepare-terminals').click()
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  await page.getByTestId('macro-tab-editor').click()
  await openTemplateDrawer(page)
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  await expect(page.getByTestId('macro-editor-lock-surface')).toBeEnabled()
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await expect(page.getByTestId('macro-create')).toBeEnabled()
  await expect(page.getByTestId('macro-create')).toHaveAttribute('aria-disabled', 'false')
  await expect(page.getByTestId('terminal-create-real')).toHaveAttribute('aria-disabled', 'false')
  await expect(page.locator('.macro-error')).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  await openTemplateDrawer(page)
  await expect(page.getByTestId('take-control')).toHaveCount(0)
  await expect(page.getByTestId('macro-create')).toBeEnabled()
  await expect(page.getByTestId('macro-create')).toHaveAttribute('aria-disabled', 'false')
  await expect(page.getByTestId('terminal-create-real')).toHaveAttribute('aria-disabled', 'false')
})

test('runtime input coalescing submits the latest local generation when it returns to the server value', async ({ browser, request }) => {
  const context = await browser.newContext()
  const firstDraftEntered = deferred<void>()
  const releaseFirstDraft = deferred<void>()
  let draftRequestCount = 0
  const draftValues: string[] = []
  let submittedValue: string | null = null

  await context.route('**/runner/input-draft', async (route) => {
    draftRequestCount += 1
    draftValues.push((route.request().postDataJSON() as { value: string }).value)
    if (draftRequestCount === 1) {
      firstDraftEntered.resolve()
      await releaseFirstDraft.promise
    }
    await route.continue()
  })
  context.on('request', (event) => {
    if (!event.url().endsWith('/runner/input')) return
    submittedValue = (event.postDataJSON() as { value?: string } | null)?.value ?? null
  })

  const page = await context.newPage()
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  await page.getByTestId('macro-json-editor').fill(JSON.stringify(runtimeInputGenerationDefinition(), null, 2))
  await page.getByTestId('macro-save-json').click()
  await page.getByTestId('macro-prepare-terminals').click()
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('waiting_input')
  await expect(page.getByTestId('macro-run-input-text')).toHaveValue('D')

  await page.getByTestId('macro-run-input-text').fill('A')
  await firstDraftEntered.promise
  await page.getByTestId('macro-run-input-text').fill('D')
  releaseFirstDraft.resolve()
  await expect.poll(() => draftValues).toEqual(['A', 'D'])
  await expect(page.getByTestId('macro-run-input-text')).toHaveValue('D')
  await page.getByTestId('macro-run-input-submit').click()

  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  expect(submittedValue).toBe('D')
  await expect(page.getByTestId('text-box-editor')).toHaveValue('DD')
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

function sharedRuntimeDefinition() {
  return {
    schemaVersion: 3,
    name: 'Shared runtime',
    description: '',
    terminalLayout: [{ index: 1, type: 'text' }],
    body: [
      { id: 'wait', type: 'wait', mode: 'duration', durationMs: 2500 },
      {
        id: 'notify',
        type: 'notify',
        level: 'info',
        title: 'Runtime notification',
        message: { parts: [{ kind: 'text', text: 'same Room broadcast' }] },
        channels: [{ kind: 'app', toast: true, sound: 'none' }],
        onFailure: 'continue',
      },
      { id: 'input', type: 'input', terminalIndex: 1, prompt: 'Shared prompt', allowEmpty: false, delivery: 'direct', ending: 'none' },
    ],
  }
}

function completedRunDefinition() {
  return {
    schemaVersion: 3,
    name: 'Completed run unlock',
    description: '',
    terminalLayout: [{ index: 1, type: 'text' }],
    body: [{
      id: 'send',
      type: 'send',
      terminalIndex: 1,
      message: { parts: [{ kind: 'text', text: 'done' }] },
      delivery: 'direct',
      ending: 'none',
    }],
  }
}

function gapRepairDefinition() {
  return {
    schemaVersion: 3,
    name: 'Gap repair retry',
    description: '',
    terminalLayout: [],
    body: [
      { id: 'wait_1', type: 'wait', mode: 'duration', durationMs: 150 },
      { id: 'wait_2', type: 'wait', mode: 'duration', durationMs: 150 },
      { id: 'wait_3', type: 'wait', mode: 'duration', durationMs: 150 },
    ],
  }
}

function runtimeInputGenerationDefinition() {
  return {
    schemaVersion: 3,
    name: 'Runtime input generation',
    description: '',
    terminalLayout: [{ index: 1, type: 'text' }],
    body: [
      {
        id: 'seed',
        type: 'send',
        terminalIndex: 1,
        message: { parts: [{ kind: 'text', text: 'D' }] },
        delivery: 'direct',
        ending: 'none',
      },
      { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminalIndex: 1 } },
      {
        id: 'input',
        type: 'input',
        terminalIndex: 1,
        prompt: 'Keep the latest local generation',
        allowEmpty: false,
        defaultSource: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' },
        delivery: 'direct',
        ending: 'none',
      },
    ],
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function openTemplateDrawer(page: import('playwright/test').Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

async function installWebSocketCapture(page: import('playwright/test').Page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    const sockets: WebSocket[] = []
    class CapturedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        sockets.push(this)
      }
    }
    window.WebSocket = CapturedWebSocket
    ;(window as Window & { __shellDeckTestSockets?: WebSocket[] }).__shellDeckTestSockets = sockets
  })
}

async function closeCapturedWebSocket(page: import('playwright/test').Page) {
  await page.evaluate(() => {
    const sockets = (window as Window & { __shellDeckTestSockets?: WebSocket[] }).__shellDeckTestSockets ?? []
    const socket = sockets.findLast((candidate) => candidate.readyState === WebSocket.OPEN)
    if (!socket) throw new Error('test_websocket_not_found')
    socket.close(4000, 'forced_reconnect')
  })
}
