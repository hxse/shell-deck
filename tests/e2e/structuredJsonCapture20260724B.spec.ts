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

test('visual editor authors root structured Capture and typed JSON If', async ({ page, request }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByRole('button', { name: 'New shell', exact: true }).click()

  const capture = await insertRoot(page, 'add-step-capture')
  await capture.getByTestId('capture-step-terminal').selectOption({ label: '1 · shell' })
  await capture.getByTestId('capture-step-kind').selectOption('structured-json')
  await expect(capture.getByTestId('capture-structured-json-schema')).toHaveValue(/"decision"/)
  await expect(capture.getByTestId('capture-structured-json-schema-line-editor'))
    .toHaveAttribute('data-auto-max-rows', '3')
  await expect(capture).toContainText('just submit-json')
  await capture.getByTestId('capture-structured-json-timeout-enabled').check()
  await capture.getByTestId('capture-structured-json-timeout-ms').fill('45000')

  await capture.getByTestId('capture-structured-json-schema').fill('"not-a-schema"')
  await expect(capture.getByTestId('capture-structured-json-schema')).toHaveValue('"not-a-schema"')
  await expect(capture.getByTestId('capture-structured-json-view-prompt')).toBeDisabled()
  await expect(page.getByTestId('macro-validation-summary')).not.toHaveText('success')
  await capture.getByTestId('capture-structured-json-schema').fill('{')
  await expect(page.getByTestId('macro-validation-summary')).not.toHaveText('success')
  const parseValidInvalidSchema = '{"properties":{"decision":{"type":"string"}},"type":7}'
  await capture.getByTestId('capture-structured-json-schema').fill(parseValidInvalidSchema)
  await expect(capture.getByTestId('capture-structured-json-schema')).toHaveValue(parseValidInvalidSchema)
  await expect(capture.getByTestId('capture-structured-json-view-prompt')).toBeDisabled()
  await capture.getByTestId('capture-structured-json-schema').fill(JSON.stringify({
    type: 'object',
    required: ['decision'],
    additionalProperties: false,
    properties: { decision: { enum: ['continue', 'retry'] } },
  }, null, 2))
  await capture.getByTestId('capture-structured-json-view-prompt').click()
  const promptDialog = capture.getByTestId('capture-structured-json-prompt-dialog')
  const promptText = promptDialog.getByTestId('capture-structured-json-prompt-text')
  await expect(promptDialog).toBeVisible()
  await expect(promptText).toHaveValue(/just -f "\$SHELL_DECK_JUSTFILE" submit-json/)
  await expect(promptText).toHaveValue(/"decision"/)
  await promptDialog.getByTestId('capture-structured-json-prompt-copy').click()
  await expect(promptDialog.getByTestId('capture-structured-json-prompt-copied')).toBeVisible()
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('structured_json_submitted')
  await promptDialog.getByTestId('capture-structured-json-prompt-close').click()

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => { throw new Error('clipboard denied') },
    })
  })
  await capture.getByTestId('capture-structured-json-view-prompt').click()
  await promptDialog.getByTestId('capture-structured-json-prompt-copy').click()
  await expect(promptDialog.getByTestId('capture-structured-json-prompt-copy-failed')).toContainText('copy it manually')
  await expect(promptText).toHaveValue(/structured_json_schema_mismatch/)
  await promptDialog.getByTestId('capture-structured-json-prompt-close').click()

  const branch = await insertRoot(page, 'add-flow-if')
  const condition = branch.getByTestId('if-branch-section').first()
  await condition.getByTestId('condition-kind').selectOption('json_match')
  await expect(condition.getByTestId('condition-json-source').locator('option'))
    .toContainText(['Unassigned', 'capture_source.captured_json'])
  await condition.getByTestId('condition-json-source').selectOption('capture_source:captured_json')
  await condition.getByTestId('condition-json-pointer').fill('/decision')
  await condition.getByTestId('condition-json-matcher-kind').selectOption('equals')
  await condition.getByTestId('condition-json-string-value').fill('retry')

  const branchBody = condition.locator('[data-testid="flow-block"][data-flow-body-label="if body"]')
  await branchBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-wait').click()

  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
})

test('every textual consumer can select an earlier typed JSON artifact', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByRole('button', { name: 'New shell', exact: true }).click()

  const capture = await insertRoot(page, 'add-step-capture')
  await capture.getByTestId('capture-step-terminal').selectOption({ label: '1 · shell' })
  await capture.getByTestId('capture-step-kind').selectOption('structured-json')

  const send = await insertRoot(page, 'add-step-send')
  await send.getByTestId('send-terminal').selectOption({ label: '1 · shell' })
  await send.getByTestId('message-add-source').click()
  await selectJsonArtifact(send.getByTestId('message-source-part'))

  const notify = await insertRoot(page, 'add-step-notify')
  await notify.getByTestId('message-add-source').click()
  await selectJsonArtifact(notify.getByTestId('message-source-part'))

  const input = await insertRoot(page, 'add-step-input')
  await input.getByTestId('input-terminal').selectOption({ label: '1 · shell' })
  await selectJsonArtifact(input.getByTestId('input-default-source'))

  const extract = await insertRoot(page, 'add-step-extract')
  await selectJsonArtifact(extract.getByTestId('extract-text-source'))

  const parallel = await insertRoot(page, 'add-step-parallel')
  await parallel.getByTestId('parallel-lane-add-empty').click()
  await page.getByTestId('parallel-add-send').click()
  const laneSend = parallel.getByTestId('parallel-lane-action').first()
  await laneSend.getByTestId('parallel-send-terminal').selectOption({ label: '1 · shell' })
  await laneSend.getByTestId('message-add-source').click()
  await selectJsonArtifact(laneSend.getByTestId('message-source-part'))

  const branch = await insertRoot(page, 'add-flow-if')
  const condition = branch.getByTestId('if-branch-section').first()
  await selectJsonArtifact(condition.getByTestId('condition-source'))
  const branchBody = condition.locator('[data-testid="flow-block"][data-flow-body-label="if body"]')
  await branchBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-wait').click()

  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
})

function rootNodes(page: Page): Locator {
  return page.locator(
    '[data-testid="flow-block"][data-flow-body-label="Root body"] > [data-flow-node-id]',
  )
}

async function insertRoot(page: Page, paletteTestId: string): Promise<Locator> {
  const nodes = rootNodes(page)
  if (await nodes.count() === 0) {
    await page.locator(
      '[data-testid="flow-block"][data-flow-body-label="Root body"]',
    ).getByTestId('empty-body-add').click()
  } else {
    await nodes.last()
      .locator(':scope > [data-testid="node-menu"] [data-testid="node-add-after"]')
      .click()
  }
  await page.getByTestId(paletteTestId).click()
  return rootNodes(page).last()
}

async function selectJsonArtifact(select: Locator): Promise<void> {
  await expect(select.locator('option[value="capture_source:captured_json"]'))
    .toHaveText('capture_source.captured_json')
  await select.selectOption('capture_source:captured_json')
}
