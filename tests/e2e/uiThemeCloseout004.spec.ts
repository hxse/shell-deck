import { expect, test, type APIRequestContext, type Page } from 'playwright/test'
import { DAISY_UI_THEME_IDS, effectiveColorScheme, type EffectiveColorScheme } from '../../src/lib/theme'
import { openTemplateDrawer } from './macroWorkbench034.helpers'

const VIEWPORT_WIDTHS = [1600, 900, 720] as const

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('all 35 explicit themes and both system appearances pass the three-viewport UI matrix', async ({ context, page, request }) => {
  test.setTimeout(240_000)
  const roomUrl = await createPopulatedRoom(page, request)
  const observer = await context.newPage()
  const home = await context.newPage()
  observer.setDefaultTimeout(12_000)
  home.setDefaultTimeout(12_000)

  await observer.goto(roomUrl)
  await expect(observer.getByTestId('take-control')).toBeVisible()
  await ensureLibraryVisible(observer)
  await observer.getByTestId('library-tab-note').click()
  const savedOption = observer.getByTestId('library-selector').locator('option', { hasText: 'Theme matrix note' })
  await expect(savedOption).toHaveCount(1)
  const savedValue = await savedOption.getAttribute('value')
  if (!savedValue) throw new Error('theme_matrix_library_item_missing')
  await observer.getByTestId('library-selector').selectOption(savedValue)
  await expect(observer.getByTestId('library-title')).toHaveAttribute('readonly', '')
  await expect(observer.getByTestId('text-box-editor')).toHaveAttribute('readonly', '')

  await openTemplateDrawer(observer)
  await observer.getByTestId('settings-button').evaluate((element) => (element as HTMLButtonElement).click())
  const themeSelect = observer.getByTestId('theme-select')
  await expect(themeSelect).toBeVisible()
  await observer.getByTestId('terminal-create-text').evaluate((element) => (element as HTMLButtonElement).click())
  const notice = observer.getByTestId('notice-item')
  await expect(notice).toBeVisible()

  await home.goto('/')
  await expect(home.getByTestId('room-home')).toBeVisible()
  await expect(home.getByTestId('room-open')).toHaveCount(1)

  const matrixCases: string[] = []
  const baseTokens = new Set<string>()
  const primaryTokens = new Set<string>()
  const surfaceBackgrounds = new Set<string>()

  for (const theme of DAISY_UI_THEME_IDS) {
    await themeSelect.selectOption(theme, { force: true })
    await expect(observer.locator('html')).toHaveAttribute('data-theme', theme)
    const scheme = effectiveColorScheme(theme, false)
    await applyThemeForMatrix(home, theme, scheme)
    for (const width of VIEWPORT_WIDTHS) {
      await setMatrixViewport(observer, home, width)
      await ensureMatrixNotice(observer)
      const roomState = await roomMatrixState(observer)
      const homeState = await homeMatrixState(home)
      expectRoomCase(roomState, width, theme)
      expectHomeCase(homeState, width, theme)
      matrixCases.push(`${theme}/${width}`)
      baseTokens.add(roomState.base100)
      primaryTokens.add(roomState.primary)
      surfaceBackgrounds.add(roomState.surfaceBackgrounds.join('|'))
    }
  }

  await themeSelect.selectOption('system', { force: true })
  await expect(observer.locator('html')).not.toHaveAttribute('data-theme')
  await home.locator('html').evaluate((element) => element.removeAttribute('data-theme'))
  for (const scheme of ['light', 'dark'] as const) {
    await Promise.all([observer.emulateMedia({ colorScheme: scheme }), home.emulateMedia({ colorScheme: scheme })])
    await expect(observer.locator('html')).toHaveAttribute('data-theme-color-scheme', scheme)
    await home.locator('html').evaluate((element, value) => element.setAttribute('data-theme-color-scheme', value), scheme)
    for (const width of VIEWPORT_WIDTHS) {
      await setMatrixViewport(observer, home, width)
      await ensureMatrixNotice(observer)
      const roomState = await roomMatrixState(observer)
      const homeState = await homeMatrixState(home)
      expectRoomCase(roomState, width, `system-${scheme}`)
      expectHomeCase(homeState, width, `system-${scheme}`)
      matrixCases.push(`system-${scheme}/${width}`)
    }
  }

  expect(matrixCases).toHaveLength(111)
  expect(new Set(matrixCases).size).toBe(111)
  expect(baseTokens.size).toBeGreaterThan(20)
  expect(primaryTokens.size).toBeGreaterThan(20)
  expect(surfaceBackgrounds.size).toBeGreaterThan(20)

  await Promise.all([observer.close(), home.close()])
})

