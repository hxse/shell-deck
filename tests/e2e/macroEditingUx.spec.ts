import { expect, test, type APIRequestContext, type Page } from 'playwright/test'

test('Text tab shows synchronized line numbers and rename focuses before click-away save', async ({ page, request }) => {
  const configId = 'text-lines-rename-e2e'
  const created = await request.post('/api/configs/' + configId + '/terminals?backend=text')
  expect(created.ok()).toBe(true)
  const terminal = await created.json() as { terminalId: string; terminalAlias: string }

  await page.goto('/?configId=' + configId)
  const tab = page.locator('[data-testid="terminal-tab"][data-terminal-id="' + terminal.terminalId + '"]')
  await tab.click()

  const lineNumbers = page.getByTestId('text-box-line-number-list')
  await expect(lineNumbers.locator(':scope > div')).toHaveText(['1'])

  const content = Array.from({ length: 120 }, (_, index) => 'line-' + (index + 1)).join('\n')
  const editor = page.getByTestId('text-box-editor')
  await expect(editor).toHaveAttribute('wrap', 'off')
  await editor.fill(content)
  await expect(lineNumbers.locator(':scope > div')).toHaveCount(120)
  await expect(lineNumbers.locator(':scope > div').last()).toHaveText('120')
  await editor.evaluate((element) => {
    element.scrollTop = 240
    element.dispatchEvent(new Event('scroll'))
  })
  await expect.poll(async () => await lineNumbers.getAttribute('style')).toContain('translateY(-240px)')
  await expect.poll(async () => await terminalText(request, configId, terminal.terminalId)).toBe(content)

  await tab.dblclick()
  const aliasInput = page.getByTestId('terminal-alias-input')
  await expect(aliasInput).toBeFocused()
  await expect.poll(async () => await aliasInput.evaluate((element) => {
    const input = element as HTMLInputElement
    return {
      start: input.selectionStart,
      end: input.selectionEnd,
      length: input.value.length,
    }
  })).toEqual({ start: terminal.terminalAlias.length, end: terminal.terminalAlias.length, length: terminal.terminalAlias.length })

  await page.keyboard.type('_review')
  await editor.click()
  await expect(tab).toHaveAttribute('data-terminal-alias', terminal.terminalAlias + '_review')
  await expect(aliasInput).toHaveCount(0)
})

