import { expect, test, type Locator, type Page } from 'playwright/test'
import { macroRuntimeControlInventory } from '../ui-baseline/031B/controlInventory'

declare global {
  interface Window {
    __sdUiCoverage?: Record<string, string[]>
    __sdSystemNotifications?: Array<{ title: string; body: string; tag: string }>
  }
}

const INPUT_DELIVERY_HELP = 'Auto uses Bracketed paste for Shell tabs and Direct bytes for Text tabs. Direct bytes and Bracketed paste force the selected mode.'

test.describe.configure({ mode: 'serial' })

async function clickWithDialog(
  target: Locator,
  action: 'accept' | 'dismiss',
  expectedText?: string,
) {
  const page = target.page()
  const dialogPromise = page.waitForEvent('dialog')
  const clickPromise = target.click()
  const dialog = await dialogPromise
  if (expectedText) {
    expect(dialog.message()).toContain(expectedText)
  }
  if (action === 'accept') {
    await dialog.accept()
  } else {
    await dialog.dismiss()
  }
  await clickPromise
}

test('current .035 UI journey preserves the complex V3 Macro and exercises server-owned runtime input through visible controls', async ({ page }) => {
  test.setTimeout(600_000)
  page.setDefaultTimeout(10_000)
  page.setDefaultNavigationTimeout(15_000)
  const externalRequests: string[] = []

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await installOfflineBrowserHarness(page, externalRequests)
  await page.goto("/")
  if (await page.getByTestId('room-home').isVisible()) {
    await page.getByTestId('new-room').click()
  }
  await expect(page).toHaveURL(/\/room_[1-9A-HJ-NP-Za-km-z]{22}$/)
  await expect(page.getByTestId('room-identity')).toContainText('connected')
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
  await expect(page.getByTestId('macro-panel')).toBeVisible()

  let fakeOneId = ''
  let fakeTwoId = ''
  let realId = ''
  let spareShellId = ''
  let textId = ''
  let mainTemplateId = ''

  await test.step('workspace settings, panels and terminals are operated from an empty deck', async () => {
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
  })

  await test.step('Macro template chrome creates the baseline record and exercises insertion cancellation', async () => {
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
    await expect(incompleteIfBranches.first().getByTestId('condition-source').locator('option:checked')).toHaveText('Select an earlier artifact')
    await incompleteIfBranches.first().getByTestId('add-flow-elif').click()
    await expect(incompleteIfBranches).toHaveCount(2)
    await expect(incompleteIfBranches.nth(1).getByTestId('condition-source')).toHaveValue('')
    await expect(page.getByTestId('macro-validation-summary')).not.toHaveText('success')
    await page.getByTestId('macro-validation-toggle').click()
    await expect(page.getByTestId('macro-validation')).toContainText('body[0].branches[0].condition.source.stepId')
    await expect(page.getByTestId('macro-validation')).toContainText('string must not be empty')
    await clickWithDialog(nodeControl(incompleteIf, 'node-remove'), 'accept')
    await expect(rootNodes(page)).toHaveCount(0)
    await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
  })

  await test.step('visual editor builds and exercises every main action surface', async () => {
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
  })

  await test.step('If branches, loop templates and control-flow bodies are built through their local UI', async () => {
    const ifNode = await insertRoot(page, 'add-flow-if', 'if_root')
    const ifBranch = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="if"]')
    await ifBranch.getByTestId('condition-source').selectOption('capture_root:captured_text')
    await ifBranch.getByTestId('condition-matcher-kind').selectOption('regex')
    await ifBranch.getByTestId('condition-regex-pattern').fill('DOG_ROOT')
    await ifBranch.getByTestId('condition-regex-flags').fill('i')
    await ifBranch.getByTestId('condition-scope').selectOption('lines:any')
    await ifBranch.getByTestId('condition-matcher-kind').selectOption('simple')
    await ifBranch.getByTestId('condition-simple-op').selectOption('contains')
    await ifBranch.getByTestId('condition-simple-text').fill('DOG_ROOT')
    await ifBranch.getByTestId('condition-scope').selectOption('whole')
    await ifBranch.getByTestId('if-branch-toggle').click()
    await expect(ifBranch).toHaveClass(/collapsed/)
    await ifBranch.getByTestId('if-branch-toggle').click()

    await insertInside(flowBody(page, 'if body').last(), 'add-step-send')
    const ifSend = flowBody(page, 'if body').last().locator(':scope > [data-flow-node-type="send"]').last()
    await setNodeId(ifSend, 'send_if')
    await selectOptionContaining(ifSend.getByTestId('send-terminal'), '2 · shell')
    await addMessageText(ifSend, 'IF_MATCH')

    await ifBranch.getByTestId('add-flow-elif').click()
    let elifBranches = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="elif"]')
    await expect(elifBranches).toHaveCount(1)
    await elifBranches.first().getByTestId('add-flow-elif').click()
    await expect(elifBranches).toHaveCount(2)
    await clickWithDialog(elifBranches.last().getByTestId('remove-flow-elif'), 'accept')
    await expect(elifBranches).toHaveCount(1)
    const elifBranch = elifBranches.first()
    await elifBranch.getByTestId('condition-source').selectOption('capture_root:captured_text')
    await elifBranch.getByTestId('condition-simple-text').fill('NEVER_MATCH')
    await insertInside(flowBody(page, 'elif body').last(), 'add-step-send')
    const elifSend = flowBody(page, 'elif body').last().locator(':scope > [data-flow-node-type="send"]').last()
    await setNodeId(elifSend, 'send_elif')
    await selectOptionContaining(elifSend.getByTestId('send-terminal'), '2 · shell')
    await addMessageText(elifSend, 'ELIF_MATCH')

    await elifBranch.getByTestId('add-flow-else').click()
    let elseBranch = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="else"]')
    await expect(elseBranch).toHaveCount(1)
    await clickWithDialog(elseBranch.getByTestId('remove-flow-else'), 'accept')
    await expect(elseBranch).toHaveCount(0)
    await ifBranch.getByTestId('add-flow-else').click()
    elseBranch = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="else"]')
    await insertInside(flowBody(page, 'else body').last(), 'add-step-send')
    const elseSend = flowBody(page, 'else body').last().locator(':scope > [data-flow-node-type="send"]').last()
    await setNodeId(elseSend, 'send_else')
    await selectOptionContaining(elseSend.getByTestId('send-terminal'), '2 · shell')
    await addMessageText(elseSend, 'ELSE_MATCH')

    const forNode = await insertRoot(page, 'add-flow-for', 'for_phases')
    await forNode.getByTestId('for-range-count').fill('2')
    await forNode.getByTestId('for-range-mode').selectOption('forever')
    await forNode.getByTestId('for-range-mode').selectOption('text-list')
    const items = forNode.getByTestId('for-text-list-item-card')
    await forNode.getByTestId('for-text-list-key').fill('phase-a')
    await forNode.getByTestId('for-text-list-value').fill('alpha')
    await forNode.getByTestId('for-text-list-add').click()
    await forNode.getByTestId('for-text-list-key').nth(1).fill('phase-b')
    await forNode.getByTestId('for-text-list-value').nth(1).fill('beta\nsecond')
    await forNode.getByTestId('for-text-list-add').click()
    await forNode.getByTestId('for-text-list-key').nth(2).fill('temporary')
    await forNode.getByTestId('for-text-list-value').nth(2).fill('remove me')
    await items.nth(2).getByTestId('for-text-list-item-up').click()
    await items.nth(1).getByTestId('for-text-list-item-down').click()
    await items.nth(2).getByTestId('for-text-list-item-remove').click()
    await expect(forNode.getByTestId('for-text-list-item-card')).toHaveCount(2)

    await insertInside(flowBody(page, 'for body').last(), 'add-step-send')
    const loopSend = flowBody(page, 'for body').last().locator(':scope > [data-flow-node-type="send"]').last()
    await setNodeId(loopSend, 'send_loop')
    await selectOptionContaining(loopSend.getByTestId('send-terminal'), '1 · shell')
    await loopSend.getByTestId('message-add-text').click()
    await loopSend.getByTestId('message-text-part').fill('LOOP ')
    await loopSend.getByTestId('message-template-toggle').check()
    await loopSend.getByTestId('message-template-insert-index').click()
    await loopSend.getByTestId('message-template-insert-key').click()
    await loopSend.getByTestId('message-template-insert-value').click()
    await expect(loopSend.getByTestId('message-text-part')).toHaveValue(/{{index}}/)

    await insertAfter(loopSend, 'add-step-notify')
    const loopNotify = flowBody(page, 'for body').last().locator(':scope > [data-flow-node-type="notify"]').last()
    await setNodeId(loopNotify, 'notify_loop')
    await loopNotify.getByTestId('notify-level').selectOption('success')
    await loopNotify.getByTestId('notify-on-failure').selectOption('pause')
    await loopNotify.getByTestId('notify-on-failure').selectOption('continue')
    await loopNotify.getByTestId('notify-title').fill('Phase ')
    await loopNotify.getByTestId('notify-title-template-toggle').check()
    await loopNotify.getByTestId('notify-title-template-insert-index').click()
    await loopNotify.getByTestId('notify-title-template-insert-key').click()
    await loopNotify.getByTestId('notify-title-template-insert-value').click()
    await loopNotify.getByTestId('message-add-text').click()
    await loopNotify.getByTestId('message-text-part').fill('Notice ')
    await loopNotify.getByTestId('message-template-toggle').check()
    await loopNotify.getByTestId('message-template-insert-index').click()
    await loopNotify.getByTestId('message-template-insert-key').click()
    await loopNotify.getByTestId('message-template-insert-value').click()
    await loopNotify.getByTestId('notify-channel-system').check()
    await loopNotify.getByTestId('notify-app-toast').uncheck()
    await loopNotify.getByTestId('notify-app-toast').check()
    await loopNotify.getByTestId('notify-app-sound').selectOption('none')
    await loopNotify.getByTestId('notify-channel-telegram').check()
    await loopNotify.getByTestId('notify-telegram-profile').selectOption('default')
    await loopNotify.getByTestId('notify-channel-telegram').uncheck()
    await loopNotify.getByTestId('notify-channel-app').uncheck()
    await loopNotify.getByTestId('notify-channel-app').check()
    await loopNotify.getByTestId('notify-app-sound').selectOption('none')

    await insertAfter(loopNotify, 'add-step-input')
    const scopedInput = flowBody(page, 'for body').last().locator(':scope > [data-flow-node-type="input"]').last()
    await setNodeId(scopedInput, 'input_scoped_temporary')
    await selectOptionContaining(scopedInput.getByTestId('input-terminal'), '1 · shell')
    await scopedInput.getByTestId('input-prompt').fill('Input ')
    await scopedInput.getByTestId('input-prompt-template-toggle').check()
    await scopedInput.getByTestId('input-prompt-template-insert-index').click()
    await scopedInput.getByTestId('input-prompt-template-insert-key').click()
    await scopedInput.getByTestId('input-prompt-template-insert-value').click()
    await scopedInput.getByTestId('input-allow-empty').check()
    await exerciseInputDelivery(scopedInput, 'input')
    await scopedInput.getByTestId('input-ending-sequence').selectOption('crlf')
    await scopedInput.getByTestId('input-default-source').selectOption('capture_root:captured_text')

    await insertAfter(scopedInput, 'add-step-wait')
    const scopedWait = flowBody(page, 'for body').last().locator(':scope > [data-flow-node-type="wait"]').last()
    await setNodeId(scopedWait, 'wait_scoped_temporary')
    await scopedWait.getByTestId('wait-mode').selectOption('user-continue')
    await scopedWait.getByTestId('wait-user-continue-prompt').fill('Continue ')
    await scopedWait.getByTestId('wait-user-continue-prompt-template-toggle').check()
    await scopedWait.getByTestId('wait-user-continue-prompt-template-insert-index').click()
    await scopedWait.getByTestId('wait-user-continue-prompt-template-insert-key').click()
    await scopedWait.getByTestId('wait-user-continue-prompt-template-insert-value').click()

    await insertAfter(scopedWait, 'add-flow-break')
    const breakNode = flowBody(page, 'for body').last().locator(':scope > [data-flow-node-type="break"]').last()
    await setNodeId(breakNode, 'break_temporary')
    await breakNode.getByTestId('flow-control-reason').fill('temporary break')
    await insertInside(flowBody(page, 'break action body').last(), 'add-step-send')
    await clickWithDialog(nodeControl(breakNode, 'node-remove'), 'accept')

    await nodeControl(loopNotify, 'node-add-after').click()
    await page.getByTestId('add-flow-continue').click()
    const continueNode = flowBody(page, 'for body').last().locator(':scope > [data-flow-node-type="continue"]').last()
    await setNodeId(continueNode, 'continue_temporary')
    await continueNode.getByTestId('flow-control-reason').fill('temporary continue')
    await insertInside(flowBody(page, 'continue action body').last(), 'add-step-send')
    await clickWithDialog(nodeControl(continueNode, 'node-remove'), 'accept')

    for (const temporary of [scopedInput, scopedWait]) {
      await clickWithDialog(nodeControl(temporary, 'node-remove'), 'accept')
    }
  })

  await test.step('Parallel lanes cover lane CRUD, all lane actions and merged output', async () => {
    const parallel = await insertRoot(page, 'add-step-parallel', 'parallel_root')
    await parallel.getByTestId('parallel-merge-separator').fill('\\n-- {laneId} --\\n')
    await parallel.getByTestId('parallel-include-empty-outputs').check()
    await parallel.getByTestId('parallel-on-lane-fail').selectOption('fail')

    await parallel.getByTestId('parallel-lane-add-before-output').click()
    await page.getByTestId('parallel-lane-insertion-cancel').click()
    await parallel.getByTestId('parallel-lane-add-before-output').click()
    await page.getByTestId('parallel-lane-insertion-cancel-scrim').click({ position: { x: 2, y: 2 } })

    const laneOne = parallel.getByTestId('parallel-lane-editor')
    await laneOne.getByTestId('parallel-lane-id-input').fill('lane_alpha')
    await laneOne.getByTestId('parallel-lane-label-input').fill('Alpha lane')
    await selectOptionContaining(laneOne.getByTestId('parallel-lane-terminal'), '1 · shell')
    await addParallelAction(laneOne, 'parallel-add-send')
    let laneAction = laneOne.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="send"]').last()
    await setParallelActionId(laneAction, 'lane_alpha_send')
    await laneAction.getByTestId('message-add-text').click()
    await laneAction.getByTestId('parallel-message-text-part').fill('PARALLEL_ALPHA')
    await exerciseInputDelivery(laneAction, 'parallel-send')
    await laneAction.getByTestId('parallel-send-ending-sequence').selectOption('cr')

    await insertParallelAfter(laneAction, 'parallel-add-wait')
    laneAction = laneOne.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="wait"]').last()
    await setParallelActionId(laneAction, 'lane_alpha_wait')
    await laneAction.getByTestId('parallel-wait-duration-ms').fill('90')
    await laneAction.getByTestId('parallel-wait-mode').selectOption('terminal-quiet')
    await laneAction.getByTestId('parallel-wait-quiet-ms').fill('60')
    await laneAction.getByTestId('parallel-wait-max-ms').fill('1500')
    await laneAction.getByTestId('parallel-wait-mode').selectOption('duration')
    await laneAction.getByTestId('parallel-wait-duration-ms').fill('90')

    await insertParallelAfter(laneAction, 'parallel-add-capture')
    laneAction = laneOne.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="capture-source"]').last()
    await setParallelActionId(laneAction, 'lane_alpha_capture')
    await laneAction.getByTestId('parallel-capture-kind').selectOption('terminal-buffer')
    await laneAction.getByTestId('parallel-capture-mode').selectOption('raw-stream-tail')
    await laneAction.getByTestId('parallel-capture-max-chars').fill('9000')
    await laneAction.getByTestId('parallel-capture-mode').selectOption('scrollback-tail')

    await insertParallelAfter(laneAction, 'parallel-add-extract')
    laneAction = laneOne.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="extract_text"]').last()
    await setParallelActionId(laneAction, 'lane_alpha_extract')
    await laneAction.getByTestId('parallel-extract-source').selectOption('lane_alpha_capture:captured_text')
    await laneAction.getByTestId('parallel-extract-select-mode').selectOption('range')
    await laneAction.getByTestId('parallel-extract-select-mode').selectOption('all')
    await laneAction.getByTestId('parallel-extract-trim').selectOption('both')
    await laneAction.getByTestId('parallel-extract-on-empty').selectOption('fail')
    await laneOne.getByTestId('parallel-output-id-input').fill('lane_alpha_output')
    await laneOne.getByTestId('parallel-output-source').selectOption('lane_alpha_extract:extracted_text')

    await laneOne.getByTestId('parallel-add-lane').click()
    await expect(parallel.getByTestId('parallel-lane-tab')).toHaveCount(2)
    let laneTwo = parallel.getByTestId('parallel-lane-editor')
    await laneTwo.getByTestId('parallel-lane-id-input').fill('lane_beta')
    await laneTwo.getByTestId('parallel-lane-label-input').fill('Beta lane')
    await selectOptionContaining(laneTwo.getByTestId('parallel-lane-terminal'), '2 · shell')
    await clickWithDialog(laneTwo.getByTestId('parallel-remove-lane'), 'dismiss')
    await expect(parallel.getByTestId('parallel-lane-tab')).toHaveCount(2)
    await addParallelAction(laneTwo, 'parallel-add-send')
    laneAction = laneTwo.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="send"]').last()
    await setParallelActionId(laneAction, 'lane_beta_send')
    await laneAction.getByTestId('message-add-text').click()
    await laneAction.getByTestId('parallel-message-text-part').fill('PARALLEL_BETA')
    await insertParallelAfter(laneAction, 'parallel-add-capture')
    laneAction = laneTwo.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="capture-source"]').last()
    await setParallelActionId(laneAction, 'lane_beta_capture')
    await laneTwo.getByTestId('parallel-output-id-input').fill('lane_beta_output')
    await laneTwo.getByTestId('parallel-output-source').selectOption('lane_beta_capture:captured_text')

    await laneTwo.getByTestId('parallel-add-lane').click()
    await expect(parallel.getByTestId('parallel-lane-tab')).toHaveCount(3)
    let laneThree = parallel.getByTestId('parallel-lane-editor')
    await laneThree.getByTestId('parallel-lane-id-input').fill('lane_repair')
    await laneThree.getByTestId('parallel-lane-label-input').fill('Repair lane')
    await selectOptionContaining(laneThree.getByTestId('parallel-lane-terminal'), '4 · shell')
    await addParallelAction(laneThree, 'parallel-add-capture')
    laneAction = laneThree.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="capture-source"]').last()
    await setParallelActionId(laneAction, 'lane_repair_capture')
    await laneThree.getByTestId('parallel-output-id-input').fill('lane_repair_output')
    await laneThree.getByTestId('parallel-output-source').selectOption('lane_repair_capture:captured_text')

    await parallel.getByTestId('parallel-lane-tab').filter({ hasText: 'Alpha lane' }).click()
    const alphaActions = parallel.getByTestId('parallel-lane-editor').getByTestId('parallel-lane-action')
    const firstAlphaAction = alphaActions.first()
    await firstAlphaAction.getByTestId('parallel-node-toggle-collapse').click()
    await firstAlphaAction.getByTestId('parallel-node-toggle-collapse').click()
    await alphaActions.nth(1).getByTestId('parallel-node-move-up').click()
    await alphaActions.first().getByTestId('parallel-node-move-down').click()
    await firstAlphaAction.getByTestId('parallel-lane-add-before').click()
    await page.getByTestId('parallel-add-send').click()
    const temporary = parallel.getByTestId('parallel-lane-editor').getByTestId('parallel-lane-action').first()
    await temporary.getByTestId('parallel-lane-add-after').click()
    await page.getByTestId('parallel-add-wait').click()
    const temporaryWait = parallel.getByTestId('parallel-lane-editor').locator('[data-testid="parallel-lane-action"][data-parallel-action-type="wait"]').first()
    await clickWithDialog(temporaryWait.getByTestId('parallel-node-remove'), 'accept')
    await clickWithDialog(temporary.getByTestId('parallel-node-remove'), 'accept')

    await parallel.getByTestId('parallel-lane-tab').filter({ hasText: 'Repair lane' }).click()
    laneThree = parallel.getByTestId('parallel-lane-editor')
    await clickWithDialog(laneThree.getByTestId('parallel-remove-lane'), 'accept')
    await expect(parallel.getByTestId('parallel-lane-tab')).toHaveCount(2)
    await parallel.getByTestId('parallel-add-lane').click()
    laneThree = parallel.getByTestId('parallel-lane-editor')
    await laneThree.getByTestId('parallel-lane-id-input').fill('lane_repair')
    await laneThree.getByTestId('parallel-lane-label-input').fill('Repair lane')
    await selectOptionContaining(laneThree.getByTestId('parallel-lane-terminal'), '4 · shell')
    await addParallelAction(laneThree, 'parallel-add-capture')
    laneAction = laneThree.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="capture-source"]').last()
    await setParallelActionId(laneAction, 'lane_repair_capture')
    await laneThree.getByTestId('parallel-output-id-input').fill('lane_repair_output')
    await laneThree.getByTestId('parallel-output-source').selectOption('lane_repair_capture:captured_text')
  })

  await test.step('final artifact send, text capture, runtime input, finish and validation are completed', async () => {
    const sendMerged = await insertRoot(page, 'add-step-send', 'send_merged_to_text')
    await selectOptionContaining(sendMerged.getByTestId('send-terminal'), '5 · text')
    await sendMerged.getByTestId('message-add-text').click()
    await sendMerged.getByTestId('message-text-part').fill('MERGED\\n')
    await sendMerged.getByTestId('message-add-source').click()
    await sendMerged.getByTestId('message-source-part').selectOption('parallel_root:merged_text')
    await sendMerged.getByTestId('send-ending-sequence').selectOption('none')

    const captureText = await insertRoot(page, 'add-step-capture', 'capture_text_box')
    await selectOptionContaining(captureText.getByTestId('capture-step-terminal'), '5 · text')
    await expect(captureText.getByTestId('capture-kind-fixed')).toContainText('text-box')

    const repairCapture = await insertRoot(page, 'add-step-capture', 'capture_repair')
    await selectOptionContaining(repairCapture.getByTestId('capture-step-terminal'), '4 · shell')

    const input = await insertRoot(page, 'add-step-input', 'input_root')
    await selectOptionContaining(input.getByTestId('input-terminal'), '1 · shell')
    await input.getByTestId('input-prompt').fill('Dogfood runtime input')
    await input.getByTestId('input-allow-empty').uncheck()
    await input.getByTestId('input-input-delivery').selectOption('auto')
    await input.getByTestId('input-ending-sequence').selectOption('cr')
    await input.getByTestId('input-default-source').selectOption('capture_text_box:captured_text')

    const finish = await insertRoot(page, 'add-flow-finish', 'finish_root')
    await finish.getByTestId('flow-control-reason').fill('031B completed')
    await insertInside(flowBody(page, 'finish action body').last(), 'add-step-send')
    const finishBodySend = flowBody(page, 'finish action body').last().locator(':scope > [data-flow-node-type="send"]').last()
    await addMessageText(finishBodySend, 'FINISH_BODY')
    await clickWithDialog(nodeControl(finishBodySend, 'node-remove'), 'accept')

    await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
    await openTemplateDrawer(page)
    await page.getByTestId('macro-save').click()
    await expect(page.getByTestId('macro-template-metadata')).not.toContainText('unsaved new macro')
    await expect(page.getByTestId('macro-template-select')).toHaveValue(/^tmpl_/)
    mainTemplateId = await page.getByTestId('macro-template-select').inputValue()
    await closeTemplateDrawer(page)
  })

  await test.step("JSON edit and saved-record selection use current Copy/New/Edit/Delete semantics", async () => {
    await page.getByTestId("macro-tab-json").click()
    await page.getByTestId("macro-json-copy").click()
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain("\"parallel_root\"")

    await page.getByTestId("macro-edit-json").click()
    await page.getByTestId("macro-json-editor").fill("{")
    await page.getByTestId("macro-save-json").click()
    await expect(page.getByTestId("macro-json-error")).toContainText("Invalid JSON")
    const currentJson = await page.evaluate(() => navigator.clipboard.readText())
    await page.getByTestId("macro-json-editor").fill(currentJson.replace("\"schemaVersion\": 3", "\"schemaVersion\": 2"))
    await page.getByTestId("macro-save-json").click()
    await expect(page.getByTestId("macro-json-error")).toContainText("schemaVersion")
    await page.getByTestId("macro-cancel-json").click()
    await page.getByTestId("macro-tab-editor").click()

    await openTemplateDrawer(page)
    await page.getByTestId("macro-name").fill("Cancelled current edit")
    await page.getByTestId("macro-cancel-edit").click()
    await expect(page.getByTestId("macro-name")).toHaveValue("031B Full Offline Dogfood")
    await page.getByTestId("macro-edit").click()
    await expect(page.getByTestId("macro-name")).toBeEnabled()
    await page.getByTestId("macro-cancel-edit").click()

    await page.getByTestId("macro-create").click()
    await page.getByTestId("macro-name").fill("Temporary selectable Macro")
    await page.getByTestId("macro-save").click()
    await expect(page.getByTestId("macro-template-metadata")).not.toContainText("unsaved new macro")
    await expect(page.getByTestId("macro-template-select").locator("option:checked")).toContainText("Temporary selectable Macro")
    const temporaryTemplateId = await page.getByTestId("macro-template-select").inputValue()
    expect(temporaryTemplateId).not.toBe(mainTemplateId)
    await page.getByTestId("macro-template-search").fill("031B Full")
    await page.getByTestId("macro-template-select").selectOption(mainTemplateId)
    await page.getByTestId("macro-template-search").fill("")
    await page.getByTestId("macro-template-select").selectOption(temporaryTemplateId)
    await expect(page.getByTestId("macro-name")).toHaveValue("Temporary selectable Macro")
    await clickWithDialog(
      page.getByTestId("macro-delete"),
      "dismiss",
      "Delete Temporary selectable Macro?",
    )
    await clickWithDialog(page.getByTestId("macro-delete"), "accept")
    await page.getByTestId("macro-template-select").selectOption(mainTemplateId)
    await closeTemplateDrawer(page)
    await expect(page.getByTestId("macro-validation-summary")).toHaveText("success")
    await page.getByTestId("macro-prepare-terminals").click()
    await expect(page.getByTestId("macro-control-start")).toBeEnabled()
  })

  await test.step('the UI-created complex Macro pauses, resumes, accepts input and captures multiple terminal results', async () => {
    await page.getByTestId('macro-debug-toggle').click()
    await page.getByTestId('macro-run-refresh').click()
    await page.getByTestId('macro-debug-toggle').click()

    await page.getByTestId('macro-control-start').click()
    await expect(page.getByTestId('macro-run-status')).toContainText('running')
    await page.getByTestId('macro-control-pause-resume').click()
    await expect(page.getByTestId('macro-run-status')).toContainText('paused', { timeout: 10_000 })
    await page.getByTestId('macro-control-pause-resume').click()

    await expect(page.getByTestId('macro-run-input-text')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('notice-item')).toBeVisible()
    await page.getByTestId('notice-dismiss').click()
    await expect(page.getByTestId('notice-item')).toHaveCount(0)
    await page.getByTestId('macro-run-input-text').fill('DOG_INPUT_031B')
    await page.getByTestId('macro-run-input-submit').click()
    await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 30_000 })

    await terminalTab(page, fakeOneId).click()
    await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /DOG_ROOT/)
    await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /LOOP/)
    await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /PARALLEL_ALPHA/)
    await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /DOG_INPUT_031B/)
    await terminalTab(page, fakeTwoId).click()
    await expect(terminalHost(page, fakeTwoId)).toHaveAttribute('data-rendered-tail', /IF_MATCH/)
    await expect(terminalHost(page, fakeTwoId)).toHaveAttribute('data-rendered-tail', /PARALLEL_BETA/)
    await terminalTab(page, textId).click()
    await expect(page.getByTestId('text-box-editor')).toHaveValue(/MERGED/)
    await expect(page.getByTestId('text-box-editor')).toHaveValue(/lane_alpha/)

    await page.getByTestId('macro-control-start').click()
    await expect(page.getByTestId('macro-run-status')).toContainText('running')
    await page.getByTestId('macro-control-stop').click()
    await expect(page.getByTestId('macro-run-status')).toContainText('stopped', { timeout: 10_000 })

    await page.getByTestId('macro-control-start').click()
    await expect(page.getByTestId('macro-run-input-text')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('notice-item')).toBeVisible()
    await page.getByTestId('notice-dismiss-layer').click({ position: { x: 2, y: 2 } })
    await expect(page.getByTestId('notice-item')).toHaveCount(0)
    await page.getByTestId('macro-run-input-text').fill('DOG_INPUT_SECOND')
    await page.getByTestId('macro-run-input-submit').click()
    await expect(page.getByTestId('macro-run-status')).toContainText('completed', { timeout: 30_000 })
  })

  await test.step("Trace renders the server-persisted completed run without legacy demo controls", async () => {
    await page.getByTestId("macro-tab-trace").click()
    await expect(page.getByTestId("macro-trace-view")).toContainText("run_started")
    await expect(page.getByTestId("macro-trace-runs")).toContainText("completed")
    await page.getByTestId("macro-tab-editor").click()
  })
  await test.step("capability repair remains explicit after a live index/type shift", async () => {
    await openTemplateDrawer(page)
    await page.getByTestId("macro-edit").click()
    await closeTemplateDrawer(page)

    await clickWithDialog(
      terminalTab(page, spareShellId).getByTestId("terminal-tab-close"),
      "accept",
      "Close terminal",
    )
    await expect(page.getByTestId("terminal-tab")).toHaveCount(4)

    const repairCapture = flowBody(page, "Root body").locator(":scope > [data-flow-node-id=\"capture_repair\"]")
    await expect(repairCapture.getByTestId("capture-kind-repair")).toBeVisible()
    await repairCapture.getByTestId("capture-kind-repair").click()
    await repairCapture.getByTestId("capture-step-terminal").selectOption("4")

    const parallel = flowBody(page, "Root body").locator(":scope > [data-flow-node-id=\"parallel_root\"]")
    await parallel.getByTestId("parallel-lane-tab").filter({ hasText: "Repair lane" }).click()
    const repairLane = parallel.getByTestId("parallel-lane-editor")
    await expect(repairLane.getByTestId("parallel-capture-kind-repair")).toBeVisible()
    await repairLane.getByTestId("parallel-capture-kind-repair").click()
    await repairLane.getByTestId("parallel-lane-terminal").selectOption("4")
    await expect(page.getByTestId("macro-validation-summary")).toHaveText("success")
  })
  await test.step('runtime inventory reports an actual browser event for every non-Codex control', async () => {
    const evidence = await page.evaluate(() => window.__sdUiCoverage ?? {})
    const missing = macroRuntimeControlInventory
      .filter((entry) => (evidence[entry.key]?.length ?? 0) === 0)
      .map((entry) => entry.key)
    expect(missing, 'controls without real UI event evidence').toEqual([])
    expect(externalRequests, 'the .031B journey must stay offline').toEqual([])
    expect(await page.evaluate(() => window.__sdSystemNotifications?.length ?? 0)).toBeGreaterThan(0)
  })
})

