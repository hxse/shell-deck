import { expect, test } from 'playwright/test'

test('workspace side panels persist layout and prompt library supports CRUD search copy and sync', async ({ browser, request }) => {
  const context = await browser.newContext()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const first = await context.newPage()
  const second = await context.newPage()

  await request.post('/api/configs/workspace-panels-e2e/terminals?backend=fake')
  await request.post('/api/configs/workspace-panels-e2e/terminals?backend=fake')
  await first.goto('/?configId=workspace-panels-e2e')
  await expect(first.getByTestId('macro-panel')).toBeVisible()
  await expect(first.getByTestId('prompt-panel')).toHaveCount(0)
  await expect(first.getByTestId('terminal-tab')).toHaveCount(2)

  await first.getByTestId('prompt-panel-toggle').click()
  await expect(first.getByTestId('prompt-panel')).toBeVisible()
  await expect(first.getByTestId('prompt-side-panel')).toBeVisible()

  const promptWidthBefore = await panelWidth(first, 'prompt-side-panel')
  const handleBox = await first.getByTestId('prompt-resize-handle').boundingBox()
  expect(handleBox).toBeTruthy()
  await first.mouse.move(handleBox!.x + 4, handleBox!.y + 20)
  await first.mouse.down()
  await first.mouse.move(handleBox!.x - 70, handleBox!.y + 20)
  await first.mouse.up()
  await expect.poll(async () => await panelWidth(first, 'prompt-side-panel')).toBeGreaterThan(promptWidthBefore + 30)

  await first.reload()
  await expect(first.getByTestId('prompt-panel')).toBeVisible()
  await expect.poll(async () => await panelWidth(first, 'prompt-side-panel')).toBeGreaterThan(promptWidthBefore + 30)
  await first.getByTestId('prompt-reset-width').click()
  await expect.poll(async () => Math.round(await panelWidth(first, 'prompt-side-panel'))).toBeGreaterThanOrEqual(360)
  await expect.poll(async () => Math.round(await panelWidth(first, 'prompt-side-panel'))).toBeLessThanOrEqual(362)

  await second.goto('/?configId=workspace-panels-e2e')
  await expect(second.getByTestId('prompt-panel')).toBeVisible()
  await first.getByTestId('macro-panel-toggle').click()
  await expect(first.getByTestId('macro-panel')).toHaveCount(0)
  await expect(second.getByTestId('macro-panel')).toHaveCount(0)
  await first.getByTestId('macro-panel-toggle').click()
  await expect(first.getByTestId('macro-panel')).toBeVisible()
  await expect(second.getByTestId('macro-panel')).toBeVisible()

  await first.getByTestId('prompt-new-project').click()
  await first.getByTestId('prompt-title').fill('Review Task Prompt')
  await first.getByTestId('prompt-tags').fill('review, task')
  await first.getByTestId('prompt-body').fill('审查当前任务，只输出 P1/P2/P3。')
  await first.getByTestId('prompt-save').click()
  await expect(first.getByTestId('prompt-list-item')).toContainText(['Review Task Prompt'])
  await expect(second.getByTestId('prompt-list-item')).toContainText(['Review Task Prompt'])

  await first.getByTestId('prompt-search').fill('P2')
  await expect(first.getByTestId('prompt-list-item')).toHaveCount(1)
  await first.getByTestId('prompt-search').fill('task')
  await expect(first.getByTestId('prompt-list-item')).toContainText(['Review Task Prompt'])
  await first.getByTestId('prompt-search').fill('')

  await selectPromptByTitle(first, 'Review Task Prompt')
  await expect(first.getByTestId('prompt-body')).toHaveValue('审查当前任务，只输出 P1/P2/P3。')
  await first.getByTestId('prompt-copy').click()
  await expect(first.getByText('Copied')).toBeVisible()
  await expect.poll(async () => await first.evaluate(() => navigator.clipboard.readText())).toContain('P1/P2/P3')

  await first.getByTestId('prompt-new-global').click()
  await first.getByTestId('prompt-title').fill('Global Fix Prompt')
  await first.getByTestId('prompt-tags').fill('fix')
  await first.getByTestId('prompt-body').fill('修复这些问题')
  await first.getByTestId('prompt-save').click()
  await first.getByTestId('prompt-scope-filter').selectOption('global')
  await expect(first.getByTestId('prompt-list-item')).toHaveCount(1)
  await expect(first.getByTestId('prompt-list-item')).toContainText(['Global Fix Prompt'])

  await selectPromptByTitle(first, 'Global Fix Prompt')
  await expect(first.getByTestId('prompt-title')).toHaveValue('Global Fix Prompt')
  await first.getByTestId('prompt-title').fill('Global Fix Prompt Updated')
  await first.getByTestId('prompt-save').click()
  await expect(first.getByTestId('prompt-list-item')).toContainText(['Global Fix Prompt Updated'])

  first.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete global prompt')
    await dialog.dismiss()
  })
  await first.getByTestId('prompt-delete').click()
  await expect(first.getByTestId('prompt-list-item')).toHaveCount(1)

  first.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete global prompt')
    await dialog.accept()
  })
  await first.getByTestId('prompt-delete').click()
  await expect(first.getByTestId('prompt-list-item')).toHaveCount(0)

  await context.close()
})