test('Macro depth guides distinguish nesting and JSON edit is isolated until valid Save', async ({ page, request }) => {
  const configId = 'macro-editing-ux-e2e'
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const template = nestedTemplate(configId)
  const imported = await request.post('/api/configs/' + configId + '/templates/import', { data: template })
  expect(imported.ok()).toBe(true)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('macro-step-list')).toBeVisible()

  const rootBody = page.locator('[data-testid="flow-block"][data-flow-depth="0"]').first()
  const nestedBody = page.locator('[data-testid="flow-block"][data-flow-depth="1"]').first()
  await expect(rootBody).toBeVisible()
  await expect(nestedBody).toBeVisible()
  const [rootGuide, nestedGuide] = await Promise.all([
    rootBody.evaluate((element) => {
      const style = getComputedStyle(element, '::before')
      return { color: style.backgroundColor, opacity: style.opacity, width: style.width }
    }),
    nestedBody.evaluate((element) => {
      const style = getComputedStyle(element, '::before')
      return { color: style.backgroundColor, opacity: style.opacity, width: style.width }
    }),
  ])
  expect(rootGuide).toEqual({ color: 'rgb(39, 134, 210)', opacity: '0.92', width: '2px' })
  expect(nestedGuide).toEqual({ color: 'rgb(20, 151, 126)', opacity: '0.92', width: '2px' })

  const chromeHeights = await page.getByTestId('macro-workbench-shell').evaluate((shell) => {
    const heightOf = (selector: string) => shell.querySelector(selector)?.getBoundingClientRect().height ?? 0
    return {
      header: heightOf('.macro-header'),
      runner: heightOf('[data-testid="macro-run-status"]'),
      tabs: heightOf('.macro-tabs'),
    }
  })
  expect(chromeHeights.header).toBe(39)
  expect(chromeHeights.runner).toBeLessThanOrEqual(40)
  expect(chromeHeights.tabs).toBeLessThanOrEqual(38)
  const macroTypography = await page.getByTestId('macro-workbench-shell').evaluate((shell) => {
    const fontSize = (selector: string) => {
      const element = shell.querySelector(selector)
      return element ? getComputedStyle(element).fontSize : ''
    }
    return {
      sectionTitle: fontSize('.macro-section-title h3'),
      fieldLabel: fontSize('.flow-node-editor label'),
      nodeTitle: fontSize('.flow-node-editor .step-title strong'),
      textarea: fontSize('[data-testid="message-text-part"]'),
      gutter: fontSize('[data-testid="message-text-part-line-numbers"]'),
    }
  })
  expect(macroTypography).toEqual({
    sectionTitle: '14px',
    fieldLabel: '12px',
    nodeTitle: '13px',
    textarea: '13px',
    gutter: '13px',
  })

  const controlSizes = await page.getByTestId('macro-workbench-shell').evaluate((shell) => {
    const metrics = (selector: string) => {
      const element = shell.querySelector(selector) as HTMLElement | null
      const style = element ? getComputedStyle(element) : null
      return { height: element?.getBoundingClientRect().height ?? 0, fontSize: style?.fontSize ?? '' }
    }
    return {
      viewTab: metrics('[data-testid="macro-tab-editor"]'),
      start: metrics('[data-testid="macro-control-start"]'),
      nodeAction: metrics('[data-testid="node-add-before"]'),
      partAction: metrics('[data-testid="message-add-text"]'),
    }
  })
  expect(controlSizes.viewTab).toEqual({ height: 28, fontSize: '12px' })
  expect(controlSizes.start).toEqual({ height: 28, fontSize: '12px' })
  expect(controlSizes.nodeAction.height).toBeGreaterThanOrEqual(24)
  expect(controlSizes.nodeAction.fontSize).toBe('12px')
  expect(controlSizes.partAction.height).toBeGreaterThanOrEqual(24)
  expect(controlSizes.partAction.fontSize).toBe('12px')

  await page.getByTestId('prompt-panel-toggle').click()
  await expect(page.getByTestId('prompt-panel')).toBeVisible()
  const promptScale = await page.getByTestId('prompt-panel').evaluate((panel) => {
    const metrics = (selector: string) => {
      const element = panel.querySelector(selector) as HTMLElement | null
      return {
        height: Math.round(element?.getBoundingClientRect().height ?? 0),
        fontSize: element ? getComputedStyle(element).fontSize : '',
      }
    }
    return {
      header: metrics('.prompt-header'),
      title: metrics('.prompt-header h2'),
      reset: metrics('[data-testid="prompt-reset-width"]'),
      sectionTitle: metrics('.prompt-section-title h3'),
      label: metrics('.prompt-section label'),
      control: metrics('[data-testid="prompt-scope-filter"]'),
      action: metrics('[data-testid="prompt-new-project"]'),
    }
  })
  expect(promptScale).toEqual({
    header: { height: 38, fontSize: '13px' },
    title: { height: 17, fontSize: '14px' },
    reset: { height: 26, fontSize: '12px' },
    sectionTitle: { height: 17, fontSize: '14px' },
    label: { height: 51, fontSize: '12px' },
    control: { height: 31, fontSize: '13px' },
    action: { height: 25, fontSize: '12px' },
  })
  await page.getByTestId('prompt-panel-toggle').click()
  await expect(page.getByTestId('prompt-panel')).toHaveCount(0)

  const rootNodes = rootBody.locator(':scope > [data-flow-node-depth="0"]')
  await expect(rootNodes).toHaveCount(2)
  await expect(rootNodes.nth(0)).toHaveAttribute('data-flow-sibling', 'false')
  await expect(rootNodes.nth(1)).toHaveAttribute('data-flow-sibling', 'true')
  const bottomTreeLine = await rootNodes.nth(0).evaluate((element) => {
    const style = getComputedStyle(element, '::before')
    return {
      bottom: style.bottom,
      height: style.height,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      mask: style.maskImage,
      left: style.left,
      borderTopWidth: style.borderTopWidth,
      extendsRight: Number.parseFloat(style.width) > element.getBoundingClientRect().width * 0.8,
    }
  })
  expect(bottomTreeLine).toEqual({
    bottom: '-1px',
    height: '2px',
    backgroundColor: rootGuide.color,
    backgroundImage: 'none',
    mask: expect.stringContaining('linear-gradient'),
    left: '0px',
    borderTopWidth: '0px',
    extendsRight: true,
  })
  expect(bottomTreeLine.mask).toContain('18%')
  expect(bottomTreeLine.mask).toContain('52%')
  await expect(page.getByTestId('flow-block-summary')).toHaveCount(0)
  expect(await rootBody.evaluate((element) => element.tagName)).toBe('DIV')
  const absentTopTreeLine = await rootNodes.nth(0).evaluate((element) => ({
    content: getComputedStyle(element, '::after').content,
    cardBorderTopColor: getComputedStyle(element).borderTopColor,
  }))
  expect(absentTopTreeLine).toEqual({
    content: 'none',
    cardBorderTopColor: 'rgba(0, 0, 0, 0)',
  })
  const siblingWhitespace = await rootNodes.nth(1).evaluate((element) => ({
    marginTop: Number.parseFloat(getComputedStyle(element).marginTop),
  }))
  expect(siblingWhitespace.marginTop).toBeGreaterThanOrEqual(14)

  const nestedNodes = nestedBody.locator(':scope > [data-flow-node-depth="1"]')
  await expect(nestedNodes).toHaveCount(2)
  const mergedGuidePositions = await Promise.all([
    rootBody.evaluate((element) => element.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(element, '::before').left)),
    rootNodes.nth(0).evaluate((element) => element.getBoundingClientRect().left),
    nestedBody.evaluate((element) => element.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(element, '::before').left)),
    nestedNodes.nth(0).evaluate((element) => element.getBoundingClientRect().left),
  ])
  expect(Math.abs(mergedGuidePositions[0] - mergedGuidePositions[1])).toBeLessThan(0.5)
  expect(Math.abs(mergedGuidePositions[2] - mergedGuidePositions[3])).toBeLessThan(0.5)
  expect(mergedGuidePositions[2]).toBeGreaterThan(mergedGuidePositions[0])
  expect(new Set(mergedGuidePositions.map((position) => Math.round(position))).size).toBe(2)
  const nodeBorders = await Promise.all([
    rootNodes.nth(0).evaluate((element) => ({ color: getComputedStyle(element).borderLeftColor, width: getComputedStyle(element).borderLeftWidth })),
    nestedNodes.nth(0).evaluate((element) => ({ color: getComputedStyle(element).borderLeftColor, width: getComputedStyle(element).borderLeftWidth })),
    nestedNodes.nth(1).evaluate((element) => ({ color: getComputedStyle(element).borderLeftColor, width: getComputedStyle(element).borderLeftWidth })),
  ])
  expect(nodeBorders).toEqual([
    { color: rootGuide.color, width: rootGuide.width },
    { color: nestedGuide.color, width: nestedGuide.width },
    { color: nestedGuide.color, width: nestedGuide.width },
  ])

  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toBeVisible()
  await expect.poll(async () => await page.getByTestId('macro-json-preview').evaluate((element) => getComputedStyle(element).fontSize)).toBe('14px')
  await expect(page.getByTestId('macro-json-editor')).toHaveCount(0)
  await page.getByTestId('macro-edit-json').click()
  const jsonEditor = page.getByTestId('macro-json-editor')
  await expect(jsonEditor).toBeVisible()
  await expect.poll(async () => await jsonEditor.evaluate((element) => getComputedStyle(element).fontSize)).toBe('14px')
  await expect(page.getByTestId('macro-tab-editor')).toBeDisabled()
  await expect(page.getByTestId('macro-tab-trace')).toBeDisabled()
  await expect(page.getByTestId('macro-control-start')).toBeDisabled()

  await openTemplateDrawer(page)
  await expect(page.getByTestId('macro-template-select')).toBeDisabled()
  await expect(page.getByTestId('macro-create')).toBeDisabled()
  await expect(page.getByTestId('macro-save')).toBeDisabled()
  await expect(page.getByTestId('macro-name')).toBeDisabled()
  await page.keyboard.press('Escape')

  await jsonEditor.fill('{')
  await page.getByTestId('macro-save-json').click()
  await expect(page.getByTestId('macro-json-error')).toContainText('Invalid JSON:')
  await expect(jsonEditor).toHaveValue('{')
  expect((await readTemplate(request, configId, template.id)).name).toBe(template.name)

  const cancelled = { ...template, name: 'Cancelled JSON name' }
  await jsonEditor.fill(JSON.stringify(cancelled, null, 2))
  await page.getByTestId('macro-cancel-json').click()
  await expect(page.getByTestId('macro-json-editor')).toHaveCount(0)
  await expect(page.getByTestId('macro-json-preview')).toContainText('Macro Editing UX')
  await expect(page.getByTestId('macro-tab-editor')).toBeEnabled()
  expect((await readTemplate(request, configId, template.id)).name).toBe(template.name)

  await page.getByTestId('macro-edit-json').click()
  const saved = { ...template, name: 'Saved through JSON' }
  await page.getByTestId('macro-json-editor').fill(JSON.stringify(saved, null, 2))
  await page.getByTestId('macro-save-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('Saved through JSON')
  await expect(page.getByTestId('macro-json-editor')).toHaveCount(0)
  await expect(page.getByTestId('macro-tab-editor')).toBeEnabled()
  expect((await readTemplate(request, configId, template.id)).name).toBe('Saved through JSON')

  await page.getByTestId('macro-tab-trace').click()
  await expect(page.getByTestId('run-log-panel')).toBeVisible()
  const traceScale = await page.getByTestId('run-log-panel').evaluate((panel) => {
    const metrics = (selector: string) => {
      const element = panel.querySelector(selector) as HTMLElement | null
      return {
        height: Math.round(element?.getBoundingClientRect().height ?? 0),
        fontSize: element ? getComputedStyle(element).fontSize : '',
      }
    }
    return {
      header: metrics('.run-log-header'),
      title: metrics('.run-log-header h2'),
      action: metrics('[data-testid="run-create"]'),
      tabs: metrics('.run-log-tabs'),
      tab: metrics('[data-testid="run-tab-log"]'),
      sectionTitle: metrics('.run-log-section-title h3'),
    }
  })
  expect(traceScale).toEqual({
    header: { height: 38, fontSize: '13px' },
    title: { height: 17, fontSize: '14px' },
    action: { height: 26, fontSize: '12px' },
    tabs: { height: 37, fontSize: '13px' },
    tab: { height: 28, fontSize: '12px' },
    sectionTitle: { height: 17, fontSize: '14px' },
  })
})

