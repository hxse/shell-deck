import { expect, test, type Locator, type Page } from 'playwright/test'

import { openTemplateDrawer } from './macroWorkbench034.helpers'

const representativeThemes = ['light', 'dark', 'synthwave', 'corporate', 'wireframe'] as const

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('Macro semantic surfaces resolve across representative themes', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await expect(page.getByTestId('macro-panel')).toBeVisible()
  await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-template-search')).toBeVisible()

  const macroBackgrounds = new Set<string>()
  const primaryTokens = new Set<string>()
  for (const theme of representativeThemes) {
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const state = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const macro = getComputedStyle(document.querySelector('[data-testid="macro-panel"]')!)
      const activeTab = getComputedStyle(document.querySelector('[data-testid="macro-tab-editor"]')!)
      const disabledAction = getComputedStyle(document.querySelector('[data-testid="macro-save"]')!)
      return {
        base100: root.getPropertyValue('--color-base-100').trim(),
        baseContent: root.getPropertyValue('--color-base-content').trim(),
        primary: root.getPropertyValue('--color-primary').trim(),
        macroBackground: macro.backgroundColor,
        macroColor: macro.color,
        activeTabBackground: activeTab.backgroundColor,
        disabledCursor: disabledAction.cursor,
        disabledBackground: disabledAction.backgroundColor,
      }
    })
    expect(state.base100).not.toBe('')
    expect(state.baseContent).not.toBe('')
    expect(state.primary).not.toBe('')
    expect(state.macroBackground).not.toBe(state.macroColor)
    expect(state.activeTabBackground).not.toBe('rgba(0, 0, 0, 0)')
    expect(state.disabledCursor).toBe('not-allowed')
    expect(state.disabledBackground).not.toBe('rgba(0, 0, 0, 0)')
    macroBackgrounds.add(state.macroBackground)
    primaryTokens.add(state.primary)
  }
  expect(macroBackgrounds.size).toBeGreaterThan(1)
  expect(primaryTokens.size).toBeGreaterThan(2)
})

test('nested authoring stays compact with an inclusive 760px boundary and inside its scroll owner', async ({ page, request }) => {
  test.setTimeout(120_000)
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  const templateSelector = page.getByTestId('macro-template-selector')
  await page.setViewportSize({ width: 760, height: 1000 })
  expect(await gridColumnCount(templateSelector)).toBe(1)
  await page.setViewportSize({ width: 761, height: 1000 })
  expect(await gridColumnCount(templateSelector)).toBe(2)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()

  const root = flowBody(page, 'Root body')
  await root.getByTestId('empty-body-add').click()
  const insertionActions = page.getByTestId('macro-actions-palette').locator('.step-actions')
  await page.setViewportSize({ width: 760, height: 1000 })
  expect(await gridColumnCount(insertionActions)).toBe(2)
  await page.setViewportSize({ width: 761, height: 1000 })
  expect(await gridColumnCount(insertionActions)).toBe(3)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.getByTestId('add-flow-if').click()
  const ifNode = root.locator(':scope > [data-flow-node-type="if"]').first()
  const branch = ifNode.getByTestId('if-branch-section').first()
  await branch.getByTestId('empty-body-add').click()
  await page.getByTestId('add-flow-for').click()
  const forNode = branch.locator('[data-flow-node-type="for"]').first()
  await forNode.getByTestId('for-range-mode').selectOption('text-list')
  const forBody = flowBody(page, 'for body')
  await forBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-notify').click()
  const notify = forBody.locator(':scope > [data-flow-node-type="notify"]').first()
  await notify.getByTestId('notify-title-template-toggle').check()

  for (const suffix of ['index', 'key', 'value']) {
    const token = notify.getByTestId(`notify-title-template-insert-${suffix}`)
    await expect(token).toBeVisible()
    expect((await token.boundingBox())?.height ?? 100).toBeLessThanOrEqual(24)
  }
  await expect(notify).not.toContainText('Available:')

  for (const width of [1600, 900, 720]) {
    await page.setViewportSize({ width, height: 1000 })
    const geometry = await page.getByTestId('macro-panel').evaluate((panel) => {
      const view = panel.querySelector('[data-testid="macro-view-scroll"]') as HTMLElement
      const blocks = [...panel.querySelectorAll('[data-testid="flow-block"]')] as HTMLElement[]
      const controls = panel.querySelector('[data-testid="macro-run-controls"]') as HTMLElement
      const controlStyle = getComputedStyle(controls)
      return {
        panelFits: panel.scrollWidth <= panel.clientWidth + 1,
        viewFits: view.scrollWidth <= view.clientWidth + 1,
        overflowingBlocks: blocks
          .filter((block) => block.scrollWidth > block.clientWidth + 1)
          .map((block) => ({
            label: block.dataset.flowBodyLabel ?? '',
            clientWidth: block.clientWidth,
            scrollWidth: block.scrollWidth,
          })),
        runDisplay: controlStyle.display,
        runColumns: controlStyle.gridTemplateColumns,
        controlHeights: [...controls.querySelectorAll('button')].map((button) => button.getBoundingClientRect().height),
      }
    })
    expect(geometry.panelFits).toBe(true)
    expect(geometry.viewFits).toBe(true)
    expect(geometry.overflowingBlocks).toEqual([])
    expect(geometry.controlHeights.every((height) => height <= 28)).toBe(true)
    if (width === 720) {
      expect(geometry.runDisplay).toBe('flex')
      expect(geometry.runColumns).toBe('none')
    }
  }

  const icon = ifNode.getByTestId('node-toggle-collapse').first()
  await expect(icon).toHaveAttribute('aria-label', 'Collapse')
  const iconBox = await icon.boundingBox()
  expect(iconBox?.width).toBe(24)
  expect(iconBox?.height).toBe(24)
})

function flowBody(page: Page, label: string): Locator {
  return page.locator(`[data-testid="flow-block"][data-flow-body-label="${label}"]`)
}

async function gridColumnCount(locator: Locator): Promise<number> {
  return await locator.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
}
