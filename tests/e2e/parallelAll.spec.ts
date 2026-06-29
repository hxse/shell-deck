import { expect, test } from 'playwright/test'

const template = {
  schemaVersion: 1,
  id: 'parallel_all_e2e_template',
  name: 'Parallel All E2E',
  description: 'parallel_all e2e',
  configId: 'parallel-e2e',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  steps: [
    {
      id: 'parallel_review',
      type: 'parallel_all',
      lanes: [lane('main_lane', 'terminal_1', 'main'), lane('review_lane', 'terminal_2', 'review')],
      join: { mode: 'all_success', onLaneFail: 'pause', onTimeout: 'pause' },
      next: 'done',
    },
    { id: 'done', type: 'complete', reason: 'ok' },
  ],
}

test('parallel_all e2e runs two lanes and preserves lane events in run log', async ({ page, request }) => {
  await request.post('/api/configs/parallel-e2e/terminals?backend=fake')
  await request.post('/api/configs/parallel-e2e/terminals?backend=fake')
  const imported = await request.post('/api/configs/parallel-e2e/templates/import', { data: template })
  expect(imported.status()).toBe(201)

  await page.goto('/?configId=parallel-e2e')
  await expect(page.getByTestId('macro-template-item')).toContainText('Parallel All E2E')
  await page.getByTestId('macro-control-start').click()
  await page.waitForTimeout(250)
  await page.getByTestId('macro-run-refresh').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed')
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /ECHO:ready main/)
  await page.getByTestId('terminal-tab').nth(1).click()
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /ECHO:ready review/)

  const runsResponse = await request.get('/api/configs/parallel-e2e/runs')
  const runsBody = await runsResponse.json() as { runs: Array<{ runId: string }> }
  const runId = runsBody.runs[0].runId
  const runResponse = await request.get('/api/configs/parallel-e2e/runs/' + runId)
  const runBody = await runResponse.json() as { run: { replay: { events: Array<{ kind: string; stepId?: string; data: Record<string, unknown> }> }; nodeLogs: Array<{ nodeId: string; events: Array<{ data: Record<string, unknown> }> }> } }
  const events = runBody.run.replay.events
  expect(events.filter((event) => event.kind === 'parallel_lane_succeeded')).toHaveLength(2)
  expect(events.some((event) => event.kind === 'parallel_all_joined')).toBe(true)
  expect(events.some((event) => event.kind === 'terminal_line_sent' && event.stepId === 'parallel_review' && event.data.laneId === 'main_lane')).toBe(true)
  expect(events.some((event) => event.kind === 'parser_normalized' && event.data.laneId === 'review_lane')).toBe(true)
  const parentLog = runBody.run.nodeLogs.find((node) => node.nodeId === 'parallel_review')
  expect(parentLog?.events.some((event) => event.data.laneId === 'main_lane')).toBe(true)
  expect(parentLog?.events.some((event) => event.data.laneId === 'review_lane')).toBe(true)
})

function lane(id: string, alias: string, prefix: string) {
  const terminal = { kind: 'alias', value: alias }
  return {
    id,
    terminal,
    steps: [
      { id: 'send_' + prefix, type: 'send_line', text: 'ready ' + prefix },
      { id: 'wait_' + prefix, type: 'wait', mode: 'terminal-quiet', terminal, quietMs: 5, maxMs: 300, onTimeout: 'pause' },
      { id: 'capture_' + prefix, type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 12000 } },
      { id: 'parse_' + prefix, type: 'parse', captureStep: 'capture_' + prefix, parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready', flags: 'i', onMatch: true, onNoMatch: false }] } },
    ],
    success: { fromParseStep: 'parse_' + prefix, mode: 'all', conditions: [{ signal: 'hasReadyText', op: '==', value: true }] },
  }
}
