import { expect, test, type APIRequestContext, type Locator, type Page } from 'playwright/test'

const SETTINGS_KEY = 'shell-deck:settings:v3'

type TerminalTestSnapshot = {
  instanceId: number
  colorScheme: 'light' | 'dark'
  baseY: number
  viewportY: number
  cursorX: number
  cursorY: number
  selection: string
}

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('App, Home, Room and terminal chrome retain structure and compact geometry across semantic themes', async ({ page, request }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  const roomUrl = await openNewRoom(page, request)
  await expect(page.getByTestId('workspace-shell')).toBeVisible()

  expect(await directChildFingerprint(page.getByTestId('workspace-shell'))).toEqual([
    'div:terminal-room',
    'section:macro-side-panel',
    'section:library-side-panel',
  ])
  expect(await directChildFingerprint(page.getByTestId('terminal-room'))).toEqual([
    'div:tab-strip',
    'div:terminal-stage',
  ])

  await page.getByTestId('terminal-create-text').click()
  await expect(page.getByTestId('text-box-pane')).toBeVisible()
  await expect(page.getByTestId('terminal-tab')).toHaveClass(/\btab\b/)
  await expect(page.getByTestId('text-box-copy')).toHaveClass(/\bbtn\b/)
  await expect(page.getByTestId('text-box-editor')).toHaveClass(/\btextarea\b/)

  await expectInclusiveChromeBreakpoints(page)

  await expectCompactGeometry(page, 1600)
  await page.setViewportSize({ width: 900, height: 1000 })
  await expectCompactGeometry(page, 900)
  await page.setViewportSize({ width: 720, height: 1000 })
  await expectCompactGeometry(page, 720)
  await page.setViewportSize({ width: 600, height: 1000 })
  await expect(page.getByTestId('terminal-tab')).toHaveCSS('min-width', '122px')
  await expect(page.locator('.topbar')).toHaveCSS('flex-direction', 'column')
  await expect(page.locator('.topbar .actions')).toHaveCSS('flex-wrap', 'wrap')

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).toBeVisible()
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).toHaveCount(0)
  await page.getByTestId('settings-button').click()
  const select = page.getByTestId('theme-select')
  const samples = new Map<string, string[]>()
  for (const theme of ['light', 'dark', 'synthwave', 'nord', 'cupcake']) {
    await select.selectOption(theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    samples.set(theme, await chromeColors(page))
  }
  for (let index = 0; index < 4; index += 1) {
    expect(new Set([...samples.values()].map((sample) => sample[index])).size).toBeGreaterThanOrEqual(4)
  }

  await page.goto('/')
  await expect(page.getByTestId('room-home')).toBeVisible()
  expect(await directChildFingerprint(page.getByTestId('room-home'))).toEqual([
    'header:room-home-header',
    'ul:room-list',
  ])
  await page.setViewportSize({ width: 680, height: 1000 })
  await expect(page.locator('.room-home-header')).toHaveCSS('flex-direction', 'column')
  await expect(page.getByTestId('room-home')).toHaveCSS('padding-left', '16px')
  await expect(page.getByTestId('room-open').first()).toHaveCSS('flex-direction', 'column')
  await page.setViewportSize({ width: 681, height: 1000 })
  await expect(page.locator('.room-home-header')).toHaveCSS('flex-direction', 'row')
  await expect(page.getByTestId('room-home')).toHaveCSS('padding-left', '28px')
  await expect(page.getByTestId('room-open').first()).toHaveCSS('flex-direction', 'row')
  await page.setViewportSize({ width: 1600, height: 1000 })
  const cupcakeHome = await page.getByTestId('room-home').evaluate((element) => getComputedStyle(element).backgroundColor)
  await page.evaluate((key) => {
    const settings = JSON.parse(localStorage.getItem(key) ?? 'null')
    localStorage.setItem(key, JSON.stringify({ ...settings, theme: 'light' }))
  }, SETTINGS_KEY)
  await page.reload()
  const lightHome = await page.getByTestId('room-home').evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(lightHome).not.toBe(cupcakeHome)

  await page.evaluate((key) => localStorage.setItem(key, '{invalid'), SETTINGS_KEY)
  await page.goto(roomUrl)
  await expect(page.getByTestId('notice-item')).toBeVisible()
  await expect(page.getByTestId('notice-item')).toHaveClass(/\balert\b/)
  await expect(page.getByTestId('settings-button')).toHaveClass(/\bbtn\b/)
})