test('compact runner keeps waiting input as a full-width second row', async ({ page, request }) => {
  const configId = 'macro-compact-runner-input-e2e'
  const createdAt = '2026-07-12T00:00:00.000Z'
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const imported = await request.post('/api/configs/' + configId + '/templates/import', {
    data: {
      schemaVersion: 2,
      id: 'tmpl_compact_runner_input',
      name: 'Compact Runner Input',
      description: '',
      configId,
      body: [
        { id: 'ask', type: 'input', terminal: { kind: 'index', value: 1 }, prompt: 'Direction', allowEmpty: false, delivery: 'direct', ending: 'cr' },
        { id: 'done', type: 'finish', reason: 'ok' },
      ],
      createdAt,
      updatedAt: createdAt,
    },
  })
  expect(imported.ok()).toBe(true)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('macro-step-list')).toBeVisible()
  await page.getByTestId('macro-control-start').click()
  const runStatus = page.getByTestId('macro-run-status')
  const runInput = page.getByTestId('macro-run-input')
  await expect(runStatus).toContainText('waiting_user_input')
  await expect(runInput).toBeVisible()

  const waitingLayout = await runStatus.evaluate((dock) => {
    const input = dock.querySelector('[data-testid="macro-run-input"]') as HTMLElement | null
    const controls = dock.querySelector('[data-testid="macro-run-controls"]') as HTMLElement | null
    if (!input || !controls) return null
    const dockRect = dock.getBoundingClientRect()
    const inputRect = input.getBoundingClientRect()
    const controlsRect = controls.getBoundingClientRect()
    const style = getComputedStyle(input)
    return {
      gridColumnStart: style.gridColumnStart,
      gridColumnEnd: style.gridColumnEnd,
      spansDock: inputRect.width >= dockRect.width - 14,
      startsAfterControls: inputRect.top >= controlsRect.bottom,
    }
  })
  expect(waitingLayout).toEqual({
    gridColumnStart: '1',
    gridColumnEnd: '-1',
    spansDock: true,
    startsAfterControls: true,
  })
})

