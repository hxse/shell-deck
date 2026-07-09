import { expect, type APIRequestContext, type Page, test } from 'playwright/test'

test.skip(process.env.SHELL_DECK_RUN_ONLINE !== '1', '.010 Codex GUI smoke is online-only')

const configId = 'codex-gui-online-e2e'
const terminal = { kind: 'alias', value: 'shell_1' }

test('Codex-in-shell GUI smoke uses macro send then covers terminal-buffer and AgentEvent capture', async ({ page, request }) => {
  test.setTimeout(180_000)

  const terminalResponse = await request.post('/api/configs/' + configId + '/terminals?backend=real')
  expect(terminalResponse.ok()).toBe(true)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('terminal-tab').first()).toContainText('real')

  const codexCommand = "printf 'Reply with SD_CODEX_GUI_010 only\n' | just -f " + process.cwd() + "/justfile -- codex exec -"
  await importTemplate(request, codexPromptTemplate(codexCommand))
  await page.reload()
  await startTemplate(page, /Codex Macro Send Prompt/)
  await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 20_000 })

  const sendRunner = await latestRunnerEvents(request)
  expect(sendRunner.some((event) => event.kind === 'terminal_text_sent' && event.stepId === 'send_codex_prompt')).toBe(true)

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
  expect(events.some((event) => event.kind === 'branch_decision' && event.data.matched === true)).toBe(true)
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
    { id: 'send_codex_prompt', type: 'send', terminal, message: { parts: [{ kind: 'text', text: command }] }, enter: true },
    { id: 'done', type: 'finish', reason: 'sent' },
  ])
}

function terminalBufferTemplate() {
  return baseTemplate('codex_terminal_buffer_gui', 'Codex Terminal Buffer GUI', [
    { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 20000 } },
    { id: 'if_codex', type: 'if', branches: [{ kind: 'if', condition: { kind: 'text_match', source: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' }, matcher: { kind: 'simple', op: 'contains', text: 'SD_CODEX_GUI_010' }, scope: { kind: 'whole' } }, body: [{ id: 'done', type: 'finish', reason: 'codex terminal-buffer ok' }] }] },
  ])
}

function agentEventTemplate() {
  return baseTemplate('codex_agent_event_gui', 'Codex AgentEvent GUI', [
    { id: 'capture', type: 'capture-source', capture: { kind: 'agent-event', terminal, agent: { kind: 'codex' }, captureMode: 'result_only' } },
    { id: 'if_codex', type: 'if', branches: [{ kind: 'if', condition: { kind: 'text_match', source: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' }, matcher: { kind: 'simple', op: 'contains', text: 'SD_CODEX_GUI_010' }, scope: { kind: 'whole' } }, body: [{ id: 'done', type: 'finish', reason: 'codex agent-event ok' }] }] },
  ])
}

function baseTemplate(id: string, name: string, body: unknown[]) {
  return {
    schemaVersion: 2,
    id,
    name,
    description: name,
    configId,
    body,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}