test('explicit and system theme changes preserve the live scrolled xterm instance and view state', async ({ page, request }) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 1200, height: 720 })
  await openNewRoom(page, request)
  await page.getByTestId('terminal-create-real').click()
  const host = page.getByTestId('terminal-host')
  await expect(host).toBeVisible()
  await expect.poll(() => terminalTestSnapshot(host).then((state) => state.instanceId)).toBe(1)
  await expect.poll(() => terminalTestSnapshot(host).then((state) => state.colorScheme)).toBe('light')

  await host.click()
  await page.keyboard.type("for i in $(seq 1 220); do printf 'SD_THEME_LINE_%s\\n' \"$i\"; done; (sleep 5; echo SD_THEME_CONTINUED_002) &")
  await page.keyboard.press('Enter')
  await expect.poll(() => terminalState(host).then((state) => state.baseY), { timeout: 15_000 }).toBeGreaterThan(20)
  await host.hover()
  await page.mouse.wheel(0, -1600)
  await expect.poll(() => terminalState(host).then((state) => state.viewportY)).toBeLessThan(
    (await terminalState(host)).baseY,
  )

  await selectTerminalText(page, host)
  await expect.poll(() => terminalState(host).then((state) => state.selection.length)).toBeGreaterThan(0)
  const before = await terminalState(host)

  await page.getByTestId('settings-button').click()
  await page.getByTestId('theme-select').selectOption('dark')
  await expect.poll(() => terminalTestSnapshot(host).then((state) => state.colorScheme)).toBe('dark')
  expect(await terminalState(host)).toEqual(before)

  await expect(host).toHaveAttribute('data-rendered-tail', /SD_THEME_CONTINUED_002/, { timeout: 12_000 })
  const afterOutput = await terminalState(host)
  expect(afterOutput.instanceId).toBe(before.instanceId)
  expect(afterOutput.viewportY).toBe(before.viewportY)
  expect(afterOutput.selection).toBe(before.selection)

  await page.getByTestId('theme-select').selectOption('system')
  await expect.poll(() => terminalTestSnapshot(host).then((state) => state.colorScheme)).toBe('light')
  const beforeSystemChange = await terminalState(host)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => terminalTestSnapshot(host).then((state) => state.colorScheme)).toBe('dark')
  expect(await terminalState(host)).toEqual(beforeSystemChange)
})

async function openNewRoom(page: Page, request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/rooms')
  expect(response.status()).toBe(201)
  const body = await response.json() as { url: string }
  await page.goto(body.url)
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  return body.url
}

