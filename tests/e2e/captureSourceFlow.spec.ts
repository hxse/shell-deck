import { expect, test } from 'playwright/test'

const template = {
  schemaVersion: 1,
  id: 'capture_terminal_buffer_template',
  name: 'Capture Terminal Buffer',
  description: 'terminal-buffer capture e2e',
  configId: 'capture-e2e',
  createdAt: '2026-06-30T00:00:00.000Z',
  updatedAt: '2026-06-30T00:00:00.000Z',
  steps: [
    { id: 'send_ready', type: 'send_line', terminal: { kind: 'alias', value: 'terminal_1' }, text: 'capture-ready', next: 'capture_terminal' },
    { id: 'capture_terminal', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'terminal_1' }, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse_terminal' },
    { id: 'parse_terminal', type: 'parse', captureStep: 'capture_terminal', parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'capture-ready', flags: 'i', onMatch: true, onNoMatch: false }] }, next: 'branch_terminal' },
    { id: 'branch_terminal', type: 'branch', fromParseStep: 'parse_terminal', conditions: [{ signal: 'hasReadyText', op: '==', value: true, goto: 'done' }], else: 'fail' },
    { id: 'done', type: 'complete', reason: 'ok' },
    { id: 'fail', type: 'fail', reason: 'missing capture text' },
  ],
}

test('terminal-buffer capture flow records source kind, terminal id and artifact refs', async ({ page, request }) => {
  await request.post('/api/configs/capture-e2e/terminals?backend=fake')
  const imported = await request.post('/api/configs/capture-e2e/templates/import', { data: template })
  expect(imported.status()).toBe(201)

  await page.goto('/?configId=capture-e2e')
  await expect(page.getByTestId('macro-template-item')).toContainText('Capture Terminal Buffer')
  await page.getByTestId('macro-control-start').click()
  await page.waitForTimeout(150)
  await expect(page.getByTestId('macro-run-status')).toContainText('completed')

  const runsResponse = await request.get('/api/configs/capture-e2e/runs')
  const runsBody = await runsResponse.json() as { runs: Array<{ runId: string }> }
  const runId = runsBody.runs[0].runId
  const runResponse = await request.get('/api/configs/capture-e2e/runs/' + runId)
  const runBody = await runResponse.json() as { run: { replay: { events: Array<{ kind: string; data: Record<string, unknown> }> } } }
  const captureEvent = runBody.run.replay.events.find((event) => event.kind === 'capture_artifact_created')

  expect(captureEvent?.data.captureKind).toBe('terminal-buffer')
  expect(captureEvent?.data.terminalId).toMatch(/^term_/)
  expect(String(captureEvent?.data.artifactRef).startsWith('artifacts/capture-normalized-')).toBe(true)
  expect(String(captureEvent?.data.rawArtifactRef).startsWith('artifacts/capture-raw-')).toBe(true)
  expect(captureEvent?.data.normalizedArtifactRef).toBe(captureEvent?.data.artifactRef)
})
