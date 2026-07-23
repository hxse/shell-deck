import { expect, test, type APIRequestContext, type Page } from 'playwright/test'
import { BROWSER_SETTINGS_KEY, DEFAULT_BROWSER_SETTINGS } from '../../src/lib/browserSettings'
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

test('native controls use theme surfaces without structural borders and retain focus', async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(await createRoom(request))
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  await page.getByTestId('terminal-create-real').click()
  await expect(page.getByTestId('terminal-tab')).toBeVisible()
  await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-search')).toBeVisible()
  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-template-search')).toBeVisible()
  await page.getByTestId('settings-button').click()
  const themeSelect = page.getByTestId('theme-select')
  await expect(themeSelect).toBeVisible()

  for (const theme of ['business', 'night', 'light']) {
    await themeSelect.selectOption(theme, { force: true })
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expectNativeControlSurfaces(page, theme)
  }

  await themeSelect.focus()
  const focus = await themeSelect.evaluate((element) => {
    const style = getComputedStyle(element)
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
  })
  expect(focus.style).not.toBe('none')
  expect(focus.width).toBeGreaterThanOrEqual(2)
})

test('business gives enabled commands solid semantic surfaces and reserves ghost for tertiary chrome', async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(await createRoom(request))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'business')
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')

  await expectButtonVariant(page, 'settings-button', 'btn-primary')
  await expectButtonVariant(page, 'macro-panel-toggle', 'btn-secondary')
  await expectButtonVariant(page, 'library-panel-toggle', 'btn-secondary')

  await openTemplateDrawer(page)
  await expectButtonVariant(page, 'macro-template-drawer', 'btn-primary')
  await expectButtonVariant(page, 'macro-create', 'btn-primary')
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await expectButtonVariant(page, 'empty-body-add', 'btn-primary')
  await page.getByTestId('empty-body-add').click()
  await expectButtonVariant(page, 'add-flow-if', 'btn-primary')
  await expectButtonVariant(page, 'macro-insertion-cancel', 'btn-ghost')
  await page.getByTestId('add-flow-if').click()
  await expectFieldSurface(page, 'condition-source')
  await expectFieldSurface(page, 'condition-simple-text')
  const rootIf = page.locator('[data-testid="flow-block"][data-flow-body-label="Root body"] > [data-flow-node-type="if"]').first()
  const ifBranch = rootIf.getByTestId('if-branch-section').first()
  await ifBranch.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  const editPresentation = await macroPresentationMetrics(page)
  expectDepthSeparators(editPresentation)

  await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-panel')).toBeVisible()
  await expectButtonVariant(page, 'library-new', 'btn-primary')
  await expectFieldSurface(page, 'library-search')
  await expectFieldSurface(page, 'library-selector')

  const metrics = await page.evaluate(() => {
    const sample = (color: string): [number, number, number, number] => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('color_sample_context_missing')
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data] as [number, number, number, number]
    }
    const root = getComputedStyle(document.documentElement)
    const button = (testId: string) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
      if (!element) throw new Error(`solid_button_missing:${testId}`)
      const style = getComputedStyle(element)
      return { testId, background: sample(style.backgroundColor), content: sample(style.color) }
    }
    const field = (testId: string) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
      if (!element) throw new Error(`field_surface_missing:${testId}`)
      const style = getComputedStyle(element)
      return { testId, background: sample(style.backgroundColor), content: sample(style.color) }
    }
    return {
      base100: sample(root.getPropertyValue('--color-base-100')),
      base200: sample(root.getPropertyValue('--color-base-200')),
      buttons: ['settings-button', 'macro-panel-toggle', 'macro-template-drawer', 'library-new'].map(button),
      fields: ['condition-source', 'condition-simple-text', 'library-search', 'library-selector'].map(field),
    }
  })

  for (const button of metrics.buttons) {
    expect(button.background[3], `${button.testId}/opaque`).toBe(255)
    expect(rgbDistance(button.background, metrics.base100), `${button.testId}/base-100-distance`).toBeGreaterThanOrEqual(25)
    expect(rgbDistance(button.background, metrics.base200), `${button.testId}/base-200-distance`).toBeGreaterThanOrEqual(25)
    expect(contrastRatio(button.background, button.content), `${button.testId}/content-contrast`).toBeGreaterThanOrEqual(3)
  }
  for (const field of metrics.fields) {
    expect(field.background[3], `${field.testId}/fill-alpha`).toBeGreaterThanOrEqual(36)
    expect(field.background[3], `${field.testId}/fill-alpha`).toBeLessThanOrEqual(40)
    const overBase100 = composite(field.background, metrics.base100)
    const overBase200 = composite(field.background, metrics.base200)
    expect(rgbDistance(overBase100, metrics.base100), `${field.testId}/base-100-distance`).toBeGreaterThanOrEqual(30)
    expect(rgbDistance(overBase200, metrics.base200), `${field.testId}/base-200-distance`).toBeGreaterThanOrEqual(30)
    expect(contrastRatio(overBase100, field.content), `${field.testId}/content-contrast`).toBeGreaterThanOrEqual(3)
  }

  await openTemplateDrawer(page)
  await page.getByTestId('macro-name').fill('Readable saved Macro')
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await page.getByTestId('macro-cancel-edit').click()
  await expect(page.getByTestId('macro-edit')).toBeVisible()
  await page.getByTestId('macro-template-drawer').click()

  const readOnlyNotice = page.getByTestId('macro-editor-lock-notice')
  await expect(readOnlyNotice).toHaveAttribute('data-lock-reason', 'content_edit_lease_required')
  await expect(readOnlyNotice).toHaveClass(/\balert-info\b/)
  await expect(readOnlyNotice).toHaveClass(/\balert-soft\b/)
  await expect(readOnlyNotice).not.toHaveClass(/\balert-(?:warning|error)\b/)
  await expect(readOnlyNotice).toContainText('Read-only · click to Edit and acquire the content lease.')
  await expect(readOnlyNotice).toHaveAttribute('data-click-to-edit', 'true')
  await expect(readOnlyNotice).toHaveAttribute('role', 'button')
  await expect(readOnlyNotice).toHaveAttribute('tabindex', '0')
  const readOnlyPresentation = await macroPresentationMetrics(page)
  expectDepthSeparators(readOnlyPresentation)
  expect(readOnlyPresentation.nodeOpacity).toBe(editPresentation.nodeOpacity)
  expect(readOnlyPresentation.titleColor).toBe(editPresentation.titleColor)
  expect(readOnlyPresentation.fieldColor).toBe(editPresentation.fieldColor)
  expect(readOnlyPresentation.fieldBackground).toBe(editPresentation.fieldBackground)
  expect(readOnlyPresentation.fieldOpacity).toBe(editPresentation.fieldOpacity)

  await readOnlyNotice.click()
  await expect(readOnlyNotice).toHaveCount(0)
  const resumedEditPresentation = await macroPresentationMetrics(page)
  expect(resumedEditPresentation.titleColor).toBe(editPresentation.titleColor)
  expect(resumedEditPresentation.fieldColor).toBe(editPresentation.fieldColor)

  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await page.getByTestId('macro-cancel-edit').click()
  await expect(page.getByTestId('macro-edit')).toBeVisible()
  await page.getByTestId('macro-template-drawer').click()
  await expect(readOnlyNotice).toHaveAttribute('role', 'button')
  await readOnlyNotice.focus()
  await expect(readOnlyNotice).toBeFocused()
  await page.keyboard.press('Space')
  await expect(readOnlyNotice).toHaveCount(0)

  await openTemplateDrawer(page)
  const templateSelect = page.getByTestId('macro-template-select')
  const savedMacroId = await templateSelect.inputValue()
  expect(savedMacroId).not.toBe('')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete Readable saved Macro?')
    await dialog.accept()
  })
  await page.getByTestId('macro-delete').click()
  await expect(templateSelect.locator(`option[value="${savedMacroId}"]`)).toHaveCount(0)
})