async function createPopulatedRoom(page: Page, request: APIRequestContext): Promise<string> {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const response = await request.post('/api/rooms')
  expect(response.status()).toBe(201)
  const body = await response.json() as { url: string }
  await page.goto(body.url)
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')

  await page.getByTestId('terminal-create-text').click()
  await expect(page.getByTestId('text-box-editor')).toBeVisible()
  await page.getByTestId('text-box-editor').fill('theme matrix terminal text')
  await ensureLibraryVisible(page)
  await page.getByTestId('library-tab-note').click()
  await page.getByTestId('library-new').click()
  await page.getByTestId('library-title').fill('Theme matrix note')
  await page.getByTestId('library-content').fill('Stable populated Library state')
  await page.getByTestId('library-save').click()
  await expect(page.getByTestId('library-status')).toHaveText('Saved')
  await page.getByTestId('library-cancel').click()
  return body.url
}

async function ensureLibraryVisible(page: Page): Promise<void> {
  if (!await page.getByTestId('library-side-panel').isVisible()) await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-panel')).toBeVisible()
}

async function applyThemeForMatrix(page: Page, theme: string, scheme: EffectiveColorScheme): Promise<void> {
  await page.locator('html').evaluate((element, value) => {
    element.setAttribute('data-theme', value.theme)
    element.setAttribute('data-theme-color-scheme', value.scheme)
  }, { theme, scheme })
}

async function setMatrixViewport(room: Page, home: Page, width: number): Promise<void> {
  await Promise.all([
    room.setViewportSize({ width, height: 1000 }),
    home.setViewportSize({ width, height: 1000 }),
  ])
}

async function ensureMatrixNotice(page: Page): Promise<void> {
  await page.getByTestId('terminal-create-text').evaluate((element) => (element as HTMLButtonElement).click())
  await expect(page.getByTestId('notice-item')).toBeVisible()
}

type RoomMatrixState = Awaited<ReturnType<typeof roomMatrixState>>
type HomeMatrixState = Awaited<ReturnType<typeof homeMatrixState>>

async function roomMatrixState(page: Page) {
  return page.evaluate(() => {
    const required = (testId: string) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
      if (!element) throw new Error(`matrix_element_missing:${testId}`)
      return element
    }
    const within = (child: HTMLElement, owner: HTMLElement) => {
      const childRect = child.getBoundingClientRect()
      const ownerRect = owner.getBoundingClientRect()
      return childRect.left >= ownerRect.left - 1
        && childRect.right <= ownerRect.right + 1
        && childRect.top >= ownerRect.top - 1
        && childRect.bottom <= ownerRect.bottom + 1
    }
    const inViewport = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1
    }
    const surfaceIds = ['macro-panel', 'library-panel', 'text-box-pane', 'settings-popover', 'notice-item']
    const surfaces = surfaceIds.map((id) => getComputedStyle(required(id)))
    const disabled = required('macro-save') as HTMLButtonElement
    const readOnly = required('text-box-editor') as HTMLTextAreaElement
    const currentMacro = required('macro-tab-editor')
    const currentLibrary = required('library-tab-note')
    const currentTerminal = required('terminal-tab')
    const rootStyle = getComputedStyle(document.documentElement)
    const workspace = required('workspace-shell')
    const macroPanel = required('macro-side-panel')
    const libraryPanel = required('library-side-panel')
    const terminalRoom = required('terminal-room')
    return {
      innerWidth,
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1,
      workspaceDirection: getComputedStyle(workspace).flexDirection,
      macroVisible: !macroPanel.hidden && getComputedStyle(macroPanel).display !== 'none',
      libraryVisible: !libraryPanel.hidden && getComputedStyle(libraryPanel).display !== 'none',
      togglesPressed: [required('macro-panel-toggle'), required('library-panel-toggle')].map((element) => element.getAttribute('aria-pressed')),
      criticalOwners: {
        macro: within(required('macro-create'), required('macro-panel')),
        library: within(required('library-new'), required('library-panel')),
        terminal: within(currentTerminal, terminalRoom),
        settings: within(required('theme-select'), required('settings-popover')),
      },
      viewportPlacement: {
        settings: inViewport(required('settings-popover')),
        notice: inViewport(required('notice-item')),
        terminal: inViewport(currentTerminal),
      },
      nativeState: {
        disabled: disabled.disabled,
        disabledCursor: getComputedStyle(disabled).cursor,
        readOnly: readOnly.readOnly,
        readOnlyCursor: getComputedStyle(readOnly).cursor,
        macroCurrent: currentMacro.getAttribute('aria-selected'),
        macroCurrentBackground: getComputedStyle(currentMacro).backgroundColor,
        libraryCurrentBackground: getComputedStyle(currentLibrary).backgroundColor,
        terminalCurrent: currentTerminal.getAttribute('aria-selected'),
        terminalCurrentBackground: getComputedStyle(currentTerminal).backgroundColor,
      },
      base100: rootStyle.getPropertyValue('--color-base-100').trim(),
      baseContent: rootStyle.getPropertyValue('--color-base-content').trim(),
      primary: rootStyle.getPropertyValue('--color-primary').trim(),
      surfaceBackgrounds: surfaces.map((style) => style.backgroundColor),
      surfaceForegrounds: surfaces.map((style) => style.color),
    }
  })
}

