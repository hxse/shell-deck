import { expect, type Locator, type Page, test } from 'playwright/test'
import type { MacroTemplate } from '../../src/lib/macro/templateTypes'

const terminal = { kind: 'alias' as const, value: 'shell_1' }
const capturedText = { kind: 'step_artifact' as const, stepId: 'capture_scope', artifact: 'captured_text' as const }

async function openTemplateDrawer(page: Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) {
    await page.getByTestId('macro-template-drawer').click()
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

async function closeTemplateDrawer(page: Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() > 0) {
    await page.keyboard.press('Escape')
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toHaveCount(0)
}

async function selectTemplate(page: Page, templateId: string) {
  await openTemplateDrawer(page)
  await page.getByTestId('macro-template-select').selectOption(templateId)
  await closeTemplateDrawer(page)
  await expect(page.getByTestId('macro-step-list')).toBeVisible()
}

async function nodeEditor(page: Page, nodeId: string): Promise<Locator> {
  const inputs = page.getByTestId('node-id-input')
  for (let index = 0; index < await inputs.count(); index += 1) {
    if (await inputs.nth(index).inputValue() === nodeId) {
      return inputs.nth(index).locator('xpath=ancestor::article[contains(concat(" ", normalize-space(@class), " "), " flow-node-editor ")][1]')
    }
  }
  throw new Error('node editor not found: ' + nodeId)
}

async function laneActionEditor(page: Page, actionId: string): Promise<Locator> {
  const inputs = page.getByTestId('parallel-action-id-input')
  for (let index = 0; index < await inputs.count(); index += 1) {
    if (await inputs.nth(index).inputValue() === actionId) {
      return inputs.nth(index).locator('xpath=ancestor::article[contains(concat(" ", normalize-space(@class), " "), " parallel-lane-action ")][1]')
    }
  }
  throw new Error('parallel lane action editor not found: ' + actionId)
}

async function textareaValues(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((elements) => elements.map((element) => (element as HTMLTextAreaElement).value))
}

function editorTemplate(configId: string): MacroTemplate {
  const timestamp = '2026-07-11T00:00:00.000Z'
  return {
    schemaVersion: 2,
    id: 'scoped_template_editor',
    name: 'Scoped text template editor',
    description: 'S1-S6 and exclusion matrix fixture',
    configId,
    createdAt: timestamp,
    updatedAt: timestamp,
    body: [
      {
        id: 'root_literal',
        type: 'send',
        terminal,
        message: { parts: [{ kind: 'text', text: 'root keeps {{text}} literal' }] },
        enter: true,
      },
      {
        id: 'root_notify_literal',
        type: 'notify',
        level: 'info',
        title: 'root title {{text}}',
        message: { parts: [{ kind: 'text', text: 'root message {{text}}' }] },
        channels: [{ kind: 'app', toast: true, sound: 'none' }],
        onFailure: 'continue',
      },
      { id: 'root_input_literal', type: 'input', terminal, prompt: 'root input {{text}}', allowEmpty: true, enter: false },
      { id: 'root_wait_literal', type: 'wait', mode: 'user-continue', prompt: 'root wait {{text}}' },
      {
        id: 'root_parallel_literal',
        type: 'parallel',
        lanes: [{
          id: 'root_lane',
          label: 'root lane literal',
          terminal,
          body: [
            { id: 'root_parallel_send_literal', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'root lane {{text}}' }] }, enter: false },
            { id: 'root_parallel_output', type: 'output', source: { kind: 'none' } },
          ],
        }],
        merge: { kind: 'sectioned_text', separator: '{laneId}', includeEmptyOutputs: true },
        onLaneFail: 'pause',
      },
      {
        id: 'for_outer',
        type: 'for',
        range: { kind: 'text-list', items: ['alpha\nsecond line', 'beta'] },
        body: [
          { id: 'send_s1', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'S1 alpha' }] }, enter: true },
          {
            id: 'notify_s3_s4',
            type: 'notify',
            level: 'info',
            title: 'S3 {{text}}',
            message: { parts: [{ kind: 'text', text: 'S4 {{text}}' }] },
            channels: [{ kind: 'app', toast: true, sound: 'none' }],
            onFailure: 'continue',
          },
          { id: 'input_s5', type: 'input', terminal, prompt: 'S5 {{text}}', allowEmpty: false, enter: true },
          { id: 'wait_s6', type: 'wait', mode: 'user-continue', prompt: 'S6 {{text}}' },
          { id: 'capture_scope', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 20000 } },
          {
            id: 'if_excluded',
            type: 'if',
            branches: [{ kind: 'if', condition: { kind: 'text_match', source: capturedText, matcher: { kind: 'simple', op: 'contains', text: 'READY' }, scope: { kind: 'whole' } }, body: [{ id: 'if_finish_excluded', type: 'finish', reason: 'static condition result' }] }],
          },
          {
            id: 'extract_excluded',
            type: 'extract_text',
            source: capturedText,
            split: { kind: 'regex', pattern: '\\n+', flags: '', keepEmpty: false },
            filters: [
              { kind: 'include', matcher: { kind: 'simple', op: 'contains', text: 'READY' } },
              { kind: 'exclude', matcher: { kind: 'regex', pattern: '^skip$', flags: 'i' } },
            ],
            select: { mode: 'all' },
            extract: { kind: 'regex', pattern: '(READY)', flags: '', group: 1 },
            trim: 'right',
            onEmpty: 'pause',
          },
          {
            id: 'for_count',
            type: 'for',
            range: { kind: 'count', count: 1 },
            body: [{ id: 'send_count', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'count {{text}}' }] }, enter: true }],
          },
          {
            id: 'for_inner',
            type: 'for',
            range: { kind: 'text-list', items: ['inner item'] },
            body: [{ id: 'send_inner', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'inner {{text}}' }] }, enter: true }],
          },
          {
            id: 'parallel_scope',
            type: 'parallel',
            lanes: [{
              id: 'lane_scope',
              label: 'static lane label',
              terminal,
              body: [
                { id: 'parallel_send_s2', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'S2 {{text}}' }] }, enter: true },
                { id: 'parallel_output', type: 'output', source: { kind: 'none' } },
              ],
            }],
            merge: { kind: 'sectioned_text', separator: '\n{laneId}\n', includeEmptyOutputs: false },
            onLaneFail: 'pause',
          },
          { id: 'finish_excluded', type: 'finish', reason: 'static {{text}} reason', body: [] },
        ],
      },
    ],
  }
}

