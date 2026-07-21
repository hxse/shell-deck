import { expect, test } from 'playwright/test'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), { data: { expectedRoomGeneration: room.roomGeneration } })))
})

test('V5 Macro workbench saves without terminals, prepares only on click, and keeps JSON edit locked until Save or Cancel', async ({ page, request }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)

  await expect(page.getByTestId('macro-side-panel')).toBeVisible()
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('macro-prepare-terminals')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)

  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).not.toContainText('Auto-prepare')
  await expect(page.getByTestId('macro-insertion-placement')).toBeVisible()
  await expect(page.getByTestId('notification-volume')).toBeVisible()
  await page.getByTestId('settings-popover').getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-terminal-layout')).toHaveCount(0)
  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  await page.getByTestId('send-terminal').selectOption('1')
  await expect(page.getByTestId('send-terminal')).toHaveValue('1')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('terminal-tab-close').click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)

  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await page.getByTestId('macro-template-drawer').click()

  // Save is portable-only: it neither creates nor prepares a terminal.
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('macro-prepare-terminals')).toHaveAttribute('aria-disabled', 'false')

  await page.getByTestId('macro-prepare-terminals').click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
  await expect(page.getByTestId('text-box-editor')).toBeVisible()
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'false')

  await page.getByTestId('macro-control-start').click()
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  await expect(page.getByTestId('macro-editor-lock-surface')).toBeEnabled()
  await expect(page.getByRole('button', { name: 'New shell', exact: true })).toBeEnabled()

  await openTemplateDrawer(page)
  await page.getByTestId('macro-description').fill('Editable after completed run')
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await page.getByTestId('macro-template-drawer').click()

  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"schemaVersion": 5')
  await expect(page.getByTestId('macro-json-preview')).not.toContainText('terminalId')
  await page.getByTestId('macro-edit-json').click()
  await expect(page.getByTestId('macro-json-editor')).toBeVisible()
  await expect(page.getByTestId('macro-tab-editor')).toBeDisabled()
  await expect(page.getByTestId('macro-tab-trace')).toBeDisabled()
  await page.getByTestId('macro-json-editor').fill('{')
  await page.getByTestId('macro-save-json').click()
  await expect(page.getByTestId('macro-json-error')).toContainText('Invalid JSON')
  await expect(page.getByTestId('macro-json-editor')).toBeVisible()
  await page.getByTestId('macro-cancel-json').click()
  await expect(page.getByTestId('macro-tab-editor')).toBeEnabled()

  await page.getByTestId('macro-tab-trace').click()
  await expect(page.getByTestId('macro-trace-runs')).toContainText('completed')
  await expect(page.getByTestId('macro-trace-view')).toContainText('run_started')
  await expect(page.getByRole('button', { name: /Duplicate|Import|Export/ })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('valid V5 JSON keeps its exact edit buffer open when update or create persistence fails', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-save').click()
  await page.getByTestId('macro-template-drawer').click()

  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  const updateCandidate = JSON.parse(await page.getByTestId('macro-json-editor').inputValue()) as Record<string, unknown>
  updateCandidate.name = 'V5 JSON update must survive'
  const updateText = JSON.stringify(updateCandidate, null, 2)
  await page.getByTestId('macro-json-editor').fill(updateText)
  await page.route('**/api/templates/*', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'content_revision_conflict' }) })
    } else await route.continue()
  })
  await page.getByTestId('macro-save-json').click()
  await expect(page.getByTestId('macro-json-error')).toContainText('content_revision_conflict')
  await expect(page.getByTestId('macro-json-editor')).toHaveValue(updateText)
  await expect(page.getByTestId('macro-tab-editor')).toBeDisabled()
  await page.unroute('**/api/templates/*')
  await page.getByTestId('macro-cancel-json').click()

  await page.getByTestId('macro-tab-editor').click()
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  const createCandidate = JSON.parse(await page.getByTestId('macro-json-editor').inputValue()) as Record<string, unknown>
  createCandidate.name = 'V5 JSON create must survive'
  const createText = JSON.stringify(createCandidate, null, 2)
  await page.getByTestId('macro-json-editor').fill(createText)
  await page.route('**/api/templates', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'synthetic_create_failure' }) })
    } else await route.continue()
  })
  await page.getByTestId('macro-save-json').click()
  await expect(page.getByTestId('macro-json-error')).toContainText('synthetic_create_failure')
  await expect(page.getByTestId('macro-json-editor')).toHaveValue(createText)
  await expect(page.getByTestId('macro-tab-editor')).toBeDisabled()
  await page.unroute('**/api/templates')
})

