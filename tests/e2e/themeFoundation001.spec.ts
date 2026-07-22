import { expect, test, type Page } from 'playwright/test'
import { BROWSER_SETTINGS_KEY, DEFAULT_BROWSER_SETTINGS } from '../../src/lib/browserSettings'
import { THEME_PREFERENCES } from '../../src/lib/theme'

const SETTINGS_KEY = BROWSER_SETTINGS_KEY
const ROOM_URL = /\/room_[1-9A-HJ-NP-Za-km-z]{22}$/

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('saved explicit Theme is painted before a delayed application module executes', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  expect(created.status()).toBe(201)
  const room = await created.json() as { url: string }
  const settings = { ...structuredClone(DEFAULT_BROWSER_SETTINGS), theme: 'synthwave' as const }
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SETTINGS_KEY,
    value: settings,
  })

  let releaseEntryModule = () => {}
  const entryModuleGate = new Promise<void>((resolve) => { releaseEntryModule = resolve })
  let entryModuleBlocked = false
  await page.route(/\/assets\/index-[^/]+\.js(?:\?.*)?$/, async (route) => {
    entryModuleBlocked = true
    await entryModuleGate
    await route.continue()
  })

  try {
    await page.goto(room.url, { waitUntil: 'commit' })
    await expect.poll(async () => page.evaluate(() => {
      const base = getComputedStyle(document.documentElement).getPropertyValue('--color-base-100').trim()
      return document.documentElement.getAttribute('data-theme') === 'synthwave' && base.length > 0
    }).catch(() => false)).toBe(true)
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))

    const firstFrame = await page.evaluate(() => ({
      appChildren: document.getElementById('app')?.childElementCount ?? -1,
      baseColor: getComputedStyle(document.documentElement).getPropertyValue('--color-base-100').trim(),
      colorScheme: document.documentElement.getAttribute('data-theme-color-scheme'),
    }))
    const lightBaseColor = await page.evaluate(() => {
      const root = document.documentElement
      root.setAttribute('data-theme', 'light')
      const value = getComputedStyle(root).getPropertyValue('--color-base-100').trim()
      root.setAttribute('data-theme', 'synthwave')
      return value
    })

    expect(entryModuleBlocked).toBe(true)
    expect(firstFrame.appChildren).toBe(0)
    expect(firstFrame.colorScheme).toBe('dark')
    expect(firstFrame.baseColor).not.toBe(lightBaseColor)
  } finally {
    releaseEntryModule()
  }

  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'synthwave')
})

test('Theme selector applies all browser-local lifecycle contracts without Room transport', async ({ page, request }) => {
  const themeApplications: Array<{ value: string | null; appChildren: number }> = []
  await page.addInitScript(() => {
    const applications: Array<{ value: string | null; appChildren: number }> = []
    ;(window as typeof window & { __themeApplications001?: typeof applications }).__themeApplications001 = applications
    const appChildren = () => document.getElementById('app')?.childElementCount ?? -1
    const nativeSetAttribute = Element.prototype.setAttribute
    const nativeRemoveAttribute = Element.prototype.removeAttribute
    Element.prototype.setAttribute = function (name, value) {
      if (this === document.documentElement && name === 'data-theme') applications.push({ value, appChildren: appChildren() })
      return nativeSetAttribute.call(this, name, value)
    }
    Element.prototype.removeAttribute = function (name) {
      if (this === document.documentElement && name === 'data-theme') applications.push({ value: null, appChildren: appChildren() })
      return nativeRemoveAttribute.call(this, name)
    }
  })

  const nonGetRequests: string[] = []
  const sentFrames: string[] = []
  page.on('request', (event) => {
    if (event.method() !== 'GET') nonGetRequests.push(`${event.method()} ${new URL(event.url()).pathname}`)
  })
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => { sentFrames.push(String(payload)) })
  })

  const created = await request.post('/api/rooms')
  expect(created.status()).toBe(201)
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await expect(page).toHaveURL(ROOM_URL)
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
  await expect(page.locator('html')).toHaveAttribute('data-theme-color-scheme', 'light')
  await expect(page.getByRole('button', { name: /^Theme$/ })).toHaveCount(0)

  await page.getByTestId('settings-button').click()
  const select = page.getByTestId('theme-select')
  await expect(select).toBeVisible()
  expect(await select.evaluate((element) => element.tagName)).toBe('SELECT')
  await expect(select.locator('xpath=ancestor::label')).toContainText('Theme')
  expect(await select.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).toEqual(THEME_PREFERENCES)
  expect(await select.evaluate((element) => element.closest('label')?.previousElementSibling?.classList.contains('settings-popover-head'))).toBe(true)
  expect(await select.evaluate((element) => element.closest('label')?.nextElementSibling?.getAttribute('data-testid'))).toBe('tab-drag-toggle')

  const systemBase = await themeBaseColor(page)
  const systemSelectBackground = await select.evaluate((element) => getComputedStyle(element).backgroundColor)
  const transportBeforeExplicit = { requests: nonGetRequests.length, frames: sentFrames.length }
  await select.selectOption('synthwave')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'synthwave')
  await expect(page.locator('html')).toHaveAttribute('data-theme-color-scheme', 'dark')
  await expect.poll(() => themeBaseColor(page)).not.toBe(systemBase)
  await expect.poll(() => select.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(systemSelectBackground)
  await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.theme, SETTINGS_KEY)).toBe('synthwave')
  await expectLocalOnly(nonGetRequests, sentFrames, transportBeforeExplicit)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'synthwave')
  themeApplications.push(...await page.evaluate(() => (
    (window as typeof window & { __themeApplications001?: Array<{ value: string | null; appChildren: number }> }).__themeApplications001 ?? []
  )))
  expect(themeApplications.find((entry) => entry.value === 'synthwave')?.appChildren).toBe(-1)

  await page.goto('/')
  await expect(page.getByTestId('room-home')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'synthwave')
  await expect(page.getByTestId('theme-select')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /theme/i })).toHaveCount(0)

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(room.url)
  await expect(page.getByTestId('room-identity')).toContainText('connected')
  await page.getByTestId('settings-button').click()
  const transportBeforeSystem = { requests: nonGetRequests.length, frames: sentFrames.length }
  await page.getByTestId('theme-select').selectOption('system')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
  await expect(page.locator('html')).toHaveAttribute('data-theme-color-scheme', 'dark')
  await expectLocalOnly(nonGetRequests, sentFrames, transportBeforeSystem)

  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme-color-scheme', 'light')
  await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.theme, SETTINGS_KEY)).toBe('system')
})

async function themeBaseColor(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-base-100').trim())
}

async function expectLocalOnly(
  requests: string[],
  frames: string[],
  before: { requests: number; frames: number },
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(requests.slice(before.requests)).toEqual([])
  expect(frames.slice(before.frames)).toEqual([])
}
