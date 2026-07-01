import { expect, test } from 'playwright/test'

const configId = 'parser-failure-gui-e2e'
const terminal = { kind: 'alias', value: 'terminal_1' }

const template = {
  schemaVersion: 1,
  id: 'parser_failure_gui_template',
  name: 'Parser Failure GUI',
  description: 'GUI parser failure evidence smoke',
  configId,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  steps: [
    { id: 'send_ready', type: 'send_line', terminal, text: 'parser failure ready', next: 'capture' },
    { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse' },
    { id: 'parse', type: 'parse', captureStep: 'capture', parser: { kind: 'ai-json', profileId: 'review-routing-v1' }, next: 'branch' },
    { id: 'branch', type: 'branch', fromParseStep: 'parse', conditions: [{ signal: 'hasAiFixable', op: '==', value: true, goto: 'done' }], else: 'fail' },
    { id: 'done', type: 'complete', reason: 'should not complete' },
    { id: 'fail', type: 'fail', reason: 'should not branch after parser failure' },
  ],
}

test('parser failure pauses from GUI and leaves node log evidence', async ({ page, request }) => {
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const imported = await request.post('/api/configs/' + configId + '/templates/import', { data: template })
  expect(imported.status()).toBe(201)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('macro-template-item')).toContainText('Parser Failure GUI')
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('paused', { timeout: 10000 })
  await expect(page.getByTestId('macro-run-status')).toContainText('ai_json_adapter_not_configured')

  await page.reload()
  await expect(page.getByTestId('run-list-item')).toHaveCount(1)
  await page.getByTestId('run-list-item').first().click()
  await expect(page.getByTestId('run-derived-status')).toHaveText('paused')

  const nodeCount = await page.getByTestId('run-node-log').count()
  for (let index = 0; index < nodeCount; index += 1) {
    await page.getByTestId('run-node-log').nth(index).locator('summary').click()
  }
  const panel = page.getByTestId('run-log-panel')
  await expect(panel).toContainText('capture_artifact_created')
  await expect(panel).toContainText('run_paused')
  await expect(panel).toContainText('ai_json_adapter_not_configured')
  await expect(panel).toContainText(/artifacts\/capture-raw-/)
  await expect(panel).toContainText(/artifacts\/capture-normalized-/)

  await page.getByTestId('run-artifact-ref').filter({ hasText: /capture-normalized/ }).first().click()
  await expect(page.getByTestId('run-artifact-preview').first()).toContainText('parser failure ready')
})