test('JSON Edit stays locked across delayed Select and Runner Start responses', async ({ page, request }) => {
  const configId = 'macro-json-pending-lock-e2e'
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const first = simpleTemplate(configId, 'tmpl_pending_first', 'Pending first')
  const second = {
    ...simpleTemplate(configId, 'tmpl_pending_second', 'Pending second'),
    body: [{ id: 'input', type: 'input', terminal: { kind: 'index', value: 1 }, prompt: 'Keep runner waiting', allowEmpty: false, delivery: 'auto', ending: 'cr' }],
  }
  expect((await request.post('/api/configs/' + configId + '/templates/import', { data: first })).ok()).toBe(true)
  expect((await request.post('/api/configs/' + configId + '/templates/import', { data: second })).ok()).toBe(true)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('macro-step-list')).toBeVisible()
  await selectTemplate(page, first.id)

  const selectGate = deferredGate()
  const selectPath = '**/api/configs/' + configId + '/templates/' + second.id
  let selectResponsePending = false
  await page.route(selectPath, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    selectResponsePending = true
    await selectGate.wait
    await route.fulfill({ response })
  })

  await openTemplateDrawer(page)
  await page.getByTestId('macro-template-select').selectOption(second.id)
  await expect.poll(() => selectResponsePending).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByTestId('macro-tab-json').click()
  const editJson = page.getByTestId('macro-edit-json')
  await expect(editJson).toBeDisabled()
  await expect(editJson).toHaveAttribute('title', 'Wait for the pending template operation to finish')
  await editJson.evaluate((button) => {
    const target = button as HTMLButtonElement
    target.disabled = false
    target.click()
  })
  await expect(page.getByTestId('macro-json-editor')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Wait for the pending template operation before editing JSON.')

  selectGate.release()
  await expect(page.getByTestId('macro-json-preview')).toContainText(second.name)
  await expect(editJson).toBeEnabled()
  await page.unroute(selectPath)

  const saveGate = deferredGate()
  const savePath = '**/api/configs/' + configId + '/templates/' + second.id
  let saveResponsePending = false
  let startRequested = false
  await page.route(savePath, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    saveResponsePending = true
    await saveGate.wait
    await route.fulfill({ response })
  })
  await page.route('**/api/configs/' + configId + '/runner/start', async (route) => {
    startRequested = true
    await route.continue()
  })

  await page.getByTestId('macro-control-start').click()
  await expect.poll(() => saveResponsePending).toBe(true)
  await expect(editJson).toBeDisabled()
  expect(startRequested).toBe(false)
  await editJson.evaluate((button) => {
    const target = button as HTMLButtonElement
    target.disabled = false
    target.click()
  })
  await expect(page.getByTestId('macro-json-editor')).toHaveCount(0)
  expect(startRequested).toBe(false)

  saveGate.release()
  await expect.poll(() => startRequested).toBe(true)
  await expect(page.getByTestId('macro-run-status')).toContainText('waiting_user_input')
  await expect(editJson).toBeEnabled()
  await page.getByTestId('macro-control-stop').click()
})

