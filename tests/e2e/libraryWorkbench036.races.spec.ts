import { expect, test, type BrowserContext, type Locator, type Page } from 'playwright/test'
import { libraryRuntimeControlInventory } from '../ui-baseline/031B/controlInventory'

import { clickWithDialog, ensureLibraryVisible, newRoomPage, selectLibraryItem } from './libraryWorkbench036.helpers'

test.describe.configure({ mode: 'serial' })

test('a pending Library Save replays a later remote Save without reviving the old edit lease', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await newRoomPage(context)
  await ensureLibraryVisible(page)
  await page.getByTestId('library-tab-prompt').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Lease Race Prompt')
  await page.getByTestId('library-content').fill('initial')
  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await expect(page.getByTestId('library-lease-status')).toContainText('held')
  await page.getByTestId('library-content').fill('committed before takeover')

  let markServerCommitted!: () => void
  const serverCommitted = new Promise<void>((resolve) => { markServerCommitted = resolve })
  let releaseSaveResponse!: () => void
  const saveResponseGate = new Promise<void>((resolve) => { releaseSaveResponse = resolve })
  const delayedSaveHandler = async (route: import('playwright/test').Route) => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    const response = await route.fetch()
    markServerCommitted()
    await saveResponseGate
    await route.fulfill({ response })
  }
  await page.route('**/api/library/items/prompt/*', delayedSaveHandler)
  await page.getByTestId('library-save').click()
  await serverCommitted
  await expect(page.getByTestId('library-save')).toHaveText('Working…')

  const otherRoom = await newRoomPage(context)
  await ensureLibraryVisible(otherRoom)
  await otherRoom.getByTestId('library-tab-prompt').click()
  await expect(otherRoom.getByTestId('library-selector').locator('option')).toContainText(['Lease Race Prompt'])
  await selectLibraryItem(otherRoom, 'Lease Race Prompt')
  await clickWithDialog(otherRoom.getByTestId('library-edit'), 'accept', 'Take over its edit lease')
  await expect(otherRoom.getByTestId('library-content')).toHaveValue('committed before takeover')
  await expect(page.getByTestId('library-remote-notice')).toContainText('edit lease moved elsewhere')
  await expect(page.getByTestId('library-content')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('library-panel')).toHaveAttribute('data-editing', 'false')
  await otherRoom.getByTestId('library-title').fill('Lease Race Prompt saved later')
  await otherRoom.getByTestId('library-content').fill('newer remote revision')
  await otherRoom.getByTestId('library-save').click()
  await expect(otherRoom.getByTestId('library-status')).toHaveText('Saved')

  releaseSaveResponse()
  await expect(page.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByTestId('library-status')).toHaveText('Saved read-only')
  await expect(page.getByTestId('library-content')).toHaveValue('committed before takeover')
  await expect(page.getByTestId('library-content')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('library-panel')).toHaveAttribute('data-editing', 'false')
  await expect(page.getByTestId('library-remote-notice')).toContainText('changed elsewhere')
  await expect(page.getByTestId('library-lease-status')).toContainText('held')
  await expect(page.getByTestId('library-selector').locator('option', { hasText: 'Lease Race Prompt saved later' })).toHaveCount(1)

  await page.getByTestId('library-tab-note').click()
  await expect(page.getByTestId('library-panel')).toHaveAttribute('data-kind', 'note')
  await expect(page.getByTestId('library-lease-status')).toHaveCount(0)
  await page.unroute('**/api/library/items/prompt/*', delayedSaveHandler)
  await otherRoom.close()
  await context.close()
})