async function installOfflineBrowserHarness(page: Page, externalRequests: string[]) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      await route.continue()
      return
    }
    externalRequests.push(url.toString())
    await route.abort()
  })

  await page.addInitScript(() => {
    window.__sdUiCoverage = {}
    window.__sdSystemNotifications = []
    for (const eventName of ['click', 'input', 'change', 'dblclick', 'keydown', 'pointerdown', 'mouseover', 'dragstart', 'drop']) {
      document.addEventListener(eventName, (event) => {
        const evidence = window.__sdUiCoverage ?? (window.__sdUiCoverage = {})
        let target: Element | null = event.target instanceof Element ? event.target : null
        while (target) {
          const testId = target instanceof HTMLElement ? target.dataset.testid : undefined
          if (testId) (evidence[testId] ??= []).push(eventName)
          target = target.parentElement
        }
      }, true)
    }

    class MockNotification {
      static permission: NotificationPermission = 'granted'
      static async requestPermission(): Promise<NotificationPermission> {
        return 'granted'
      }
      constructor(title: string, options?: NotificationOptions) {
        window.__sdSystemNotifications?.push({
          title,
          body: options?.body ?? '',
          tag: options?.tag ?? '',
        })
      }
    }
    Object.defineProperty(window, 'Notification', { value: MockNotification, configurable: true })

    class MockAudioContext {
      currentTime = 0
      destination = {}
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0 },
          connect() {},
          start() {},
          stop() {},
        }
      }
      createGain() {
        return {
          gain: { value: 0 },
          connect() {},
        }
      }
      async close() {}
    }
    Object.defineProperty(window, 'AudioContext', { value: MockAudioContext, configurable: true })
  })
}

