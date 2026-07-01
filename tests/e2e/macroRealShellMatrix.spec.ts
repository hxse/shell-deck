import { expect, type APIRequestContext, type Page, test } from 'playwright/test'

type DeckSnapshot = {
  terminals: Array<{ terminalId: string; terminalAlias?: string; replay: string[] }>
  indexMap: Array<{ index: number; terminalId: string; terminalAlias?: string }>
}

async function createRealTerminals(request: APIRequestContext, configId: string, count: number) {
  for (let index = 0; index < count; index += 1) {
    const response = await request.post('/api/configs/' + configId + '/terminals?backend=real')
    expect(response.ok()).toBe(true)
  }
  return await snapshot(request, configId)
}

async function snapshot(request: APIRequestContext, configId: string): Promise<DeckSnapshot> {
  const response = await request.get('/api/configs/' + configId + '/snapshot')
  expect(response.ok()).toBe(true)
  return await response.json() as DeckSnapshot
}

async function importTemplate(request: APIRequestContext, configId: string, template: Record<string, unknown>) {
  const response = await request.post('/api/configs/' + configId + '/templates/import', { data: template })
  expect(response.status()).toBe(201)
}

async function startTemplate(page: Page, name: RegExp | string) {
  await page.getByRole('button', { name }).click()
  await page.getByTestId('macro-control-start').click()
}

async function expectTerminalReplay(page: Page, terminalId: string, marker: RegExp) {
  await page.locator('[data-testid="terminal-tab"][data-terminal-id="' + terminalId + '"]').click()
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', marker)
}

function baseTemplate(configId: string, id: string, name: string, steps: unknown[]) {
  return {
    schemaVersion: 1,
    id,
    name,
    description: name,
    configId,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    steps,
  }
}

function printf(marker: string) {
  return "printf '" + marker + "\\n'"
}

test('real shell macro targets index id and renamed alias after tab reorder', async ({ page, request }) => {
  const configId = 'real-target-matrix-e2e'
  const initial = await createRealTerminals(request, configId, 3)
  const firstId = initial.terminals[0].terminalId
  const secondId = initial.terminals[1].terminalId
  const thirdId = initial.terminals[2].terminalId

  await page.goto('/?configId=' + configId)
  await page.locator('[data-testid="terminal-tab"][data-terminal-id="' + secondId + '"]').dblclick()
  await page.getByTestId('terminal-alias-input').fill('reviewer_real')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="terminal-tab"][data-terminal-id="' + secondId + '"]')).toHaveAttribute('data-terminal-alias', 'reviewer_real')

  await page.getByTestId('tab-drag-toggle').click()
  await page.locator('[data-testid="terminal-tab"][data-terminal-id="' + thirdId + '"]').dragTo(page.locator('[data-testid="terminal-tab"][data-terminal-id="' + firstId + '"]'))
  await expect.poll(async () => (await snapshot(request, configId)).indexMap[0].terminalId).toBe(thirdId)

  await importTemplate(request, configId, baseTemplate(configId, 'target_matrix', 'Real Target Matrix', [
    { id: 'send_index', type: 'send_line', terminal: { kind: 'index', value: 1 }, text: printf('SD_TARGET_INDEX_010'), next: 'send_id' },
    { id: 'send_id', type: 'send_line', terminal: { kind: 'id', value: firstId }, text: printf('SD_TARGET_ID_010'), next: 'send_alias' },
    { id: 'send_alias', type: 'send_line', terminal: { kind: 'alias', value: 'reviewer_real' }, text: printf('SD_TARGET_ALIAS_010'), next: 'done' },
    { id: 'done', type: 'complete', reason: 'targets ok' },
  ]))
  await page.reload()

  await startTemplate(page, /Real Target Matrix/)
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 10000 })
  await expectTerminalReplay(page, thirdId, /SD_TARGET_INDEX_010/)
  await expectTerminalReplay(page, firstId, /SD_TARGET_ID_010/)
  await expectTerminalReplay(page, secondId, /SD_TARGET_ALIAS_010/)
})