function moveOutTemplate(configId: string): MacroTemplate {
  const timestamp = '2026-07-11T00:00:00.000Z'
  return {
    schemaVersion: 2,
    id: 'scoped_template_move_out',
    name: 'Scoped template move out',
    description: '',
    configId,
    createdAt: timestamp,
    updatedAt: timestamp,
    body: [
      { id: 'root_anchor', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'anchor' }] }, enter: true },
      {
        id: 'for_move',
        type: 'for',
        range: { kind: 'text-list', items: ['bound'] },
        body: [
          { id: 'move_send', type: 'send', terminal, message: { parts: [{ kind: 'template', template: 'keep {{text}} exactly' }] }, enter: true },
          { id: 'scope_filler', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'keep loop non-empty' }] }, enter: true },
        ],
      },
    ],
  }
}

test('text-list editor persists multiline items and exposes only S1-S6 scoped template controls', async ({ page, request }) => {
  const configId = 'scoped-template-editor-' + Date.now()
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const imported = await request.post('/api/configs/' + configId + '/templates/import', { data: editorTemplate(configId) })
  expect(imported.status(), await imported.text()).toBe(201)

  await page.goto('/?configId=' + configId)
  await selectTemplate(page, 'scoped_template_editor')

  const rootLiteral = await nodeEditor(page, 'root_literal')
  await expect(rootLiteral.getByTestId('message-text-part')).toHaveValue('root keeps {{text}} literal')
  await expect(rootLiteral.getByTestId('message-template-toggle')).toHaveCount(0)

  const rootNotify = await nodeEditor(page, 'root_notify_literal')
  await expect(rootNotify.getByTestId('notify-title-template-toggle')).toHaveCount(0)
  await expect(rootNotify.getByTestId('message-template-toggle')).toHaveCount(0)
  await expect((await nodeEditor(page, 'root_input_literal')).getByTestId('input-prompt-template-toggle')).toHaveCount(0)
  await expect((await nodeEditor(page, 'root_wait_literal')).getByTestId('wait-user-continue-prompt-template-toggle')).toHaveCount(0)
  await expect((await laneActionEditor(page, 'root_parallel_send_literal')).getByTestId('message-template-toggle')).toHaveCount(0)

  const outer = await nodeEditor(page, 'for_outer')
  const outerItemSection = outer.locator(':scope > .text-list-items')
  const outerItems = outerItemSection.getByTestId('for-text-list-item')
  await expect(outer.getByTestId('for-text-list-summary').first()).toContainText('text-list · {{text}} · 2 items')
  await expect.poll(() => textareaValues(outerItems)).toEqual(['alpha\nsecond line', 'beta'])
  await expect(outerItemSection.getByTestId('message-template-toggle')).toHaveCount(0)
  await outerItemSection.getByTestId('for-text-list-add').click()
  await expect(outerItems).toHaveCount(3)
  await outerItems.nth(2).fill('gamma\n终')
  await outerItemSection.getByTestId('for-text-list-item-card').nth(2).getByRole('button', { name: 'Up' }).click()
  await expect.poll(() => textareaValues(outerItems)).toEqual(['alpha\nsecond line', 'gamma\n终', 'beta'])
  await outerItemSection.getByTestId('for-text-list-item-card').nth(2).getByRole('button', { name: 'Remove' }).click()
  await expect.poll(() => textareaValues(outerItems)).toEqual(['alpha\nsecond line', 'gamma\n终'])
  await expect(outer.getByTestId('for-text-list-summary').first()).toContainText('2 items')

  const sendS1 = await nodeEditor(page, 'send_s1')
  await expect(sendS1.getByTestId('message-template-toggle')).toBeVisible()
  await sendS1.getByTestId('message-template-toggle').check()
  const sendS1Text = sendS1.getByTestId('message-text-part')
  await sendS1Text.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(3, 8))
  await sendS1.getByTestId('message-template-insert').click()
  await expect(sendS1Text).toHaveValue('S1 {{text}}')
  await expect(sendS1.getByTestId('message-template-source')).toHaveText('Available: {{text}} · from for_outer')
  await sendS1Text.fill('{{text}} + {{other}}')
  await expect(sendS1.getByTestId('message-template-syntax-issue')).toContainText('only supports exact {{text}} token')
  await sendS1Text.fill('S1 {{text}}')
  await expect(sendS1.getByTestId('message-template-syntax-issue')).toHaveCount(0)

  const notify = await nodeEditor(page, 'notify_s3_s4')
  await expect(notify.getByTestId('notify-title-template-toggle')).toBeVisible()
  await expect(notify.getByTestId('message-template-toggle')).toBeVisible()
  await notify.getByTestId('notify-title-template-toggle').check()
  await notify.getByTestId('message-template-toggle').check()
  await expect(notify.getByTestId('notify-title-template-tools')).toContainText('from for_outer')
  await expect(notify.getByTestId('message-template-source')).toContainText('from for_outer')

  const input = await nodeEditor(page, 'input_s5')
  await expect(input.getByTestId('input-prompt-template-toggle')).toBeVisible()
  await input.getByTestId('input-prompt-template-toggle').check()
  await expect(input.getByTestId('input-prompt-template-tools')).toContainText('from for_outer')

  const wait = await nodeEditor(page, 'wait_s6')
  await expect(wait.getByTestId('wait-user-continue-prompt-template-toggle')).toBeVisible()
  await wait.getByTestId('wait-user-continue-prompt-template-toggle').check()
  await expect(wait.getByTestId('wait-user-continue-prompt-template-tools')).toContainText('from for_outer')

  const countSend = await nodeEditor(page, 'send_count')
  await countSend.getByTestId('message-template-toggle').check()
  await expect(countSend.getByTestId('message-template-source')).toHaveText('Available: {{text}} · from for_outer')

  const innerSend = await nodeEditor(page, 'send_inner')
  await innerSend.getByTestId('message-template-toggle').check()
  await expect(innerSend.getByTestId('message-template-source')).toContainText('Available: {{text}} · from for_inner')
  await expect(innerSend.getByTestId('message-template-source')).toContainText('shadows for_outer')

  const parallel = await nodeEditor(page, 'parallel_scope')
  const parallelSend = await laneActionEditor(page, 'parallel_send_s2')
  await expect(parallelSend.getByTestId('message-template-toggle')).toBeVisible()
  await parallelSend.getByTestId('message-template-toggle').check()
  await expect(parallelSend.getByTestId('message-template-source')).toHaveText('Available: {{text}} · from for_outer')

  const ifExcluded = await nodeEditor(page, 'if_excluded')
  const extractExcluded = await nodeEditor(page, 'extract_excluded')
  const finishExcluded = await nodeEditor(page, 'finish_excluded')
  await expect(ifExcluded.locator('input[data-testid$="-template-toggle"]')).toHaveCount(0)
  await expect(extractExcluded.locator('input[data-testid$="-template-toggle"]')).toHaveCount(0)
  await expect(finishExcluded.locator('input[data-testid$="-template-toggle"]')).toHaveCount(0)
  expect(await parallel.getByLabel('Separator').evaluate((element) => element.parentElement?.querySelector('input[type="checkbox"]') === null)).toBe(true)
  expect(await parallel.getByLabel('Label').evaluate((element) => element.parentElement?.querySelector('input[type="checkbox"]') === null)).toBe(true)

  const outerCollapse = outer.locator(':scope > .step-title').getByTestId('node-toggle-collapse')
  await outerCollapse.click()
  await expect(outerCollapse).toHaveText('Expand')
  await expect(outer.getByTestId('for-text-list-summary').first()).toContainText('text-list · {{text}} · 2 items')
  await outerCollapse.click()
  await expect(outerCollapse).toHaveText('Collapse')

  await page.setViewportSize({ width: 720, height: 900 })
  expect(await innerSend.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')

  await openTemplateDrawer(page)
  expect(await page.getByTestId('macro-name').evaluate((element) => element.parentElement?.querySelector('input[type="checkbox"]') === null)).toBe(true)
  await page.getByTestId('macro-save').click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  const storedResponse = await request.get('/api/configs/' + configId + '/templates/scoped_template_editor')
  const storedBody = await storedResponse.json() as { template: MacroTemplate }
  const storedOuter = storedBody.template.body.find((node) => node.id === 'for_outer')
  expect(storedOuter?.type).toBe('for')
  if (!storedOuter || storedOuter.type !== 'for' || storedOuter.range.kind !== 'text-list') throw new Error('stored outer text-list missing')
  expect(storedOuter.range.items).toEqual(['alpha\nsecond line', 'gamma\n终'])
  const storedSend = storedOuter.body.find((node) => node.id === 'send_s1')
  expect(storedSend?.type).toBe('send')
  if (!storedSend || storedSend.type !== 'send') throw new Error('stored S1 send missing')
  expect(storedSend.message.parts[0]).toEqual({ kind: 'template', template: 'S1 {{text}}' })
  const storedNotify = storedOuter.body.find((node) => node.id === 'notify_s3_s4')
  expect(storedNotify?.type).toBe('notify')
  if (!storedNotify || storedNotify.type !== 'notify') throw new Error('stored notify missing')
  expect(storedNotify.title).toEqual({ kind: 'template', template: 'S3 {{text}}' })
  expect(storedNotify.message.parts[0]).toEqual({ kind: 'template', template: 'S4 {{text}}' })
  const storedInput = storedOuter.body.find((node) => node.id === 'input_s5')
  const storedWait = storedOuter.body.find((node) => node.id === 'wait_s6')
  expect(storedInput?.type === 'input' ? storedInput.prompt : undefined).toEqual({ kind: 'template', template: 'S5 {{text}}' })
  expect(storedWait?.type === 'wait' && storedWait.mode === 'user-continue' ? storedWait.prompt : undefined).toEqual({ kind: 'template', template: 'S6 {{text}}' })

  await page.reload()
  await selectTemplate(page, 'scoped_template_editor')
  const reloadedOuter = await nodeEditor(page, 'for_outer')
  await expect.poll(() => textareaValues(reloadedOuter.locator(':scope > .text-list-items').getByTestId('for-text-list-item'))).toEqual(['alpha\nsecond line', 'gamma\n终'])
  await expect((await nodeEditor(page, 'send_s1')).getByTestId('message-template-toggle')).toBeChecked()
  await expect((await nodeEditor(page, 'notify_s3_s4')).getByTestId('notify-title-template-toggle')).toBeChecked()
  await expect((await laneActionEditor(page, 'parallel_send_s2')).getByTestId('message-template-toggle')).toBeChecked()

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('discard its items')
    await dialog.dismiss()
  })
  const reloadedOuterMode = reloadedOuter.locator(':scope > .macro-row select[data-testid="for-range-mode"]')
  await reloadedOuterMode.selectOption('count')
  await expect(reloadedOuterMode).toHaveValue('text-list')
  await expect.poll(() => textareaValues(reloadedOuter.locator(':scope > .text-list-items').getByTestId('for-text-list-item'))).toEqual(['alpha\nsecond line', 'gamma\n终'])
})

