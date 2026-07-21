import { expect, test } from 'playwright/test'

import { openTemplateDrawer } from './macroWorkbench034.helpers'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), { data: { expectedRoomGeneration: room.roomGeneration } })))
})

test('every eligible new reference defaults to Unassigned even when compatible terminals or earlier artifacts exist', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByRole('button', { name: 'New shell', exact: true }).click()

  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-flow-for').click()
  const forBody = page.locator('[data-testid="flow-block"][data-flow-body-label="for body"]')

  await forBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-flow-if').click()
  const incompleteIf = forBody.locator('[data-flow-node-type="if"]').first()
  await expect(incompleteIf).toBeVisible()
  await expect(incompleteIf.getByTestId('condition-source').first()).toHaveValue('')
  await expect(incompleteIf.getByTestId('condition-source').first().locator('option:checked')).toHaveText('Unassigned')
  await expect(incompleteIf.getByTestId('condition-source-warning').first()).toBeVisible()
  await incompleteIf.getByTestId('add-flow-elif').first().click()
  await expect(incompleteIf.getByTestId('if-branch-section')).toHaveCount(2)
  await expect(incompleteIf.getByTestId('condition-source').nth(1)).toHaveValue('')
  await expect(page.getByTestId('macro-validation-summary')).not.toHaveText('success')
  page.once('dialog', (dialog) => dialog.accept())
  await incompleteIf.getByTestId('node-remove').first().click()

  await forBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-extract').click()
  const incompleteExtract = forBody.locator('[data-flow-node-type="extract_text"]').first()
  await expect(incompleteExtract).toBeVisible()
  await expect(incompleteExtract.getByTestId('extract-text-source')).toHaveValue('')
  await expect(incompleteExtract.getByTestId('extract-text-source').locator('option:checked')).toHaveText('Unassigned')
  await expect(incompleteExtract.getByTestId('extract-text-source-warning')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await incompleteExtract.getByTestId('node-remove').first().click()

  await forBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-parallel').click()
  const incompleteParallel = forBody.locator('[data-flow-node-type="parallel"]').first()
  await expect(incompleteParallel.getByTestId('parallel-lane-terminal')).toHaveValue('unassigned')
  await incompleteParallel.getByTestId('parallel-add-lane').click()
  await expect(incompleteParallel.getByTestId('parallel-lane-terminal')).toHaveValue('unassigned')
  await incompleteParallel.getByTestId('parallel-lane-add-before-output').click()
  await incompleteParallel.getByTestId('parallel-add-extract').click()
  const incompleteLaneExtract = incompleteParallel.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="extract_text"]')
  await expect(incompleteLaneExtract).toBeVisible()
  await expect(incompleteLaneExtract.getByTestId('parallel-extract-source')).toHaveValue('')
  await expect(incompleteLaneExtract.getByTestId('parallel-extract-source').locator('option:checked')).toHaveText('Unassigned')
  await expect(incompleteLaneExtract.getByTestId('parallel-extract-source-warning')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await incompleteParallel.getByTestId('node-remove').first().click()

  await forBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-capture').click()
  const producer = forBody.locator('[data-flow-node-type="capture-source"]').first()
  await expect(producer.getByTestId('capture-step-terminal')).toHaveValue('unassigned')
  await producer.getByTestId('capture-step-terminal').selectOption('1')
  await producer.getByTestId('node-add-after').click()
  await page.getByTestId('add-step-parallel').click()
  const parallelAfterCapture = forBody.locator('[data-flow-node-type="parallel"]').first()
  await parallelAfterCapture.getByTestId('parallel-lane-add-before-output').click()
  await parallelAfterCapture.getByTestId('parallel-add-extract').click()
  const outerAwareExtract = parallelAfterCapture.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="extract_text"]')
  await expect(outerAwareExtract.getByTestId('parallel-extract-source').locator('option')).toContainText(['capture_source.captured_text'])
  await outerAwareExtract.getByTestId('parallel-extract-source').selectOption('capture_source:captured_text')
  await expect(outerAwareExtract.getByTestId('parallel-extract-source')).toHaveValue('capture_source:captured_text')
  page.once('dialog', (dialog) => dialog.accept())
  await parallelAfterCapture.getByTestId('node-remove').first().click()

  await producer.getByTestId('node-add-after').click()
  await page.getByTestId('add-flow-if').click()

  const branch = forBody.getByTestId('if-branch-section')
  await expect(branch.getByLabel('Source').locator('option:checked')).toHaveText('Unassigned')
  await branch.getByTestId('condition-source').selectOption('capture_source:captured_text')
  await branch.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(branch.getByTestId('send-terminal')).toHaveValue('unassigned')
  await branch.getByTestId('send-terminal').selectOption('1')
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
})