async function homeMatrixState(page: Page) {
  return page.evaluate(() => {
    const home = document.querySelector<HTMLElement>('[data-testid="room-home"]')
    const list = document.querySelector<HTMLElement>('[data-testid="room-list"]')
    const open = document.querySelector<HTMLElement>('[data-testid="room-open"]')
    const create = document.querySelector<HTMLElement>('[data-testid="new-room"]')
    if (!home || !list || !open || !create) throw new Error('home_matrix_element_missing')
    const openRect = open.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()
    const style = getComputedStyle(home)
    return {
      innerWidth,
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1,
      openInsideList: openRect.left >= listRect.left - 1 && openRect.right <= listRect.right + 1,
      createVisible: create.getBoundingClientRect().width > 0 && create.getBoundingClientRect().height > 0,
      background: style.backgroundColor,
      foreground: style.color,
    }
  })
}

function expectRoomCase(state: RoomMatrixState, width: number, label: string): void {
  expect(state.innerWidth, label).toBe(width)
  expect(state.documentFits, label).toBe(true)
  expect(state.workspaceDirection, label).toBe(width <= 980 ? 'column' : 'row')
  expect(state.macroVisible, label).toBe(true)
  expect(state.libraryVisible, label).toBe(true)
  expect(state.togglesPressed, label).toEqual(['true', 'true'])
  expect(state.criticalOwners, label).toEqual({ macro: true, library: true, terminal: true, settings: true })
  expect(state.viewportPlacement, label).toEqual({ settings: true, notice: true, terminal: true })
  expect(state.nativeState.disabled, label).toBe(true)
  expect(state.nativeState.disabledCursor, label).toBe('not-allowed')
  expect(state.nativeState.readOnly, label).toBe(true)
  expect(state.nativeState.readOnlyCursor, label).toBe('not-allowed')
  expect(state.nativeState.macroCurrent, label).toBe('true')
  expect(state.nativeState.terminalCurrent, label).toBe('true')
  for (const color of [state.base100, state.baseContent, state.primary]) expect(color, label).not.toBe('')
  for (const color of [...state.surfaceBackgrounds, ...state.surfaceForegrounds]) expectOpaque(color, label)
  for (const color of [
    state.nativeState.macroCurrentBackground,
    state.nativeState.libraryCurrentBackground,
    state.nativeState.terminalCurrentBackground,
  ]) expectOpaque(color, label)
}

function expectHomeCase(state: HomeMatrixState, width: number, label: string): void {
  expect(state.innerWidth, label).toBe(width)
  expect(state.documentFits, label).toBe(true)
  expect(state.openInsideList, label).toBe(true)
  expect(state.createVisible, label).toBe(true)
  expectOpaque(state.background, label)
  expectOpaque(state.foreground, label)
}

function expectOpaque(color: string, label: string): void {
  expect(color, label).not.toBe('')
  expect(color, label).not.toBe('transparent')
  expect(color.replaceAll(' ', ''), label).not.toBe('rgba(0,0,0,0)')
}
