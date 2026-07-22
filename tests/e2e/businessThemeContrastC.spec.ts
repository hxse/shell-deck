import { expect, test, type APIRequestContext, type Page } from 'playwright/test'
import { BROWSER_SETTINGS_KEY, DEFAULT_BROWSER_SETTINGS } from '../../src/lib/browserSettings'
import { DARK_DAISY_UI_THEME_IDS } from '../../src/lib/theme'
import { openTemplateDrawer } from './macroWorkbench034.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('missing settings paint business before the delayed application module', async ({ page, request }) => {
  const roomUrl = await createRoom(request)
  let releaseEntryModule = () => {}
  const entryModuleGate = new Promise<void>((resolve) => { releaseEntryModule = resolve })
  let entryModuleBlocked = false
  await page.route(/\/assets\/index-[^/]+\.js(?:\?.*)?$/, async (route) => {
    entryModuleBlocked = true
    await entryModuleGate
    await route.continue()
  })

  try {
    await page.goto(roomUrl, { waitUntil: 'commit' })
    await expect.poll(async () => page.evaluate(() => (
      document.documentElement.getAttribute('data-theme') === 'business'
        && getComputedStyle(document.documentElement).getPropertyValue('--color-base-300').trim().length > 0
    )).catch(() => false)).toBe(true)
    await twoAnimationFrames(page)
    expect(entryModuleBlocked).toBe(true)
    expect(await page.evaluate(() => ({
      appChildren: document.getElementById('app')?.childElementCount ?? -1,
      theme: document.documentElement.getAttribute('data-theme'),
      colorScheme: document.documentElement.getAttribute('data-theme-color-scheme'),
    }))).toEqual({ appChildren: 0, theme: 'business', colorScheme: 'dark' })
  } finally {
    releaseEntryModule()
  }

  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('theme-select')).toHaveValue('business')
})

test('an existing valid system preference is not overwritten by the new default', async ({ page, request }) => {
  const settings = { ...structuredClone(DEFAULT_BROWSER_SETTINGS), theme: 'system' as const }
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: BROWSER_SETTINGS_KEY,
    value: settings,
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(await createRoom(request))
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
  await expect(page.locator('html')).toHaveAttribute('data-theme-color-scheme', 'dark')
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('theme-select')).toHaveValue('system')
})

test('all dark themes and system dark render representative boundaries at 3:1 or better', async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(await createRoom(request))
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-search')).toBeVisible()
  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-template-search')).toBeVisible()
  await page.getByTestId('settings-button').click()
  const themeSelect = page.getByTestId('theme-select')
  await expect(themeSelect).toBeVisible()

  for (const theme of DARK_DAISY_UI_THEME_IDS) {
    await themeSelect.selectOption(theme, { force: true })
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme-color-scheme', 'dark')
    await expectDarkBoundaryContrast(page, theme)
  }

  await page.emulateMedia({ colorScheme: 'dark' })
  await themeSelect.selectOption('system', { force: true })
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
  await expect(page.locator('html')).toHaveAttribute('data-theme-color-scheme', 'dark')
  await expectDarkBoundaryContrast(page, 'system-dark')

  await themeSelect.selectOption('light', { force: true })
  const explicitLight = await themeTokens(page)
  await page.emulateMedia({ colorScheme: 'light' })
  await themeSelect.selectOption('system', { force: true })
  await expect(page.locator('html')).toHaveAttribute('data-theme-color-scheme', 'light')
  expect(await themeTokens(page)).toEqual(explicitLight)
})

async function createRoom(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/rooms')
  expect(response.status()).toBe(201)
  return (await response.json() as { url: string }).url
}

async function expectDarkBoundaryContrast(page: Page, label: string): Promise<void> {
  await twoAnimationFrames(page)
  const result = await page.evaluate(() => {
    const ids = ['theme-select', 'library-search', 'macro-template-search', 'macro-panel']
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('contrast_canvas_context_missing')

    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
      return { red, green, blue, alpha: alpha / 255 }
    }
    const composite = (foreground: ReturnType<typeof rgba>, background: ReturnType<typeof rgba>) => ({
      red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
      green: foreground.green * foreground.alpha + background.green * (1 - foreground.alpha),
      blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
    })
    const luminance = (color: { red: number; green: number; blue: number }) => {
      const linear = [color.red, color.green, color.blue].map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const contrast = (border: string, background: string) => {
      const backgroundColor = rgba(background)
      const borderColor = composite(rgba(border), backgroundColor)
      const left = luminance(borderColor)
      const right = luminance(backgroundColor)
      return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
    }

    const rootStyle = getComputedStyle(document.documentElement)
    const base100 = rootStyle.getPropertyValue('--color-base-100').trim()
    return {
      depth: rootStyle.getPropertyValue('--depth').trim(),
      ratios: ids.map((id) => {
        const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
        if (!element) throw new Error(`contrast_element_missing:${id}`)
        const style = getComputedStyle(element)
        return { id, value: contrast(style.borderTopColor, base100) }
      }),
    }
  })

  expect(result.depth, label).toBe('1')
  for (const ratio of result.ratios) expect(ratio.value, `${label}/${ratio.id}`).toBeGreaterThanOrEqual(3)
}

async function themeTokens(page: Page): Promise<{ base300: string; depth: string }> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      base300: style.getPropertyValue('--color-base-300').trim(),
      depth: style.getPropertyValue('--depth').trim(),
    }
  })
}

async function twoAnimationFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}