test('terminal selectors never render blank for empty, stale or incompatible targets', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()

  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  const sendTarget = page.getByTestId('send-terminal')
  await expect(sendTarget).toHaveValue('unassigned')
  await expect(sendTarget).toHaveAttribute('data-terminal-select-status', 'unassigned')
  await expect(sendTarget.locator('option:checked')).toHaveText('Unassigned')
  await expect(page.getByTestId('send-terminal-warning')).toBeVisible()

  await page.getByRole('button', { name: 'New shell', exact: true }).click()
  await expect(sendTarget).toHaveValue('unassigned')
  await expect(sendTarget).toHaveAttribute('data-terminal-select-status', 'unassigned')
  await sendTarget.selectOption('1')
  await expect(sendTarget).toHaveValue('1')
  await expect(sendTarget).toHaveAttribute('data-terminal-select-status', 'selected')

  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await sendTarget.selectOption('2')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('terminal-tab-close').nth(1).click()
  await expect(sendTarget).toHaveValue('')
  await expect(sendTarget).toHaveAttribute('data-terminal-select-status', 'missing')
  await expect(sendTarget.locator('option:checked')).toHaveText('Missing terminal 2 — choose another terminal')

  await sendTarget.selectOption('1')
  await page.getByTestId('node-add-after').first().click()
  await page.getByTestId('add-step-wait').click()
  await page.getByTestId('wait-mode').selectOption('terminal-quiet')
  const quietTarget = page.getByTestId('wait-target-tab')
  await expect(quietTarget).toHaveValue('unassigned')
  await quietTarget.selectOption('1')
  await expect(quietTarget).toHaveValue('1')
})

test('Send, Input, Wait, Capture and Parallel default Unassigned and hidden layout follows explicit references', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()

  for (let count = 0; count < 4; count += 1) {
    await page.getByRole('button', { name: 'New shell', exact: true }).click()
  }
  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(5)

  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  await page.getByTestId('send-terminal').selectOption('1')
  await expect(page.getByTestId('send-terminal')).toHaveValue('1')
  await expect(page.getByTestId('send-terminal').locator('option')).toHaveText([
    'Unassigned',
    '1 · shell',
    '2 · shell',
    '3 · shell',
    '4 · shell',
    '5 · text',
  ])

  await page.getByTestId('node-add-after').last().click()
  await page.getByTestId('add-step-input').click()
  await expect(page.getByTestId('input-terminal')).toHaveValue('unassigned')
  await page.getByTestId('input-terminal').selectOption('2')
  await expect(page.getByTestId('input-terminal')).toHaveValue('2')

  await page.getByTestId('node-add-after').last().click()
  await page.getByTestId('add-step-wait').click()
  await page.getByTestId('wait-mode').selectOption('terminal-quiet')
  await expect(page.getByTestId('wait-target-tab')).toHaveValue('unassigned')
  await page.getByTestId('wait-target-tab').selectOption('3')
  await expect(page.getByTestId('wait-target-tab')).toHaveValue('3')

  await page.getByTestId('node-add-after').last().click()
  await page.getByTestId('add-step-parallel').click()
  await expect(page.getByTestId('parallel-lane-terminal')).toHaveValue('unassigned')
  await page.getByTestId('parallel-lane-terminal').selectOption('4')
  await expect(page.getByTestId('parallel-lane-terminal')).toHaveValue('4')

  await page.getByTestId('node-add-after').last().click()
  await page.getByTestId('add-step-capture').click()
  await expect(page.getByTestId('capture-step-terminal')).toHaveValue('unassigned')
  await page.getByTestId('capture-step-terminal').selectOption('5')
  await expect(page.getByTestId('capture-step-terminal')).toHaveValue('5')
  await expect(page.getByTestId('capture-kind-fixed')).toHaveText('Capture kind: text-box')
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"index": 5')
  await expect(page.getByTestId('macro-json-preview')).toContainText('"type": "text"')
})

