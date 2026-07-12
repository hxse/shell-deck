import { expect, type Page, test } from 'playwright/test'

const template = {
  schemaVersion: 2,
  id: 'workbench_template',
  name: 'Workbench Send Template',
  description: 'workbench e2e template',
  configId: 'workbench-ui-e2e',
  createdAt: '2026-07-03T00:00:00.000Z',
  updatedAt: '2026-07-03T00:00:00.000Z',
  body: [
    { id: 'send', type: 'send', terminal: { kind: 'alias', value: 'shell_1' }, message: { parts: [{ kind: 'text', text: 'workbench-run' }] }, ending: "cr" },
    { id: 'input', type: 'input', terminal: { kind: 'alias', value: 'shell_1' }, prompt: 'Workbench input', allowEmpty: false, ending: "cr" },
    { id: 'done', type: 'finish', reason: 'ok' },
  ],
}

async function expectWithinViewport(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox()
  const viewport = page.viewportSize()
  expect(box).toBeTruthy()
  expect(viewport).toBeTruthy()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1)
}

test('macro prompt workbench uses selectors, grouped controls, trace tabs and live run log', async ({ page, request }) => {
  const configId = 'workbench-ui-e2e-' + Date.now()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const imported = await request.post('/api/configs/' + configId + '/templates/import', { data: { ...template, configId } })
  expect(imported.status()).toBe(201)
  await request.post('/api/configs/' + configId + '/prompts', {
    data: { promptId: 'workbench_prompt', title: 'Workbench Prompt', body: 'Use this prompt body', tags: ['ui'] },
  })

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('macro-workbench-shell')).toBeVisible()
  await expect(page.getByTestId('macro-template-summary')).toBeVisible()
  await expect(page.getByTestId('macro-template-selector')).toBeHidden()
  await page.getByTestId('macro-template-summary').click()
  await expect(page.getByTestId('macro-template-selector')).toBeVisible()
  await expect(page.getByTestId('macro-template-item')).toContainText(['Workbench Send Template'])
  await page.getByTestId('macro-template-select').selectOption('workbench_template')
  await page.getByTestId('macro-template-search').fill('Send')
  await expect(page.getByTestId('macro-template-item')).toHaveCount(1)
  await expect(page.getByTestId('macro-template-actions')).toContainText('New')
  await expect(page.getByTestId('macro-template-actions')).toContainText('Save')
  await expect(page.getByTestId('macro-template-actions')).toContainText('Duplicate')
  await expect(page.getByTestId('macro-template-actions')).toContainText('Import')
  await expect(page.getByTestId('macro-template-actions')).toContainText('Export')
  await expect(page.getByTestId('macro-template-actions')).toContainText('Delete')
  await page.getByTestId('macro-template-summary').click()

  await expect(page.getByTestId('macro-run-controls')).toBeVisible()
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-run-controls')).toBeVisible()
  await page.getByTestId('macro-tab-editor').click()

  await expect(page.getByTestId('run-log-panel')).toHaveCount(0)
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('waiting_user_input')
  await expect(page.getByTestId('macro-run-input')).toBeVisible()
  await expect(page.getByTestId('macro-run-input')).toHaveCSS('border-top-color', 'rgb(217, 45, 32)')
  await page.getByTestId('macro-run-input-text').fill('workbench-user-input')
  await page.getByTestId('macro-run-input-submit').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed')
  await page.getByTestId('macro-tab-trace').click()
  await expect(page.getByTestId('run-log-panel')).toBeVisible()
  await expect(page.getByTestId('run-tab-log')).toBeVisible()
  await expect(page.getByTestId('run-tab-ai')).toBeVisible()
  await expect(page.getByTestId('run-log-panel')).toContainText('Trace for Workbench Send Template')
  await expect(page.getByTestId('run-list-item')).toHaveCount(1)
  await expect(page.getByTestId('run-derived-status')).toHaveText('completed')
  await expect(page.getByTestId('run-node-log').first()).toBeVisible()
  await page.getByTestId('run-tab-ai').click()
  await expect(page.getByTestId('run-ai-trace')).toContainText('terminal_text_sent')
  await expect(page.getByTestId('run-ai-trace')).toContainText('user_input_requested')
  await expect(page.getByTestId('run-ai-trace')).toContainText('artifacts/send-')
  await page.getByTestId('run-trace-copy').click()
  await expect.poll(async () => await page.evaluate(() => navigator.clipboard.readText())).toContain('terminal_text_sent')
  await page.getByTestId('run-tab-log').click()
  const runId = (await page.getByTestId('run-list-item').first().locator('span').textContent())?.trim()
  expect(runId).toBeTruthy()
  await request.post('/api/configs/' + configId + '/runs/' + runId + '/events', {
    data: { kind: 'user_override', summary: 'Live update from e2e', data: { source: 'workspaceWorkbench' } },
  })
  await expect(page.getByTestId('run-log-panel')).toContainText('Live update from e2e')
  await page.getByTestId('run-tab-ai').click()
  await expect(page.getByTestId('run-ai-trace')).toContainText('Live update from e2e')
  await expectWithinViewport(page, 'run-log-panel')
  await expectWithinViewport(page, 'run-ai-trace')

  await page.getByTestId('prompt-panel-toggle').click()
  await expect(page.getByTestId('prompt-panel')).toBeVisible()
  await expectWithinViewport(page, 'run-log-panel')
  await expectWithinViewport(page, 'run-ai-trace')
  await expect(page.getByTestId('prompt-toolbar')).toBeVisible()
  await page.getByTestId('prompt-search').fill('Workbench')
  await expect(page.getByTestId('prompt-list-item')).toHaveCount(1)
  const promptValue = await page.getByTestId('prompt-selector').locator('option').filter({ hasText: 'Workbench Prompt' }).first().getAttribute('value')
  expect(promptValue).toBeTruthy()
  await page.getByTestId('prompt-selector').selectOption(promptValue!)
  await expect(page.getByTestId('prompt-body')).toHaveValue('Use this prompt body')
  await expect(page.getByTestId('prompt-preview')).toHaveCount(0)
  await expect(page.getByTestId('prompt-actions')).toContainText('New project')
  await expect(page.getByTestId('prompt-actions')).toContainText('New global')
  await expect(page.getByTestId('prompt-actions')).toContainText('Save')
  await expect(page.getByTestId('prompt-actions')).toContainText('Copy')
  await expect(page.getByTestId('prompt-actions')).toContainText('Delete')
})