test('moving a template consumer out of scope and back preserves its binding until the user explicitly turns template off', async ({ page, request }) => {
  const configId = 'scoped-template-move-out-' + Date.now()
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const imported = await request.post('/api/configs/' + configId + '/templates/import', { data: moveOutTemplate(configId) })
  expect(imported.status()).toBe(201)

  await page.goto('/?configId=' + configId)
  await selectTemplate(page, 'scoped_template_move_out')
  const scopedSend = await nodeEditor(page, 'move_send')
  await expect(scopedSend.getByTestId('message-template-toggle')).toBeChecked()
  await expect(scopedSend.getByTestId('message-template-source')).toHaveText('Available: {{text}} · from for_move')

  const rootAnchor = await nodeEditor(page, 'root_anchor')
  await rootAnchor.getByTestId('node-add-after').click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await expect(page.getByTestId('macro-move-existing-select').locator('option[value="move_send"]')).toHaveText(/move_send/)
  await page.getByTestId('macro-move-existing-select').selectOption('move_send')
  await page.getByTestId('macro-move-existing').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)

  const movedSend = await nodeEditor(page, 'move_send')
  const movedToggle = movedSend.getByTestId('message-template-toggle')
  await expect(movedToggle).toBeChecked()
  await expect(movedSend.getByTestId('message-text-part')).toHaveValue('keep {{text}} exactly')
  await expect(movedSend.getByTestId('message-template-scope-issue')).toContainText('needs an enclosing text-list for')
  await expect(movedSend.getByTestId('message-template-insert')).toHaveCount(0)
  await expect(page.getByTestId('macro-validation-summary')).not.toHaveText('success')

  const forMove = await nodeEditor(page, 'for_move')
  await forMove.getByTestId('node-add-inside-for').click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await page.getByTestId('macro-move-existing-select').selectOption('move_send')
  await page.getByTestId('macro-move-existing').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)

  const returnedSend = await nodeEditor(page, 'move_send')
  await expect(returnedSend.getByTestId('message-template-toggle')).toBeChecked()
  await expect(returnedSend.getByTestId('message-text-part')).toHaveValue('keep {{text}} exactly')
  await expect(returnedSend.getByTestId('message-template-source')).toHaveText('Available: {{text}} · from for_move')
  await expect(returnedSend.getByTestId('message-template-scope-issue')).toHaveCount(0)
  await expect(returnedSend.getByTestId('message-template-insert')).toBeVisible()
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')

  const rootAnchorAgain = await nodeEditor(page, 'root_anchor')
  await rootAnchorAgain.getByTestId('node-add-after').click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await page.getByTestId('macro-move-existing-select').selectOption('move_send')
  await page.getByTestId('macro-move-existing').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)

  const movedAgain = await nodeEditor(page, 'move_send')
  const movedAgainToggle = movedAgain.getByTestId('message-template-toggle')
  await expect(movedAgainToggle).toBeChecked()
  await expect(movedAgain.getByTestId('message-text-part')).toHaveValue('keep {{text}} exactly')
  await expect(movedAgain.getByTestId('message-template-scope-issue')).toContainText('needs an enclosing text-list for')
  await expect(movedAgain.getByTestId('message-template-insert')).toHaveCount(0)

  await movedAgainToggle.click()
  await expect(movedAgain.getByTestId('message-template-toggle')).toHaveCount(0)
  await expect(movedAgain.getByTestId('message-template-scope-issue')).toHaveCount(0)
  await expect(movedAgain.getByTestId('message-text-part')).toHaveValue('keep {{text}} exactly')
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
  await expect(movedAgain.getByTestId('message-part-row')).toContainText('1. text')
})
