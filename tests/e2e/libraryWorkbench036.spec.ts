import { expect, test, type BrowserContext, type Locator, type Page } from 'playwright/test'
import { libraryRuntimeControlInventory } from '../ui-baseline/031B/controlInventory'

declare global {
  interface Window { __sdRejectClipboard?: boolean; __shellDeckTestSockets?: WebSocket[] }
}

const ROOM_URL = /\/room_[1-9A-HJ-NP-Za-km-z]{22}$/

test.describe.configure({ mode: 'serial' })

test('current .036 Library journey exercises every control, all three kinds, leases, Copy and clean/dirty Macro Load entirely through UI', async ({ browser }) => {
  test.setTimeout(240_000)
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  await installClipboardHarness(context)
  const covered = new Set<string>()
  const page = await newRoomPage(context)

  await expect(page.getByTestId('macro-panel')).toBeVisible()
  await expect(page.getByTestId('library-side-panel')).toBeHidden()
  await expect(page.getByTestId('library-panel-toggle')).toHaveAttribute('aria-pressed', 'false')
  await clickAndCover(page.getByTestId('library-panel-toggle'), 'library-panel-toggle', covered)
  await expect(page.getByTestId('library-panel-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('library-panel')).toBeVisible()
  await expect(page.getByTestId('workspace-shell').locator(':scope > [data-testid]').first()).toHaveAttribute('data-testid', 'terminal-room')
  await expect(page.getByTestId('macro-side-panel')).toBeVisible()
  await expect(page.getByTestId('library-side-panel')).toBeVisible()
  await dragResizeHandle(page, 'library-resize-handle', -42)
  covered.add('library-resize-handle')
  await clickAndCover(page.getByTestId('library-reset-width'), 'library-reset-width', covered)

  let promptContent = 'Reusable SIGNAL prompt\nsecond line'
  await test.step('Prompt CRUD, search, clipboard, read-only and pending-inert behavior use only visible controls', async () => {
    await clickAndCover(page.getByTestId('library-tab-prompt'), 'library-tab-prompt', covered)
    await clickAndCover(page.getByTestId('library-new'), 'library-new', covered)
    await expect(page.getByTestId('library-dirty')).toBeVisible()
    await fillAndCover(page.getByTestId('library-title'), 'Signal Prompt', 'library-title', covered)
    await fillAndCover(page.getByTestId('library-description'), 'Common review instruction', 'library-description', covered)
    await fillAndCover(page.getByTestId('library-tags'), 'review, signal, review', 'library-tags', covered)
    await fillAndCover(page.getByTestId('library-content'), promptContent, 'library-content', covered)

    let releaseCreate!: () => void
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
    await page.route('**/api/library/items', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      await createGate
      await route.continue()
    }, { times: 1 })
    const savePromise = page.getByTestId('library-save').click()
    covered.add('library-save')
    await expect(page.getByTestId('library-save')).toHaveText('Working…')
    await expect(page.getByTestId('library-title')).toHaveAttribute('readonly', '')
    releaseCreate()
    await savePromise
    await expect(page.getByTestId('library-status')).toHaveText('Saved')
    await expect(page.getByTestId('library-dirty')).toHaveCount(0)
    await expect(page.getByTestId('library-title')).not.toHaveAttribute('readonly', '')
    await expect(page.getByTestId('library-cancel')).toHaveText('Done')
    await expect(page.getByTestId('library-tags')).toHaveValue('review, signal')

    await clickAndCover(page.getByTestId('library-cancel'), 'library-cancel', covered)
    await expect(page.getByTestId('library-status')).toHaveText('Done')
    await expect(page.getByTestId('library-title')).toHaveAttribute('readonly', '')

    await clickAndCover(page.getByTestId('library-copy'), 'library-copy', covered)
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toBe(promptContent)
    await expect(page.getByTestId('library-copy')).toHaveText('Copied')

    await fillAndCover(page.getByTestId('library-search'), '  SIGNAL  ', 'library-search', covered)
    await expect(page.getByTestId('library-selector').locator('option')).toContainText(['Signal Prompt'])
    await selectLibraryItem(page, 'Signal Prompt')
    covered.add('library-selector')
    await expect(page.getByTestId('library-title')).toHaveValue('Signal Prompt')
    await clickAndCover(page.getByTestId('library-refresh'), 'library-refresh', covered)

    await clickAndCover(page.getByTestId('library-edit'), 'library-edit', covered)
    await page.getByTestId('library-title').fill('Cancelled Prompt Title')
    await page.getByTestId('library-content').fill('cancelled edit')
    await page.getByTestId('library-cancel').click()
    await expect(page.getByTestId('library-title')).toHaveValue('Signal Prompt')
    await expect(page.getByTestId('library-content')).toHaveValue(promptContent)

    await page.getByTestId('library-edit').click()
    promptContent = 'Saved SIGNAL edit'
    await page.getByTestId('library-content').fill(promptContent)
    await page.getByTestId('library-save').click()
    await expect(page.getByTestId('library-status')).toHaveText('Saved')

    await page.evaluate(() => { window.__sdRejectClipboard = true })
    await page.getByTestId('library-copy').click()
    await expect(page.getByTestId('library-error')).toHaveText('clipboard_write_failed')
    await expect(page.getByTestId('notice-item')).toContainText('clipboard')
    await page.getByTestId('notice-dismiss-layer').click()
    await page.evaluate(() => { window.__sdRejectClipboard = false })
  })

  await test.step('Note keeps arbitrary invalid JSON/template text and tab/search preferences survive reload', async () => {
    await fillAndCover(page.getByTestId('library-search'), '', 'library-search', covered)
    await clickAndCover(page.getByTestId('library-tab-note'), 'library-tab-note', covered)
    await page.getByTestId('library-new').click()
    await page.getByTestId('library-title').fill('Raw Note')
    await page.getByTestId('library-description').fill('Not parsed')
    await page.getByTestId('library-tags').fill('raw')
    await page.getByTestId('library-content').fill('{ invalid JSON {{legacy}}')
    await page.getByTestId('library-save').click()
    await expect(page.getByTestId('library-status')).toHaveText('Saved')
    await expect(page.getByTestId('library-validate')).toHaveCount(0)
    await fillAndCover(page.getByTestId('library-search'), '{{legacy}}', 'library-search', covered)
    await expect(page.getByTestId('library-selector').locator('option')).toContainText(['Raw Note'])

    await page.reload()
    await expect(page.getByTestId('library-panel')).toBeVisible()
    await expect(page.getByTestId('library-panel')).toHaveAttribute('data-kind', 'note')
    await expect(page.getByTestId('library-search')).toHaveValue('{{legacy}}')
    await expect(page.getByTestId('macro-panel')).toBeVisible()
    await ensureController(page)
  })

  await test.step('an unsaved New Macro draft can be materialized in Library without saving or selecting a MacroRecord', async () => {
    await page.getByTestId('macro-template-drawer').click()
    await page.getByTestId('macro-create').click()
    await page.getByTestId('macro-name').fill('Unsaved Macro Material')
    await clickAndCover(page.getByTestId('macro-save-to-library'), 'macro-save-to-library', covered)
    await expect(page.getByTestId('macro-save-to-library')).toHaveText('Saved')
    await expect(page.getByTestId('macro-template-summary')).toContainText('Unsaved Macro Material *')
    await expect(page.getByTestId('macro-template-metadata')).toContainText('unsaved new macro')
    await page.getByTestId('macro-cancel-edit').click()
    await expect(page.getByTestId('macro-template-summary')).toContainText('No macro selected')
    await page.getByTestId('macro-template-drawer').click()
  })

  const macroDefinition = {
    schemaVersion: 3,
    name: 'Loaded Library Macro',
    description: 'portable',
    terminalLayout: [],
    body: [],
  }
  await test.step('Macro JSON uses line numbers and the single validator, then clean Load selects while dirty Load creates only', async () => {
    await page.getByTestId('library-search').fill('')
    await clickAndCover(page.getByTestId('library-tab-macro-template'), 'library-tab-macro-template', covered)
    await expect(page.getByTestId('library-actions').getByTestId('library-load-into-macro')).toBeVisible()
    await expect(page.getByTestId('library-editor').getByTestId('library-load-into-macro')).toHaveCount(0)
    await expect(page.getByTestId('library-selector').locator('option')).toContainText(['Unsaved Macro Material'])
    await page.getByTestId('library-new').click()
    await page.getByTestId('library-title').fill('Portable Macro Material')
    await page.getByTestId('library-content').fill('{')
    await clickAndCover(page.getByTestId('library-validate'), 'library-validate', covered)
    await expect(page.getByTestId('library-validation')).toContainText('invalid_json')
    await page.getByTestId('library-save').click()
    await expect(page.getByTestId('library-error')).toHaveText('invalid_json')

    const macroText = JSON.stringify(macroDefinition, null, 2)
    await page.getByTestId('library-content').fill(macroText)
    await page.getByTestId('library-validate').click()
    await expect(page.getByTestId('library-validation')).toHaveText('Valid MacroDefinitionV3')
    await expect(page.getByTestId('library-content-line-numbers').locator(':scope > div > div')).toHaveCount(macroText.split('\n').length)
    await page.getByTestId('library-save').click()
    await expect(page.getByTestId('library-status')).toHaveText('Saved')

    await clickAndCover(page.getByTestId('library-load-into-macro'), 'library-load-into-macro', covered)
    await expect(page.getByTestId('library-status')).toContainText('Created and selected')
    await page.getByTestId('macro-template-drawer').click()
    await expect(page.getByTestId('macro-template-summary')).toContainText('Loaded Library Macro')

    await page.getByTestId('macro-edit').click()
    await page.getByTestId('macro-name').fill('Local dirty Macro')
    await page.getByTestId('macro-save-to-library').click()
    await expect(page.getByTestId('macro-save-to-library')).toHaveText('Saved')
    await expect(page.getByTestId('macro-name')).toHaveValue('Local dirty Macro')
    await expect(page.getByTestId('macro-template-summary')).toContainText('Local dirty Macro *')
    await expect(page.getByTestId('library-selector').locator('option')).toContainText(['Local dirty Macro'])
    await page.getByTestId('macro-template-drawer').click()
    await page.getByTestId('library-load-into-macro').click()
    await expect(page.getByTestId('library-status')).toContainText('current Macro draft was not switched')
    await page.getByTestId('macro-template-drawer').click()
    await expect(page.getByTestId('macro-name')).toHaveValue('Local dirty Macro')
    await page.getByTestId('macro-cancel-edit').click()
    await page.getByTestId('macro-template-drawer').click()

    page.once('dialog', async (dialog) => dialog.dismiss())
    await clickAndCover(page.getByTestId('library-remove'), 'library-remove', covered)
    await expect(page.getByTestId('library-title')).toHaveValue('Portable Macro Material')
    page.once('dialog', async (dialog) => dialog.accept())
    await page.getByTestId('library-remove').click()
    await expect(page.getByTestId('library-status')).toContainText(/Removed|0 Macro JSON items/)
    await expect(page.getByTestId('macro-template-summary')).toContainText('Loaded Library Macro')
  })

  await test.step('same-Room observer gets explicit denial and another Room can take over the per-record Library lease without browser-to-browser state', async () => {
    const observer = await context.newPage()
    observer.setDefaultTimeout(12_000)
    await observer.goto(page.url())
    await ensureLibraryVisible(observer)
    await observer.getByTestId('library-tab-prompt').click()
    await expect(observer.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'false')
    await observer.getByTestId('library-new').click({ force: true })
    await expect(observer.getByTestId('notice-item')).toContainText('read-only')
    await expect(observer.getByTestId('library-dirty')).toHaveCount(0)
    await observer.close()

    await page.getByTestId('library-tab-prompt').click()
    await page.getByTestId('library-search').fill('')
    await selectLibraryItem(page, 'Signal Prompt')
    await page.getByTestId('library-edit').click()
    await expect(page.getByTestId('library-lease-status')).toContainText('held')
    await page.getByTestId('library-content').fill('Unsaved first-Room draft')

    const otherRoom = await newRoomPage(context)
    await ensureLibraryVisible(otherRoom)
    await otherRoom.getByTestId('library-tab-prompt').click()
    await expect(otherRoom.getByTestId('library-selector').locator('option')).toContainText(['Signal Prompt'])
    await selectLibraryItem(otherRoom, 'Signal Prompt')
    await clickWithDialog(otherRoom.getByTestId('library-edit'), 'dismiss', 'Take over its edit lease')
    await expect(otherRoom.getByTestId('library-status')).toHaveText('Item remains read-only')
    await clickWithDialog(otherRoom.getByTestId('library-edit'), 'accept', 'Take over its edit lease')
    await expect(otherRoom.getByTestId('library-lease-status')).toContainText('held')
    await expect(page.getByTestId('library-remote-notice')).toContainText('edit lease moved elsewhere')
    await expect(page.getByTestId('library-content')).toHaveValue('Unsaved first-Room draft')
    await expect(page.getByTestId('library-content')).toHaveAttribute('readonly', '')
    await page.getByTestId('library-save').click()
    await expect(page.getByTestId('notice-item')).toContainText('content edit lease moved elsewhere')
    await page.getByTestId('notice-dismiss-layer').click()
    await otherRoom.getByTestId('library-content').fill('Saved from the other Room')
    await otherRoom.getByTestId('library-save').click()
    await expect(otherRoom.getByTestId('library-status')).toHaveText('Saved')
    await page.getByTestId('library-cancel').click()
    await page.getByTestId('library-refresh').click()
    await expect(page.getByTestId('library-content')).toHaveValue('Saved from the other Room')
    await otherRoom.close()
  })

  await clickAndCover(page.getByTestId('library-panel-toggle'), 'library-panel-toggle', covered)
  await expect(page.getByTestId('library-panel-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('library-side-panel')).toBeHidden()
  const missing = libraryRuntimeControlInventory.filter(({ key }) => !covered.has(key)).map(({ key }) => key)
  expect(missing).toEqual([])
  await context.close()
})

test('Library navigation serializes lease release and cannot overwrite a newer local draft', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await newRoomPage(context)
  await ensureLibraryVisible(page)
  await page.getByTestId('library-tab-note').click()

  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('First Note')
  await page.getByTestId('library-content').fill('first')
  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await page.getByTestId('library-cancel').click()
  await expect(page.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'false')

  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Second Note')
  await page.getByTestId('library-content').fill('second')
  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')

  let releaseSelectorLease!: () => void
  const selectorLeaseGate = new Promise<void>((resolve) => { releaseSelectorLease = resolve })
  const selectorReleaseHandler = async (route: import('playwright/test').Route) => {
    await selectorLeaseGate
    await route.continue()
  }
  await page.route('**/api/content-edit-leases/*', selectorReleaseHandler)
  await selectLibraryItem(page, 'First Note')
  await expect(page.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'true')
  const observer = await context.newPage()
  observer.setDefaultTimeout(12_000)
  await observer.goto(page.url())
  await ensureController(observer)
  await expect(page.getByTestId('take-control')).toBeVisible()
  await page.getByTestId('library-new').evaluate((element: HTMLButtonElement) => element.click())
  await expect(page.getByTestId('notice-item')).toContainText('Wait for the current operation')
  await expect(page.getByTestId('library-error')).toHaveText('operation_pending')
  await page.getByTestId('library-save').evaluate((element: HTMLButtonElement) => element.click())
  await expect(page.getByTestId('notice-item')).toContainText('Wait for the current operation')
  await expect(page.getByTestId('library-error')).toHaveText('operation_pending')
  await expect(page.getByTestId('library-title')).toHaveValue('Second Note')
  releaseSelectorLease()
  await expect(page.getByTestId('library-title')).toHaveValue('First Note')
  await expect(page.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByTestId('library-lease-status')).toHaveCount(0)
  await page.unroute('**/api/content-edit-leases/*', selectorReleaseHandler)
  await page.getByTestId('notice-dismiss-layer').click()
  await observer.close()
  await expect(page.getByTestId('take-control')).toBeVisible()
  await ensureController(page)

  await page.getByTestId('library-edit').click()
  await expect(page.getByTestId('library-lease-status')).toContainText('held')
  let releaseTabLease!: () => void
  const tabLeaseGate = new Promise<void>((resolve) => { releaseTabLease = resolve })
  const tabReleaseHandler = async (route: import('playwright/test').Route) => {
    await tabLeaseGate
    await route.continue()
  }
  await page.route('**/api/content-edit-leases/*', tabReleaseHandler)
  await page.getByTestId('library-tab-prompt').click()
  await expect(page.getByTestId('library-toolbar')).toHaveAttribute('aria-busy', 'true')
  await page.getByTestId('library-new').click({ force: true })
  await expect(page.getByTestId('notice-item')).toContainText('Wait for the current operation')
  await expect(page.getByTestId('library-panel')).toHaveAttribute('data-kind', 'note')
  await expect(page.getByTestId('library-title')).toHaveValue('First Note')
  releaseTabLease()
  await expect(page.getByTestId('library-panel')).toHaveAttribute('data-kind', 'prompt')
  await expect(page.getByTestId('library-title')).toHaveCount(0)
  await page.unroute('**/api/content-edit-leases/*', tabReleaseHandler)
  await page.getByTestId('notice-dismiss-layer').click()

  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Surviving Prompt Draft')
  await page.getByTestId('library-content').fill('latest local text')
  let releaseCreate!: () => void
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
  const createHandler = async (route: import('playwright/test').Route) => {
    if (route.request().method() === 'POST') await createGate
    await route.continue()
  }
  await page.route('**/api/library/items', createHandler)
  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-save')).toHaveText('Working…')
  await page.getByTestId('library-tab-note').click({ force: true })
  await expect(page.getByTestId('notice-item')).toContainText('Wait for the current operation')
  await expect(page.getByTestId('library-panel')).toHaveAttribute('data-kind', 'prompt')
  await expect(page.getByTestId('library-title')).toHaveValue('Surviving Prompt Draft')
  releaseCreate()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await expect(page.getByTestId('library-panel')).toHaveAttribute('data-kind', 'prompt')
  await expect(page.getByTestId('library-title')).toHaveValue('Surviving Prompt Draft')
  await page.unroute('**/api/library/items', createHandler)

  await context.close()
})

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
  await page.getByTestId('macro-template-dismiss-layer').click()
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

async function newRoomPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  await page.goto('/')
  if (await page.getByTestId('room-home').isVisible()) {
    const button = await page.getByTestId('new-room').count() ? page.getByTestId('new-room') : page.getByTestId('new-room-empty')
    await button.click()
  }
  await expect(page).toHaveURL(ROOM_URL)
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  return page
}

async function ensureLibraryVisible(page: Page) {
  if (!await page.getByTestId('library-side-panel').isVisible()) await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-panel')).toBeVisible()
}

async function ensureController(page: Page) {
  if (await page.getByTestId('take-control').count()) {
    const acceptTakeover = (dialog: import('playwright/test').Dialog) => { void dialog.accept() }
    page.on('dialog', acceptTakeover)
    try { await page.getByTestId('take-control').click() }
    finally { page.off('dialog', acceptTakeover) }
  }
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
}

async function selectLibraryItem(page: Page, title: string) {
  const option = page.getByTestId('library-selector').locator('option', { hasText: title }).first()
  const value = await option.getAttribute('value')
  if (!value) throw new Error('missing Library option for ' + title)
  await page.getByTestId('library-selector').selectOption(value)
}

async function installWebSocketCapture(context: BrowserContext) {
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    const sockets: WebSocket[] = []
    class CapturedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        sockets.push(this)
      }
    }
    window.WebSocket = CapturedWebSocket
    window.__shellDeckTestSockets = sockets
  })
}

