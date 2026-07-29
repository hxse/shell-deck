import { expect, test, type Locator, type Page } from 'playwright/test'
import { openTemplateDrawer } from './macroWorkbench034.helpers'

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

test('Macro Visual fields keep native input identity and never autosave', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()

  const persistedWrites: string[] = []
  page.on('request', (outgoing) => {
    if (!['POST', 'PUT'].includes(outgoing.method())) return
    if (/\/api\/templates(?:\/[^/]+)?$/.test(new URL(outgoing.url()).pathname)) {
      persistedWrites.push(`${outgoing.method()} ${outgoing.url()}`)
    }
  })

  const send = await insertRoot(page, 'add-step-send')
  await send.getByTestId('message-add-text').click()
  const text = send.getByTestId('message-text-part')
  await text.fill('')
  await rememberElement(text, 'messageText')
  await text.pressSequentially('a'.repeat(96))
  for (let index = 0; index < 48; index += 1) await text.press('Backspace')
  await expectStableInput(text, 'messageText', 'a'.repeat(48))

  await expectStableRename(send.getByTestId('node-id-input'), 'nodeId', 'root_send_fast')

  const forNode = await insertRoot(page, 'add-flow-for')
  await forNode.getByTestId('for-range-mode').selectOption('text-list')
  const textListCard = forNode.getByTestId('for-text-list-item-card')
  const textListKey = textListCard.getByTestId('for-text-list-key')
  const textListValue = textListCard.getByTestId('for-text-list-value')
  await textListKey.fill('phase')
  await textListValue.fill('alpha\nbeta\ngamma\ndelta')
  await rememberElement(textListCard, 'textListCard')
  await rememberElement(textListKey, 'textListKey')
  await rememberElement(textListValue, 'textListValue')
  await expectStableRename(forNode.getByTestId('node-id-input'), 'forNodeId', 'loop_fast')
  await expectSameElement(textListCard, 'textListCard')
  await expectSameElement(textListKey, 'textListKey')
  await expectSameElement(textListValue, 'textListValue')
  await expect(textListKey).toHaveValue('phase')
  await expect(textListValue).toHaveValue('alpha\nbeta\ngamma\ndelta')
  await forNode.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-wait').click()

  const parallel = await insertRoot(page, 'add-step-parallel')
  await expectStableRename(
    parallel.getByTestId('parallel-lane-id-input'),
    'laneId',
    'lane_fast',
  )

  await parallel.getByTestId('parallel-lane-add-empty').click()
  await page.getByTestId('parallel-add-capture').click()
  const action = parallel.getByTestId('parallel-lane-action').first()
  await expectStableRename(
    action.getByTestId('parallel-action-id-input'),
    'actionId',
    'capture_fast',
  )

  expect(persistedWrites).toEqual([])
  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-save')).toBeDisabled()
  const name = page.getByTestId('macro-name')
  await name.fill('Temporary name')
  await expect(page.getByTestId('macro-save')).toBeEnabled()
  await name.fill('New Macro')
  await expect(page.getByTestId('macro-save')).toBeDisabled()
})

async function expectStableRename(input: Locator, key: string, value: string): Promise<void> {
  await input.fill('')
  await rememberElement(input, key)
  await input.pressSequentially(value)
  await expectStableInput(input, key, value)
}

async function rememberElement(input: Locator, key: string): Promise<void> {
  await input.evaluate((element, name) => {
    (window as unknown as Record<string, unknown>)[`macroInput:${name}`] = element
  }, key)
}

async function expectSameElement(input: Locator, key: string): Promise<void> {
  expect(await input.evaluate((element, name) => (
    (window as unknown as Record<string, unknown>)[`macroInput:${name}`] === element
  ), key)).toBe(true)
}

async function expectStableInput(input: Locator, key: string, value: string): Promise<void> {
  await expect(input).toHaveValue(value)
  await expect(input).toBeFocused()
  await expectSameElement(input, key)
  expect(await input.evaluate((element) => {
    const field = element as HTMLInputElement | HTMLTextAreaElement
    return field.selectionStart === field.value.length
      && field.selectionEnd === field.value.length
  })).toBe(true)
}

async function insertRoot(page: Page, paletteTestId: string): Promise<Locator> {
  const roots = rootNodes(page)
  if (await roots.count() === 0) {
    await rootBody(page).getByTestId('empty-body-add').click()
  } else {
    await nodeControl(roots.last(), 'node-add-after').click()
  }
  await page.getByTestId(paletteTestId).click()
  return rootNodes(page).last()
}

function rootBody(page: Page): Locator {
  return page.locator('[data-testid="flow-block"][data-flow-body-label="Root body"]')
}

function rootNodes(page: Page): Locator {
  return rootBody(page).locator(':scope > .flow-node-editor')
}

function nodeControl(node: Locator, testId: string): Locator {
  return node.locator(
    `:scope > [data-testid="node-menu"] > [data-testid="node-action-controls"] > [data-testid="${testId}"]`,
  )
}
