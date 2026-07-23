import { expect, type Page } from 'playwright/test'
import {
  clickWithDialog,
  closeTemplateDrawer,
  createTerminal,
  dragResizeHandle,
  exerciseInputDelivery,
  exerciseNodeChrome,
  flowBody,
  insertRoot,
  nodeControl,
  openTemplateDrawer,
  rootNodes,
  selectOptionContaining,
  terminalHost,
  terminalIdAt,
  terminalTab,
  type MacroJourneyState,
} from './comprehensiveMacroUiBehaviorCurrent.helpers'

export async function operateWorkspace(page: Page, state: MacroJourneyState): Promise<void> {
  let { fakeOneId, fakeTwoId, realId, spareShellId, textId } = state
  await expect(page.getByTestId('macro-panel-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('macro-panel-toggle').click()
  await expect(page.getByTestId('macro-panel-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('macro-panel')).toHaveCount(1)
  await expect(page.getByTestId('macro-side-panel')).toBeHidden()
  await page.getByTestId('macro-panel-toggle').click()
  await expect(page.getByTestId('macro-panel-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('macro-panel')).toBeVisible()


  await page.getByTestId('settings-button').click()
  await expect(page.getByTestId('settings-popover')).toBeVisible()
  await page.getByTestId('macro-insertion-placement').click()
  await expect(page.getByTestId('macro-insertion-placement')).toContainText('center')
  await page.getByTestId('notification-volume').fill('170')
  await expect(page.getByTestId('notification-volume-output')).toHaveText('170%')
  await page.getByTestId('notification-success-sound-test').click()
  await page.getByTestId('tab-drag-toggle').click()
  await expect(page.getByTestId('tab-drag-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('settings-popover')).toHaveCount(0)

  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-dismiss-layer').click()
  await expect(page.getByTestId('settings-popover')).toHaveCount(0)

  await createTerminal(page, 'terminal-create-real', 1)
  await createTerminal(page, 'terminal-create-real', 2)
  await createTerminal(page, 'terminal-create-real', 3)
  await createTerminal(page, 'terminal-create-real', 4)
  await createTerminal(page, 'terminal-create-text', 5)

  fakeOneId = await terminalIdAt(page, 0)
  fakeTwoId = await terminalIdAt(page, 1)
  realId = await terminalIdAt(page, 2)
  spareShellId = await terminalIdAt(page, 3)
  textId = await terminalIdAt(page, 4)


  await terminalTab(page, fakeTwoId).focus()
  await page.keyboard.press(' ')
  await expect(terminalTab(page, fakeTwoId)).toHaveAttribute('aria-selected', 'true')

  await terminalTab(page, fakeOneId).dragTo(terminalTab(page, fakeTwoId))
  await expect.poll(async () => await terminalIdAt(page, 1)).toBe(fakeOneId)
  await terminalTab(page, fakeOneId).dragTo(terminalTab(page, fakeTwoId))
  await expect.poll(async () => await terminalIdAt(page, 0)).toBe(fakeOneId)

  await terminalTab(page, fakeOneId).click()
  const fakeOneHost = terminalHost(page, fakeOneId)
  await fakeOneHost.click()
  await page.keyboard.type('UI_FAKE_031B')
  await page.keyboard.press('Enter')
  await expect(fakeOneHost).toHaveAttribute('data-rendered-tail', /UI_FAKE_031B/)

  await terminalTab(page, realId).click()
  const realHost = terminalHost(page, realId)
  await realHost.click()
  await page.keyboard.type("printf 'UI_REAL_031B\\n'")
  await page.keyboard.press('Enter')
  await expect(realHost).toHaveAttribute('data-rendered-tail', /UI_REAL_031B/, { timeout: 10_000 })

  await terminalTab(page, textId).click()
  const textEditor = page.getByTestId('text-box-editor')
  const textSeed = Array.from({ length: 160 }, (_, index) => `dogfood text line ${index + 1}`).join('\n')
  await textEditor.fill(textSeed)
  await expect(page.getByTestId('text-box-line-number-list').locator(':scope > div')).toHaveCount(160)
  await textEditor.evaluate((element) => {
    element.scrollTop = 18
    element.dispatchEvent(new Event('scroll'))
  })
  await expect.poll(async () => await page.getByTestId('text-box-line-number-list').getAttribute('style')).toContain('translateY(-18px)')
  await page.getByTestId('text-box-copy').click()
  await expect.poll(async () => await page.evaluate(() => navigator.clipboard.readText())).toBe(textSeed)

  await createTerminal(page, 'terminal-create-real', 6)
  const temporaryId = await terminalIdAt(page, 5)
  await clickWithDialog(
    terminalTab(page, temporaryId).getByTestId('terminal-tab-close'),
    'dismiss',
    'Close terminal',
  )
  await expect(page.getByTestId('terminal-tab')).toHaveCount(6)
  await clickWithDialog(
    terminalTab(page, temporaryId).getByTestId('terminal-tab-close'),
    'accept',
    'Close terminal',
  )
  await expect(page.getByTestId('terminal-tab')).toHaveCount(5)

  await dragResizeHandle(page, 'macro-resize-handle', -54)
  await page.getByTestId('macro-reset-width').click()

  await page.getByTestId('settings-button').click()
  await page.getByTestId('macro-insertion-placement').click()
  await expect(page.getByTestId('macro-insertion-placement')).toContainText('near')
  await page.getByTestId('settings-dismiss-layer').click()
  Object.assign(state, { fakeOneId, fakeTwoId, realId, spareShellId, textId })
}

export async function createMacroChrome(page: Page): Promise<void> {
  await openTemplateDrawer(page)
  await page.getByTestId('macro-template-search').fill('nothing-yet')
  await expect(page.getByTestId('macro-template-select').locator('option')).toContainText(['No saved macros'])
  await page.getByTestId('macro-template-search').fill('')
  await page.getByTestId('macro-template-dismiss-layer').click()
  await expect(page.getByTestId('macro-template-drawer-body')).toHaveCount(0)

  await openTemplateDrawer(page)
  await page.getByTestId('macro-create').click()
  await expect(page.getByTestId('macro-name')).toHaveValue('New Macro')
  await page.getByTestId('macro-name').fill('031B Full Offline Dogfood')
  await page.getByTestId('macro-description').fill('Built entirely through the visual UI.\nNo API fixture.')
  await closeTemplateDrawer(page)

  await page.getByTestId('macro-validation-toggle').click()
  await expect(page.getByTestId('macro-validation')).toHaveAttribute('open', '')
  await page.getByTestId('macro-validation-toggle').click()

  await page.getByTestId('empty-body-add').click()
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await page.getByTestId('macro-insertion-cancel').click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('macro-insertion-cancel-scrim').click({ position: { x: 2, y: 2 } })
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)

  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-flow-if').click()
  const incompleteIf = rootNodes(page).last()
  await expect(incompleteIf).toHaveAttribute('data-flow-node-type', 'if')
  const incompleteIfBranches = incompleteIf.getByTestId('if-branch-section')
  await expect(incompleteIfBranches).toHaveCount(1)
  await expect(incompleteIfBranches.first().getByTestId('condition-source')).toHaveValue('')
  await expect(incompleteIfBranches.first().getByTestId('condition-source').locator('option:checked')).toHaveText('Unassigned')
  await expect(incompleteIfBranches.first().getByTestId('condition-source-warning')).toBeVisible()
  await incompleteIfBranches.first().getByTestId('add-flow-elif').click()
  await expect(incompleteIfBranches).toHaveCount(2)
  await expect(incompleteIfBranches.nth(1).getByTestId('condition-source')).toHaveValue('')
  await expect(page.getByTestId('macro-validation-summary')).not.toHaveText('success')
  await page.getByTestId('macro-validation-toggle').click()
  await expect(page.getByTestId('macro-validation')).toContainText('body[0].branches[0].body')
  await expect(page.getByTestId('macro-validation')).toContainText('body must not be empty')
  await clickWithDialog(nodeControl(incompleteIf, 'node-remove'), 'accept')
  await expect(rootNodes(page)).toHaveCount(0)
  await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
}

export async function buildMainActions(page: Page): Promise<void> {
  const sendRoot = await insertRoot(page, 'add-step-send', 'send_root')
  await selectOptionContaining(sendRoot.getByTestId('send-terminal'), '1 · shell')
  await exerciseInputDelivery(sendRoot, 'send')
  await sendRoot.getByTestId('send-ending-sequence').selectOption('lf')
  await sendRoot.getByTestId('send-ending-sequence').selectOption('cr')
  await sendRoot.getByTestId('message-add-text').click()
  await sendRoot.getByTestId('message-text-part').fill('DOG_ROOT')
  await sendRoot.getByTestId('message-add-text').click()
  await sendRoot.getByTestId('message-text-part').nth(1).fill('TEMP_PART')
  await sendRoot.getByTestId('message-part-up').nth(1).click()
  await sendRoot.getByTestId('message-part-down').first().click()
  await sendRoot.getByTestId('message-part-remove').nth(1).click()
  await sendRoot.getByTestId('message-add-source').click()
  await expect(sendRoot.getByTestId('message-source-part')).toHaveValue('')
  await sendRoot.getByTestId('message-part-remove').last().click()

  const waitRoot = await insertRoot(page, 'add-step-wait', 'wait_pause_window')
  await waitRoot.getByTestId('wait-duration-ms').fill('1800')
  await waitRoot.getByTestId('wait-mode').selectOption('terminal-quiet')
  await selectOptionContaining(waitRoot.getByTestId('wait-target-tab'), '1 · shell')
  await waitRoot.getByTestId('wait-quiet-ms').fill('80')
  await waitRoot.getByTestId('wait-max-ms').fill('2500')
  await waitRoot.getByTestId('wait-on-timeout').selectOption('finish')
  await waitRoot.getByTestId('wait-on-timeout').selectOption('pause')
  await waitRoot.getByTestId('wait-mode').selectOption('user-continue')
  await waitRoot.getByTestId('wait-user-continue-prompt').fill('Temporary continue prompt')
  await waitRoot.getByTestId('wait-mode').selectOption('duration')
  await waitRoot.getByTestId('wait-duration-ms').fill('1800')

  const captureRoot = await insertRoot(page, 'add-step-capture', 'capture_root')
  await selectOptionContaining(captureRoot.getByTestId('capture-step-terminal'), '1 · shell')
  await captureRoot.getByTestId('capture-step-kind').selectOption('terminal-buffer')
  await captureRoot.getByTestId('capture-terminal-buffer-mode').selectOption('raw-stream-tail')
  await captureRoot.getByTestId('capture-max-chars').fill('12000')
  await captureRoot.getByTestId('capture-terminal-buffer-mode').selectOption('scrollback-tail')

  const extractRoot = await insertRoot(page, 'add-step-extract', 'extract_root')
  await extractRoot.getByTestId('extract-text-source').selectOption('capture_root:captured_text')
  await extractRoot.getByTestId('extract-text-split-kind').selectOption('regex')
  await extractRoot.getByTestId('extract-text-keep-empty').check()
  await extractRoot.getByTestId('extract-text-split-pattern').fill('\\n+')
  await extractRoot.getByTestId('extract-text-split-flags').fill('i')
  await extractRoot.getByTestId('extract-add-filter').click()
  await extractRoot.getByTestId('extract-filter-mode').selectOption('include')
  await extractRoot.getByTestId('extract-filter-matcher-kind').selectOption('simple')
  await extractRoot.getByTestId('extract-filter-simple-op').selectOption('contains')
  await extractRoot.getByTestId('extract-filter-simple-text').fill('DOG_ROOT')
  await extractRoot.getByTestId('extract-filter-matcher-kind').selectOption('regex')
  await extractRoot.getByTestId('extract-filter-regex-pattern').fill('DOG_ROOT')
  await extractRoot.getByTestId('extract-filter-regex-flags').fill('i')
  await extractRoot.getByTestId('extract-filter-remove').click()
  await extractRoot.getByTestId('extract-text-select-mode').selectOption('index')
  await extractRoot.getByTestId('extract-text-select-index').fill('-1')
  await extractRoot.getByTestId('extract-text-select-mode').selectOption('range')
  await extractRoot.getByTestId('extract-text-select-start').fill('0')
  await extractRoot.getByTestId('extract-text-select-end').fill('3')
  await extractRoot.getByTestId('extract-text-select-mode').selectOption('all')
  await extractRoot.getByTestId('extract-text-extract-kind').selectOption('regex')
  await extractRoot.getByTestId('extract-text-regex-pattern').fill('(DOG_ROOT)')
  await extractRoot.getByTestId('extract-text-regex-flags').fill('i')
  await extractRoot.getByTestId('extract-text-regex-group').fill('1')
  await extractRoot.getByTestId('extract-text-extract-kind').selectOption('none')
  await extractRoot.getByTestId('extract-text-trim').selectOption('both')
  await extractRoot.getByTestId('extract-text-on-empty').selectOption('continue')

  await exerciseNodeChrome(page, sendRoot, waitRoot)
}