async function createRoom(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/rooms')
  expect(response.status()).toBe(201)
  return (await response.json() as { url: string }).url
}

async function expectNativeControlSurfaces(page: Page, label: string): Promise<void> {
  await twoAnimationFrames(page)
  const result = await page.evaluate(() => {
    const ids = ['theme-select', 'library-search', 'macro-template-search']
    const button = document.querySelector<HTMLElement>('[data-testid="macro-template-drawer"]')
    if (!button) throw new Error('native_button_missing')
    const tab = document.querySelector<HTMLElement>('[data-testid="terminal-tab"]')
    if (!tab) throw new Error('native_tab_missing')
    return {
      controls: ids.map((id) => {
        const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
        if (!element) throw new Error(`native_control_missing:${id}`)
        const style = getComputedStyle(element)
        return {
          id,
          background: style.backgroundColor,
          border: style.borderTopColor,
          component: element.matches('input') ? element.classList.contains('input') : element.classList.contains('select'),
          ghost: element.classList.contains(element.matches('input') ? 'input-ghost' : 'select-ghost'),
          fill: element.classList.contains('bg-base-content/15'),
        }
      }),
      button: {
        background: getComputedStyle(button).backgroundColor,
        native: button.classList.contains('btn') && button.classList.contains('btn-primary') && !button.classList.contains('btn-soft'),
      },
      tab: {
        borderStyle: getComputedStyle(tab).borderTopStyle,
        native: tab.classList.contains('tab') && tab.parentElement?.classList.contains('tabs-box'),
      },
    }
  })

  for (const control of result.controls) {
    expect(control.component, `${label}/${control.id}/component`).toBe(true)
    expect(control.ghost, `${label}/${control.id}/ghost`).toBe(true)
    expect(control.fill, `${label}/${control.id}/fill`).toBe(true)
    expect(control.border, `${label}/${control.id}/border`).toBe('rgba(0, 0, 0, 0)')
    expect(control.background, `${label}/${control.id}/background`).not.toBe('rgba(0, 0, 0, 0)')
  }
  expect(result.button.native, `${label}/button/component`).toBe(true)
  expect(result.button.background, `${label}/button/background`).not.toBe('rgba(0, 0, 0, 0)')
  expect(result.tab.native, `${label}/tab/component`).toBe(true)
  expect(result.tab.borderStyle, `${label}/tab/border`).toBe('none')
}