test('real shell wait modes and control-flow checkpoints are driven from GUI controls', async ({ page, request }) => {
  const configId = 'real-wait-control-e2e'
  await createRealTerminals(request, configId, 1)

  await importTemplate(request, configId, baseTemplate(configId, 'wait_modes', 'Real Wait Modes', [
    { id: 'wait_duration', type: 'wait', mode: 'duration', durationMs: 50, next: 'wait_user' },
    { id: 'wait_user', type: 'wait', mode: 'user-continue', prompt: 'Continue?', next: 'done' },
    { id: 'done', type: 'complete', reason: 'wait modes ok' },
  ]))
  await page.goto('/?configId=' + configId)
  await startTemplate(page, /Real Wait Modes/)
  await expect(page.getByTestId('macro-run-status')).toContainText('waiting', { timeout: 5000 })
  await page.getByTestId('macro-control-resume').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 5000 })

  await importTemplate(request, configId, baseTemplate(configId, 'capture_ready_timeout', 'Capture Ready Timeout', [
    { id: 'wait_capture', type: 'wait', mode: 'capture-ready-or-user', captureStep: 'future_capture', timeoutMs: 50, onTimeout: 'pause', next: 'done' },
    { id: 'future_capture', type: 'capture-source', capture: { kind: 'agent-event', terminal: { kind: 'alias', value: 'terminal_1' }, agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook' } },
    { id: 'done', type: 'complete', reason: 'should not reach' },
  ]))
  await page.reload()
  await startTemplate(page, /Capture Ready Timeout/)
  await expect(page.getByTestId('macro-run-status')).toContainText('paused', { timeout: 5000 })
  await expect(page.getByTestId('macro-run-status')).toContainText(/Wait timed out/i)
  await page.getByTestId('macro-control-stop').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('stopped')

  await importTemplate(request, configId, baseTemplate(configId, 'goto_loop_guard', 'Goto Loop Guard', [
    { id: 'send_loop', type: 'send_line', terminal: { kind: 'alias', value: 'terminal_1' }, text: printf('SD_LOOP_GUARD_010'), next: 'loop_back' },
    { id: 'loop_back', type: 'goto', goto: 'send_loop', loopGuard: { maxIterations: 1, onLimit: 'pause' } },
  ]))
  await page.reload()
  await startTemplate(page, /Goto Loop Guard/)
  await expect(page.getByTestId('macro-run-status')).toContainText('paused', { timeout: 10000 })
  await expect(page.getByTestId('macro-run-status')).toContainText('Loop guard limit')
  await page.getByTestId('macro-control-stop').click()

  await importTemplate(request, configId, baseTemplate(configId, 'fail_stop_steps', 'Fail Step Smoke', [
    { id: 'fail_here', type: 'fail', reason: 'configured failure' },
  ]))
  await page.reload()
  await startTemplate(page, /Fail Step Smoke/)
  await expect(page.getByTestId('macro-run-status')).toContainText('failed', { timeout: 5000 })

  await importTemplate(request, configId, baseTemplate(configId, 'stop_step', 'Stop Step Smoke', [
    { id: 'stop_here', type: 'stop', reason: 'configured stop' },
  ]))
  await page.reload()
  await startTemplate(page, /Stop Step Smoke/)
  await expect(page.getByTestId('macro-run-status')).toContainText('stopped', { timeout: 5000 })
})

