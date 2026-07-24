import { expect, test } from 'playwright/test'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as {
    rooms: Array<{ roomId: string; roomGeneration: string }>
  }
  for (const room of body.rooms) {
    await request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
      data: { expectedRoomGeneration: room.roomGeneration },
    })
  }
})

test('Text input stays local, tab switch flushes server truth, and gutter DOM is viewport-bounded', async ({ page, request }) => {
  test.setTimeout(60_000)
  let traceRequestCount = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/runner/traces')) traceRequestCount += 1
  })
  const created = await request.post('/api/rooms')
  expect(created.status()).toBe(201)
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await expect(page.getByTestId('room-control-status')).toContainText('Control:')
  expect(traceRequestCount).toBe(0)

  await page.getByRole('button', { name: 'New shell', exact: true }).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
  const shellTab = page.getByTestId('terminal-tab').first()
  const shellId = await shellTab.getAttribute('data-terminal-id')
  if (!shellId) throw new Error('missing shell terminal')

  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
  const textTab = page.getByTestId('terminal-tab').last()
  const textId = await textTab.getAttribute('data-terminal-id')
  if (!textId) throw new Error('missing text terminal')

  const content = Array.from({ length: 20_000 }, (_, index) => `line ${index + 1}`).join('\n')
  const editor = page.getByTestId('text-box-editor')
  await editor.evaluate((element, value) => {
    const textarea = element as HTMLTextAreaElement
    textarea.value = value
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  }, content)
  await expect.poll(() => editor.evaluate((element) => (element as HTMLTextAreaElement).value.length)).toBe(content.length)
  await expect.poll(() => page.getByTestId('text-box-line-number-list').locator('div').count())
    .toBeLessThan(100)

  await shellTab.click()
  await expect(page.locator(`[data-testid="terminal-view-slot"][data-terminal-id="${shellId}"]`)).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('room-control-status')).toContainText('Control:')
  await page.locator(`[data-testid="terminal-tab"][data-terminal-id="${textId}"]`).click()
  await expect.poll(() => page.getByTestId('text-box-editor').evaluate((element) => {
    const value = (element as HTMLTextAreaElement).value
    return {
      length: value.length,
      start: value.slice(0, 12),
      end: value.slice(-10),
    }
  })).toEqual({
    length: content.length,
    start: content.slice(0, 12),
    end: content.slice(-10),
  })
  await expect.poll(() => page.getByTestId('text-box-line-number-list').locator('div').count())
    .toBeLessThan(100)
  expect(traceRequestCount).toBe(0)
})