async function expectButtonVariant(page: Page, testId: string, variant: string): Promise<void> {
  const button = page.getByTestId(testId)
  await expect(button).toBeVisible()
  await expect(button).toHaveClass(/\bbtn\b/)
  await expect(button).toHaveClass(new RegExp(`\\b${variant}\\b`))
  await expect(button).not.toHaveClass(/\bbtn-soft\b/)
}

async function expectFieldSurface(page: Page, testId: string): Promise<void> {
  const field = page.getByTestId(testId)
  await expect(field).toBeVisible()
  await expect(field).toHaveClass(/\b(?:input|select|textarea)\b/)
  await expect(field).toHaveClass(/\b(?:input|select|textarea)-ghost\b/)
  await expect(field).toHaveClass(/\bbg-base-content\/15\b/)
}

type MacroPresentationMetrics = {
  nodeOpacity: string
  titleColor: string
  fieldColor: string
  fieldBackground: string
  fieldOpacity: string
  depths: Array<{
    depth: string
    borderColor: string
    gradient: string
    separatorHeight: number
    separatorWidth: number
  }>
}

async function macroPresentationMetrics(page: Page): Promise<MacroPresentationMetrics> {
  await twoAnimationFrames(page)
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-flow-node-depth="0"], [data-flow-node-depth="1"]')]
      .filter((node, index, values) => values.findIndex((candidate) => candidate.dataset.flowNodeDepth === node.dataset.flowNodeDepth) === index)
      .sort((left, right) => Number(left.dataset.flowNodeDepth) - Number(right.dataset.flowNodeDepth))
    if (nodes.length !== 2) throw new Error(`flow_depth_nodes_missing:${nodes.length}`)
    const rootNode = nodes[0]
    const title = rootNode.querySelector<HTMLElement>('.node-title-cluster > strong')
    const field = rootNode.querySelector<HTMLElement>('[data-testid="node-id-input"]')
    if (!title || !field) throw new Error('macro_readability_target_missing')
    const nodeStyle = getComputedStyle(rootNode)
    const fieldStyle = getComputedStyle(field)
    return {
      nodeOpacity: nodeStyle.opacity,
      titleColor: getComputedStyle(title).color,
      fieldColor: fieldStyle.color,
      fieldBackground: fieldStyle.backgroundColor,
      fieldOpacity: fieldStyle.opacity,
      depths: nodes.map((node) => {
        const block = node.closest<HTMLElement>('[data-testid="flow-block"]')
        if (!block) throw new Error('flow_depth_block_missing')
        const separator = getComputedStyle(node, '::after')
        return {
          depth: node.dataset.flowNodeDepth ?? '',
          borderColor: getComputedStyle(block).borderLeftColor,
          gradient: separator.backgroundImage,
          separatorHeight: Number.parseFloat(separator.height),
          separatorWidth: Number.parseFloat(separator.width),
        }
      }),
    }
  })
}

function expectDepthSeparators(metrics: MacroPresentationMetrics): void {
  expect(metrics.nodeOpacity).toBe('1')
  expect(metrics.depths.map((depth) => depth.depth)).toEqual(['0', '1'])
  for (const depth of metrics.depths) {
    expect(depth.gradient, `depth-${depth.depth}/gradient`).toContain('linear-gradient')
    expect(depth.separatorHeight, `depth-${depth.depth}/height`).toBe(2)
    expect(depth.separatorWidth, `depth-${depth.depth}/width`).toBeGreaterThan(40)
  }
  expect(metrics.depths[0].borderColor).not.toBe(metrics.depths[1].borderColor)
  expect(metrics.depths[0].gradient).not.toBe(metrics.depths[1].gradient)
}

function rgbDistance(left: [number, number, number, number], right: [number, number, number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}

function contrastRatio(left: [number, number, number, number], right: [number, number, number, number]): number {
  const luminance = (color: [number, number, number, number]) => {
    const channels = color.slice(0, 3).map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const brighter = Math.max(luminance(left), luminance(right))
  const darker = Math.min(luminance(left), luminance(right))
  return (brighter + 0.05) / (darker + 0.05)
}

function composite(foreground: [number, number, number, number], background: [number, number, number, number]): [number, number, number, number] {
  const alpha = foreground[3] / 255
  return [
    Math.round(foreground[0] * alpha + background[0] * (1 - alpha)),
    Math.round(foreground[1] * alpha + background[1] * (1 - alpha)),
    Math.round(foreground[2] * alpha + background[2] * (1 - alpha)),
    255,
  ]
}

async function twoAnimationFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}
