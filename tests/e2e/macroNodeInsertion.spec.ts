import { expect, test, type Page } from 'playwright/test'

async function openTemplateDrawer(page: { getByTestId: (id: string) => any }) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) {
    await page.getByTestId('macro-template-drawer').click()
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function flowBody(page: Page, label: string) {
  return page.locator('[data-testid="flow-block"][data-flow-body-label="' + label + '"]')
}

function emptyBodyAdd(body: ReturnType<Page['locator']>) {
  return body.locator(':scope > [data-testid="empty-flow-body"] > [data-testid="empty-body-add"]')
}

async function insertAfterLast(page: { getByTestId: (id: string) => any }, testId: string) {
  const buttons = page.getByTestId('node-add-after')
  await buttons.nth(await buttons.count() - 1).click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await page.getByTestId(testId).click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
}

test('count editor persists only the explicit discriminator and rejects old imports', async ({ page, request }) => {
  const configId = 'macro-count-canonical-e2e-' + Date.now()
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await page.goto('/?configId=' + configId)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await expect(page.getByTestId('macro-template-select')).not.toHaveValue('')
  const templateId = await page.getByTestId('macro-template-select').inputValue()
  await page.getByTestId('macro-template-summary').click()

  await page.getByTestId('empty-body-add').first().click()
  await page.getByTestId('add-flow-for').click()
  const rangeMode = page.getByTestId('for-range-mode')
  await expect(rangeMode).toHaveValue('count')
  await rangeMode.selectOption('forever')
  await expect(page.getByTestId('for-range-count')).toHaveCount(0)
  await rangeMode.selectOption('count')
  await expect(page.getByTestId('for-range-count')).toHaveValue('1')
  await emptyBodyAdd(flowBody(page, 'for body').last()).click()
  await page.getByTestId('add-step-wait').click()
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"kind": "count"')
  await expect(page.getByTestId('macro-json-preview')).toContainText('"count": 1')
  await page.getByTestId('macro-tab-editor').click()

  await openTemplateDrawer(page)
  const saveResponsePromise = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/configs/' + configId + '/templates/' + templateId))
  await page.getByTestId('macro-save').click()
  expect((await saveResponsePromise).status()).toBe(200)
  const savedResponse = await request.get('/api/configs/' + configId + '/templates/' + templateId)
  expect(savedResponse.status()).toBe(200)
  const savedBody = await savedResponse.json() as { template: { body: Array<{ type: string; range?: unknown }> } }
  expect(savedBody.template.body[0]).toMatchObject({ type: 'for', range: { kind: 'count', count: 1 } })

  const rejected = await request.post('/api/configs/' + configId + '/templates/import', {
    data: {
      ...savedBody.template,
      id: 'old_count_import',
      name: 'Old Count Import',
      body: [{ id: 'old_loop', type: 'for', range: { count: 2 }, body: [] }],
    },
  })
  expect(rejected.status()).toBe(422)

  await page.reload()
  await openTemplateDrawer(page)
  const optionValues = await page.getByTestId('macro-template-select').locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
  expect(optionValues).toContain(templateId)
  expect(optionValues).not.toContain('old_count_import')
  await page.getByTestId('macro-template-select').selectOption(templateId)
  await page.getByTestId('macro-template-summary').click()
  await expect(page.getByTestId('for-range-mode')).toHaveValue('count')
  await expect(page.getByTestId('for-range-count')).toHaveValue('1')
})

test('Macro node insertion uses local anchors and floating palette', async ({ page, request }) => {
  await request.post('/api/configs/macro-node-insertion-e2e/terminals?backend=fake')
  await page.goto('/?configId=macro-node-insertion-e2e')
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-summary').click()

  await expect(page.getByTestId('macro-step-tool-rail')).toHaveCount(0)
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  await expect(page.getByTestId('macro-run-controls')).toBeVisible()
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).toBeVisible()
  await expect(page.getByTestId('macro-insertion-placement-toggle')).toHaveText('Insert: near')
  await expect(page.getByTestId('notification-volume')).toHaveValue('240')
  await expect(page.getByTestId('notification-volume')).toHaveAttribute('max', '1000')
  await expect(page.getByTestId('notification-success-sound-test')).toHaveText('Play success sound')
  await page.getByTestId('notification-success-sound-test').click()
  await page.getByTestId('settings-dismiss-layer').click()
  await expect(page.getByTestId('settings-popover')).toHaveCount(0)
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).toBeVisible()
  await page.getByTestId('settings-dismiss-layer').click()
  await expect(page.getByTestId('settings-popover')).toHaveCount(0)

  await expect(page.getByTestId('empty-body-add')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Flow V2 Body' })).toBeVisible()
  await expect(page.getByTestId('flow-block-summary')).toHaveCount(0)
  await expect(page.getByTestId('macro-step-list')).not.toContainText('Root body')
  const emptyAdd = page.getByTestId('empty-body-add').first()
  const addBox = await emptyAdd.boundingBox()
  await emptyAdd.click()
  await expect(page.getByTestId('macro-insertion-mode')).toBeVisible()
  await expect(page.getByTestId('macro-insertion-mode')).toHaveAttribute('data-placement-mode', 'anchored')
  await expect(page.getByTestId('macro-insertion-palette')).toContainText('Insert into Root body')
  const anchoredBox = await page.getByTestId('macro-insertion-palette').boundingBox()
  expect(addBox).toBeTruthy()
  expect(anchoredBox).toBeTruthy()
  const viewportForAnchor = page.viewportSize()
  expect(viewportForAnchor).toBeTruthy()
  if (addBox!.y > viewportForAnchor!.height / 2) {
    expect(anchoredBox!.y + anchoredBox!.height).toBeLessThanOrEqual(addBox!.y + 1)
  } else {
    expect(anchoredBox!.y).toBeGreaterThanOrEqual(addBox!.y + addBox!.height - 1)
  }
  expect(anchoredBox!.x).toBeGreaterThanOrEqual(0)
  expect(anchoredBox!.y).toBeGreaterThanOrEqual(0)
  expect(anchoredBox!.x + anchoredBox!.width).toBeLessThanOrEqual(viewportForAnchor!.width)
  expect(anchoredBox!.y + anchoredBox!.height).toBeLessThanOrEqual(viewportForAnchor!.height)
  expect(boxesOverlap(anchoredBox!, addBox!)).toBe(false)
  await expect(page.getByTestId('add-step-send')).toBeVisible()
  await expect(page.getByTestId('add-step-send')).toBeFocused()
  await expect(page.getByTestId('add-flow-if')).toBeVisible()
  await expect(page.getByTestId('add-flow-break')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  await expect(emptyAdd).toBeFocused()
  await expect(page.getByTestId('macro-step-list')).not.toContainText('0 nodes')

  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).toBeVisible()
  await page.getByTestId('macro-insertion-placement-toggle').click()
  await expect(page.getByTestId('macro-insertion-placement-toggle')).toHaveText('Insert: center')
  await page.getByTestId('settings-dismiss-layer').click()
  await expect(page.getByTestId('settings-popover')).toHaveCount(0)
  await emptyAdd.click()
  await expect(page.getByTestId('macro-insertion-mode')).toHaveAttribute('data-placement-mode', 'center')
  const centeredBox = await page.getByTestId('macro-insertion-palette').boundingBox()
  const viewport = page.viewportSize()
  expect(centeredBox).toBeTruthy()
  expect(viewport).toBeTruthy()
  expect(Math.abs(centeredBox!.x + centeredBox!.width / 2 - viewport!.width / 2)).toBeLessThan(24)
  expect(Math.abs(centeredBox!.y + centeredBox!.height / 2 - viewport!.height / 2)).toBeLessThan(48)
  await page.keyboard.press('Escape')
  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).toBeVisible()
  await page.getByTestId('macro-insertion-placement-toggle').click()
  await expect(page.getByTestId('macro-insertion-placement-toggle')).toHaveText('Insert: near')
  await page.getByTestId('settings-dismiss-layer').click()
  await expect(page.getByTestId('settings-popover')).toHaveCount(0)

  await page.getByTestId('empty-body-add').first().click()
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('macro-step-list')).toContainText('1. send')

  const firstNode = flowBody(page, 'Root body').first().locator(':scope > .flow-node-editor').first()
  const firstCollapse = firstNode.getByTestId('node-toggle-collapse')
  const nodeActions = firstNode.getByTestId('node-action-controls')
  await expect(nodeActions.locator('button')).toHaveCount(6)
  expect(await nodeActions.locator('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title')))).toEqual(['Collapse', 'Move up', 'Move down', 'Add before', 'Add after', 'Remove'])
  await expect(nodeActions.locator('button')).toHaveText(['', '', '', '', '', ''])
  await expect(firstNode.getByTestId('node-structural-actions')).toHaveCount(0)
  await expect(firstNode.getByTestId('node-edit-actions')).toHaveCount(0)
  await expect(firstCollapse).toHaveAttribute('title', 'Collapse')
  await expect(firstCollapse).toHaveAttribute('aria-expanded', 'true')
  await expect(firstCollapse).not.toHaveText('Collapse')
  await expect(firstNode.getByTestId('node-move-up')).toHaveAttribute('title', 'Move up')
  await expect(firstNode.getByTestId('node-move-down')).toHaveAttribute('title', 'Move down')
  await expect(firstNode.getByTestId('node-remove').locator('svg')).toHaveAttribute('viewBox', '0 0 24 24')
  await expect(firstNode.getByTestId('node-remove').locator('path')).toHaveCount(5)
  await expect(nodeActions.locator('svg')).toHaveCount(6)
  const iconGeometry = await nodeActions.locator('button').evaluateAll((buttons) => buttons.map((button) => {
    const icon = button.querySelector('svg')
    const buttonBox = button.getBoundingClientRect()
    const iconBox = icon?.getBoundingClientRect()
    const style = getComputedStyle(button)
    return {
      buttonWidth: buttonBox.width,
      buttonHeight: buttonBox.height,
      iconWidth: iconBox?.width ?? 0,
      iconHeight: iconBox?.height ?? 0,
      centerDx: iconBox ? (iconBox.left + iconBox.width / 2) - (buttonBox.left + buttonBox.width / 2) : 99,
      centerDy: iconBox ? (iconBox.top + iconBox.height / 2) - (buttonBox.top + buttonBox.height / 2) : 99,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
    }
  }))
  for (const geometry of iconGeometry) {
    expect(geometry).toMatchObject({ buttonWidth: 24, buttonHeight: 24, iconWidth: 15, iconHeight: 15, padding: ['0px', '0px', '0px', '0px'] })
    expect(Math.abs(geometry.centerDx)).toBeLessThan(0.6)
    expect(Math.abs(geometry.centerDy)).toBeLessThan(0.6)
  }
  await expect(firstNode.getByTestId('node-collapsed-badge')).toHaveCount(0)
  const expandedActionsBox = await nodeActions.boundingBox()
  await firstCollapse.click()
  await expect(firstCollapse).toHaveAttribute('title', 'Expand')
  await expect(firstCollapse).toHaveAttribute('aria-expanded', 'false')
  await expect(firstNode).toHaveClass(/collapsed/)
  await expect(firstCollapse).toHaveClass(/active/)
  await expect(firstNode.getByTestId('node-collapsed-badge')).toHaveText('Collapsed')
  await page.mouse.move(0, 0)
  const collapsedActionsBox = await nodeActions.boundingBox()
  expect(expandedActionsBox).toBeTruthy()
  expect(collapsedActionsBox).toBeTruthy()
  expect(Math.abs(collapsedActionsBox!.x - expandedActionsBox!.x)).toBeLessThan(0.6)
  expect(Math.abs(collapsedActionsBox!.y - expandedActionsBox!.y)).toBeLessThan(0.6)
  const collapsedVisual = await firstNode.evaluate((element) => {
    const card = getComputedStyle(element)
    const toolbar = element.querySelector('[data-testid="node-action-controls"]')
    const toggle = element.querySelector('[data-testid="node-toggle-collapse"]')
    const badge = element.querySelector('[data-testid="node-collapsed-badge"]')
    return {
      backgroundImage: card.backgroundImage,
      toolbarGap: toolbar ? getComputedStyle(toolbar).gap : '',
      toolbarBackground: toolbar ? getComputedStyle(toolbar).backgroundColor : '',
      toolbarBorderWidth: toolbar ? getComputedStyle(toolbar).borderTopWidth : '',
      toolbarRadius: toolbar ? getComputedStyle(toolbar).borderRadius : '',
      toggleBackground: toggle ? getComputedStyle(toggle).backgroundColor : '',
      toggleBorderColor: toggle ? getComputedStyle(toggle).borderTopColor : '',
      toggleRadius: toggle ? getComputedStyle(toggle).borderRadius : '',
      toggleColor: toggle ? getComputedStyle(toggle).color : '',
      badgeDisplay: badge ? getComputedStyle(badge).display : '',
    }
  })
  expect(collapsedVisual.backgroundImage).toContain('linear-gradient')
  expect(collapsedVisual).toMatchObject({
    toolbarGap: '4px',
    toolbarBackground: 'rgba(0, 0, 0, 0)',
    toolbarBorderWidth: '0px',
    toolbarRadius: '0px',
    toggleBackground: 'rgb(237, 246, 255)',
    toggleBorderColor: 'rgb(23, 105, 170)',
    toggleRadius: '4px',
    toggleColor: 'rgb(18, 60, 99)',
    badgeDisplay: 'flex',
  })
  await firstCollapse.click()
  await expect(firstCollapse).toHaveAttribute('title', 'Collapse')
  await expect(firstCollapse).toHaveAttribute('aria-expanded', 'true')

  await page.getByTestId('node-add-before').first().click()
  await page.getByTestId('add-step-wait').click()
  await expect(page.getByTestId('macro-step-list')).toContainText('1. wait')
  await expect(page.getByTestId('macro-step-list')).toContainText('2. send')

  await page.getByTestId('node-add-after').nth(1).click()
  await expect(page.getByTestId('macro-move-existing-palette')).toBeVisible()
  const moveOptions = await page.getByTestId('macro-move-existing-select').locator('option').allTextContents()
  expect(moveOptions.some((text) => text.includes('send'))).toBe(false)
  await page.getByTestId('macro-move-existing-select').selectOption('wait')
  await page.getByTestId('macro-move-existing').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  await expect(page.getByTestId('macro-step-list')).toContainText('1. send')
  await expect(page.getByTestId('macro-step-list')).toContainText('2. wait')

  await insertAfterLast(page, 'add-flow-if')
  await expect(page.locator('[data-testid^="node-add-inside-"]')).toHaveCount(0)
  const ifNode = flowBody(page, 'Root body').first().locator(':scope > .flow-node-editor').last()
  const ifBranch = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="if"]')
  const ifBranchActions = ifBranch.locator(':scope > [data-testid="flow-branch-title"] > [data-testid="flow-branch-actions"]')
  const ifBranchToggle = ifBranch.getByTestId('if-branch-toggle')
  await expect(ifBranchActions.locator('button')).toHaveText(['', 'Add elif', 'Add else'])
  expect(await ifBranchActions.locator('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title') ?? button.textContent))).toEqual(['Collapse', 'Add elif', 'Add else'])
  await expect(ifBranchToggle).toHaveAttribute('title', 'Collapse')
  await expect(ifBranchToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(ifBranch.getByTestId('if-branch-collapsed-badge')).toHaveCount(0)
  const ifLabelOrder = await ifBranch.locator(':scope > [data-testid="flow-branch-title"] > .flow-branch-label').evaluate((label) => Array.from(label.children).map((child) => child.tagName.toLowerCase()))
  expect(ifLabelOrder).toEqual(['strong'])
  await expect(ifBranch.getByTestId('remove-flow-elif')).toHaveCount(0)
  const [ifLabelBox, ifActionsBox] = await Promise.all([
    ifBranch.locator(':scope > [data-testid="flow-branch-title"] > .flow-branch-label > strong').boundingBox(),
    ifBranchActions.boundingBox(),
  ])
  expect(ifLabelBox).toBeTruthy()
  expect(ifActionsBox).toBeTruthy()
  expect(Math.abs(ifLabelBox!.y + ifLabelBox!.height / 2 - ifActionsBox!.y - ifActionsBox!.height / 2)).toBeLessThan(2)
  const ifBody = flowBody(page, 'if body').last()
  await emptyBodyAdd(ifBody).click()
  await expect(page.getByTestId('macro-insertion-palette')).toContainText('Insert into if body')
  await page.getByTestId('add-step-capture').click()
  await expect(ifBody).toBeVisible()
  await expect(page.getByTestId('macro-step-list')).not.toContainText('if body')
  await expect(page.getByTestId('macro-step-list')).toContainText('capture-source')
  const branchActionOffset = async () => ifBranch.evaluate((branch) => {
    const title = branch.querySelector(':scope > [data-testid="flow-branch-title"]')
    const actions = branch.querySelector(':scope > [data-testid="flow-branch-title"] > [data-testid="flow-branch-actions"]')
    const titleBox = title?.getBoundingClientRect()
    const actionBox = actions?.getBoundingClientRect()
    return titleBox && actionBox ? { x: actionBox.x - titleBox.x, y: actionBox.y - titleBox.y } : null
  })
  const expandedIfActionsOffset = await branchActionOffset()
  await ifBranchToggle.click()
  await expect(ifBranch).toHaveClass(/collapsed/)
  await expect(ifBranchToggle).toHaveAttribute('title', 'Expand')
  await expect(ifBranchToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(ifBranch.getByTestId('if-branch-collapsed-badge')).toHaveText('Collapsed')
  const collapsedIfActionsOffset = await branchActionOffset()
  expect(expandedIfActionsOffset).toBeTruthy()
  expect(collapsedIfActionsOffset).toBeTruthy()
  expect(Math.abs(collapsedIfActionsOffset!.x - expandedIfActionsOffset!.x)).toBeLessThan(0.6)
  expect(Math.abs(collapsedIfActionsOffset!.y - expandedIfActionsOffset!.y)).toBeLessThan(0.6)
  await page.mouse.move(0, 0)
  const collapsedBranchToggleStyle = await ifBranchToggle.evaluate((button) => {
    const style = getComputedStyle(button)
    return { background: style.backgroundColor, border: style.borderTopColor, color: style.color }
  })
  expect(collapsedBranchToggleStyle).toEqual({ background: 'rgb(237, 246, 255)', border: 'rgb(23, 105, 170)', color: 'rgb(18, 60, 99)' })
  await expect(ifBody).toBeHidden()
  await expect(ifBranchActions).toBeVisible()
  await ifBranchToggle.click()
  await expect(ifBody).toBeVisible()
  await expect(ifBranch.getByTestId('if-branch-collapsed-badge')).toHaveCount(0)

  await ifBranch.getByTestId('add-flow-elif').click()
  const elifBranches = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="elif"]')
  await expect(elifBranches).toHaveCount(1)
  const elifActions = elifBranches.first().locator(':scope > [data-testid="flow-branch-title"] > [data-testid="flow-branch-actions"] button')
  await expect(elifActions).toHaveText(['', 'Add elif', 'Add else', ''])
  await expect(elifBranches.first().getByTestId('remove-flow-elif')).toHaveAttribute('title', 'Remove')
  await expect(elifBranches.first().getByTestId('remove-flow-elif').locator('svg')).toHaveCount(1)
  await elifBranches.first().getByTestId('add-flow-elif').click()
  await expect(elifBranches).toHaveCount(2)
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Remove elif branch')
    await dialog.accept()
  })
  await elifBranches.last().getByTestId('remove-flow-elif').click()
  await expect(elifBranches).toHaveCount(1)
  await emptyBodyAdd(flowBody(page, 'elif body').last()).click()
  await page.getByTestId('add-flow-finish').click()
  const elifBody = flowBody(page, 'elif body').last()
  const elifToggle = elifBranches.first().getByTestId('if-branch-toggle')
  await expect(elifBody).toBeVisible()
  await expect(page.getByTestId('macro-step-list')).not.toContainText('elif body')
  await elifToggle.click()
  await expect(elifBranches.first()).toHaveClass(/collapsed/)
  await expect(elifToggle).toHaveAttribute('title', 'Expand')
  await expect(elifBranches.first().getByTestId('if-branch-collapsed-badge')).toHaveText('Collapsed')
  await expect(elifBody).toBeHidden()
  await expect(elifBranches.first().getByTestId('flow-branch-actions')).toBeVisible()
  await expect(ifBody).toBeVisible()
  await elifToggle.click()
  await expect(elifBody).toBeVisible()

  await expect(ifNode.getByTestId('add-flow-else')).toHaveCount(2)
  await elifBranches.first().getByTestId('add-flow-else').click()
  await expect(ifNode.getByTestId('add-flow-else')).toHaveCount(0)
  let elseBranch = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="else"]')
  await expect(elseBranch.locator(':scope > [data-testid="flow-branch-title"] > [data-testid="flow-branch-actions"] button')).toHaveText(['', ''])
  await expect(elseBranch.getByTestId('remove-flow-else')).toHaveAttribute('title', 'Remove')
  await expect(elseBranch.getByTestId('remove-flow-else').locator('svg')).toHaveCount(1)
  await expect(elseBranch.getByTestId('add-flow-elif')).toHaveCount(0)
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Remove else branch')
    await dialog.accept()
  })
  await elseBranch.getByTestId('remove-flow-else').click()
  await expect(elseBranch).toHaveCount(0)
  await expect(ifNode.getByTestId('add-flow-else')).toHaveCount(2)
  await elifBranches.first().getByTestId('add-flow-else').click()
  await expect(ifNode.getByTestId('add-flow-else')).toHaveCount(0)
  elseBranch = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="else"]')
  await expect(elseBranch).toHaveCount(1)
  await emptyBodyAdd(flowBody(page, 'else body').last()).click()
  await page.getByTestId('add-step-input').click()
  const elseBody = flowBody(page, 'else body').last()
  const elseToggle = elseBranch.getByTestId('if-branch-toggle')
  await expect(elseBody).toBeVisible()
  await expect(page.getByTestId('macro-step-list')).not.toContainText('else body')
  await expect(page.getByTestId('if-branch-section')).toHaveCount(3)
  await expect(ifNode.getByTestId('if-branch-toggle')).toHaveCount(3)
  await elseToggle.click()
  await expect(elseBranch).toHaveClass(/collapsed/)
  await expect(elseToggle).toHaveAttribute('title', 'Expand')
  await expect(elseToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(elseBranch.getByTestId('if-branch-collapsed-badge')).toHaveText('Collapsed')
  await expect(elseBody).toBeHidden()
  await expect(elseBranch.getByTestId('remove-flow-else')).toBeVisible()
  await expect(ifBody).toBeVisible()
  await expect(elifBody).toBeVisible()
  await elseToggle.click()
  await expect(elseBody).toBeVisible()
  const branchSectionChrome = await page.getByTestId('if-branch-section').first().evaluate((element) => {
    const style = getComputedStyle(element)
    const label = element.querySelector(':scope > .step-title .flow-branch-label > strong')
    const labelStyle = label ? getComputedStyle(label) : null
    return {
      borderLeftWidth: style.borderLeftWidth,
      paddingLeft: style.paddingLeft,
      marginLeft: style.marginLeft,
      backgroundColor: style.backgroundColor,
      labelTransform: labelStyle?.textTransform ?? '',
      labelBackgroundColor: labelStyle?.backgroundColor ?? '',
    }
  })
  expect(branchSectionChrome).toEqual({
    borderLeftWidth: '0px',
    paddingLeft: '0px',
    marginLeft: '0px',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    labelTransform: 'uppercase',
    labelBackgroundColor: 'rgb(238, 242, 246)',
  })

  const rootBody = flowBody(page, 'Root body').first()
  await rootBody.locator(':scope > .flow-node-editor > .step-title [data-testid="node-add-after"]').last().click()
  await page.getByTestId('add-flow-for').click()
  const forBody = flowBody(page, 'for body').last()
  await emptyBodyAdd(forBody).click()
  await expect(page.getByTestId('add-flow-break')).toBeVisible()
  await expect(page.getByTestId('add-flow-continue')).toBeVisible()
  await page.getByTestId('add-flow-break').click()
  await forBody.locator(':scope > .flow-node-editor').last().getByTestId('node-add-after').click()
  await page.getByTestId('add-flow-continue').click()
  await expect(page.getByTestId('macro-step-list')).toContainText('break')
  await expect(page.getByTestId('macro-step-list')).toContainText('continue')
  const [ifGuideX, forGuideX] = await Promise.all([
    ifBody.evaluate((element) => element.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(element, '::before').left)),
    forBody.evaluate((element) => element.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(element, '::before').left)),
  ])
  expect(Math.abs(ifGuideX - forGuideX)).toBeLessThan(0.5)
  await page.getByTestId('for-range-mode').first().selectOption('forever')
  await expect(page.getByTestId('for-range-count')).toHaveCount(0)
  await emptyBodyAdd(flowBody(page, 'continue action body').last()).click()
  await expect(page.getByTestId('macro-actions-palette')).toBeVisible()
  await expect(page.getByTestId('macro-flow-palette')).toHaveCount(0)
  await page.getByTestId('add-step-send').click()
  await expect(flowBody(page, 'continue action body').last().locator(':scope > .flow-node-editor')).toHaveCount(1)
  await expect(page.getByTestId('macro-step-list')).not.toContainText('continue action body')

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    await dialog.dismiss()
  })
  await page.getByTestId('node-remove').first().click()
  await expect(page.getByTestId('macro-step-list')).toContainText('1. send')

  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"branches"')
  await expect(page.getByTestId('macro-json-preview')).toContainText('"else"')
  await expect(page.getByTestId('macro-json-preview')).toContainText('"break"')
  await expect(page.getByTestId('macro-json-preview')).toContainText('"continue"')
})

