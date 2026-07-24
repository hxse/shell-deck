import { expect, test } from 'playwright/test'

import { deferred, openTemplateDrawer, runtimeInputGenerationDefinition, sharedRuntimeDefinition } from './roomRuntimeSync035.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('same URL tabs share server-owned run, takeover, notification and runtime input without sharing editor selection', async ({ browser, request }) => {
  const context = await browser.newContext()
  let runnerGetCount = 0
  context.on('request', (requestEvent) => {
    if (requestEvent.method() === 'GET' && /\/api\/rooms\/[^/]+\/runner$/.test(new URL(requestEvent.url()).pathname)) runnerGetCount += 1
  })
  const first = await context.newPage()
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await first.goto(room.url)

  await openTemplateDrawer(first)
  await first.getByTestId('macro-create').click()
  await first.getByTestId('macro-template-drawer').click()
  await first.getByTestId('macro-tab-json').click()
  await first.getByTestId('macro-edit-json').click()
  await first.getByTestId('macro-json-editor').fill(JSON.stringify(sharedRuntimeDefinition(), null, 2))
  await first.getByTestId('macro-save-json').click()
  await expect(first.getByTestId('macro-json-preview')).toContainText('Shared runtime')
  await first.getByTestId('macro-prepare-terminals').click()
  await expect(first.getByTestId('terminal-tab')).toHaveCount(1)

  const second = await context.newPage()
  await second.goto(first.url())
  await expect(second.getByTestId('macro-template-summary').locator('strong')).toHaveText('No macro selected')

  await first.getByTestId('macro-control-start').click()
  await expect(first.getByTestId('macro-run-status').locator('strong')).toHaveText('running')
  await expect(second.getByTestId('macro-run-status').locator('strong')).toHaveText('running')
  await expect(second.getByTestId('macro-running-identity')).toContainText('Shared runtime')
  await expect(second.getByTestId('macro-template-summary').locator('strong')).toHaveText('No macro selected')

  second.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('active Macro run stay on the server and will not be lost')
    await dialog.accept()
  })
  await second.getByTestId('take-control').click()
  await expect(second.getByTestId('room-control-status')).toHaveText('Control: This device')
  await expect(first.getByTestId('take-control')).toBeVisible()

  await second.getByTestId('macro-control-pause-resume').click()
  await expect(first.getByTestId('macro-run-status').locator('strong')).toHaveText('paused')
  await expect(second.getByTestId('macro-run-status').locator('strong')).toHaveText('paused')
  await second.getByTestId('macro-control-pause-resume').click()
  await expect(first.getByTestId('macro-run-status').locator('strong')).toHaveText('running')

  await expect(first.getByTestId('notice-item')).toContainText('Runtime notification', { timeout: 6_000 })
  await expect(second.getByTestId('notice-item')).toContainText('Runtime notification', { timeout: 6_000 })
  const firstNotice = await first.getByTestId('notice-item').textContent()
  const secondNotice = await second.getByTestId('notice-item').textContent()
  expect(firstNotice?.match(/notification_id: ([^\s]+)/)?.[1]).toBe(secondNotice?.match(/notification_id: ([^\s]+)/)?.[1])
  await first.getByTestId('notice-item').getByRole('button', { name: 'Dismiss notice' }).click()
  await second.getByTestId('notice-item').getByRole('button', { name: 'Dismiss notice' }).click()

  await expect(second.getByTestId('macro-run-status').locator('strong')).toHaveText('waiting_input', { timeout: 6_000 })
  await expect(first.getByTestId('macro-run-input-text')).toBeDisabled()
  await expect(second.getByTestId('macro-run-input-text')).toBeEditable()
  await second.getByTestId('macro-run-input-text').fill('draft from second')
  await expect(first.getByTestId('macro-run-input-text')).toHaveValue('draft from second')

  const roomUrl = first.url()
  await first.close()
  await second.close()
  await new Promise((resolve) => setTimeout(resolve, 200))

  const third = await context.newPage()
  await third.goto(roomUrl)
  await expect(third.getByTestId('macro-run-status').locator('strong')).toHaveText('waiting_input')
  await expect(third.getByTestId('macro-running-identity')).toContainText('Shared runtime')
  await expect(third.getByTestId('macro-run-input-text')).toHaveValue('draft from second')
  await expect(third.getByTestId('notice-item')).toHaveCount(0)
  await third.getByTestId('take-control').click()
  await expect(third.getByTestId('room-control-status')).toHaveText('Control: This device')
  await third.getByTestId('macro-run-input-submit').click()
  await expect(third.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  expect(runnerGetCount).toBe(0)

  await context.close()
})

test('runtime input coalescing submits the latest local generation when it returns to the server value', async ({ browser, request }) => {
  const context = await browser.newContext()
  const firstDraftEntered = deferred<void>()
  const releaseFirstDraft = deferred<void>()
  const submitEntered = deferred<void>()
  const releaseSubmit = deferred<void>()
  let draftRequestCount = 0
  let submitRequestCount = 0
  const draftValues: string[] = []
  let submittedValue: string | null = null

  await context.route('**/runner/input-draft', async (route) => {
    draftRequestCount += 1
    draftValues.push((route.request().postDataJSON() as { value: string }).value)
    if (draftRequestCount === 1) {
      firstDraftEntered.resolve()
      await releaseFirstDraft.promise
    }
    await route.continue()
  })
  await context.route('**/runner/input', async (route) => {
    submitRequestCount += 1
    submittedValue = (route.request().postDataJSON() as { value?: string } | null)?.value ?? null
    submitEntered.resolve()
    await releaseSubmit.promise
    await route.continue()
  })

  const page = await context.newPage()
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  await page.getByTestId('macro-json-editor').fill(JSON.stringify(runtimeInputGenerationDefinition(), null, 2))
  await page.getByTestId('macro-save-json').click()
  await page.getByTestId('macro-prepare-terminals').click()
  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('waiting_input')
  await expect(page.getByTestId('macro-run-input-text')).toHaveValue('D')

  await page.getByTestId('macro-run-input-text').fill('A')
  await firstDraftEntered.promise
  await page.getByTestId('macro-run-input-text').fill('D')
  releaseFirstDraft.resolve()
  await expect.poll(() => draftValues).toEqual(['A', 'D'])
  await expect(page.getByTestId('macro-run-input-text')).toHaveValue('D')
  await page.getByTestId('macro-run-input-submit').click()
  await submitEntered.promise
  await page.getByTestId('macro-run-input-submit').dispatchEvent('click')
  expect(submitRequestCount).toBe(1)
  releaseSubmit.resolve()

  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  expect(submittedValue).toBe('D')
  await expect(page.getByTestId('text-box-editor')).toHaveValue('DD')
  await context.close()
})
