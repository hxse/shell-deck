import { expect, test, type BrowserContext, type Locator, type Page } from 'playwright/test'
import { workspaceRuntimeControlInventory } from '../ui-baseline/031B/controlInventory'

const ROOM_URL = /\/room_[1-9A-HJ-NP-Za-km-z]{22}$/
const SETTINGS_KEY = 'shell-deck:settings:v2'

test.describe.configure({ mode: 'serial' })

test('current .036 UI journey preserves Room interactions and exercises automatic Home refresh plus single-writer feedback', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const covered = new Set<string>()
  const externalRequests: string[] = []
  context.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') externalRequests.push(request.url())
  })

  const first = await context.newPage()
  first.setDefaultTimeout(12_000)
  await first.goto('/')
  if (await first.getByTestId('room-home').isVisible()) {
    const roomRows = first.getByTestId('room-list').locator('li')
    while (await roomRows.count() > 0) {
      const previousCount = await roomRows.count()
      const destroy = roomRows.first().getByTestId('room-destroy')
      const dialogPromise = first.waitForEvent('dialog')
      const clickPromise = destroy.click()
      const dialog = await dialogPromise
      await dialog.accept()
      await clickPromise
      await expect(roomRows).toHaveCount(previousCount - 1)
    }
    await first.getByTestId('new-room-empty').click()
  }
  await expect(first).toHaveURL(ROOM_URL)
  await expect(first.getByTestId('room-identity')).toContainText('connected')
  await expect(first.getByTestId('empty-terminal-room')).toBeVisible()
  await expect(first.getByTestId('macro-panel')).toBeVisible()
  await expect(first.getByTestId('prompt-panel')).toHaveCount(0)
  await expect(first.locator('.run-log-view')).toHaveCount(0)

  await test.step('strict browser-setting reset exposes both dismiss controls without changing product state through an API', async () => {
    await invalidateBrowserSettings(first)
    await first.reload()
    await expect(first.getByTestId('notice-item')).toContainText('Browser settings were reset')
    await clickAndCover(first.getByTestId('notice-dismiss'), 'notice-dismiss', covered)
    await expect(first.getByTestId('notice-item')).toHaveCount(0)

    await invalidateBrowserSettings(first)
    await first.reload()
    await expect(first.getByTestId('notice-item')).toContainText('Browser settings were reset')
    await clickAndCover(first.getByTestId('notice-dismiss-layer'), 'notice-dismiss-layer', covered)
    await expect(first.getByTestId('notice-item')).toHaveCount(0)
  })
  await ensureController(first, covered)

  await test.step('Settings closes through both paths and enables the only surviving browser-local toggle', async () => {
    await clickAndCover(first.getByTestId('settings-button'), 'settings-button', covered)
    await expect(first.getByTestId('settings-popover')).toBeVisible()
    await clickAndCover(first.getByTestId('tab-drag-toggle'), 'tab-drag-toggle', covered)
    await expect(first.getByTestId('tab-drag-toggle')).toHaveAttribute('aria-pressed', 'true')
    await clickAndCover(first.getByTestId('settings-close'), 'settings-close', covered)
    await expect(first.getByTestId('settings-popover')).toHaveCount(0)

    await clickAndCover(first.getByTestId('settings-button'), 'settings-button', covered)
    await clickAndCover(first.getByTestId('settings-dismiss-layer'), 'settings-dismiss-layer', covered)
    await expect(first.getByTestId('settings-popover')).toHaveCount(0)
  })

  let firstShellId = ''
  let textId = ''
  let inheritedShellId = ''
  let second: Page

  await test.step('real Shell, Text, cwd inheritance, line numbers and clipboard work from an empty Room', async () => {
    await clickAndCover(first.getByTestId('terminal-create-real'), 'terminal-create-real', covered)
    await expect(first.getByTestId('terminal-tab')).toHaveCount(1)
    firstShellId = await terminalIdAt(first, 0)
    const shellHost = first.getByTestId('terminal-host')
    await shellHost.click()
    covered.add('terminal-host')
    await first.keyboard.type("printf 'UI_SHELL_032\\n'")
    await first.keyboard.press('Enter')
    await expect(shellHost).toHaveAttribute('data-rendered-tail', /UI_SHELL_032/, { timeout: 15_000 })
    await first.keyboard.type('cd /tmp')
    await first.keyboard.press('Enter')
    await expect(first.locator('.terminal-meta-label')).toContainText(' · /tmp · real · running', { timeout: 15_000 })

    await clickAndCover(first.getByTestId('terminal-create-text'), 'terminal-create-text', covered)
    await expect(first.getByTestId('terminal-tab')).toHaveCount(2)
    textId = await terminalIdAt(first, 1)
    const text = Array.from({ length: 160 }, (_, index) => `offline line ${index + 1}`).join('\n')
    await first.getByTestId('text-box-editor').fill(text)
    covered.add('text-box-editor')
    await expect(first.getByTestId('text-box-line-number-list').locator(':scope > div')).toHaveCount(160)
    await first.getByTestId('text-box-editor').evaluate((element) => {
      element.scrollTop = 24
      element.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(async () => first.getByTestId('text-box-line-number-list').getAttribute('style')).toContain('translateY(-24px)')
    await clickAndCover(first.getByTestId('text-box-copy'), 'text-box-copy', covered)
    await expect.poll(async () => first.evaluate(() => navigator.clipboard.readText())).toBe(text)

    second = await context.newPage()
    second.setDefaultTimeout(12_000)
    await second.goto(first.url())
    await expect(second.getByTestId('terminal-tab')).toHaveCount(2)
    await tabById(second, textId).click()
    covered.add('terminal-tab')
    await expect(second.getByTestId('text-box-editor')).toHaveValue(text)

    await clickAndCover(first.getByTestId('terminal-create-real'), 'terminal-create-real', covered)
    await expect(first.getByTestId('terminal-tab')).toHaveCount(3)
    inheritedShellId = await terminalIdAt(first, 2)
    await expect(tabById(first, inheritedShellId)).toHaveAttribute('title', / · \/tmp · real · running$/)
    await expect(first.locator('.terminal-meta-label')).toContainText(' · /tmp · real · running')
    await expect(second.getByTestId('terminal-tab')).toHaveCount(3)
    await expect(tabById(second, textId)).toHaveAttribute('aria-selected', 'true')
    await expect(second.getByTestId('text-box-editor')).toHaveValue(text)
  })

  await test.step('observer stays useful but read-only, then explicitly takes control without losing shared state', async () => {
    await expect(second.getByTestId('take-control')).toHaveText('Read-only · Take control')
    await expect(second.getByTestId('terminal-create-real')).toBeDisabled()
    await expect(second.getByTestId('terminal-create-text')).toBeDisabled()
    await expect(tabById(second, textId).getByTestId('terminal-tab-close')).toBeDisabled()
    await expect(second.getByTestId('text-box-editor')).toHaveAttribute('readonly', '')
    await expect(second.getByTestId('text-box-copy')).toBeEnabled()

    await second.getByTestId('settings-button').click()
    await expect(second.getByTestId('settings-popover')).toBeVisible()
    await expect(second.getByTestId('tab-drag-toggle')).toBeEnabled()
    if (await second.getByTestId('tab-drag-toggle').getAttribute('aria-pressed') !== 'true') {
      await second.getByTestId('tab-drag-toggle').click()
    }
    await second.getByTestId('settings-close').click()

    second.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Take control of this Room?')
      await dialog.dismiss()
    })
    await second.getByTestId('take-control').click()
    covered.add('take-control')
    await expect(second.getByTestId('take-control')).toBeVisible()

    second.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Take control of this Room?')
      await dialog.accept()
    })
    await clickAndCover(second.getByTestId('take-control'), 'take-control', covered)
    await expect(second.getByTestId('room-control-status')).toHaveText('Control: This device')
    await expect(first.getByTestId('take-control')).toHaveText('Read-only · Take control')
    await expect(first.getByTestId('terminal-create-real')).toBeDisabled()
    await expect(first.getByTestId('notice-item')).toContainText('Control moved to another device')
    await first.getByTestId('notice-dismiss-layer').click()
    covered.add('notice-dismiss-layer')
    await tabById(first, textId).click()
    await expect(first.getByTestId('text-box-editor')).toHaveAttribute('readonly', '')
    await expect(second.getByTestId('text-box-editor')).toBeEditable()
    await second.getByTestId('text-box-editor').fill('shared after explicit takeover')
    await expect(first.getByTestId('text-box-editor')).toHaveValue('shared after explicit takeover')
  })

  await test.step('tab keyboard selection, drag reorder and close confirmation remain synchronized across two clients', async () => {
    const firstTab = tabById(second, firstShellId)
    await firstTab.focus()
    await second.keyboard.press(' ')
    covered.add('terminal-tab')
    await expect(firstTab).toHaveAttribute('aria-selected', 'true')

    await firstTab.dragTo(tabById(second, inheritedShellId))
    covered.add('terminal-tab')
    await expect.poll(async () => terminalIds(first)).toEqual([textId, inheritedShellId, firstShellId])
    await expect.poll(async () => terminalIds(second)).toEqual([textId, inheritedShellId, firstShellId])

    second.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Close terminal')
      await dialog.dismiss()
    })
    await tabById(second, inheritedShellId).getByTestId('terminal-tab-close').click()
    covered.add('terminal-tab-close')
    await expect(first.getByTestId('terminal-tab')).toHaveCount(3)

    second.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Close terminal')
      await dialog.accept()
    })
    await tabById(second, inheritedShellId).getByTestId('terminal-tab-close').click()
    covered.add('terminal-tab-close')
    await expect(first.getByTestId('terminal-tab')).toHaveCount(2)
    await expect(second.getByTestId('terminal-tab')).toHaveCount(2)
  })

  await test.step('Home navigation, automatic refresh, New Room and explicit Destroy cover the full Room lifecycle', async () => {
    const originalRoomUrl = first.url()
    const originalRoomId = new URL(originalRoomUrl).pathname.slice(1)
    const homePromise = context.waitForEvent('page')
    await clickAndCover(first.getByTestId('home-button'), 'home-button', covered)
    const openedHome = await homePromise
    openedHome.setDefaultTimeout(12_000)
    await openedHome.waitForLoadState()
    await expect(openedHome).toHaveURL(/\/$/)
    await expect(openedHome.getByTestId('room-list').locator('li')).toHaveCount(1)
    await expect(openedHome.getByRole('button', { name: 'Refresh' })).toHaveCount(0)
    await expect(openedHome.getByTestId('room-capacity')).toHaveText('1 / 32')

    const creator = await context.newPage()
    creator.setDefaultTimeout(12_000)
    await creator.goto('/')
    await expect(creator.getByTestId('room-list').locator('li')).toHaveCount(1)
    await clickAndCover(creator.getByTestId('new-room'), 'new-room', covered)
    await expect(creator).toHaveURL(ROOM_URL)
    expect(creator.url()).not.toBe(originalRoomUrl)
    await expect(openedHome.getByTestId('room-list').locator('li')).toHaveCount(2, { timeout: 3_000 })
    await expect(openedHome.getByTestId('room-capacity')).toHaveText('2 / 32')

    const originalHomeRow = openedHome.getByTestId('room-list').locator('li').filter({ hasText: originalRoomId })
    await clickAndCover(originalHomeRow.getByTestId('room-open'), 'room-open', covered)
    await expect(openedHome).toHaveURL(originalRoomUrl)
    await openedHome.close()

    const management = await context.newPage()
    management.setDefaultTimeout(12_000)
    await management.goto('/')
    await expect(management.getByTestId('room-list').locator('li')).toHaveCount(2)
    const originalRow = management.getByTestId('room-list').locator('li').filter({ hasText: originalRoomId })
    management.once('dialog', async (dialog) => dialog.dismiss())
    await originalRow.getByTestId('room-destroy').click()
    covered.add('room-destroy')
    await expect(management.getByTestId('room-list').locator('li')).toHaveCount(2)

    management.once('dialog', async (dialog) => dialog.accept())
    await originalRow.getByTestId('room-destroy').click()
    covered.add('room-destroy')
    await expect(management.getByTestId('room-list').locator('li')).toHaveCount(1)
    await expect(first).toHaveURL(/\/$/)
    await expect(second).toHaveURL(/\/$/)

    management.once('dialog', async (dialog) => dialog.accept())
    await management.getByTestId('room-destroy').click()
    covered.add('room-destroy')
    await expect(management.getByTestId('room-home-empty')).toBeVisible()
    await expect(management.getByTestId('room-capacity')).toHaveText('0 / 32')
    await clickAndCover(management.getByTestId('new-room-empty'), 'new-room-empty', covered)
    await expect(management).toHaveURL(ROOM_URL)
  })

  const missing = workspaceRuntimeControlInventory.filter(({ key }) => !covered.has(key)).map(({ key }) => key)
  expect(missing).toEqual([])
  expect(externalRequests).toEqual([])
  await context.close()
})

