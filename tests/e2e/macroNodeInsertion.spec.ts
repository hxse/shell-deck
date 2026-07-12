import { expect, test } from 'playwright/test'

async function openTemplateDrawer(page: { getByTestId: (id: string) => any }) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) {
    await page.getByTestId('macro-template-drawer').click()
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
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
  await page.getByTestId('node-add-inside-for').click()
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
  await expect(page.getByTestId('macro-step-list')).toContainText('0 nodes')

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

  await page.getByTestId('node-toggle-collapse').first().click()
  await expect(page.getByTestId('node-toggle-collapse').first()).toHaveText('Expand')
  await page.getByTestId('node-toggle-collapse').first().click()
  await expect(page.getByTestId('node-toggle-collapse').first()).toHaveText('Collapse')

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
  await page.getByTestId('node-add-inside-if').click()
  await expect(page.getByTestId('macro-insertion-palette')).toContainText('Insert inside if')
  await page.getByTestId('add-step-capture').click()
  await expect(page.getByTestId('flow-block-summary').filter({ hasText: 'if body' })).toBeVisible()
  await expect(page.getByTestId('macro-step-list')).toContainText('capture-source')

  await page.getByTestId('add-flow-elif').click()
  await page.getByTestId('node-add-inside-elif').click()
  await page.getByTestId('add-flow-finish').click()
  await expect(page.getByTestId('macro-step-list')).toContainText('elif body')

  await page.getByTestId('add-flow-else').click()
  await page.getByTestId('node-add-inside-else').click()
  await page.getByTestId('add-step-input').click()
  await expect(page.getByTestId('macro-step-list')).toContainText('else body')

  await insertAfterLast(page, 'add-flow-for')
  await page.getByTestId('node-add-inside-for').click()
  await expect(page.getByTestId('add-flow-break')).toBeVisible()
  await expect(page.getByTestId('add-flow-continue')).toBeVisible()
  await page.getByTestId('add-flow-break').click()
  await page.getByTestId('node-add-inside-for').click()
  await page.getByTestId('add-flow-continue').click()
  await expect(page.getByTestId('macro-step-list')).toContainText('break')
  await expect(page.getByTestId('macro-step-list')).toContainText('continue')
  await page.getByTestId('for-range-mode').first().selectOption('forever')
  await expect(page.getByTestId('for-range-count')).toHaveCount(0)
  await page.getByTestId('node-add-inside-control').last().click()
  await expect(page.getByTestId('macro-actions-palette')).toBeVisible()
  await expect(page.getByTestId('macro-flow-palette')).toHaveCount(0)
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('macro-step-list')).toContainText('continue action body')

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
        { id: 'seed_send', type: 'send', terminal: { kind: 'alias', value: 'shell_1' }, message: { parts: [{ kind: 'text', text: 'seed' }] }, ending: "cr" },
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
  await expect(page.getByTestId('macro-step-list')).toContainText('finish action body')

  await page.getByTestId('empty-body-add').first().click()
  await expect(page.getByTestId('macro-insertion-palette')).toContainText('Insert into finish action body')
  await expect(page.getByTestId('macro-move-existing-select').locator('option')).toContainText(['seed_send'])
  await page.getByTestId('macro-move-existing-select').selectOption('seed_send')
  await page.getByTestId('macro-move-existing').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  await page.getByTestId('empty-body-add').last().click()
  await expect(page.getByTestId('macro-insertion-palette')).toContainText('Insert into finish action body')
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  await expect(page.getByTestId('macro-step-list')).toContainText('send')
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"type": "send"')
})
