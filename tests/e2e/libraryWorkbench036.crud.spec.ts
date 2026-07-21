import { expect, test, type BrowserContext, type Locator, type Page } from 'playwright/test'
import { libraryRuntimeControlInventory } from '../ui-baseline/031B/controlInventory'

import { clickAndCover, clickWithDialog, dragResizeHandle, ensureController, ensureLibraryVisible, fillAndCover, installClipboardHarness, newRoomPage, selectLibraryItem } from './libraryWorkbench036.helpers'

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
    schemaVersion: 5,
    name: 'Loaded Library Macro',
    description: 'portable',
    terminalLayout: [],
    body: [{ id: 'send', type: 'send', terminal: { kind: 'unassigned' }, message: { parts: [{ kind: 'artifact', source: { kind: 'unassigned' } }] }, delivery: 'auto', ending: 'cr' }],
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
    await expect(page.getByTestId('library-validation')).toContainText('Valid MacroDefinitionV5 · 2 unassigned references (not runnable)')
    await expect(page.getByTestId('library-validation')).toContainText('body[0].terminal')
    await expect(page.getByTestId('library-validation')).toContainText('body[0].message.parts[0].source')
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