async function createTerminal(page: Page, testId: string, expectedCount: number) {
  await page.getByTestId(testId).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(expectedCount)
}

async function terminalIdAt(page: Page, index: number): Promise<string> {
  const id = await page.getByTestId('terminal-tab').nth(index).getAttribute('data-terminal-id')
  if (!id) throw new Error('missing terminal id at index ' + index)
  return id
}

function terminalTab(page: Page, terminalId: string): Locator {
  return page.locator('[data-testid="terminal-tab"][data-terminal-id="' + terminalId + '"]')
}

function terminalHost(page: Page, terminalId: string): Locator {
  return page.locator('[data-testid="terminal-pane"][data-terminal-id="' + terminalId + '"]').getByTestId('terminal-host')
}


async function dragResizeHandle(page: Page, testId: string, deltaX: number) {
  const handle = page.getByTestId(testId)
  const box = await handle.boundingBox()
  if (!box) throw new Error('missing resize handle: ' + testId)
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(24, box.height / 2))
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + Math.min(24, box.height / 2))
  await page.mouse.up()
}

async function firstNonEmptyOptionValue(select: Locator): Promise<string> {
  const values = await select.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).filter(Boolean))
  if (!values[0]) throw new Error('select has no non-empty option')
  return values[0]
}

async function selectOptionContaining(select: Locator, text: string) {
  const option = select.locator('option').filter({ hasText: text }).first()
  const value = await option.getAttribute('value')
  if (!value) throw new Error('missing option containing: ' + text)
  await select.selectOption(value)
}

