import { expect, test } from 'playwright/test'

import { completedRunDefinition, gapRepairDefinition, openTemplateDrawer } from './roomRuntimeSync035.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('a terminal runner delta gap repairs after one transient GET failure without a later delta', async ({ page, request }) => {
  let suppressedRunnerDeltas = 0
  let forwardedTerminalDeltas = 0
  await page.routeWebSocket('**/ws/rooms/**', (browserSocket) => {
    const serverSocket = browserSocket.connectToServer()
    serverSocket.onMessage((message) => {
      if (typeof message !== 'string') { browserSocket.send(message); return }
      let parsed: { type?: string; delta?: { status?: string } }
      try { parsed = JSON.parse(message) as typeof parsed }
      catch { browserSocket.send(message); return }
      if (parsed.type !== 'runner_delta') { browserSocket.send(message); return }
      if (parsed.delta?.status !== 'completed') {
        suppressedRunnerDeltas += 1
        return
      }
      forwardedTerminalDeltas += 1
      browserSocket.send(message)
    })
  })

  let repairGetCount = 0
  await page.route(/\/api\/rooms\/[^/]+\/runner$/, async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return }
    repairGetCount += 1
    if (repairGetCount === 1) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'transient_runner_repair_failure' }) })
      return
    }
    await route.continue()
  })

  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  await page.getByTestId('macro-json-editor').fill(JSON.stringify(gapRepairDefinition(), null, 2))
  await page.getByTestId('macro-save-json').click()

  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 8_000 })
  expect(suppressedRunnerDeltas).toBeGreaterThan(0)
  expect(forwardedTerminalDeltas).toBe(1)
  await expect.poll(() => repairGetCount).toBe(2)
  await page.waitForTimeout(500)
  expect(repairGetCount).toBe(2)
})

test('completed run preserves Macro editing and controller reload remains writable', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  await page.getByTestId('macro-json-editor').fill(JSON.stringify(completedRunDefinition(), null, 2))
  await page.getByTestId('macro-save-json').click()
  await page.getByTestId('macro-prepare-terminals').click()
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  await page.getByTestId('macro-tab-editor').click()
  await openTemplateDrawer(page)
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  await expect(page.getByTestId('macro-editor-lock-surface')).toBeEnabled()
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await expect(page.getByTestId('macro-create')).toBeEnabled()
  await expect(page.getByTestId('macro-create')).toHaveAttribute('aria-disabled', 'false')
  await expect(page.getByTestId('terminal-create-real')).toHaveAttribute('aria-disabled', 'false')
  await expect(page.locator('.macro-error')).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  await openTemplateDrawer(page)
  await expect(page.getByTestId('take-control')).toHaveCount(0)
  await expect(page.getByTestId('macro-create')).toBeEnabled()
  await expect(page.getByTestId('macro-create')).toHaveAttribute('aria-disabled', 'false')
  await expect(page.getByTestId('terminal-create-real')).toHaveAttribute('aria-disabled', 'false')
})
