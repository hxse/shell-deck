import { expect, test } from 'playwright/test'

const configId = 'real-shell-gui-e2e'

const terminal = { kind: 'alias', value: 'terminal_1' }

const template = {
  schemaVersion: 1,
  id: 'real_shell_gui_template',
  name: 'Real Shell GUI Template',
  description: 'real shell macro GUI smoke',
  configId,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  steps: [
    { id: 'send_real', type: 'send_line', terminal, text: "printf 'SD_REAL_MACRO_010\\n'", next: 'wait_real' },
    { id: 'wait_real', type: 'wait', mode: 'terminal-quiet', terminal, quietMs: 100, maxMs: 5000, onTimeout: 'pause', next: 'capture_real' },
    { id: 'capture_real', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse_real' },
    {
      id: 'parse_real',
      type: 'parse',
      captureStep: 'capture_real',
      parser: { kind: 'regex', rules: [{ signal: 'realShellOk', type: 'boolean-null', pattern: 'SD_REAL_MACRO_010', flags: '', onMatch: true, onNoMatch: false }] },
      next: 'branch_real',
    },
    { id: 'branch_real', type: 'branch', fromParseStep: 'parse_real', conditions: [{ signal: 'realShellOk', op: '==', value: true, goto: 'done' }], else: 'fail' },
    { id: 'done', type: 'complete', reason: 'real shell ok' },
    { id: 'fail', type: 'fail', reason: 'real shell marker missing' },
  ],
}

test('macro GUI smoke uses a real shell terminal for send capture parse and branch', async ({ page, request }) => {
  const terminalResponse = await request.post('/api/configs/' + configId + '/terminals?backend=real')
  expect(terminalResponse.ok()).toBe(true)
  const imported = await request.post('/api/configs/' + configId + '/templates/import', { data: template })
  expect(imported.status()).toBe(201)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('terminal-tab').first()).toContainText('real')
  await expect(page.getByTestId('macro-template-item')).toContainText('Real Shell GUI Template')

  await page.getByTestId('terminal-host').click()
  await page.keyboard.insertText("printf 'SD_REAL_PREP_010\\n'")
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /SD_REAL_PREP_010/, { timeout: 5000 })

  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 10000 })
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /SD_REAL_MACRO_010/)

  const runsResponse = await request.get('/api/configs/' + configId + '/runs')
  const runsBody = await runsResponse.json() as { runs: Array<{ runId: string }> }
  const runResponse = await request.get('/api/configs/' + configId + '/runs/' + runsBody.runs[0].runId)
  const runBody = await runResponse.json() as { run: { replay: { events: Array<{ kind: string; data: Record<string, unknown> }> } } }
  const events = runBody.run.replay.events
  expect(events.some((event) => event.kind === 'capture_artifact_created' && event.data.captureKind === 'terminal-buffer')).toBe(true)
  expect(events.some((event) => event.kind === 'parser_normalized' && (event.data.signals as { realShellOk?: boolean }).realShellOk === true)).toBe(true)
  expect(events.some((event) => event.kind === 'branch_decision' && event.data.selectedStepId === 'done')).toBe(true)

  await page.reload()
  await page.getByTestId('macro-tab-trace').click()
  await expect(page.getByTestId('run-list-item')).toHaveCount(1)
  await page.getByTestId('run-list-item').first().click()
  await expect(page.getByTestId('run-derived-status')).toHaveText('completed')
  const nodeCount = await page.getByTestId('run-node-log').count()
  for (let index = 0; index < nodeCount; index += 1) {
    await page.getByTestId('run-node-log').nth(index).locator('summary').click()
  }
  const panel = page.getByTestId('run-log-panel')
  for (const eventKind of ['terminal_line_sent', 'wait_started', 'capture_artifact_created', 'parser_normalized', 'branch_decision', 'run_completed']) {
    await expect(panel).toContainText(eventKind)
  }
  await expect(panel).toContainText(/artifacts\/capture-raw-/)
  await expect(panel).toContainText(/artifacts\/capture-normalized-/)
  await expect(panel).toContainText(/artifacts\/parser-regex-raw-/)
  await expect(panel).toContainText(/artifacts\/parser-normalized-/)
  await page.getByTestId('run-artifact-ref').filter({ hasText: /capture-normalized/ }).first().click()
  await expect(page.getByTestId('run-artifact-preview').first()).toContainText('SD_REAL_MACRO_010')
})