test('real shell parser matrix covers structured branch and mock ai-json when enabled', async ({ page, request }) => {
  const configId = 'real-parser-matrix-e2e'
  await createRealTerminals(request, configId, 1)
  const terminal = { kind: 'alias', value: 'terminal_1' }

  await importTemplate(request, configId, baseTemplate(configId, 'regex_branch_matrix', 'Regex Branch Matrix', [
    { id: 'send_branch', type: 'send_line', terminal, text: printf('SD_BRANCH_TRUE_010'), next: 'wait_branch' },
    { id: 'wait_branch', type: 'wait', mode: 'terminal-quiet', terminal, quietMs: 100, maxMs: 5000, onTimeout: 'pause', next: 'capture_branch' },
    { id: 'capture_branch', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse_branch' },
    {
      id: 'parse_branch',
      type: 'parse',
      captureStep: 'capture_branch',
      parser: {
        kind: 'regex',
        rules: [
          { signal: 'isTrue', type: 'boolean-null', pattern: 'SD_BRANCH_TRUE_010', flags: '', onMatch: true, onNoMatch: false },
          { signal: 'isFalse', type: 'boolean-null', pattern: 'SD_BRANCH_FALSE_MISSING_010', flags: '', onMatch: true, onNoMatch: false },
          { signal: 'isUnknown', type: 'boolean-null', pattern: 'SD_BRANCH_NULL_MISSING_010', flags: '', onMatch: true, onNoMatch: null },
        ],
      },
      next: 'branch_true',
    },
    { id: 'branch_true', type: 'branch', fromParseStep: 'parse_branch', conditions: [{ signal: 'isTrue', op: '==', value: true, goto: 'branch_false' }], else: 'fail' },
    { id: 'branch_false', type: 'branch', fromParseStep: 'parse_branch', conditions: [{ signal: 'isFalse', op: '==', value: false, goto: 'branch_null' }], else: 'fail' },
    { id: 'branch_null', type: 'branch', fromParseStep: 'parse_branch', conditions: [{ signal: 'isUnknown', op: 'is_null', goto: 'done_regex' }], else: 'fail' },
    { id: 'done_regex', type: 'complete', reason: 'regex branch ok' },
    { id: 'fail', type: 'fail', reason: 'branch matrix failed' },
  ]))
  await page.goto('/?configId=' + configId)
  await startTemplate(page, /Regex Branch Matrix/)
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 10000 })

  if (process.env.SHELL_DECK_E2E_AI_JSON_PARSER !== 'mock') return

  await importTemplate(request, configId, baseTemplate(configId, 'mock_ai_json_matrix', 'Mock AI JSON Matrix', [
    { id: 'send_ai', type: 'send_line', terminal, text: printf('ready clean only p3'), next: 'wait_ai' },
    { id: 'wait_ai', type: 'wait', mode: 'terminal-quiet', terminal, quietMs: 100, maxMs: 5000, onTimeout: 'pause', next: 'capture_ai' },
    { id: 'capture_ai', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse_ai' },
    { id: 'parse_ai', type: 'parse', captureStep: 'capture_ai', parser: { kind: 'ai-json', profileId: 'review-routing-v1' }, next: 'branch_ai_fixable' },
    { id: 'branch_ai_fixable', type: 'branch', fromParseStep: 'parse_ai', conditions: [{ signal: 'hasAiFixable', op: '==', value: true, goto: 'branch_ai_no_decision' }], else: 'fail' },
    { id: 'branch_ai_no_decision', type: 'branch', fromParseStep: 'parse_ai', conditions: [{ signal: 'needsUserDecision', op: 'is_null', goto: 'branch_ai_clean' }], else: 'fail' },
    { id: 'branch_ai_clean', type: 'branch', fromParseStep: 'parse_ai', conditions: [{ signal: 'onlyP3OrClean', op: '==', value: true, goto: 'done_ai' }], else: 'fail' },
    { id: 'done_ai', type: 'complete', reason: 'mock ai json ok' },
    { id: 'fail', type: 'fail', reason: 'mock ai json failed' },
  ]))
  await page.reload()
  await startTemplate(page, /Mock AI JSON Matrix/)
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 10000 })
})

test('real shell parallel_all fan-out fan-in uses real terminal lanes', async ({ page, request }) => {
  const configId = 'real-parallel-matrix-e2e'
  await createRealTerminals(request, configId, 2)
  await importTemplate(request, configId, baseTemplate(configId, 'real_parallel_all', 'Real Parallel All', [
    {
      id: 'parallel_real',
      type: 'parallel_all',
      lanes: [lane('lane_one', 'terminal_1', 'SD_PARALLEL_ONE_010'), lane('lane_two', 'terminal_2', 'SD_PARALLEL_TWO_010')],
      join: { mode: 'all_success', onLaneFail: 'pause', onTimeout: 'pause' },
      next: 'done',
    },
    { id: 'done', type: 'complete', reason: 'parallel real ok' },
  ]))

  await page.goto('/?configId=' + configId)
  await startTemplate(page, /Real Parallel All/)
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 10000 })
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /SD_PARALLEL_ONE_010/)
  await page.getByTestId('terminal-tab').nth(1).click()
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /SD_PARALLEL_TWO_010/)
})

function lane(id: string, alias: string, marker: string) {
  const terminal = { kind: 'alias', value: alias }
  return {
    id,
    terminal,
    steps: [
      { id: 'send_' + id, type: 'send_line', text: printf(marker) },
      { id: 'wait_' + id, type: 'wait', mode: 'terminal-quiet', terminal, quietMs: 100, maxMs: 5000, onTimeout: 'pause' },
      { id: 'capture_' + id, type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 12000 } },
      { id: 'parse_' + id, type: 'parse', captureStep: 'capture_' + id, parser: { kind: 'regex', rules: [{ signal: 'hasMarker', type: 'boolean-null', pattern: marker, flags: '', onMatch: true, onNoMatch: false }] } },
    ],
    success: { fromParseStep: 'parse_' + id, mode: 'all', conditions: [{ signal: 'hasMarker', op: '==', value: true }] },
  }
}
