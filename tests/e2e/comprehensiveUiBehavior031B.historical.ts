import { expect, test, type Locator, type Page } from 'playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeControlInventory } from '../ui-baseline/031B/controlInventory'

declare global {
  interface Window {
    __sdUiCoverage?: Record<string, string[]>
    __sdSystemNotifications?: Array<{ title: string; body: string; tag: string }>
  }
}

const CONFIG_ID = 'ui-baseline-031b'
const INPUT_DELIVERY_HELP = 'Auto uses Bracketed paste for Shell tabs and Direct bytes for Text tabs. Direct bytes and Bracketed paste force the selected mode.'

test.describe.configure({ mode: 'serial' })

test('offline user journey covers the .031A UI and runs a complex Macro built from zero', async ({ page }) => {
  test.setTimeout(600_000)
  page.setDefaultTimeout(10_000)
  page.setDefaultNavigationTimeout(15_000)
  const externalRequests: string[] = []
  const exportedMacroPath = join(tmpdir(), 'shell-deck-031b-export-' + Date.now() + '.json')

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await installOfflineBrowserHarness(page, externalRequests)
  await page.goto('/?configId=' + CONFIG_ID)
  await expect(page.locator('.brand-line')).toContainText('connected')
  await expect(page.getByTestId('terminal-tab')).toHaveCount(0)
  await expect(page.getByTestId('macro-panel')).toBeVisible()

  let fakeOneId = ''
  let fakeTwoId = ''
  let realId = ''
  let spareShellId = ''
  let textId = ''
  let mainTemplateId = ''

  await test.step('workspace settings, panels and terminals are operated from an empty deck', async () => {
    await page.getByTestId('macro-panel-toggle').click()
    await expect(page.getByTestId('macro-panel')).toHaveCount(0)
    await page.getByTestId('macro-panel-toggle').click()
    await expect(page.getByTestId('macro-panel')).toBeVisible()

    await page.getByTestId('prompt-panel-toggle').click()
    await expect(page.getByTestId('prompt-panel')).toBeVisible()
    await dragResizeHandle(page, 'prompt-resize-handle', -42)
    await page.getByTestId('prompt-reset-width').click()
    await page.getByTestId('prompt-panel-toggle').click()
    await expect(page.getByTestId('prompt-panel')).toHaveCount(0)

    await page.getByTestId('settings-button').click()
    await expect(page.getByTestId('settings-popover')).toBeVisible()
    await page.getByTestId('macro-insertion-placement-toggle').click()
    await expect(page.getByTestId('macro-insertion-placement-toggle')).toContainText('center')
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

    await createTerminal(page, 'terminal-create-fake', 1)
    await createTerminal(page, 'terminal-create-fake', 2)
    await createTerminal(page, 'terminal-create-real', 3)
    await createTerminal(page, 'terminal-create-fake', 4)
    await createTerminal(page, 'terminal-create-text', 5)

    fakeOneId = await terminalIdAt(page, 0)
    fakeTwoId = await terminalIdAt(page, 1)
    realId = await terminalIdAt(page, 2)
    spareShellId = await terminalIdAt(page, 3)
    textId = await terminalIdAt(page, 4)

    await renameTerminal(page, fakeOneId, 'dog_fake_1', 'enter')
    await renameTerminal(page, fakeTwoId, 'cancelled_alias', 'escape')
    await expect(terminalTab(page, fakeTwoId)).not.toHaveAttribute('data-terminal-alias', 'cancelled_alias')
    await renameTerminal(page, fakeTwoId, 'dog_fake_2', 'blur')
    await renameTerminal(page, realId, 'dog_real', 'enter')
    await renameTerminal(page, spareShellId, 'dog_spare', 'enter')
    await renameTerminal(page, textId, 'dog_text', 'enter')

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
    await expect(fakeOneHost).toHaveAttribute('data-rendered-tail', /ECHO:UI_FAKE_031B/)

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

    await createTerminal(page, 'terminal-create-fake', 6)
    const temporaryId = await terminalIdAt(page, 5)
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Close tab')
      await dialog.dismiss()
    })
    await terminalTab(page, temporaryId).getByTestId('terminal-tab-close').click()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(6)
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Close tab')
      await dialog.accept()
    })
    await terminalTab(page, temporaryId).getByTestId('terminal-tab-close').click()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(5)

    await dragResizeHandle(page, 'macro-resize-handle', -54)
    await page.getByTestId('macro-reset-width').click()

    await page.getByTestId('settings-button').click()
    await page.getByTestId('macro-insertion-placement-toggle').click()
    await expect(page.getByTestId('macro-insertion-placement-toggle')).toContainText('near')
    await page.getByTestId('settings-dismiss-layer').click()
  })

  await test.step('Prompt panel performs project/global CRUD, filtering, copy and deletion through UI', async () => {
    await page.getByTestId('prompt-panel-toggle').click()
    await expect(page.getByTestId('prompt-panel')).toBeVisible()
    await page.getByTestId('prompt-new-project').click()
    await page.getByTestId('prompt-title').fill('031B Project Prompt')
    await page.getByTestId('prompt-tags').fill('dogfood, offline')
    await page.getByTestId('prompt-body').fill('Review this offline UI journey.')
    await page.getByTestId('prompt-save').click()
    await expect(page.getByTestId('prompt-list-item').filter({ hasText: '031B Project Prompt' }))
      .toContainText(/031B Project Prompt · project\s*· dogfood, offline/)
    await page.getByTestId('prompt-copy').click()
    await expect.poll(async () => await page.evaluate(() => navigator.clipboard.readText())).toBe('Review this offline UI journey.')

    await page.getByTestId('prompt-edit-scope').selectOption('global')
    await page.getByTestId('prompt-save').click()
    await expect(page.getByTestId('prompt-list-item').filter({ hasText: '031B Project Prompt' }))
      .toContainText(/031B Project Prompt · global\s*· dogfood, offline/)

    await page.getByTestId('prompt-new-global').click()
    await page.getByTestId('prompt-title').fill('031B Global Notes')
    await page.getByTestId('prompt-tags').fill('global')
    await page.getByTestId('prompt-body').fill('Reusable global prompt body.')
    await page.getByTestId('prompt-save').click()
    await page.getByTestId('prompt-scope-filter').selectOption('global')
    await page.getByTestId('prompt-search').fill('Project')
    await expect(page.getByTestId('prompt-list-item').filter({ hasText: '031B Project Prompt' })).toHaveCount(1)
    const projectPromptValue = await firstNonEmptyOptionValue(page.getByTestId('prompt-selector'))
    await page.getByTestId('prompt-selector').selectOption(projectPromptValue)

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Delete global prompt')
      await dialog.dismiss()
    })
    await page.getByTestId('prompt-delete').click()
    await expect(page.getByTestId('prompt-title')).toHaveValue('031B Project Prompt')
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Delete global prompt')
      await dialog.accept()
    })
    await page.getByTestId('prompt-delete').click()
    await expect(page.getByTestId('prompt-editor')).toContainText('Select or create a prompt')

    await page.getByTestId('prompt-search').fill('')
    await page.getByTestId('prompt-scope-filter').selectOption('all')
    await page.getByTestId('prompt-panel-toggle').click()
    await expect(page.getByTestId('prompt-panel')).toHaveCount(0)
  })

  await test.step('Macro template chrome creates the baseline record and exercises insertion cancellation', async () => {
    await openTemplateDrawer(page)
    await page.getByTestId('macro-template-search').fill('nothing-yet')
    await expect(page.getByTestId('macro-template-select').locator('option')).toContainText(['No templates'])
    await page.getByTestId('macro-template-search').fill('')
    await page.getByTestId('macro-template-dismiss-layer').click()
    await expect(page.getByTestId('macro-template-drawer-body')).toHaveCount(0)

    await openTemplateDrawer(page)
    await page.getByTestId('macro-create').click()
    await expect(page.getByTestId('macro-name')).toHaveValue('New Macro Template')
    mainTemplateId = await page.getByTestId('macro-template-select').inputValue()
    expect(mainTemplateId).toMatch(/^tmpl_/)
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
    const invalidIf = rootNodes(page).last()
    await expect(invalidIf).toHaveAttribute('data-flow-node-type', 'if')
    await expect(page.getByTestId('macro-validation-summary'))
      .toContainText('artifact source must reference an earlier artifact-producing step in the visible predecessor scope')
    page.once('dialog', async (dialog) => dialog.accept())
    await nodeControl(invalidIf, 'node-remove').click()
    await expect(rootNodes(page)).toHaveCount(0)
  })

  await test.step('visual editor builds and exercises every main action surface', async () => {
    const sendRoot = await insertRoot(page, 'add-step-send', 'send_root')
    await selectOptionContaining(sendRoot.getByTestId('send-terminal'), 'dog_fake_1')
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
    await selectOptionContaining(waitRoot.getByTestId('wait-target-tab'), 'dog_fake_1')
    await waitRoot.getByTestId('wait-quiet-ms').fill('80')
    await waitRoot.getByTestId('wait-max-ms').fill('2500')
    await waitRoot.getByTestId('wait-on-timeout').selectOption('finish')
    await waitRoot.getByTestId('wait-on-timeout').selectOption('pause')
    await waitRoot.getByTestId('wait-mode').selectOption('user-continue')
    await waitRoot.getByTestId('wait-user-continue-prompt').fill('Temporary continue prompt')
    await waitRoot.getByTestId('wait-mode').selectOption('duration')
    await waitRoot.getByTestId('wait-duration-ms').fill('1800')

    const captureRoot = await insertRoot(page, 'add-step-capture', 'capture_root')
    await selectOptionContaining(captureRoot.getByTestId('capture-step-terminal'), 'dog_fake_1')
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
    await selectOptionContaining(ifSend.getByTestId('send-terminal'), 'dog_fake_2')
    await addMessageText(ifSend, 'IF_MATCH')

    await ifBranch.getByTestId('add-flow-elif').click()
    let elifBranches = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="elif"]')
    await expect(elifBranches).toHaveCount(1)
    await elifBranches.first().getByTestId('add-flow-elif').click()
    await expect(elifBranches).toHaveCount(2)
    page.once('dialog', async (dialog) => dialog.accept())
    await elifBranches.last().getByTestId('remove-flow-elif').click()
    await expect(elifBranches).toHaveCount(1)
    const elifBranch = elifBranches.first()
    await elifBranch.getByTestId('condition-source').selectOption('capture_root:captured_text')
    await elifBranch.getByTestId('condition-simple-text').fill('NEVER_MATCH')
    await insertInside(flowBody(page, 'elif body').last(), 'add-step-send')
    const elifSend = flowBody(page, 'elif body').last().locator(':scope > [data-flow-node-type="send"]').last()
    await setNodeId(elifSend, 'send_elif')
    await selectOptionContaining(elifSend.getByTestId('send-terminal'), 'dog_fake_2')
    await addMessageText(elifSend, 'ELIF_MATCH')

    await elifBranch.getByTestId('add-flow-else').click()
    let elseBranch = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="else"]')
    await expect(elseBranch).toHaveCount(1)
    page.once('dialog', async (dialog) => dialog.accept())
    await elseBranch.getByTestId('remove-flow-else').click()
    await expect(elseBranch).toHaveCount(0)
    await ifBranch.getByTestId('add-flow-else').click()
    elseBranch = ifNode.locator(':scope > [data-testid="if-branch-section"][data-flow-branch-kind="else"]')
    await insertInside(flowBody(page, 'else body').last(), 'add-step-send')
    const elseSend = flowBody(page, 'else body').last().locator(':scope > [data-flow-node-type="send"]').last()
    await setNodeId(elseSend, 'send_else')
    await selectOptionContaining(elseSend.getByTestId('send-terminal'), 'dog_fake_2')
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
    await selectOptionContaining(loopSend.getByTestId('send-terminal'), 'dog_fake_1')
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
    await selectOptionContaining(scopedInput.getByTestId('input-terminal'), 'dog_fake_1')
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
    page.once('dialog', async (dialog) => dialog.accept())
    await nodeControl(breakNode, 'node-remove').click()

    await nodeControl(loopNotify, 'node-add-after').click()
    await page.getByTestId('add-flow-continue').click()
    const continueNode = flowBody(page, 'for body').last().locator(':scope > [data-flow-node-type="continue"]').last()
    await setNodeId(continueNode, 'continue_temporary')
    await continueNode.getByTestId('flow-control-reason').fill('temporary continue')
    await insertInside(flowBody(page, 'continue action body').last(), 'add-step-send')
    page.once('dialog', async (dialog) => dialog.accept())
    await nodeControl(continueNode, 'node-remove').click()

    for (const temporary of [scopedInput, scopedWait]) {
      page.once('dialog', async (dialog) => dialog.accept())
      await nodeControl(temporary, 'node-remove').click()
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
    await selectOptionContaining(laneOne.getByTestId('parallel-lane-terminal'), 'dog_fake_1')
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
    await selectOptionContaining(laneTwo.getByTestId('parallel-lane-terminal'), 'dog_fake_2')
    page.once('dialog', async (dialog) => dialog.dismiss())
    await laneTwo.getByTestId('parallel-remove-lane').click()
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
    await selectOptionContaining(laneThree.getByTestId('parallel-lane-terminal'), 'dog_spare')
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
    page.once('dialog', async (dialog) => dialog.accept())
    await temporaryWait.getByTestId('parallel-node-remove').click()
    page.once('dialog', async (dialog) => dialog.accept())
    await temporary.getByTestId('parallel-node-remove').click()

    await parallel.getByTestId('parallel-lane-tab').filter({ hasText: 'Repair lane' }).click()
    laneThree = parallel.getByTestId('parallel-lane-editor')
    page.once('dialog', async (dialog) => dialog.accept())
    await laneThree.getByTestId('parallel-remove-lane').click()
    await expect(parallel.getByTestId('parallel-lane-tab')).toHaveCount(2)
    await parallel.getByTestId('parallel-add-lane').click()
    laneThree = parallel.getByTestId('parallel-lane-editor')
    await laneThree.getByTestId('parallel-lane-id-input').fill('lane_repair')
    await laneThree.getByTestId('parallel-lane-label-input').fill('Repair lane')
    await selectOptionContaining(laneThree.getByTestId('parallel-lane-terminal'), 'dog_spare')
    await addParallelAction(laneThree, 'parallel-add-capture')
    laneAction = laneThree.locator('[data-testid="parallel-lane-action"][data-parallel-action-type="capture-source"]').last()
    await setParallelActionId(laneAction, 'lane_repair_capture')
    await laneThree.getByTestId('parallel-output-id-input').fill('lane_repair_output')
    await laneThree.getByTestId('parallel-output-source').selectOption('lane_repair_capture:captured_text')
  })

  await test.step('final artifact send, text capture, runtime input, finish and validation are completed', async () => {
    const sendMerged = await insertRoot(page, 'add-step-send', 'send_merged_to_text')
    await selectOptionContaining(sendMerged.getByTestId('send-terminal'), 'dog_text')
    await sendMerged.getByTestId('message-add-text').click()
    await sendMerged.getByTestId('message-text-part').fill('MERGED\\n')
    await sendMerged.getByTestId('message-add-source').click()
    await sendMerged.getByTestId('message-source-part').selectOption('parallel_root:merged_text')
    await sendMerged.getByTestId('send-ending-sequence').selectOption('none')

    const captureText = await insertRoot(page, 'add-step-capture', 'capture_text_box')
    await selectOptionContaining(captureText.getByTestId('capture-step-terminal'), 'dog_text')
    await expect(captureText.getByTestId('capture-kind-fixed')).toContainText('text-box')

    const repairCapture = await insertRoot(page, 'add-step-capture', 'capture_repair')
    await selectOptionContaining(repairCapture.getByTestId('capture-step-terminal'), 'dog_spare')

    const input = await insertRoot(page, 'add-step-input', 'input_root')
    await selectOptionContaining(input.getByTestId('input-terminal'), 'dog_fake_1')
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
    page.once('dialog', async (dialog) => dialog.accept())
    await nodeControl(finishBodySend, 'node-remove').click()

    await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
    await openTemplateDrawer(page)
    await page.getByTestId('macro-save').click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await closeTemplateDrawer(page)
  })

  await test.step('JSON view, copy/export/import, duplicate, selection and deletion all remain operable', async () => {
    await page.getByTestId('macro-tab-json').click()
    await page.getByTestId('macro-json-copy').click()
    await expect.poll(async () => await page.evaluate(() => navigator.clipboard.readText())).toContain('"parallel_root"')

    const jsonDownload = page.waitForEvent('download')
    await page.getByTestId('macro-export-json').click()
    await (await jsonDownload).saveAs(exportedMacroPath)

    await page.getByTestId('macro-edit-json').click()
    await page.getByTestId('macro-json-editor').fill('{')
    await page.getByTestId('macro-save-json').click()
    await expect(page.getByTestId('macro-json-error')).toContainText('Invalid JSON:')
    const currentJson = await page.evaluate(() => navigator.clipboard.readText())
    await page.getByTestId('macro-json-editor').fill(currentJson.replace('"schemaVersion": 2', '"schemaVersion": 1'))
    await page.getByTestId('macro-save-json').click()
    await expect(page.getByTestId('macro-json-error')).toContainText('schemaVersion')
    await page.getByTestId('macro-cancel-json').click()
    await page.getByTestId('macro-tab-editor').click()

    await openTemplateDrawer(page)
    const macroDownload = page.waitForEvent('download')
    await page.getByTestId('macro-export').click()
    await (await macroDownload).saveAs(exportedMacroPath)

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('macro-import').click()
    const chooser = await chooserPromise
    await chooser.setFiles(exportedMacroPath)
    await expect(page.getByText('Imported', { exact: true })).toBeVisible()
    const importedId = await page.getByTestId('macro-template-select').inputValue()
    expect(importedId).not.toBe(mainTemplateId)
    page.once('dialog', async (dialog) => dialog.accept())
    await page.getByTestId('macro-delete').click()

    await page.getByTestId('macro-template-select').selectOption(mainTemplateId)
    await page.getByTestId('macro-duplicate').click()
    await expect(page.getByText('Duplicated', { exact: true })).toBeVisible()
    page.once('dialog', async (dialog) => dialog.dismiss())
    await page.getByTestId('macro-delete').click()
    page.once('dialog', async (dialog) => dialog.accept())
    await page.getByTestId('macro-delete').click()

    await page.getByTestId('macro-template-select').selectOption(mainTemplateId)
    await page.getByTestId('macro-create').click()
    await page.getByTestId('macro-name').fill('Temporary selectable Macro')
    await page.getByTestId('macro-save').click()
    const temporaryTemplateId = await page.getByTestId('macro-template-select').inputValue()
    await page.getByTestId('macro-template-search').fill('031B Full')
    await page.getByTestId('macro-template-select').selectOption(mainTemplateId)
    await page.getByTestId('macro-template-search').fill('')
    await page.getByTestId('macro-template-select').selectOption(temporaryTemplateId)
    page.once('dialog', async (dialog) => dialog.accept())
    await page.getByTestId('macro-delete').click()
    await page.getByTestId('macro-template-select').selectOption(mainTemplateId)
    await closeTemplateDrawer(page)
    await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
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
    await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /ECHO:DOG_ROOT/)
    await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /ECHO:LOOP/)
    await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /ECHO:PARALLEL_ALPHA/)
    await expect(terminalHost(page, fakeOneId)).toHaveAttribute('data-rendered-tail', /ECHO:DOG_INPUT_031B/)
    await terminalTab(page, fakeTwoId).click()
    await expect(terminalHost(page, fakeTwoId)).toHaveAttribute('data-rendered-tail', /ECHO:IF_MATCH/)
    await expect(terminalHost(page, fakeTwoId)).toHaveAttribute('data-rendered-tail', /ECHO:PARALLEL_BETA/)
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

  await test.step('Trace controls and artifact previews are exercised after the real run', async () => {
    await page.getByTestId('macro-tab-trace').click()
    await expect(page.getByTestId('run-log-panel')).toBeVisible()
    await page.getByTestId('run-log-debug-toggle').click()
    await page.getByTestId('run-log-refresh').click()
    await page.getByTestId('run-log-debug-toggle').click()
    await page.getByTestId('run-tab-ai').click()
    await expect(page.getByTestId('run-ai-trace')).toContainText(mainTemplateId)
    await page.getByTestId('run-trace-copy').click()
    await page.getByTestId('run-tab-log').click()
    await page.getByTestId('run-list-item').first().click()
    const firstNodeLog = page.getByTestId('run-node-log').filter({ has: page.getByTestId('run-artifact-ref') }).first()
    await firstNodeLog.getByTestId('run-node-log-toggle').click()
    await firstNodeLog.getByTestId('run-artifact-ref').first().click()
    await expect(firstNodeLog.getByTestId('run-artifact-preview')).toBeVisible()

    await page.getByTestId('run-create').click()
    await page.getByTestId('run-append-demo').click()
    await expect(page.getByTestId('run-derived-status')).toBeVisible()
    await page.getByTestId('macro-tab-editor').click()
  })

  await test.step('capability repair controls are produced by a real index shift and repaired through UI', async () => {
    await page.getByTestId('macro-tab-json').click()
    await page.getByTestId('macro-json-copy').click()
    const current = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
      body: Array<Record<string, unknown>>
    }
    mutateCaptureTargetsForRepair(current.body)
    await page.getByTestId('macro-edit-json').click()
    await page.getByTestId('macro-json-editor').fill(JSON.stringify(current, null, 2))
    await page.getByTestId('macro-save-json').click()
    await expect(page.getByTestId('macro-json-editor')).toHaveCount(0)
    await page.getByTestId('macro-tab-editor').click()

    page.once('dialog', async (dialog) => dialog.accept())
    await terminalTab(page, spareShellId).getByTestId('terminal-tab-close').click()
    await expect(page.getByTestId('terminal-tab')).toHaveCount(4)
    await expect(page.getByTestId('capture-kind-repair')).toBeVisible()
    await page.getByTestId('capture-kind-repair').click()
    await page.getByTestId('parallel-lane-tab').filter({ hasText: 'Repair lane' }).click()
    await expect(page.getByTestId('parallel-capture-kind-repair')).toBeVisible()
    await page.getByTestId('parallel-capture-kind-repair').click()
    await expect(page.getByTestId('macro-validation-summary')).toHaveText('success')
  })

  await test.step('runtime inventory reports an actual browser event for every non-Codex control', async () => {
    const evidence = await page.evaluate(() => window.__sdUiCoverage ?? {})
    const missing = runtimeControlInventory
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

async function renameTerminal(page: Page, terminalId: string, alias: string, commit: 'enter' | 'blur' | 'escape') {
  const tab = terminalTab(page, terminalId)
  await tab.dblclick()
  const input = page.getByTestId('terminal-alias-input')
  await expect(input).toBeFocused()
  await input.fill(alias)
  if (commit === 'enter') await page.keyboard.press('Enter')
  if (commit === 'escape') await page.keyboard.press('Escape')
  if (commit === 'blur') await page.getByTestId('macro-panel-toggle').click()
  if (commit === 'blur') await page.getByTestId('macro-panel-toggle').click()
  await expect(input).toHaveCount(0)
  if (commit !== 'escape') await expect(tab).toHaveAttribute('data-terminal-alias', alias)
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
  page.once('dialog', async (dialog) => dialog.accept())
  await nodeControl(temporary, 'node-remove').click()
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

function mutateCaptureTargetsForRepair(nodes: Array<Record<string, unknown>>) {
  for (const node of nodes) {
    if (node.id === 'capture_repair') {
      const capture = node.capture as Record<string, unknown>
      capture.terminal = { kind: 'index', value: 4 }
    }
    if (node.type === 'parallel') {
      const lanes = node.lanes as Array<Record<string, unknown>>
      const lane = lanes.find((candidate) => candidate.id === 'lane_repair')
      if (lane) {
        lane.terminal = { kind: 'index', value: 4 }
        for (const item of lane.body as Array<Record<string, unknown>>) {
          if (item.type === 'capture-source') {
            const capture = item.capture as Record<string, unknown>
            capture.terminal = { kind: 'index', value: 4 }
          }
        }
      }
    }
    if (node.type === 'if') {
      for (const branch of node.branches as Array<Record<string, unknown>>) {
        mutateCaptureTargetsForRepair(branch.body as Array<Record<string, unknown>>)
      }
      if (Array.isArray(node.else)) mutateCaptureTargetsForRepair(node.else as Array<Record<string, unknown>>)
    }
    if (node.type === 'for' || node.type === 'break' || node.type === 'continue' || node.type === 'finish') {
      if (Array.isArray(node.body)) mutateCaptureTargetsForRepair(node.body as Array<Record<string, unknown>>)
    }
  }
}