async function invalidateBrowserSettings(page: Page) {
  await page.evaluate(([key]) => window.localStorage.setItem(key, '{invalid'), [SETTINGS_KEY])
}

async function ensureController(page: Page, covered: Set<string>) {
  if (await page.getByTestId('room-control-status').count()) {
    await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
    return
  }
  const acceptTakeover = async (dialog: { accept(): Promise<void> }) => dialog.accept()
  page.on('dialog', acceptTakeover)
  try {
    await clickAndCover(page.getByTestId('take-control'), 'take-control', covered)
  } finally {
    page.off('dialog', acceptTakeover)
  }
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
}

async function clickAndCover(locator: Locator, key: string, covered: Set<string>) {
  await locator.click()
  covered.add(key)
}

async function terminalIdAt(page: Page, index: number): Promise<string> {
  const value = await page.getByTestId('terminal-tab').nth(index).getAttribute('data-terminal-id')
  if (!value) throw new Error(`terminal_${index}_missing_id`)
  return value
}

function tabById(page: Page, terminalId: string): Locator {
  return page.getByTestId('terminal-tab').filter({ has: page.locator(`[data-terminal-id="${terminalId}"]`) }).or(page.locator(`[data-testid="terminal-tab"][data-terminal-id="${terminalId}"]`)).first()
}

async function terminalIds(page: Page): Promise<string[]> {
  return page.getByTestId('terminal-tab').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-terminal-id') ?? ''))
}
