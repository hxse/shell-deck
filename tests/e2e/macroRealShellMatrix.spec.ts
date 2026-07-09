import { expect, type APIRequestContext, test } from 'playwright/test'

function baseTemplate(configId: string, id: string, name: string, body: unknown[]) {
  return {
    schemaVersion: 2,
    id,
    name,
    description: name,
    configId,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    body,
  }
}

function printf(marker: string) {
  return "printf '" + marker + "\\n'"
}

async function createRealTerminal(request: APIRequestContext, configId: string) {
  const response = await request.post('/api/configs/' + configId + '/terminals?backend=real')
  expect(response.ok()).toBe(true)
  return await response.json() as { terminalId: string }
}

async function importTemplate(request: APIRequestContext, configId: string, template: unknown) {
  const response = await request.post('/api/configs/' + configId + '/templates/import', { data: template })
  expect(response.ok()).toBe(true)
}

test('real shell terminal target refs support index id and alias', async ({ page, request }) => {
  const configId = 'real-target-matrix-e2e-' + Date.now()
  const first = await createRealTerminal(request, configId)
  const second = await createRealTerminal(request, configId)
  await importTemplate(request, configId, baseTemplate(configId, 'target_refs', 'Target Ref Smoke', [
    { id: 'send_index', type: 'send', terminal: { kind: 'index', value: 1 }, message: { parts: [{ kind: 'text', text: printf('SD_TARGET_INDEX_010') }] }, enter: true },
    { id: 'send_id', type: 'send', terminal: { kind: 'id', value: first.terminalId }, message: { parts: [{ kind: 'text', text: printf('SD_TARGET_ID_010') }] }, enter: true },
    { id: 'send_alias', type: 'send', terminal: { kind: 'alias', value: 'shell_2' }, message: { parts: [{ kind: 'text', text: printf('SD_TARGET_ALIAS_010') }] }, enter: true },
    { id: 'done', type: 'finish', reason: 'targets ok' },
  ]))

  await page.goto('/?configId=' + configId)
  await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
  await expect(page.getByTestId('macro-template-item')).toContainText('Target Ref Smoke')
  await page.getByTestId('macro-template-select').selectOption('target_refs')
  await page.getByTestId('macro-template-summary').click()
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 10000 })
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /SD_TARGET_ID_010/)
  const runs = await (await request.get('/api/configs/' + configId + '/runs')).json() as { runs: Array<{ runId: string }> }
  const run = await (await request.get('/api/configs/' + configId + '/runs/' + runs.runs[0].runId)).json() as { run: { replay: { events: Array<{ kind: string; data: Record<string, unknown> }> } } }
  const sentTargets = run.run.replay.events.filter((event) => event.kind === 'terminal_text_sent').map((event) => event.data.terminalId)
  expect(sentTargets).toContain(first.terminalId)
  expect(sentTargets).toContain(second.terminalId)
})

test('wait duration and user-continue complete from GUI controls', async ({ page, request }) => {
  const configId = 'real-wait-matrix-e2e-' + Date.now()
  await createRealTerminal(request, configId)
  await importTemplate(request, configId, baseTemplate(configId, 'wait_modes', 'Wait Modes Smoke', [
    { id: 'wait_duration', type: 'wait', mode: 'duration', durationMs: 50 },
    { id: 'wait_user', type: 'wait', mode: 'user-continue', prompt: 'Continue?' },
    { id: 'done', type: 'finish', reason: 'wait modes ok' },
  ]))

  await page.goto('/?configId=' + configId)
  await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
  await expect(page.getByTestId('macro-template-item')).toContainText('Wait Modes Smoke')
  await page.getByTestId('macro-template-select').selectOption('wait_modes')
  await page.getByTestId('macro-template-summary').click()
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('waiting', { timeout: 5000 })
  await expect(page.getByTestId('macro-control-pause-resume')).toHaveText('Resume')
  await page.getByTestId('macro-control-pause-resume').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 5000 })
})