async function selectPromptByTitle(page: { getByTestId: (id: string) => any }, title: string) {
  const selector = page.getByTestId('prompt-selector')
  const value = await selector.locator('option').filter({ hasText: title }).first().getAttribute('value')
  expect(value).toBeTruthy()
  await selector.selectOption(value!)
}

async function expectWithinViewport(page: { viewportSize: () => { width: number; height: number } | null; getByTestId: (id: string) => { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null> } }, testId: string) {
  const box = await page.getByTestId(testId).boundingBox()
  const viewport = page.viewportSize()
  expect(box).toBeTruthy()
  expect(viewport).toBeTruthy()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1)
}

async function panelWidth(page: { getByTestId: (id: string) => { evaluate: <T>(callback: (element: HTMLElement) => T | Promise<T>) => Promise<T> } }, testId: string) {
  return await page.getByTestId(testId).evaluate((element) => element.getBoundingClientRect().width)
}


test('prompt panel moves saved prompts across scopes and broadcasts global prompts across configs', async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()
  const primaryConfig = 'workspace-prompt-scope-e2e'
  const otherConfig = 'workspace-prompt-scope-other-e2e'

  await request.post('/api/configs/' + primaryConfig + '/terminals?backend=fake')
  await request.post('/api/configs/' + otherConfig + '/terminals?backend=fake')
  await request.post('/api/configs/' + primaryConfig + '/prompts', {
    data: { promptId: 'move_scope_prompt', title: 'Move Scope Prompt', body: 'project only body', tags: ['move'] },
  })

  await first.goto('/?configId=' + primaryConfig)
  await second.goto('/?configId=' + otherConfig)
  await first.getByTestId('prompt-panel-toggle').click()
  await second.getByTestId('prompt-panel-toggle').click()

  await first.getByTestId('prompt-scope-filter').selectOption('project')
  await selectPromptByTitle(first, 'Move Scope Prompt')
  await first.getByTestId('prompt-edit-scope').selectOption('global')
  await first.getByTestId('prompt-body').fill('global moved body')
  await first.getByTestId('prompt-save').click()
  await expect(first.getByTestId('prompt-scope-filter')).toHaveValue('global')
  await expect(first.getByTestId('prompt-edit-scope')).toHaveValue('global')
  await expect(first.getByTestId('prompt-body')).toHaveValue('global moved body')

  await first.getByTestId('prompt-scope-filter').selectOption('project')
  await expect(first.getByTestId('prompt-list-item')).toHaveCount(0)
  await first.getByTestId('prompt-scope-filter').selectOption('global')
  await expect(first.getByTestId('prompt-list-item')).toContainText(['Move Scope Prompt'])
  await selectPromptByTitle(first, 'Move Scope Prompt')
  await expect(first.getByTestId('prompt-body')).toHaveValue('global moved body')

  await second.getByTestId('prompt-scope-filter').selectOption('global')
  await expect(second.getByTestId('prompt-list-item')).toContainText(['Move Scope Prompt'])

  await first.getByTestId('prompt-scope-filter').selectOption('all')
  await first.getByTestId('prompt-edit-scope').selectOption('project')
  await first.getByTestId('prompt-body').fill('project moved back body')
  await first.getByTestId('prompt-save').click()
  await first.getByTestId('prompt-scope-filter').selectOption('project')
  await expect(first.getByTestId('prompt-list-item')).toContainText(['Move Scope Prompt'])
  await expect(first.getByTestId('prompt-body')).toHaveValue('project moved back body')
  const movedBackResponse = await request.get('/api/configs/' + primaryConfig + '/prompts/move_scope_prompt')
  expect(movedBackResponse.ok()).toBeTruthy()
  const movedBackBody = await movedBackResponse.json() as { prompt: { scope: string; configId?: string; body: string } }
  expect(movedBackBody.prompt.scope).toBe('project')
  expect(movedBackBody.prompt.configId).toBe(primaryConfig)
  expect(movedBackBody.prompt.body).toBe('project moved back body')

  await second.getByTestId('prompt-scope-filter').selectOption('global')
  await expect(second.getByTestId('prompt-list-item')).toHaveCount(0)

  await context.close()
})