test('a pending Library Save treats its own revision event as an acknowledgement', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await newRoomPage(context)
  await ensureLibraryVisible(page)
  await page.getByTestId('library-tab-prompt').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Library own acknowledgement')
  await page.getByTestId('library-content').fill('initial')
  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await page.getByTestId('library-content').fill('own committed revision')

  let listReads = 0
  let countListReads = false
  const countListRead = (request: import('playwright/test').Request) => {
    if (countListReads && request.method() === 'GET' && new URL(request.url()).pathname === '/api/library/items') listReads += 1
  }
  page.on('request', countListRead)

  let markServerCommitted!: () => void
  const serverCommitted = new Promise<void>((resolve) => { markServerCommitted = resolve })
  let releaseSaveResponse!: () => void
  const saveResponseGate = new Promise<void>((resolve) => { releaseSaveResponse = resolve })
  const delayedSaveHandler = async (route: import('playwright/test').Route) => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    const response = await route.fetch()
    markServerCommitted()
    await saveResponseGate
    await route.fulfill({ response })
  }
  await page.route('**/api/library/items/prompt/*', delayedSaveHandler)
  await page.getByTestId('library-save').click()
  await serverCommitted
  await expect(page.getByTestId('library-save')).toHaveText('Working…')
  countListReads = true
  releaseSaveResponse()

  await expect(page.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(() => listReads).toBeGreaterThanOrEqual(2)
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await expect(page.getByTestId('library-content')).toHaveValue('own committed revision')
  await expect(page.getByTestId('library-panel')).toHaveAttribute('data-editing', 'true')
  await expect(page.getByTestId('library-remote-notice')).toHaveCount(0)
  page.off('request', countListRead)
  await page.unroute('**/api/library/items/prompt/*', delayedSaveHandler)
  await context.close()
})

test('a delayed first Library Create keeps its submitted buffer when another Room saves a newer revision first', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await newRoomPage(context)
  await ensureLibraryVisible(page)
  await page.getByTestId('library-tab-prompt').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Submitted Create buffer')
  await page.getByTestId('library-content').fill('A submitted content')

  let markCreateCommitted!: () => void
  const createCommitted = new Promise<void>((resolve) => { markCreateCommitted = resolve })
  let releaseCreateResponse!: () => void
  const createResponseGate = new Promise<void>((resolve) => { releaseCreateResponse = resolve })
  const delayedCreateHandler = async (route: import('playwright/test').Route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const response = await route.fetch()
    markCreateCommitted()
    await createResponseGate
    await route.fulfill({ response })
  }
  await page.route('**/api/library/items', delayedCreateHandler)
  await page.getByTestId('library-save').click()
  await createCommitted
  await expect(page.getByTestId('library-save')).toHaveText('Working…')

  const otherRoom = await newRoomPage(context)
  await ensureLibraryVisible(otherRoom)
  await otherRoom.getByTestId('library-tab-prompt').click()
  await expect(otherRoom.getByTestId('library-selector').locator('option')).toContainText(['Submitted Create buffer'])
  await selectLibraryItem(otherRoom, 'Submitted Create buffer')
  await otherRoom.getByTestId('library-edit').click()
  await expect(otherRoom.getByTestId('library-lease-status')).toContainText('held')
  await otherRoom.getByTestId('library-title').fill('Newer remote Create revision')
  await otherRoom.getByTestId('library-content').fill('B committed content')
  await otherRoom.getByTestId('library-save').click()
  await expect(otherRoom.getByTestId('library-status')).toHaveText('Saved')
  await expect(otherRoom.getByTestId('library-selector').locator('option', { hasText: 'Newer remote Create revision' })).toHaveCount(1)

  releaseCreateResponse()
  await expect(page.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await expect(page.getByTestId('library-title')).toHaveValue('Submitted Create buffer')
  await expect(page.getByTestId('library-content')).toHaveValue('A submitted content')
  await expect(page.getByTestId('library-content')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('library-remote-notice')).toContainText('changed elsewhere')
  await expect(page.getByTestId('library-selector').locator('option', { hasText: 'Newer remote Create revision' })).toHaveCount(1)
  await expect(page.getByTestId('library-cancel')).toHaveText('Discard local copy')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)

  await page.getByTestId('library-cancel').click()
  await expect(page.getByTestId('library-status')).toHaveText('Local copy discarded; latest saved item loaded')
  await expect(page.getByTestId('library-title')).toHaveValue('Newer remote Create revision')
  await expect(page.getByTestId('library-content')).toHaveValue('B committed content')
  await expect(page.getByTestId('library-remote-notice')).toHaveCount(0)
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)

  await page.unroute('**/api/library/items', delayedCreateHandler)
  await otherRoom.close()
  await context.close()
})

