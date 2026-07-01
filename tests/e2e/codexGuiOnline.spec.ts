import { expect, type APIRequestContext, type Page, test } from 'playwright/test'

test.skip(process.env.SHELL_DECK_RUN_ONLINE !== '1', '.010 Codex GUI smoke is online-only')

const configId = 'codex-gui-online-e2e'
const terminal = { kind: 'alias', value: 'terminal_1' }

test('Codex-in-shell GUI smoke uses macro send_line then covers terminal-buffer and AgentEvent capture', async ({ page, request }) => {
  test.setTimeout(180_000)

  const terminalResponse = await request.post('/api/configs/' + configId + '/terminals?backend=real')
  expect(terminalResponse.ok()).toBe(true)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('terminal-tab').first()).toContainText('real')

  const codexCommand = "printf 'Reply with SD_CODEX_GUI_010 only\\n' | just -f <shell-deck-root>/justfile -- codex exec -"
  await importTemplate(request, codexPromptTemplate(codexCommand))
  await page.reload()
  await startTemplate(page, /Codex Macro Send Prompt/)
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 20_000 })

  const sendRunner = await latestRunnerEvents(request)
  expect(sendRunner.some((event) => event.kind === 'terminal_line_sent' && event.stepId === 'send_codex_prompt')).toBe(true)

  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /SD_CODEX_GUI_010/, { timeout: 150_000 })
  await expect(page.getByTestId('terminal-host').first()).toHaveAttribute('data-rendered-replay', /hook: Stop Completed/, { timeout: 150_000 })

  await importTemplate(request, terminalBufferTemplate())
  await page.reload()
  await startTemplate(page, /Codex Terminal Buffer GUI/)
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 20_000 })

  await importTemplate(request, agentEventTemplate())
  await page.reload()
  await startTemplate(page, /Codex AgentEvent GUI/)
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 20_000 })

  const events = await latestRunnerEvents(request)
  const capture = events.find((event) => event.kind === 'capture_artifact_created')
  expect(capture?.data.captureKind).toBe('agent-event')
  expect(String(capture?.data.codexSessionId)).toMatch(/^019/)
  expect(String(capture?.data.launchId)).toMatch(/^launch_/)
  expect(events.some((event) => event.kind === 'parser_normalized' && (event.data.signals as { codexOk?: boolean }).codexOk === true)).toBe(true)
  expect(events.some((event) => event.kind === 'branch_decision' && event.data.selectedStepId === 'done')).toBe(true)
})

async function importTemplate(request: APIRequestContext, template: Record<string, unknown>) {
  const response = await request.post('/api/configs/' + configId + '/templates/import', { data: template })
  expect(response.status()).toBe(201)
}

async function startTemplate(page: Page, name: RegExp) {
  await page.getByRole('button', { name }).click()
  await page.getByTestId('macro-control-start').click()
}

async function latestRunnerEvents(request: APIRequestContext) {
  const runnerResponse = await request.get('/api/configs/' + configId + '/runner')
  const runnerBody = await runnerResponse.json() as {
    runner: { run?: { replay: { events: Array<{ kind: string; stepId?: string; data: Record<string, unknown> }> } } }
  }
  return runnerBody.runner.run?.replay.events ?? []
}

function codexPromptTemplate(command: string) {
  return baseTemplate('codex_macro_send_prompt_gui', 'Codex Macro Send Prompt', [
    { id: 'send_codex_prompt', type: 'send_line', terminal, text: command },
  ])
}

function terminalBufferTemplate() {
  return baseTemplate('codex_terminal_buffer_gui', 'Codex Terminal Buffer GUI', [
    { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 20000 }, next: 'parse' },
    { id: 'parse', type: 'parse', captureStep: 'capture', parser: regexParser(), next: 'branch' },
    { id: 'branch', type: 'branch', fromParseStep: 'parse', conditions: [{ signal: 'codexOk', op: '==', value: true, goto: 'done' }], else: 'fail' },
    { id: 'done', type: 'complete', reason: 'codex terminal-buffer ok' },
    { id: 'fail', type: 'fail', reason: 'codex terminal-buffer missing marker' },
  ])
}

function agentEventTemplate() {
  return baseTemplate('codex_agent_event_gui', 'Codex AgentEvent GUI', [
    { id: 'capture', type: 'capture-source', capture: { kind: 'agent-event', terminal, agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook' }, next: 'parse' },
    { id: 'parse', type: 'parse', captureStep: 'capture', parser: regexParser(), next: 'branch' },
    { id: 'branch', type: 'branch', fromParseStep: 'parse', conditions: [{ signal: 'codexOk', op: '==', value: true, goto: 'done' }], else: 'fail' },
    { id: 'done', type: 'complete', reason: 'codex agent-event ok' },
    { id: 'fail', type: 'fail', reason: 'codex agent-event missing marker' },
  ])
}

function regexParser() {
  return { kind: 'regex', rules: [{ signal: 'codexOk', type: 'boolean-null', pattern: 'SD_CODEX_GUI_010', flags: '', onMatch: true, onNoMatch: false }] }
}

function baseTemplate(id: string, name: string, steps: unknown[]) {
  return {
    schemaVersion: 1,
    id,
    name,
    description: name,
    configId,
    steps,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}