test('real shell text_match if handles simple true branch', async ({ page, request }) => {
  const configId = 'real-text-match-matrix-e2e-' + Date.now()
  const terminal = await createRealTerminal(request, configId)
  const target = { kind: 'id', value: terminal.terminalId }
  await importTemplate(request, configId, baseTemplate(configId, 'text_match_branch', 'Text Match Branch', [
    { id: 'send_branch', type: 'send', terminal: target, message: { parts: [{ kind: 'text', text: printf('SD_BRANCH_TRUE_010') }] }, enter: true },
    { id: 'wait_branch', type: 'wait', mode: 'duration', durationMs: 800 },
    { id: 'capture_branch', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: target, mode: 'scrollback-tail', maxChars: 12000 } },
    { id: 'if_branch', type: 'if', branches: [{ kind: 'if', condition: { kind: 'text_match', source: { kind: 'step_artifact', stepId: 'capture_branch', artifact: 'captured_text' }, matcher: { kind: 'simple', op: 'contains', text: 'SD_BRANCH_TRUE_010' }, scope: { kind: 'whole' } }, body: [{ id: 'done_regex', type: 'finish', reason: 'text match ok' }] }] },
  ]))

  await page.goto('/?configId=' + configId)
  await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
  await expect(page.getByTestId('macro-template-item')).toContainText('Text Match Branch')
  await page.getByTestId('macro-template-select').selectOption('text_match_branch')
  await page.getByTestId('macro-template-summary').click()
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 10000 })
  const runs = await (await request.get('/api/configs/' + configId + '/runs')).json() as { runs: Array<{ runId: string }> }
  const run = await (await request.get('/api/configs/' + configId + '/runs/' + runs.runs[0].runId)).json() as { run: { replay: { events: Array<{ kind: string; data: Record<string, unknown> }> } } }
  expect(run.run.replay.events.some((event) => event.kind === 'branch_decision' && event.data.matched === true)).toBe(true)
})

test("real shell parallel lane fan-out fan-in uses real terminals", async ({ page, request }) => {
  const configId = "real-parallel-matrix-e2e-" + Date.now()
  await createRealTerminal(request, configId)
  await createRealTerminal(request, configId)
  await importTemplate(request, configId, baseTemplate(configId, "real_parallel_lane_output", "Real Parallel Lane Output", [
    {
      id: "parallel_review",
      type: "parallel",
      lanes: [
        { id: "docs", label: "Docs", terminal: { kind: "alias", value: "shell_1" }, body: [
          { id: "send_docs", type: "send", terminal: { kind: "alias", value: "shell_1" }, message: { parts: [{ kind: "text", text: printf("SD_PARALLEL_DOCS_010") }] }, enter: true },
          { id: "wait_docs", type: "wait", mode: "terminal-quiet", terminal: { kind: "alias", value: "shell_1" }, quietMs: 100, maxMs: 5000, onTimeout: "pause" },
          { id: "capture_docs", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "shell_1" }, mode: "scrollback-tail", maxChars: 12000 } },
          { id: "output_docs", type: "output", source: { kind: "step_artifact", stepId: "capture_docs", artifact: "captured_text" } },
        ] },
        { id: "tests", label: "Tests", terminal: { kind: "alias", value: "shell_2" }, body: [
          { id: "send_tests", type: "send", terminal: { kind: "alias", value: "shell_2" }, message: { parts: [{ kind: "text", text: printf("SD_PARALLEL_TESTS_010") }] }, enter: true },
          { id: "wait_tests", type: "wait", mode: "terminal-quiet", terminal: { kind: "alias", value: "shell_2" }, quietMs: 100, maxMs: 5000, onTimeout: "pause" },
          { id: "capture_tests", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "shell_2" }, mode: "scrollback-tail", maxChars: 12000 } },
          { id: "output_tests", type: "output", source: { kind: "step_artifact", stepId: "capture_tests", artifact: "captured_text" } },
        ] },
      ],
      merge: { kind: "sectioned_text", separator: "===== {laneId} | {terminalAlias} =====", includeEmptyOutputs: true },
      onLaneFail: "pause",
    },
    { id: "done", type: "finish", reason: "parallel real ok" },
  ]))

  await page.goto("/?configId=" + configId)
  await page.getByTestId("macro-template-drawer").click()
  await expect(page.getByTestId("macro-template-drawer-body")).toBeVisible()
  await expect(page.getByTestId("macro-template-item")).toContainText("Real Parallel Lane Output")
  await page.getByTestId("macro-template-select").selectOption("real_parallel_lane_output")
  await page.getByTestId("macro-template-summary").click()
  await page.getByTestId("macro-control-start").click()
  await expect(page.getByTestId("macro-run-status")).toContainText("completed", { timeout: 10000 })
  const runs = await (await request.get("/api/configs/" + configId + "/runs")).json() as { runs: Array<{ runId: string }> }
  const run = await (await request.get("/api/configs/" + configId + "/runs/" + runs.runs[0].runId)).json() as { run: { replay: { events: Array<{ kind: string; data: Record<string, unknown> }> } } }
  expect(run.run.replay.events.some((event) => event.kind === "parallel_joined")).toBe(true)
})