async function expectCompactGeometry(page: Page, viewportWidth: number): Promise<void> {
  const topbar = page.locator('.topbar')
  const workspace = page.getByTestId('workspace-shell')
  const stage = page.locator('.terminal-stage')
  const pane = page.getByTestId('text-box-pane')
  const sidePanel = page.getByTestId('macro-side-panel')
  const handle = page.getByTestId('macro-resize-handle')
  const tabStrip = page.locator('.tab-strip')
  const tab = page.getByTestId('terminal-tab')
  const meta = page.locator('.terminal-meta')
  const [topbarBox, workspaceBox, stageBox, paneBox, sideBox, handleBox, tabStripBox, tabBox, metaBox] = await Promise.all(
    [topbar, workspace, stage, pane, sidePanel, handle, tabStrip, tab, meta].map((locator) => locator.boundingBox()),
  )
  for (const box of [topbarBox, workspaceBox, stageBox, paneBox, sideBox, tabStripBox, tabBox, metaBox]) {
    expect(box).not.toBeNull()
  }
  expect(topbarBox!.height).toBeGreaterThanOrEqual(35)
  expect(topbarBox!.height).toBeLessThanOrEqual(40)
  expect(Math.abs(workspaceBox!.y - (topbarBox!.y + topbarBox!.height))).toBeLessThanOrEqual(1)
  expect(Math.abs((workspaceBox!.y + workspaceBox!.height) - 1000)).toBeLessThanOrEqual(1)
  if (viewportWidth > 980) {
    expect(sideBox!.width).toBeGreaterThanOrEqual(759)
    expect(sideBox!.width).toBeLessThanOrEqual(762)
    expect(handleBox!.width).toBe(6)
  } else {
    expect(handleBox).toBeNull()
    expect(Math.abs(sideBox!.width - viewportWidth * 0.85)).toBeLessThanOrEqual(1)
    expect(sideBox!.height).toBeGreaterThanOrEqual(260)
    expect(await workspace.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('column')
  }
  expect(tabStripBox!.height).toBe(40)
  expect(tabBox!.height).toBe(34)
  expect(metaBox!.height).toBe(30)
  const expectedPadding = viewportWidth <= 640 ? 8 : 12
  expect(Math.abs(paneBox!.x - (stageBox!.x + expectedPadding))).toBeLessThanOrEqual(1)
  expect(Math.abs(paneBox!.y - (stageBox!.y + expectedPadding))).toBeLessThanOrEqual(1)
  expect(await workspace.evaluate((element) => getComputedStyle(element).overflow)).toBe('hidden')
  expect(await stage.evaluate((element) => getComputedStyle(element).overflow)).toBe('hidden')
  if (viewportWidth === 720) {
    expect(await topbar.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('row')
    expect(await page.locator('.topbar .actions').evaluate((element) => getComputedStyle(element).flexWrap)).toBe('nowrap')
  }
}

async function expectInclusiveChromeBreakpoints(page: Page): Promise<void> {
  const topbar = page.locator('.topbar')
  const actions = page.locator('.topbar .actions')
  const workspace = page.getByTestId('workspace-shell')
  const stage = page.locator('.terminal-stage')
  const tab = page.getByTestId('terminal-tab')
  const terminalRoom = page.getByTestId('terminal-room')
  const macroPanel = page.getByTestId('macro-side-panel')
  const resizeHandle = page.getByTestId('macro-resize-handle')

  await page.setViewportSize({ width: 640, height: 1000 })
  await expect(topbar).toHaveCSS('flex-direction', 'column')
  await expect(actions).toHaveCSS('flex-wrap', 'wrap')
  await expect(stage).toHaveCSS('padding-left', '8px')
  await expect(tab).toHaveCSS('min-width', '122px')
  await page.setViewportSize({ width: 641, height: 1000 })
  await expect(topbar).toHaveCSS('flex-direction', 'row')
  await expect(actions).toHaveCSS('flex-wrap', 'nowrap')
  await expect(stage).toHaveCSS('padding-left', '12px')
  await expect(tab).toHaveCSS('min-width', '138px')

  await page.setViewportSize({ width: 980, height: 1000 })
  await expect(workspace).toHaveCSS('flex-direction', 'column')
  await expect(resizeHandle).toBeHidden()
  await page.setViewportSize({ width: 981, height: 1000 })
  await expect(workspace).toHaveCSS('flex-direction', 'row')
  await expect(resizeHandle).toBeVisible()

  await page.setViewportSize({ width: 1100, height: 1000 })
  await expect(terminalRoom).toHaveCSS('min-width', '240px')
  await page.setViewportSize({ width: 1101, height: 1000 })
  await expect(terminalRoom).toHaveCSS('min-width', '0px')

  await page.setViewportSize({ width: 1260, height: 1000 })
  await expect(macroPanel).toHaveCSS('min-width', '420px')
  await page.setViewportSize({ width: 1261, height: 1000 })
  await expect(macroPanel).toHaveCSS('min-width', '360px')
}

async function chromeColors(page: Page): Promise<string[]> {
  const locators = [
    page.locator('.topbar'),
    page.getByTestId('macro-side-panel'),
    page.getByTestId('text-box-pane'),
    page.getByTestId('text-box-editor'),
  ]
  return await Promise.all(locators.map((locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor)))
}

async function directChildFingerprint(locator: Locator): Promise<string[]> {
  return await locator.evaluate((element) => Array.from(element.children).map((child) => {
    const identity = child.getAttribute('data-testid') ?? [...child.classList][0] ?? ''
    return child.tagName.toLowerCase() + ':' + identity
  }))
}

async function selectTerminalText(page: Page, host: Locator): Promise<void> {
  const row = host.locator('.xterm-rows > div').nth(2)
  const box = await row.boundingBox()
  if (!box) throw new Error('xterm_row_geometry_missing')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 8, y)
  await page.mouse.down()
  await page.mouse.move(Math.min(box.x + box.width - 8, box.x + 140), y, { steps: 4 })
  await page.mouse.up()
}

async function terminalState(host: Locator) {
  const { colorScheme: _colorScheme, ...state } = await terminalTestSnapshot(host)
  return state
}

async function terminalTestSnapshot(host: Locator): Promise<TerminalTestSnapshot> {
  return await host.evaluate((element) => {
    let snapshot: TerminalTestSnapshot | null = null
    element.dispatchEvent(new CustomEvent('shell-deck-terminal-test-state-request', {
      detail: { accept: (state: TerminalTestSnapshot) => { snapshot = state } },
    }))
    if (!snapshot) throw new Error('terminal_test_bridge_unavailable')
    return snapshot
  })
}