test('pending Save and Start make the visual editor inert and reject stale field mutations', async ({ page, request }) => {
  const configId = 'macro-visual-pending-lock-e2e'
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const template = simpleTemplate(configId, 'tmpl_visual_pending_lock', 'Visual pending lock')
  expect((await request.post('/api/configs/' + configId + '/templates/import', { data: template })).ok()).toBe(true)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('macro-step-list')).toBeVisible()
  const lockSurface = page.getByTestId('macro-editor-lock-surface')
  const nodeIdInput = rootFlowNode(page).getByTestId('node-id-input')
  await expect(lockSurface).toBeEnabled()
  await expect(nodeIdInput).toBeEnabled()

  const saveGate = deferredGate()
  const templatePath = '**/api/configs/' + configId + '/templates/' + template.id
  let saveResponsePending = false
  await page.route(templatePath, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    saveResponsePending = true
    await saveGate.wait
    await route.fulfill({ response })
  })

  await openTemplateDrawer(page)
  await page.getByTestId('macro-save').click()
  await expect.poll(() => saveResponsePending).toBe(true)
  await page.keyboard.press('Escape')
  await expect(lockSurface).toBeDisabled()
  await expect(lockSurface).toHaveAttribute('inert', '')
  await expect(nodeIdInput).toBeDisabled()
  await forceVisualInput(nodeIdInput, 'send_after_delayed_save')
  await expect(page.getByRole('alert')).toContainText('Wait for the pending template operation before editing the visual draft.')

  saveGate.release()
  await expect(lockSurface).toBeEnabled()
  await expect(lockSurface).not.toHaveAttribute('inert', '')
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"id": "send"')
  await expect(page.getByTestId('macro-json-preview')).not.toContainText('send_after_delayed_save')
  await page.getByTestId('macro-tab-editor').click()
  await expect(nodeIdInput).toHaveValue('send')
  const afterSave = await request.get('/api/configs/' + configId + '/templates/' + template.id)
  const afterSaveBody = await afterSave.json() as { template: { body: Array<{ id: string }> } }
  expect(afterSaveBody.template.body[0]?.id).toBe('send')
  await page.unroute(templatePath)

  const startGate = deferredGate()
  let startSaveResponsePending = false
  let startRequested = false
  await page.route(templatePath, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    startSaveResponsePending = true
    await startGate.wait
    await route.fulfill({ response })
  })
  await page.route('**/api/configs/' + configId + '/runner/start', async (route) => {
    startRequested = true
    await route.continue()
  })

  await page.getByTestId('macro-control-start').click()
  await expect.poll(() => startSaveResponsePending).toBe(true)
  await expect(lockSurface).toBeDisabled()
  await expect(nodeIdInput).toBeDisabled()
  await forceVisualInput(nodeIdInput, 'send_after_delayed_start')
  expect(startRequested).toBe(false)

  startGate.release()
  await expect(lockSurface).toBeEnabled()
  expect(startRequested).toBe(false)
  await expect(page.getByTestId('macro-run-status')).toContainText('idle')
  await page.getByTestId('macro-tab-json').click()
  await expect(page.getByTestId('macro-json-preview')).toContainText('"id": "send"')
  await expect(page.getByTestId('macro-json-preview')).not.toContainText('send_after_delayed_start')
})

