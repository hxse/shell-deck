import { expect, test } from 'playwright/test'

const configId = 'parser-failure-gui-e2e'

const legacyParserTemplate = {
  schemaVersion: 1,
  id: 'parser_failure_gui_template',
  name: 'Legacy Parser Failure Template',
  description: 'legacy parser action should be rejected in Flow V2',
  configId,
  createdAt: '2026-06-30T00:00:00.000Z',
  updatedAt: '2026-06-30T00:00:00.000Z',
  steps: [
    { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'shell_1' }, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse' },
    { id: 'parse', type: 'parse', captureStep: 'capture', parser: { kind: 'ai-json', profileId: 'review-routing-v1' }, next: 'done' },
    { id: 'done', type: 'complete', reason: 'old parser path' },
  ],
}

test('Flow V2 GUI rejects legacy parser action templates instead of running hidden ai-json parser', async ({ page, request }) => {
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const imported = await request.post('/api/configs/' + configId + '/templates/import', { data: legacyParserTemplate })
  expect(imported.status()).toBeGreaterThanOrEqual(400)

  await page.goto('/?configId=' + configId)
  await page.getByTestId('macro-template-summary').click()
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-summary').click()
  await expect(page.getByTestId('add-step-send')).toHaveCount(0)
  await page.getByTestId('empty-body-add').first().click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await expect(page.getByTestId('add-step-send')).toBeVisible()
  await expect(page.getByTestId('add-step-capture')).toBeVisible()
  await expect(page.getByTestId('add-step-wait')).toBeVisible()
  await expect(page.getByTestId('add-step-parallel')).toBeVisible()
  await expect(page.getByTestId('add-step-parse')).toHaveCount(0)
})