async function closeCapturedWebSocket(page: Page) {
  await page.evaluate(() => {
    const socket = (window.__shellDeckTestSockets ?? []).findLast((candidate) => candidate.readyState === WebSocket.OPEN)
    if (!socket) throw new Error('test_websocket_not_found')
    socket.close(4000, 'forced_reconnect')
  })
}

async function installClipboardHarness(context: BrowserContext) {
  await context.addInitScript(() => {
    let clipboardText = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          if (window.__sdRejectClipboard) return Promise.reject(new Error('synthetic_clipboard_failure'))
          clipboardText = value
          return Promise.resolve()
        },
        readText() { return Promise.resolve(clipboardText) },
      },
    })
  })
}

async function clickAndCover(locator: Locator, key: string, covered: Set<string>) {
  await locator.click()
  covered.add(key)
}

async function fillAndCover(locator: Locator, value: string, key: string, covered: Set<string>) {
  await locator.fill(value)
  covered.add(key)
}

async function dragResizeHandle(page: Page, testId: string, deltaX: number) {
  const handle = page.getByTestId(testId)
  const box = await handle.boundingBox()
  if (!box) throw new Error('missing resize handle ' + testId)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2)
  await page.mouse.up()
}

async function clickWithDialog(target: Locator, action: 'accept' | 'dismiss', expectedText: string) {
  const page = target.page()
  const dialogPromise = page.waitForEvent('dialog')
  const clickPromise = target.click()
  const dialog = await dialogPromise
  expect(dialog.message()).toContain(expectedText)
  if (action === 'accept') await dialog.accept()
  else await dialog.dismiss()
  await clickPromise
}