test('V5 visual editor preserves anchored insertion, nested blocks and explicit collapse state', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByRole('button', { name: 'New shell', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Flow V2 Body' })).toBeVisible()
  await page.getByTestId('empty-body-add').click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await expect(page.getByTestId('add-step-send')).toBeFocused()
  await page.getByTestId('add-flow-for').click()

  const forBody = page.locator('[data-testid="flow-block"][data-flow-body-label="for body"]')
  await expect(forBody.getByTestId('empty-body-add')).toHaveText('Add inside')
  await forBody.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(forBody.getByTestId('node-id-input')).toHaveValue('send')

  const rootFor = page.locator('[data-testid="flow-block"][data-flow-body-label="Root body"] > .flow-node-editor').first()
  const rootToggle = rootFor.getByTestId('node-toggle-collapse').first()
  await rootToggle.click()
  await expect(rootFor.getByTestId('node-collapsed-badge').first()).toHaveText('Collapsed')
  await expect(rootToggle).toHaveAttribute('title', 'Expand')
  await rootToggle.click()
  await expect(rootFor.getByTestId('node-collapsed-badge')).toHaveCount(0)
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

test('dirty Start serializes Save and keeps the visual draft inert until the bound response commits', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  await page.getByTestId('send-terminal').selectOption('1')
  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-prepare-terminals').click()
  await expect(page.getByTestId('macro-control-start')).toHaveAttribute('aria-disabled', 'false')

  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await page.getByTestId('macro-name').fill('Dirty bound start')
  await page.getByTestId('macro-template-drawer').click()

  const gate = deferredGate()
  let updatePending = false
  let startRequested = false
  await page.route('**/api/templates/*', async (route) => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    const response = await route.fetch()
    updatePending = true
    await gate.wait
    await route.fulfill({ response })
  })
  await page.route('**/api/rooms/*/runner/start', async (route) => {
    startRequested = true
    await route.continue()
  })

  await page.getByTestId('macro-control-start').click()
  await expect.poll(() => updatePending).toBe(true)
  expect(startRequested).toBe(false)
  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-name')).toBeDisabled()
  await forceInput(page.getByTestId('macro-name'), 'stale mutation')
  await expect(page.getByTestId('notice-item')).toContainText('Wait for the current operation')
  await page.getByTestId('notice-item').getByRole('button', { name: 'Dismiss notice' }).click()
  await page.getByTestId('macro-template-drawer').click()
  expect(startRequested).toBe(false)

  gate.release()
  await expect.poll(() => startRequested).toBe(true)
  await expect(page.getByTestId('macro-run-status').locator('strong')).toHaveText('completed', { timeout: 5_000 })
  await page.getByTestId('macro-tab-editor').click()
  await expect(page.getByTestId('macro-editor-lock-surface')).toBeEnabled()
  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-cancel-edit')).toHaveText('Done')
  await expect(page.getByTestId('macro-name')).toBeEnabled()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('Dirty bound start')
  await expect(page.getByTestId('macro-json-preview')).not.toContainText('stale mutation')
})

test('Macro panel visibility preserves in-memory draft and unsaved work guards page unload without browser storage', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await page.getByRole('button', { name: 'New shell', exact: true }).click()
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-name').fill('Page memory Macro')
  await page.getByTestId('macro-template-drawer').click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) => value.includes('Page memory Macro')))).toBe(false)

  await expect(page.getByTestId('macro-panel-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('macro-panel-toggle').click()
  await expect(page.getByTestId('macro-panel-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('macro-side-panel')).toBeHidden()
  await page.getByTestId('macro-panel-toggle').click()
  await expect(page.getByTestId('macro-panel-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('macro-side-panel')).toBeVisible()
  await expect(page.getByTestId('send-terminal')).toHaveValue('unassigned')
  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-name')).toHaveValue('Page memory Macro')
  await expect(page.getByTestId('macro-template-metadata')).toContainText('unsaved new macro')
  await page.getByTestId('macro-save').click()
  await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
  await page.getByTestId('macro-template-drawer').click()

  await page.getByTestId('macro-tab-json').click()
  await page.getByTestId('macro-edit-json').click()
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await page.getByTestId('macro-cancel-json').click()
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
})

test('a delayed Prepare HTTP snapshot cannot roll back newer Room WebSocket truth', async ({ page, request }) => {
  const created = await request.post('/api/rooms')
  const room = await created.json() as { url: string }
  await page.goto(room.url)
  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await page.getByTestId('macro-template-drawer').click()
  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()
  await page.getByTestId('send-terminal').selectOption('1')
  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await page.getByTestId('macro-template-drawer').click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('terminal-tab-close').click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)

  const gate = deferredGate()
  let prepareCommitted = false
  await page.route('**/api/rooms/*/terminals/prepare', async (route) => {
    const response = await route.fetch()
    prepareCommitted = true
    await gate.wait
    await route.fulfill({ response })
  })
  await page.getByTestId('macro-prepare-terminals').click()
  await expect.poll(() => prepareCommitted).toBe(true)
  await expect(page.getByTestId('terminal-tab')).toHaveCount(1)

  await page.getByRole('button', { name: 'New text', exact: true }).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
  gate.release()
  await expect(page.getByTestId('macro-prepare-terminals')).toBeEnabled()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(2)
})

async function openTemplateDrawer(page: import('playwright/test').Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

function deferredGate() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { wait, release }
}

async function forceInput(input: import('playwright/test').Locator, value: string) {
  await input.evaluate((element, next) => {
    const target = element as HTMLInputElement
    target.disabled = false
    target.value = next
    target.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