test('empty imported finish action body inserts action from empty body affordance', async ({ page, request }) => {
  const configId = 'macro-control-empty-e2e-' + Date.now()
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const imported = await request.post('/api/configs/' + configId + '/templates/import', {
    data: {
      schemaVersion: 2,
      id: 'control_empty_template',
      name: 'Control Empty Body',
      description: '',
      configId,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
      body: [
        { id: 'seed_send', type: 'send', terminal: { kind: 'alias', value: 'shell_1' }, message: { parts: [{ kind: 'text', text: 'seed' }] }, delivery: "direct", ending: "cr" },
        { id: 'done_move', type: 'finish', reason: 'move' },
        { id: 'done_insert', type: 'finish', reason: 'insert' },
      ],
    },
  })
  expect(imported.status()).toBe(201)

  await page.goto('/?configId=' + configId)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-template-select').selectOption('control_empty_template')
  await page.getByTestId('macro-template-summary').click()

  const finishBodies = flowBody(page, 'finish action body')
  await expect(finishBodies).toHaveCount(2)
  await expect(page.getByTestId('macro-step-list')).not.toContainText('finish action body')
  await emptyBodyAdd(finishBodies.nth(0)).click()
  await expect(page.getByTestId('macro-insertion-palette')).toContainText('Insert into finish action body')
  await expect(page.getByTestId('macro-move-existing-select').locator('option')).toContainText(['seed_send'])
  await page.getByTestId('macro-move-existing-select').selectOption('seed_send')
  await page.getByTestId('macro-move-existing').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  await emptyBodyAdd(finishBodies.nth(1)).click()
  await expect(page.getByTestId('macro-insertion-palette')).toContainText('Insert into finish action body')
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  await expect(page.getByTestId('macro-step-list')).toContainText('send')
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"type": "send"')
})