test('Macro New, Select, Discard and direct Delete stay operable while every Room terminal is available for explicit slot adoption', async ({ page, request }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)

  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-name').fill('Saved Alpha')
  await page.getByTestId('macro-save').click()

  const selector = page.getByTestId('macro-template-select')
  const alphaOption = selector.locator('option', { hasText: 'Saved Alpha' })
  await expect(alphaOption).toHaveCount(1)
  const alphaId = await alphaOption.getAttribute('value')
  expect(alphaId).toBeTruthy()

  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await page.getByTestId('macro-cancel-edit').click()
  await page.getByTestId('macro-edit').click()
  await page.getByTestId('macro-name').fill('Unsaved Alpha edit')
  await expect(page.getByTestId('macro-create')).toBeEnabled()
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Discard unsaved macro changes?')
    await dialog.accept()
  })
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-name').fill('Unsaved Beta')
  await expect(selector).toBeEnabled()
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Discard unsaved macro changes?')
    await dialog.dismiss()
  })
  await selector.selectOption(alphaId!)
  await expect(selector).toHaveValue('')
  await expect(page.getByTestId('macro-name')).toHaveValue('Unsaved Beta')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Discard unsaved macro changes?')
    await dialog.accept()
  })
  await selector.selectOption(alphaId!)
  await expect(page.getByTestId('macro-name')).toHaveValue('Saved Alpha')
  await page.getByTestId('macro-template-search').fill('no matching macro name')
  await expect(selector).toHaveValue(alphaId!)
  await expect(selector.locator('option:checked')).toContainText('Saved Alpha')
  await page.getByTestId('macro-template-search').fill('')

  await page.getByTestId('macro-edit').click()
  await page.getByTestId('macro-name').fill('Unsaved deselect edit')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Discard unsaved macro changes?')
    await dialog.dismiss()
  })
  await selector.selectOption('')
  await expect(selector).toHaveValue(alphaId!)
  await expect(page.getByTestId('macro-name')).toHaveValue('Unsaved deselect edit')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Discard unsaved macro changes?')
    await dialog.accept()
  })
  await selector.selectOption('')
  await expect(selector).toHaveValue('')
  await expect(page.getByTestId('macro-template-summary')).toContainText('No macro selected')
  await expect(page.getByTestId('macro-template-metadata')).toHaveCount(0)

  await selector.selectOption(alphaId!)
  await expect(page.getByTestId('macro-name')).toHaveValue('Saved Alpha')

  await page.getByTestId('macro-edit').click()
  await page.getByTestId('macro-name').fill('Cancelled Alpha edit')
  await page.getByTestId('macro-cancel-edit').click()
  await expect(page.getByTestId('macro-name')).toHaveValue('Saved Alpha')

  const deleteButton = page.getByTestId('macro-delete')
  await expect(deleteButton).toBeEnabled()
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete Saved Alpha?')
    await dialog.accept()
  })
  await deleteButton.click()
  await expect(selector.locator(`option[value="${alphaId}"]`)).toHaveCount(0)
  await expect(page.getByTestId('macro-template-metadata')).toHaveCount(0)

  await page.getByTestId('macro-create').click()
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Discard')
  await page.getByTestId('macro-cancel-edit').click()
  await expect(page.getByTestId('macro-template-metadata')).toHaveCount(0)
  await expect(page.getByTestId('macro-template-summary')).toContainText('No macro selected')

  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  const sendTarget = page.getByTestId('send-terminal')
  await expect(sendTarget.locator('option:checked')).toHaveText('Unassigned')

  await page.getByRole('button', { name: 'New shell', exact: true }).click()
  await page.getByRole('button', { name: 'New shell', exact: true }).click()
  await page.getByRole('button', { name: 'New shell', exact: true }).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(3)
  await expect(sendTarget).toHaveValue('unassigned')
  await expect(sendTarget).toHaveAttribute('data-terminal-select-status', 'unassigned')
  await expect(sendTarget.locator('option:not([value=""])')).toHaveText([
    'Unassigned',
    '1 · shell',
    '2 · shell',
    '3 · shell',
  ])

  await sendTarget.selectOption('3')
  await expect(sendTarget).toHaveValue('3')
  await expect(sendTarget.locator('option:checked')).toHaveText('3 · shell')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('node-remove').click()
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"terminalLayout": []')
  await page.getByTestId('macro-tab-editor').click()

  await openTemplateDrawer(page)
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Discard unsaved macro changes?')
    await dialog.accept()
  })
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  await expect(page.getByTestId('send-terminal').locator('option:checked')).toHaveText('Unassigned')
  await expect(page.getByTestId('send-terminal').locator('option')).toContainText(['1 · shell', '2 · shell', '3 · shell'])
  expect(pageErrors).toEqual([])
})