test('a delayed first Library Create keeps its submitted buffer when another Room deletes the record first', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await newRoomPage(context)
  await ensureLibraryVisible(page)
  await page.getByTestId('library-tab-prompt').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Submitted Create before Delete')
  await page.getByTestId('library-content').fill('only remaining local buffer')

  let markCreateCommitted!: () => void
  const createCommitted = new Promise<void>((resolve) => { markCreateCommitted = resolve })
  let releaseCreateResponse!: () => void
  const createResponseGate = new Promise<void>((resolve) => { releaseCreateResponse = resolve })
  const delayedCreateHandler = async (route: import('playwright/test').Route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const response = await route.fetch()
    markCreateCommitted()
    await createResponseGate
    await route.fulfill({ response })
  }
  await page.route('**/api/library/items', delayedCreateHandler)
  await page.getByTestId('library-save').click()
  await createCommitted
  await expect(page.getByTestId('library-save')).toHaveText('Working…')

  const otherRoom = await newRoomPage(context)
  await ensureLibraryVisible(otherRoom)
  await otherRoom.getByTestId('library-tab-prompt').click()
  await expect(otherRoom.getByTestId('library-selector').locator('option')).toContainText(['Submitted Create before Delete'])
  await selectLibraryItem(otherRoom, 'Submitted Create before Delete')
  await otherRoom.getByTestId('library-edit').click()
  await expect(otherRoom.getByTestId('library-lease-status')).toContainText('held')
  await clickWithDialog(otherRoom.getByTestId('library-remove'), 'accept', 'Remove Submitted Create before Delete?')
  await expect(otherRoom.getByTestId('library-status')).toHaveText('Removed')
  await expect(otherRoom.getByTestId('library-selector').locator('option', { hasText: 'Submitted Create before Delete' })).toHaveCount(0)

  releaseCreateResponse()
  await expect(page.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByTestId('library-title')).toHaveValue('Submitted Create before Delete')
  await expect(page.getByTestId('library-content')).toHaveValue('only remaining local buffer')
  await expect(page.getByTestId('library-content')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('library-remote-notice')).toContainText('removed elsewhere')
  await expect(page.getByTestId('library-selector').locator('option', { hasText: 'Submitted Create before Delete' })).toHaveCount(0)
  await expect(page.getByTestId('library-cancel')).toHaveText('Discard local copy')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)

  await page.getByTestId('library-cancel').click()
  await expect(page.getByTestId('library-status')).toHaveText('Local copy discarded; item removed elsewhere')
  await expect(page.getByTestId('library-title')).toHaveCount(0)
  await expect(page.getByTestId('library-content')).toHaveCount(0)
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)

  await page.unroute('**/api/library/items', delayedCreateHandler)
  await otherRoom.close()
  await context.close()
})

test('a pending Library Save replays a later remote Delete without discarding its submitted buffer', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await newRoomPage(context)
  await ensureLibraryVisible(page)
  await page.getByTestId('library-tab-prompt').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Library Delete race')
  await page.getByTestId('library-content').fill('initial')
  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await page.getByTestId('library-content').fill('submitted before remote Delete')

  let markServerCommitted!: () => void
  const serverCommitted = new Promise<void>((resolve) => { markServerCommitted = resolve })
  let releaseSaveResponse!: () => void
  const saveResponseGate = new Promise<void>((resolve) => { releaseSaveResponse = resolve })
  const delayedSaveHandler = async (route: import('playwright/test').Route) => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    const response = await route.fetch()
    markServerCommitted()
    await saveResponseGate
    await route.fulfill({ response })
  }
  await page.route('**/api/library/items/prompt/*', delayedSaveHandler)
  await page.getByTestId('library-save').click()
  await serverCommitted

  const otherRoom = await newRoomPage(context)
  await ensureLibraryVisible(otherRoom)
  await otherRoom.getByTestId('library-tab-prompt').click()
  await expect(otherRoom.getByTestId('library-selector').locator('option')).toContainText(['Library Delete race'])
  await selectLibraryItem(otherRoom, 'Library Delete race')
  await clickWithDialog(otherRoom.getByTestId('library-edit'), 'accept', 'Take over its edit lease')
  await expect(otherRoom.getByTestId('library-content')).toHaveValue('submitted before remote Delete')
  await clickWithDialog(otherRoom.getByTestId('library-remove'), 'accept', 'Remove Library Delete race?')
  await expect(otherRoom.getByTestId('library-status')).toHaveText('Removed')

  releaseSaveResponse()
  await expect(page.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByTestId('library-status')).toHaveText('Saved read-only')
  await expect(page.getByTestId('library-content')).toHaveValue('submitted before remote Delete')
  await expect(page.getByTestId('library-content')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('library-remote-notice')).toContainText('removed elsewhere')
  await page.unroute('**/api/library/items/prompt/*', delayedSaveHandler)
  await otherRoom.close()
  await context.close()
})