async function openTemplateDrawer(page: Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) {
    await page.getByTestId('macro-template-drawer').click()
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

async function closeTemplateDrawer(page: Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() > 0) {
    await page.getByTestId('macro-template-drawer').click()
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toHaveCount(0)
}

function flowBody(page: Page, label: string): Locator {
  return page.locator('[data-testid="flow-block"][data-flow-body-label="' + label + '"]')
}

function rootNodes(page: Page): Locator {
  return flowBody(page, 'Root body').locator(':scope > [data-flow-node-id]')
}

function nodeControl(node: Locator, testId: string): Locator {
  return node.locator(
    ':scope > [data-testid="node-menu"] > [data-testid="node-action-controls"] > [data-testid="' + testId + '"]',
  )
}

async function insertRoot(page: Page, paletteTestId: string, nodeId: string): Promise<Locator> {
  const roots = rootNodes(page)
  if (await roots.count() === 0) {
    await flowBody(page, 'Root body').getByTestId('empty-body-add').click()
  } else {
    await nodeControl(roots.last(), 'node-add-after').click()
  }
  await expect(page.getByTestId('macro-insertion-palette')).toBeVisible()
  await page.getByTestId(paletteTestId).click()
  await expect(page.getByTestId('macro-insertion-palette')).toHaveCount(0)
  const inserted = rootNodes(page).last()
  await inserted.getByTestId('node-id-input').fill(nodeId)
  const stableNode = flowBody(page, 'Root body').locator(':scope > [data-flow-node-id="' + nodeId + '"]')
  await expect(stableNode).toBeVisible()
  return stableNode
}

async function insertInside(body: Locator, paletteTestId: string) {
  await body.locator(':scope > [data-testid="empty-flow-body"] > [data-testid="empty-body-add"]').click()
  await body.page().getByTestId(paletteTestId).click()
}

async function insertAfter(node: Locator, paletteTestId: string) {
  await nodeControl(node, 'node-add-after').click()
  await node.page().getByTestId(paletteTestId).click()
}

async function setNodeId(node: Locator, id: string) {
  await node.getByTestId('node-id-input').fill(id)
  await expect(node.page().locator('[data-flow-node-id="' + id + '"]')).toBeVisible()
}

async function addMessageText(node: Locator, text: string) {
  await node.getByTestId('message-add-text').click()
  await node.getByTestId('message-text-part').last().fill(text)
}

async function exerciseInputDelivery(scope: Locator, prefix: 'send' | 'input' | 'parallel-send') {
  const help = scope.getByTestId(prefix + '-input-delivery-help')
  await help.hover()
  await expect(scope.page().getByRole('tooltip')).toHaveText(INPUT_DELIVERY_HELP)
  await scope.page().mouse.move(0, 0)
  const select = scope.getByTestId(prefix + '-input-delivery')
  await select.selectOption('direct')
  await select.selectOption('bracketed-paste')
  await select.selectOption('auto')
}

async function exerciseNodeChrome(page: Page, first: Locator, second: Locator) {
  await nodeControl(first, 'node-toggle-collapse').click()
  await expect(first).toHaveClass(/collapsed/)
  await nodeControl(first, 'node-toggle-collapse').click()
  await nodeControl(second, 'node-move-up').click()
  await nodeControl(rootNodes(page).first(), 'node-move-down').click()
  await nodeControl(first, 'node-add-before').click()
  await page.getByTestId('add-step-wait').click()
  const temporary = rootNodes(page).first()
  await nodeControl(temporary, 'node-add-after').click()
  await page.getByTestId('macro-move-existing-select').selectOption('wait_pause_window')
  await page.getByTestId('macro-move-existing').click()
  await clickWithDialog(nodeControl(temporary, 'node-remove'), 'accept')
  await nodeControl(second, 'node-move-down').click()
}

async function addParallelAction(lane: Locator, paletteTestId: string) {
  await lane.getByTestId('parallel-lane-add-before-output').click()
  await lane.page().getByTestId(paletteTestId).click()
}

async function insertParallelAfter(action: Locator, paletteTestId: string) {
  await action.getByTestId('parallel-lane-add-after').click()
  await action.page().getByTestId(paletteTestId).click()
}

async function setParallelActionId(action: Locator, id: string) {
  await action.getByTestId('parallel-action-id-input').fill(id)
  await expect(action.page().locator('[data-parallel-action-id="' + id + '"]')).toBeVisible()
}
