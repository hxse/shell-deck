import { expect, test } from 'playwright/test'

function realShellTemplate(configId: string, terminal: { kind: 'id'; value: string }) {
  return {
    schemaVersion: 2,
    id: 'real_shell_gui_template',
    name: 'Real Shell GUI Template',
    description: 'real shell GUI smoke',
    configId,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    body: [
      { id: 'send_real', type: 'send_line', terminal, message: { parts: [{ kind: 'text', text: "printf 'SD_REAL_MACRO_010\\n'" }] } },
      { id: 'wait_real', type: 'wait', mode: 'duration', durationMs: 800 },
      { id: 'capture_real', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 12000 } },
      { id: 'if_real', type: 'if', branches: [{ kind: 'if', condition: { kind: 'text_match', source: { kind: 'step_artifact', stepId: 'capture_real', artifact: 'captured_text' }, matcher: { kind: 'simple', op: 'contains', text: 'SD_REAL_MACRO_010' }, scope: { kind: 'whole' } }, body: [{ id: 'done', type: 'return', reason: 'real shell ok' }] }] },
    ],
  }
}

test('macro GUI smoke uses a real shell terminal for send capture and text_match branch', async ({ page, request }) => {
  const configId = 'real-shell-gui-e2e-' + Date.now()
  const terminalResponse = await request.post('/api/configs/' + configId + '/terminals?backend=real')
  expect(terminalResponse.ok()).toBe(true)
  const terminal = await terminalResponse.json() as { terminalId: string }
  const imported = await request.post('/api/configs/' + configId + '/templates/import', { data: realShellTemplate(configId, { kind: 'id', value: terminal.terminalId }) })
  expect(imported.status()).toBe(201)

  await page.goto('/?configId=' + configId)
  await page.getByTestId('macro-template-drawer').evaluate((element: HTMLDetailsElement) => { element.open = true })
  await expect(page.getByTestId('macro-template-item')).toContainText('Real Shell GUI Template')
  await page.getByTestId('macro-template-select').selectOption('real_shell_gui_template')
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 10000 })
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /SD_REAL_MACRO_010/)

  const runsResponse = await request.get('/api/configs/' + configId + '/runs')
  const runsBody = await runsResponse.json() as { runs: Array<{ runId: string }> }
  const runResponse = await request.get('/api/configs/' + configId + '/runs/' + runsBody.runs[0].runId)
  const runBody = await runResponse.json() as { run: { replay: { events: Array<{ kind: string; data: Record<string, unknown> }> } } }
  const events = runBody.run.replay.events
  expect(events.some((event) => event.kind === 'capture_artifact_created' && event.data.captureKind === 'terminal-buffer')).toBe(true)
  expect(events.some((event) => event.kind === 'branch_decision' && event.data.matched === true)).toBe(true)

  await page.getByTestId('macro-tab-trace').click()
  await expect(page.getByTestId('run-derived-status')).toHaveText('completed')
  await page.getByTestId('run-node-log').filter({ hasText: 'capture_real' }).locator('summary').click()
  await expect(page.getByTestId('run-log-panel')).toContainText(/artifacts\/capture-normalized-/)
})