test('prompt panel refreshes selected prompt on remote update and protects dirty drafts', async ({ browser, request }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const configId = 'workspace-prompt-remote-e2e'

  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await request.post('/api/configs/' + configId + '/prompts', {
    data: { promptId: 'remote_prompt', title: 'Remote Prompt', body: 'first body', tags: ['sync'] },
  })

  await page.goto('/?configId=' + configId)
  await page.getByTestId('prompt-panel-toggle').click()
  await selectPromptByTitle(page, 'Remote Prompt')
  await expect(page.getByTestId('prompt-body')).toHaveValue('first body')

  await request.put('/api/configs/' + configId + '/prompts/remote_prompt', {
    data: { title: 'Remote Prompt', body: 'second body', tags: ['sync'] },
  })
  await expect(page.getByTestId('prompt-body')).toHaveValue('second body')

  await request.put('/api/configs/' + configId + '/prompts/remote_prompt', {
    data: { scope: 'global', title: 'Remote Prompt', body: 'global body', tags: ['sync'] },
  })
  await expect(page.getByTestId('prompt-edit-scope')).toHaveValue('global')
  await expect(page.getByTestId('prompt-body')).toHaveValue('global body')

  await page.getByTestId('prompt-body').fill('local dirty body')
  await request.put('/api/prompts/global/remote_prompt?configId=' + encodeURIComponent(configId), {
    data: { title: 'Remote Prompt', body: 'third body', tags: ['sync'] },
  })
  await expect(page.getByText('Remote prompt changes are available')).toBeVisible()
  await expect(page.getByTestId('prompt-body')).toHaveValue('local dirty body')

  await context.close()
})

test('prompt panel preserves selected scope when project and global share prompt id', async ({ browser, request }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const configId = 'workspace-prompt-same-id-e2e'

  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await request.post('/api/configs/' + configId + '/prompts', {
    data: { promptId: 'same_prompt', title: 'Same Project Prompt', body: 'project same body', tags: ['project'] },
  })
  await request.post('/api/prompts/global?configId=' + encodeURIComponent(configId), {
    data: { promptId: 'same_prompt', title: 'Same Global Prompt', body: 'global same body', tags: ['global'] },
  })

  await page.goto('/?configId=' + configId)
  await page.getByTestId('prompt-panel-toggle').click()
  await selectPromptByTitle(page, 'Same Project Prompt')
  await expect(page.getByTestId('prompt-edit-scope')).toHaveValue('project')
  await expect(page.getByTestId('prompt-body')).toHaveValue('project same body')

  await request.put('/api/prompts/global/same_prompt?configId=' + encodeURIComponent(configId), {
    data: { title: 'Same Global Prompt Updated', body: 'global same body updated', tags: ['global'] },
  })
  await expect(page.getByTestId('prompt-edit-scope')).toHaveValue('project')
  await expect(page.getByTestId('prompt-title')).toHaveValue('Same Project Prompt')
  await expect(page.getByTestId('prompt-body')).toHaveValue('project same body')

  await request.delete('/api/configs/' + configId + '/prompts/same_prompt')
  await expect(page.getByText('Select or create a prompt.')).toBeVisible()
  await expect(page.getByTestId('prompt-body')).toHaveCount(0)
  await page.getByTestId('prompt-scope-filter').selectOption('global')
  await expect(page.getByTestId('prompt-list-item')).toContainText(['Same Global Prompt Updated'])
  await expect(page.getByTestId('prompt-list-item')).not.toContainText(['Same Project Prompt'])

  await context.close()
})