test('collapse state resets on template replacement and deleted node id reuse', async ({ page, request }) => {
  const configId = 'macro-collapse-lifecycle-e2e'
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const first = simpleTemplate(configId, 'tmpl_collapse_first', 'Collapse first')
  const second = simpleTemplate(configId, 'tmpl_collapse_second', 'Collapse second')
  expect((await request.post('/api/configs/' + configId + '/templates/import', { data: first })).ok()).toBe(true)
  expect((await request.post('/api/configs/' + configId + '/templates/import', { data: second })).ok()).toBe(true)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('macro-step-list')).toBeVisible()
  await selectTemplate(page, first.id)
  let node = rootFlowNode(page)
  await node.getByTestId('node-toggle-collapse').click()
  await expect(node.getByTestId('node-collapsed-badge')).toHaveText('Collapsed')

  await selectTemplate(page, second.id)
  node = rootFlowNode(page)
  await expect(node.getByTestId('node-toggle-collapse')).toHaveAttribute('title', 'Collapse')
  await expect(node.getByTestId('node-collapsed-badge')).toHaveCount(0)

  await node.getByTestId('node-toggle-collapse').click()
  await expect(node.getByTestId('node-collapsed-badge')).toHaveText('Collapsed')
  page.once('dialog', (dialog) => dialog.accept())
  await node.getByTestId('node-remove').click()
  await expect(page.getByTestId('empty-body-add')).toBeVisible()
  await page.getByTestId('empty-body-add').click()
  await page.getByTestId('add-step-send').click()

  node = rootFlowNode(page)
  await expect(node.getByTestId('node-id-input')).toHaveValue('send')
  await expect(node.getByTestId('node-toggle-collapse')).toHaveAttribute('title', 'Collapse')
  await expect(node.getByTestId('node-collapsed-badge')).toHaveCount(0)
})

test('deleting a parallel lane clears collapse state before action ids are reused', async ({ page, request }) => {
  const configId = 'macro-lane-collapse-lifecycle-e2e'
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  await request.post('/api/configs/' + configId + '/terminals?backend=fake')
  const template = parallelCollapseTemplate(configId)
  expect((await request.post('/api/configs/' + configId + '/templates/import', { data: template })).ok()).toBe(true)

  await page.goto('/?configId=' + configId)
  await expect(page.getByTestId('parallel-lane-tabs')).toBeVisible()
  await page.getByTestId('parallel-lane-tab').nth(1).click()
  let action = page.getByTestId('parallel-lane-action')
  await action.getByTestId('parallel-node-toggle-collapse').click()
  await expect(action.getByTestId('node-collapsed-badge')).toHaveText('Collapsed')

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('parallel-remove-lane').click()
  await expect(page.getByTestId('parallel-lane-tab')).toHaveCount(1)
  await page.getByTestId('parallel-add-lane').click()
  await expect(page.getByTestId('parallel-lane-tab')).toHaveCount(2)
  await page.getByTestId('parallel-lane-add-before-output').click()
  await page.getByTestId('parallel-add-send').click()

  action = page.getByTestId('parallel-lane-action')
  await expect(action.getByTestId('parallel-action-id-input')).toHaveValue('send')
  await expect(action.getByTestId('parallel-node-toggle-collapse')).toHaveAttribute('title', 'Collapse')
  await expect(action.getByTestId('node-collapsed-badge')).toHaveCount(0)
})

