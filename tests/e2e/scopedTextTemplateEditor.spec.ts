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

async function inputValues(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value))
}

async function expectLoopTokenControls(scope: Locator, prefix: string) {
  for (const token of ['index', 'key', 'value']) {
    await expect(scope.getByTestId(prefix + '-template-insert-' + token)).toBeVisible()
  }
}

async function textareaHeight(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().height)
}

function adaptiveWrapper(textarea: Locator): Locator {
  return textarea.locator('xpath=ancestor::div[@data-adaptive-textarea="true"][1]')
}

async function exerciseAdaptiveSurface(textarea: Locator, maxRows: number, validHead: string, restoreValue: string) {
  const wrapper = adaptiveWrapper(textarea)
  await expect(wrapper).toHaveAttribute('data-auto-max-rows', String(maxRows))
  await expect(textarea).toHaveCSS('resize', 'vertical')
  await textarea.fill(validHead)
  await expect.poll(() => textareaHeight(textarea)).toBeGreaterThan(0)
  const shortHeight = await textareaHeight(textarea)
  await textarea.fill(validHead + '\nsecond visual line')
  await expect.poll(() => textareaHeight(textarea)).toBeGreaterThan(shortHeight + 1)
  const grownHeight = await textareaHeight(textarea)
  const longValue = validHead + '\nline 2\nline 3\nline 4\nline 5\nline 6'
  await textarea.fill(longValue)
  await expect.poll(() => textarea.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  const cappedHeight = await textareaHeight(textarea)
  expect(cappedHeight).toBeGreaterThanOrEqual(grownHeight - 1)
  const computedAutoCap = await textarea.evaluate((element, rows) => {
    const style = getComputedStyle(element)
    const number = (value: string) => Number.parseFloat(value) || 0
    const lineHeight = number(style.lineHeight) || number(style.fontSize) * 1.45
    const chrome = number(style.paddingTop) + number(style.paddingBottom) + number(style.borderTopWidth) + number(style.borderBottomWidth)
    return rows * lineHeight + chrome
  }, maxRows)
  expect(cappedHeight).toBeLessThanOrEqual(computedAutoCap + 2)
  await expect(textarea).toHaveCSS('overflow-y', 'auto')
  await textarea.fill(validHead)
  await expect.poll(() => textareaHeight(textarea)).toBeLessThan(cappedHeight - 1)
  await expect(wrapper).not.toHaveAttribute('data-manual-height', /.+/)
  await textarea.fill(restoreValue)
  await expect(textarea).toHaveValue(restoreValue)
}

async function simulateNativeVerticalResize(textarea: Locator, targetHeight: number) {
  await textarea.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', buttons: 1 })
  await textarea.evaluate(async (element, height) => {
    element.style.height = height + 'px'
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', bubbles: true }))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }, targetHeight)
}

function editorTemplate(configId: string): MacroTemplate {
  const timestamp = '2026-07-11T00:00:00.000Z'
  return {
    schemaVersion: 2,
    id: 'scoped_template_editor',
    name: 'Scoped text template editor',
    description: 'S1-S6 and exclusion matrix fixture\nAdaptive description',
    configId,
    createdAt: timestamp,
    updatedAt: timestamp,
    body: [
      {
        id: 'root_literal',
        type: 'send',
        terminal,
        message: { parts: [{ kind: 'text', text: 'root keeps {{text}} literal' }] },
        delivery: "direct",
        ending: "cr",
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
      { id: 'root_input_literal', type: 'input', terminal, prompt: 'root input {{text}}', allowEmpty: true, delivery: "direct", ending: "none" },
      { id: 'root_wait_literal', type: 'wait', mode: 'user-continue', prompt: 'root wait {{text}}' },
      {
        id: 'root_parallel_literal',
        type: 'parallel',
        lanes: [{
          id: 'root_lane',
          label: 'root lane literal',
          terminal,
          body: [
            { id: 'root_parallel_send_literal', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'root lane {{text}}' }] }, delivery: "direct", ending: "none" },
            { id: 'root_parallel_output', type: 'output', source: { kind: 'none' } },
          ],
        }],
        merge: { kind: 'sectioned_text', separator: '{laneId}', includeEmptyOutputs: true },
        onLaneFail: 'pause',
      },
      {
        id: 'for_outer',
        type: 'for',
        range: { kind: 'text-list', items: [{ key: 'phase-a', value: 'alpha\nsecond line' }, { key: 'phase-b', value: 'beta' }] },
        body: [
          { id: 'send_s1', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'S1 alpha' }] }, delivery: "direct", ending: "cr" },
          { id: 'send_part_reorder', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'part A' }, { kind: 'text', text: 'part B' }] }, delivery: "direct", ending: "none" },
          {
            id: 'notify_s3_s4',
            type: 'notify',
            level: 'info',
            title: 'S3 title',
            message: { parts: [{ kind: 'text', text: 'S4 body' }] },
            channels: [{ kind: 'app', toast: true, sound: 'none' }],
            onFailure: 'continue',
          },
          { id: 'input_s5', type: 'input', terminal, prompt: 'S5 prompt', allowEmpty: false, delivery: "direct", ending: "cr" },
          { id: 'wait_s6', type: 'wait', mode: 'user-continue', prompt: 'S6 prompt' },
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
            body: [{ id: 'send_count', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'count literal' }] }, delivery: "direct", ending: "cr" }],
          },
          {
            id: 'for_inner',
            type: 'for',
            range: { kind: 'text-list', items: [{ key: 'inner-key', value: 'inner value' }] },
            body: [{ id: 'send_inner', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'inner literal' }] }, delivery: "direct", ending: "cr" }],
          },
          {
            id: 'parallel_scope',
            type: 'parallel',
            lanes: [{
              id: 'lane_scope',
              label: 'static lane label',
              terminal,
              body: [
                { id: 'parallel_send_s2', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'S2 literal' }] }, delivery: "direct", ending: "cr" },
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
      { id: 'root_anchor', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'anchor' }] }, delivery: "direct", ending: "cr" },
      {
        id: 'for_move',
        type: 'for',
        range: { kind: 'text-list', items: [{ key: 'bound-key', value: 'bound-value' }] },
        body: [
          { id: 'move_send', type: 'send', terminal, message: { parts: [{ kind: 'template', template: 'keep {{index}} / {{key}} / {{value}} exactly' }] }, delivery: "direct", ending: "cr" },
          { id: 'scope_filler', type: 'send', terminal, message: { parts: [{ kind: 'text', text: 'keep loop non-empty' }] }, delivery: "direct", ending: "cr" },
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
  const outerKeys = outerItemSection.getByTestId('for-text-list-key')
  const outerValues = outerItemSection.getByTestId('for-text-list-value')
  const outerCards = outerItemSection.getByTestId('for-text-list-item-card')
  await expect(outer.getByTestId('for-text-list-summary').first()).toContainText('text-list · {{index}} · {{key}} · {{value}} · 2 items')
  await expect(outerItemSection.getByTestId('for-text-list-index')).toHaveText(['1', '2'])
  await expect.poll(() => inputValues(outerKeys)).toEqual(['phase-a', 'phase-b'])
  await expect.poll(() => textareaValues(outerValues)).toEqual(['alpha\nsecond line', 'beta'])
  await expect(outerItemSection.getByTestId('message-template-toggle')).toHaveCount(0)
  await outerItemSection.getByTestId('for-text-list-add').click()
  await expect(outerKeys).toHaveCount(3)
  await outerKeys.nth(2).fill('phase-gamma')
  await outerValues.nth(2).fill('gamma\n终')
  await outerCards.nth(2).getByRole('button', { name: 'Up' }).click()
  await expect(outerItemSection.getByTestId('for-text-list-index')).toHaveText(['1', '2', '3'])
  await expect.poll(() => inputValues(outerKeys)).toEqual(['phase-a', 'phase-gamma', 'phase-b'])
  await expect.poll(() => textareaValues(outerValues)).toEqual(['alpha\nsecond line', 'gamma\n终', 'beta'])
  await outerCards.nth(2).getByRole('button', { name: 'Remove' }).click()
  await expect(outerItemSection.getByTestId('for-text-list-index')).toHaveText(['1', '2'])
  await expect.poll(() => inputValues(outerKeys)).toEqual(['phase-a', 'phase-gamma'])
  await expect.poll(() => textareaValues(outerValues)).toEqual(['alpha\nsecond line', 'gamma\n终'])
  await expect(outer.getByTestId('for-text-list-summary').first()).toContainText('2 items')

  const itemATextarea = outerValues.first()
  const itemAWrapper = adaptiveWrapper(itemATextarea)
  await itemAWrapper.evaluate((element) => { element.setAttribute('data-e2e-identity', 'item-a') })
  const itemAAutoHeight = await textareaHeight(itemATextarea)
  await simulateNativeVerticalResize(itemATextarea, itemAAutoHeight + 80)
  await expect(itemAWrapper).toHaveAttribute('data-manual-height', /.+/)
  await itemATextarea.fill('alpha\nsecond line\ninput keeps identity')
  await expect(itemAWrapper).toHaveAttribute('data-e2e-identity', 'item-a')
  await expect(itemAWrapper).toHaveAttribute('data-manual-height', /.+/)
  await itemATextarea.fill('alpha\nsecond line')
  await outerCards.first().getByRole('button', { name: 'Down' }).click()
  await expect.poll(() => textareaValues(outerValues)).toEqual(['gamma\n终', 'alpha\nsecond line'])
  const itemBAtFirstPosition = adaptiveWrapper(outerValues.first())
  await expect(itemBAtFirstPosition).not.toHaveAttribute('data-manual-height', /.+/)
  await expect(itemBAtFirstPosition).not.toHaveAttribute('data-e2e-identity', /.+/)
  await outerCards.nth(1).getByRole('button', { name: 'Up' }).click()
  await expect.poll(() => textareaValues(outerValues)).toEqual(['alpha\nsecond line', 'gamma\n终'])

  const reorderMessage = await nodeEditor(page, 'send_part_reorder')
  const reorderPartTexts = reorderMessage.getByTestId('message-text-part')
  const reorderPartRows = reorderMessage.getByTestId('message-part-row')
  const partATextarea = reorderPartTexts.first()
  const partAWrapper = adaptiveWrapper(partATextarea)
  await partAWrapper.evaluate((element) => { element.setAttribute('data-e2e-identity', 'part-a') })
  const partAAutoHeight = await textareaHeight(partATextarea)
  await simulateNativeVerticalResize(partATextarea, partAAutoHeight + 80)
  await partATextarea.fill('part A edited')
  await expect(partAWrapper).toHaveAttribute('data-e2e-identity', 'part-a')
  await expect(partAWrapper).toHaveAttribute('data-manual-height', /.+/)
  await reorderPartRows.first().getByRole('button', { name: 'Down' }).click()
  await expect.poll(() => textareaValues(reorderPartTexts)).toEqual(['part B', 'part A edited'])
  const partBAtFirstPosition = adaptiveWrapper(reorderPartTexts.first())
  await expect(partBAtFirstPosition).not.toHaveAttribute('data-manual-height', /.+/)
  await expect(partBAtFirstPosition).not.toHaveAttribute('data-e2e-identity', /.+/)
  await reorderPartRows.nth(1).getByRole('button', { name: 'Up' }).click()
  await expect.poll(() => textareaValues(reorderPartTexts)).toEqual(['part A edited', 'part B'])

  const sendS1 = await nodeEditor(page, 'send_s1')
  await expect(sendS1.getByTestId('message-template-toggle')).toBeVisible()
  await expect(sendS1.getByText('Use loop template', { exact: true })).toBeVisible()
  await sendS1.getByTestId('message-template-toggle').check()
  const sendS1Text = sendS1.getByTestId('message-text-part')
  await sendS1Text.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(3, 8))
  await expectLoopTokenControls(sendS1, 'message')
  await sendS1.getByTestId('message-template-insert-index').click()
  await expect(sendS1Text).toHaveValue('S1 {{index}}')
  await sendS1.getByTestId('message-template-insert-key').click()
  await sendS1.getByTestId('message-template-insert-value').click()
  await expect(sendS1Text).toHaveValue('S1 {{index}}{{key}}{{value}}')
  await expect(sendS1.getByTestId('message-template-source')).toHaveText('Available: {{index}} · {{key}} · {{value}} · from for_outer')
  await sendS1Text.fill('{{index}} + {{text}} + {{other}}')
  await expect(sendS1.getByTestId('message-template-syntax-issue')).toContainText('only supports exact {{index}}, {{key}} and {{value}} tokens')
  await sendS1Text.fill('S1 {{index}} {{key}} {{value}}')
  await expect(sendS1.getByTestId('message-template-syntax-issue')).toHaveCount(0)

  const notify = await nodeEditor(page, 'notify_s3_s4')
  await expect(notify.getByTestId('notify-title-template-toggle')).toBeVisible()
  await expect(notify.getByTestId('message-template-toggle')).toBeVisible()
  await notify.getByTestId('notify-title-template-toggle').check()
  await notify.getByTestId('message-template-toggle').check()
  await expectLoopTokenControls(notify, 'notify-title')
  await expectLoopTokenControls(notify, 'message')
  await notify.getByTestId('notify-title-template-insert-index').click()
  await notify.getByTestId('notify-title-template-insert-key').click()
  await notify.getByTestId('notify-title-template-insert-value').click()
  await notify.getByTestId('message-template-insert-index').click()
  await notify.getByTestId('message-template-insert-key').click()
  await notify.getByTestId('message-template-insert-value').click()
  await expect(notify.getByTestId('notify-title-template-tools')).toContainText('from for_outer')
  await expect(notify.getByTestId('message-template-source')).toContainText('from for_outer')

  const input = await nodeEditor(page, 'input_s5')
  await expect(input.getByTestId('input-prompt-template-toggle')).toBeVisible()
  await input.getByTestId('input-prompt-template-toggle').check()
  await expectLoopTokenControls(input, 'input-prompt')
  await input.getByTestId('input-prompt-template-insert-index').click()
  await input.getByTestId('input-prompt-template-insert-key').click()
  await input.getByTestId('input-prompt-template-insert-value').click()
  await expect(input.getByTestId('input-prompt-template-tools')).toContainText('from for_outer')

  const wait = await nodeEditor(page, 'wait_s6')
  await expect(wait.getByTestId('wait-user-continue-prompt-template-toggle')).toBeVisible()
  await wait.getByTestId('wait-user-continue-prompt-template-toggle').check()
  await expectLoopTokenControls(wait, 'wait-user-continue-prompt')
  await wait.getByTestId('wait-user-continue-prompt-template-insert-index').click()
  await wait.getByTestId('wait-user-continue-prompt-template-insert-key').click()
  await wait.getByTestId('wait-user-continue-prompt-template-insert-value').click()
  await expect(wait.getByTestId('wait-user-continue-prompt-template-tools')).toContainText('from for_outer')

  const countSend = await nodeEditor(page, 'send_count')
  await countSend.getByTestId('message-template-toggle').check()
  await expectLoopTokenControls(countSend, 'message')
  await countSend.getByTestId('message-template-insert-value').click()
  await expect(countSend.getByTestId('message-template-source')).toHaveText('Available: {{index}} · {{key}} · {{value}} · from for_outer')

  const innerSend = await nodeEditor(page, 'send_inner')
  await innerSend.getByTestId('message-template-toggle').check()
  await expectLoopTokenControls(innerSend, 'message')
  await innerSend.getByTestId('message-template-insert-key').click()
  await expect(innerSend.getByTestId('message-template-source')).toContainText('Available: {{index}} · {{key}} · {{value}} · from for_inner')
  await expect(innerSend.getByTestId('message-template-source')).toContainText('shadows for_outer')

  const parallel = await nodeEditor(page, 'parallel_scope')
  const parallelSend = await laneActionEditor(page, 'parallel_send_s2')
  await expect(parallelSend.getByTestId('message-template-toggle')).toBeVisible()
  await parallelSend.getByTestId('message-template-toggle').check()
  await expectLoopTokenControls(parallelSend, 'message')
  await parallelSend.getByTestId('message-template-insert-index').click()
  await expect(parallelSend.getByTestId('message-template-source')).toHaveText('Available: {{index}} · {{key}} · {{value}} · from for_outer')

  const notifyMessageText = notify.getByTestId('message-text-part')
  const parallelMessageText = parallelSend.getByTestId('parallel-message-text-part')
  const inputPrompt = input.getByTestId('input-prompt')
  const waitPrompt = wait.getByTestId('wait-user-continue-prompt')
  await expect(notify.getByTestId('notify-title')).toHaveJSProperty('tagName', 'INPUT')
  await expect(adaptiveWrapper(notify.getByTestId('notify-title'))).toHaveCount(0)
  await exerciseAdaptiveSurface(sendS1Text, 3, '{{value}}', 'S1 {{index}} {{key}} {{value}}')
  await exerciseAdaptiveSurface(notifyMessageText, 3, '{{key}}', 'S4 {{index}} {{key}} {{value}}')
  await exerciseAdaptiveSurface(parallelMessageText, 3, '{{index}}', 'S2 {{index}} {{key}} {{value}}')
  await exerciseAdaptiveSurface(outerValues.first(), 3, 'value', 'alpha\nsecond line')
  await exerciseAdaptiveSurface(inputPrompt, 3, '{{value}}', 'S5 {{index}} {{key}} {{value}}')
  await exerciseAdaptiveSurface(waitPrompt, 3, '{{key}}', 'S6 {{index}} {{key}} {{value}}')

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
  await expect(outer.getByTestId('for-text-list-summary').first()).toContainText('text-list · {{index}} · {{key}} · {{value}} · 2 items')
  await outerCollapse.click()
  await expect(outerCollapse).toHaveText('Collapse')

  await page.setViewportSize({ width: 720, height: 900 })
  await sendS1Text.fill('{{value}} ' + 'soft wrapped content '.repeat(80))
  await expect.poll(() => sendS1Text.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  expect(await innerSend.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await sendS1Text.fill('S1 {{index}} {{key}} {{value}}')
  await page.setViewportSize({ width: 1280, height: 720 })
  const automaticHeight = await textareaHeight(sendS1Text)
  await simulateNativeVerticalResize(sendS1Text, automaticHeight + 100)
  await expect(adaptiveWrapper(sendS1Text)).toHaveAttribute('data-manual-height', /.+/)
  const manualHeight = await textareaHeight(sendS1Text)
  await sendS1Text.fill('S1 {{index}} {{key}} {{value}}\npost-resize edit')
  await expect.poll(async () => (await textareaHeight(sendS1Text)) >= manualHeight - 1).toBe(true)
  await simulateNativeVerticalResize(sendS1Text, 5000)
  const hardCappedHeight = await textareaHeight(sendS1Text)
  expect(hardCappedHeight).toBeLessThanOrEqual(720 * 0.6 + 2)
  await sendS1Text.fill('S1 {{index}} {{key}} {{value}}')
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')

  await openTemplateDrawer(page)
  expect(await page.getByTestId('macro-name').evaluate((element) => element.parentElement?.querySelector('input[type="checkbox"]') === null)).toBe(true)
  const descriptionValue = 'S1-S6 and exclusion matrix fixture\nAdaptive description'
  const description = page.getByTestId('macro-description')
  await exerciseAdaptiveSurface(description, 3, 'description', descriptionValue)
  const descriptionAutoHeight = await textareaHeight(description)
  await simulateNativeVerticalResize(description, descriptionAutoHeight + 90)
  const descriptionManualHeight = await textareaHeight(description)
  await expect(adaptiveWrapper(description)).toHaveAttribute('data-manual-height', /.+/)
  await closeTemplateDrawer(page)
  await openTemplateDrawer(page)
  const remountedDescription = page.getByTestId('macro-description')
  await expect(adaptiveWrapper(remountedDescription)).not.toHaveAttribute('data-manual-height', /.+/)
  await expect.poll(() => textareaHeight(remountedDescription)).toBeLessThan(descriptionManualHeight - 1)
  await page.getByTestId('macro-save').click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  const storedResponse = await request.get('/api/configs/' + configId + '/templates/scoped_template_editor')
  const storedBody = await storedResponse.json() as { template: MacroTemplate }
  const storedOuter = storedBody.template.body.find((node) => node.id === 'for_outer')
  expect(storedOuter?.type).toBe('for')
  if (!storedOuter || storedOuter.type !== 'for' || storedOuter.range.kind !== 'text-list') throw new Error('stored outer text-list missing')
  expect(storedOuter.range.items).toEqual([{ key: 'phase-a', value: 'alpha\nsecond line' }, { key: 'phase-gamma', value: 'gamma\n终' }])
  const storedSend = storedOuter.body.find((node) => node.id === 'send_s1')
  expect(storedSend?.type).toBe('send')
  if (!storedSend || storedSend.type !== 'send') throw new Error('stored S1 send missing')
  expect(storedSend.message.parts[0]).toEqual({ kind: 'template', template: 'S1 {{index}} {{key}} {{value}}' })
  const storedNotify = storedOuter.body.find((node) => node.id === 'notify_s3_s4')
  expect(storedNotify?.type).toBe('notify')
  if (!storedNotify || storedNotify.type !== 'notify') throw new Error('stored notify missing')
  expect(storedNotify.title).toEqual({ kind: 'template', template: 'S3 title{{index}}{{key}}{{value}}' })
  expect(storedNotify.message.parts[0]).toEqual({ kind: 'template', template: 'S4 {{index}} {{key}} {{value}}' })
  const storedInput = storedOuter.body.find((node) => node.id === 'input_s5')
  const storedWait = storedOuter.body.find((node) => node.id === 'wait_s6')
  expect(storedInput?.type === 'input' ? storedInput.prompt : undefined).toEqual({ kind: 'template', template: 'S5 {{index}} {{key}} {{value}}' })
  expect(storedWait?.type === 'wait' && storedWait.mode === 'user-continue' ? storedWait.prompt : undefined).toEqual({ kind: 'template', template: 'S6 {{index}} {{key}} {{value}}' })

  await page.reload()
  await selectTemplate(page, 'scoped_template_editor')
  const reloadedOuter = await nodeEditor(page, 'for_outer')
  await expect.poll(() => inputValues(reloadedOuter.locator(':scope > .text-list-items').getByTestId('for-text-list-key'))).toEqual(['phase-a', 'phase-gamma'])
  await expect.poll(() => textareaValues(reloadedOuter.locator(':scope > .text-list-items').getByTestId('for-text-list-value'))).toEqual(['alpha\nsecond line', 'gamma\n终'])
  const reloadedSend = await nodeEditor(page, 'send_s1')
  await expect(reloadedSend.getByTestId('message-template-toggle')).toBeChecked()
  await expect(adaptiveWrapper(reloadedSend.getByTestId('message-text-part'))).not.toHaveAttribute('data-manual-height', /.+/)
  await expect((await nodeEditor(page, 'notify_s3_s4')).getByTestId('notify-title-template-toggle')).toBeChecked()
  await expect((await laneActionEditor(page, 'parallel_send_s2')).getByTestId('message-template-toggle')).toBeChecked()

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('discard its items')
    await dialog.dismiss()
  })
  const reloadedOuterMode = reloadedOuter.locator(':scope > .macro-row select[data-testid="for-range-mode"]')
  await reloadedOuterMode.selectOption('count')
  await expect(reloadedOuterMode).toHaveValue('text-list')
  await expect.poll(() => textareaValues(reloadedOuter.locator(':scope > .text-list-items').getByTestId('for-text-list-value'))).toEqual(['alpha\nsecond line', 'gamma\n终'])
  await page.getByTestId('macro-control-start').click()
  const runtimeInput = page.getByTestId('macro-run-input-text')
  await expect(runtimeInput).toBeVisible({ timeout: 10_000 })
  await exerciseAdaptiveSurface(runtimeInput, 4, 'runtime', '')
  await page.getByTestId('macro-control-stop').click({ force: true })
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
  await expect(scopedSend.getByTestId('message-template-source')).toHaveText('Available: {{index}} · {{key}} · {{value}} · from for_move')

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
  await expect(movedSend.getByTestId('message-text-part')).toHaveValue('keep {{index}} / {{key}} / {{value}} exactly')
  await expect(movedSend.getByTestId('message-template-scope-issue')).toContainText('needs an enclosing text-list for')
  await expect(movedSend.locator('[data-testid^="message-template-insert-"]')).toHaveCount(0)
  await expect(page.getByTestId('macro-validation-summary')).not.toHaveText('success')

  const forMove = await nodeEditor(page, 'for_move')
  await forMove.getByTestId('node-add-inside-for').click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await page.getByTestId('macro-move-existing-select').selectOption('move_send')
  await page.getByTestId('macro-move-existing').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)

  const returnedSend = await nodeEditor(page, 'move_send')
  await expect(returnedSend.getByTestId('message-template-toggle')).toBeChecked()
  await expect(returnedSend.getByTestId('message-text-part')).toHaveValue('keep {{index}} / {{key}} / {{value}} exactly')
  await expect(returnedSend.getByTestId('message-template-source')).toHaveText('Available: {{index}} · {{key}} · {{value}} · from for_move')
  await expect(returnedSend.getByTestId('message-template-scope-issue')).toHaveCount(0)
  await expectLoopTokenControls(returnedSend, 'message')
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
  await expect(movedAgain.getByTestId('message-text-part')).toHaveValue('keep {{index}} / {{key}} / {{value}} exactly')
  await expect(movedAgain.getByTestId('message-template-scope-issue')).toContainText('needs an enclosing text-list for')
  await expect(movedAgain.locator('[data-testid^="message-template-insert-"]')).toHaveCount(0)

  await movedAgainToggle.click()
  await expect(movedAgain.getByTestId('message-template-toggle')).toHaveCount(0)
  await expect(movedAgain.getByTestId('message-template-scope-issue')).toHaveCount(0)
  await expect(movedAgain.getByTestId('message-text-part')).toHaveValue('keep {{index}} / {{key}} / {{value}} exactly')
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
  await expect(movedAgain.getByTestId('message-part-row')).toContainText('1. text')
})