test('prompt delete uses saved scope when draft scope is changed but unsaved', async ({ browser, request }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const configId = 'workspace-prompt-delete-scope-e2e'

  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await request.post('/api/configs/' + configId + '/prompts', {
    data: { promptId: 'delete_same_prompt', title: 'Delete Project Prompt', body: 'project delete body', tags: ['project'] },
  })
  await request.post('/api/prompts/global?configId=' + encodeURIComponent(configId), {
    data: { promptId: 'delete_same_prompt', title: 'Delete Global Prompt', body: 'global delete body', tags: ['global'] },
  })

  await page.goto('/?configId=' + configId)
  await page.getByTestId('prompt-panel-toggle').click()
  await selectPromptByTitle(page, 'Delete Project Prompt')
  await page.getByTestId('prompt-edit-scope').selectOption('global')
  await expect(page.getByTestId('prompt-edit-scope')).toHaveValue('global')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete project prompt')
    await dialog.accept()
  })
  await page.getByTestId('prompt-delete').click()

  await page.getByTestId('prompt-scope-filter').selectOption('project')
  await expect(page.getByTestId('prompt-list-item')).toHaveCount(0)
  await page.getByTestId('prompt-scope-filter').selectOption('global')
  await expect(page.getByTestId('prompt-list-item')).toContainText(['Delete Global Prompt'])
  await selectPromptByTitle(page, 'Delete Global Prompt')
  await expect(page.getByTestId('prompt-body')).toHaveValue('global delete body')

  await context.close()
})

test('workspace side panel widths sync, reset, and remain visible at narrow desktop width', async ({ browser, request }) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 760 } })
  const first = await context.newPage()
  const second = await context.newPage()
  const configId = 'workspace-panel-width-e2e'

  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await first.goto('/?configId=' + configId)
  await second.goto('/?configId=' + configId)
  await first.getByTestId('prompt-panel-toggle').click()
  await expect(first.getByTestId('macro-side-panel')).toBeVisible()
  await expect(first.getByTestId('prompt-side-panel')).toBeVisible()
  await expect(first.getByTestId('terminal-deck')).toBeVisible()

  const macroWidthBefore = await panelWidth(first, 'macro-side-panel')
  const handleBox = await first.getByTestId('macro-resize-handle').boundingBox()
  expect(handleBox).toBeTruthy()
  await first.mouse.move(handleBox!.x + 4, handleBox!.y + 20)
  await first.mouse.down()
  await first.mouse.move(handleBox!.x - 80, handleBox!.y + 20)
  await first.mouse.up()
  await expect.poll(async () => await panelWidth(first, 'macro-side-panel')).toBeGreaterThan(macroWidthBefore + 30)
  await expect.poll(async () => await panelWidth(second, 'macro-side-panel')).toBeGreaterThan(macroWidthBefore + 30)

  await first.getByTestId('macro-reset-width').click()
  await expect.poll(async () => Math.round(await panelWidth(first, 'macro-side-panel'))).toBeGreaterThanOrEqual(420)
  await expect.poll(async () => Math.round(await panelWidth(first, 'macro-side-panel'))).toBeLessThanOrEqual(762)
  await expect.poll(async () => Math.round(await panelWidth(second, 'macro-side-panel'))).toBeGreaterThanOrEqual(420)
  await expect.poll(async () => Math.round(await panelWidth(second, 'macro-side-panel'))).toBeLessThanOrEqual(762)
  await expect.poll(async () => Math.abs(Math.round(await panelWidth(first, 'macro-side-panel')) - Math.round(await panelWidth(second, 'macro-side-panel')))).toBeLessThanOrEqual(1)

  await first.setViewportSize({ width: 1080, height: 760 })
  await second.setViewportSize({ width: 1080, height: 760 })
  await expect.poll(async () => await panelWidth(first, 'terminal-deck')).toBeGreaterThan(230)
  await expectWithinViewport(first, 'macro-side-panel')
  await expectWithinViewport(first, 'prompt-side-panel')
  await expectWithinViewport(first, 'terminal-deck')

  await context.close()
})
