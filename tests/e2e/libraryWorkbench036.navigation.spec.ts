import { expect, test, type BrowserContext, type Locator, type Page } from 'playwright/test'
import { libraryRuntimeControlInventory } from '../ui-baseline/031B/controlInventory'

import { ensureController, ensureLibraryVisible, newRoomPage, selectLibraryItem } from './libraryWorkbench036.helpers'

test.describe.configure({ mode: 'serial' })

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