async function openTemplateDrawer(page: Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) {
    await page.getByTestId('macro-template-drawer').click()
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

async function selectTemplate(page: Page, templateId: string) {
  await openTemplateDrawer(page)
  if (await page.getByTestId('macro-template-select').inputValue() !== templateId) {
    await page.getByTestId('macro-template-select').selectOption(templateId)
  }
  await expect(page.getByTestId('macro-template-metadata').locator('code')).toHaveText(templateId)
  await page.keyboard.press('Escape')
}

function rootFlowNode(page: Page) {
  return page.locator('[data-testid="flow-block"][data-flow-body-label="Root body"] > .flow-node-editor').first()
}

function deferredGate() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { wait, release }
}

async function forceVisualInput(input: ReturnType<Page['locator']>, value: string) {
  await input.evaluate((element, nextValue) => {
    const target = element as HTMLInputElement
    const lockSurface = target.closest('fieldset')
    lockSurface?.removeAttribute('disabled')
    lockSurface?.removeAttribute('inert')
    target.value = nextValue
    target.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function terminalText(request: APIRequestContext, configId: string, terminalId: string): Promise<string> {
  const response = await request.get('/api/configs/' + configId + '/snapshot')
  const snapshot = await response.json() as { terminals: Array<{ terminalId: string; replay: string[] }> }
  return snapshot.terminals.find((terminal) => terminal.terminalId === terminalId)?.replay.join('') ?? ''
}

async function readTemplate(request: APIRequestContext, configId: string, templateId: string): Promise<{ name: string }> {
  const response = await request.get('/api/configs/' + configId + '/templates/' + templateId)
  const body = await response.json() as { template: { name: string } }
  return body.template
}

function nestedTemplate(configId: string) {
  const createdAt = '2026-07-12T00:00:00.000Z'
  return {
    schemaVersion: 2,
    id: 'tmpl_macro_editing_ux',
    name: 'Macro Editing UX',
    description: '',
    configId,
    body: [
      sendNode('root_send'),
      {
        id: 'outer_for',
        type: 'for',
        range: { kind: 'count', count: 1 },
        body: [
          sendNode('nested_send_1'),
          sendNode('nested_send_2'),
        ],
      },
    ],
    createdAt,
    updatedAt: createdAt,
  }
}

function sendNode(id: string) {
  return {
    id,
    type: 'send',
    terminal: { kind: 'index', value: 1 },
    message: { parts: [{ kind: 'text', text: id }] },
    delivery: 'auto',
    ending: 'cr',
  }
}

function simpleTemplate(configId: string, id: string, name: string) {
  const createdAt = '2026-07-13T00:00:00.000Z'
  return {
    schemaVersion: 2,
    id,
    name,
    description: '',
    configId,
    body: [sendNode('send')],
    createdAt,
    updatedAt: createdAt,
  }
}

function parallelCollapseTemplate(configId: string) {
  const createdAt = '2026-07-13T00:00:00.000Z'
  return {
    schemaVersion: 2,
    id: 'tmpl_parallel_collapse_lifecycle',
    name: 'Parallel collapse lifecycle',
    description: '',
    configId,
    body: [{
      id: 'parallel',
      type: 'parallel',
      lanes: [
        {
          id: 'lane_1',
          label: 'Lane 1',
          terminal: { kind: 'index', value: 1 },
          body: [{ id: 'lane_1_output', type: 'output', source: { kind: 'none' } }],
        },
        {
          id: 'lane_2',
          label: 'Lane 2',
          terminal: { kind: 'index', value: 2 },
          body: [{ ...sendNode('send'), terminal: { kind: 'index', value: 2 } }, { id: 'lane_2_output', type: 'output', source: { kind: 'none' } }],
        },
      ],
      merge: { kind: 'sectioned_text', separator: '\n', includeEmptyOutputs: false },
      onLaneFail: 'pause',
    }],
    createdAt,
    updatedAt: createdAt,
  }
}
