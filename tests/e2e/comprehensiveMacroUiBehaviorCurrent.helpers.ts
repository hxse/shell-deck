import { expect, type Locator, type Page } from 'playwright/test'

declare global {
  interface Window {
    __sdUiCoverage?: Record<string, string[]>
    __sdSystemNotifications?: Array<{ title: string; body: string; tag: string }>
  }
}

const INPUT_DELIVERY_HELP = 'Auto uses Bracketed paste for Shell tabs and Direct bytes for Text tabs. Direct bytes and Bracketed paste force the selected mode.'

export type MacroJourneyState = {
  externalRequests: string[]
  fakeOneId: string
  fakeTwoId: string
  realId: string
  spareShellId: string
  textId: string
  mainTemplateId: string
}

export function createMacroJourneyState(externalRequests: string[]): MacroJourneyState {
  return {
    externalRequests,
    fakeOneId: '',
    fakeTwoId: '',
    realId: '',
    spareShellId: '',
    textId: '',
    mainTemplateId: '',
  }
}

export async function clickWithDialog(
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

export async function installOfflineBrowserHarness(page: Page, externalRequests: string[]) {
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

export async function createTerminal(page: Page, testId: string, expectedCount: number) {
  await page.getByTestId(testId).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(expectedCount)
}

export async function terminalIdAt(page: Page, index: number): Promise<string> {
  const id = await page.getByTestId('terminal-tab').nth(index).getAttribute('data-terminal-id')
  if (!id) throw new Error('missing terminal id at index ' + index)
  return id
}

export function terminalTab(page: Page, terminalId: string): Locator {
  return page.locator('[data-testid="terminal-tab"][data-terminal-id="' + terminalId + '"]')
}

export function terminalHost(page: Page, terminalId: string): Locator {
  return page.locator('[data-testid="terminal-pane"][data-terminal-id="' + terminalId + '"]').getByTestId('terminal-host')
}

export async function dragResizeHandle(page: Page, testId: string, deltaX: number) {
  const handle = page.getByTestId(testId)
  const box = await handle.boundingBox()
  if (!box) throw new Error('missing resize handle: ' + testId)
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(24, box.height / 2))
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + Math.min(24, box.height / 2))
  await page.mouse.up()
}

export async function firstNonEmptyOptionValue(select: Locator): Promise<string> {
  const values = await select.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).filter(Boolean))
  if (!values[0]) throw new Error('select has no non-empty option')
  return values[0]
}

export async function selectOptionContaining(select: Locator, text: string) {
  const option = select.locator('option').filter({ hasText: text }).first()
  const value = await option.getAttribute('value')
  if (!value) throw new Error('missing option containing: ' + text)
  await select.selectOption(value)
}

export async function openTemplateDrawer(page: Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) {
    await page.getByTestId('macro-template-drawer').click()
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

export async function closeTemplateDrawer(page: Page) {
  if (await page.getByTestId('macro-template-drawer-body').count() > 0) {
    await page.getByTestId('macro-template-drawer').click()
  }
  await expect(page.getByTestId('macro-template-drawer-body')).toHaveCount(0)
}

export function flowBody(page: Page, label: string): Locator {
  return page.locator('[data-testid="flow-block"][data-flow-body-label="' + label + '"]')
}

export function rootNodes(page: Page): Locator {
  return flowBody(page, 'Root body').locator(':scope > [data-flow-node-id]')
}

export function nodeControl(node: Locator, testId: string): Locator {
  return node.locator(
    ':scope > [data-testid="node-menu"] > [data-testid="node-action-controls"] > [data-testid="' + testId + '"]',
  )
}

export async function insertRoot(page: Page, paletteTestId: string, nodeId: string): Promise<Locator> {
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

export async function insertInside(body: Locator, paletteTestId: string) {
  await body.locator(':scope > [data-testid="empty-flow-body"] > [data-testid="empty-body-add"]').click()
  await body.page().getByTestId(paletteTestId).click()
}

export async function insertAfter(node: Locator, paletteTestId: string) {
  await nodeControl(node, 'node-add-after').click()
  await node.page().getByTestId(paletteTestId).click()
}

export async function setNodeId(node: Locator, id: string) {
  await node.getByTestId('node-id-input').fill(id)
  await expect(node.page().locator('[data-flow-node-id="' + id + '"]')).toBeVisible()
}

export async function addMessageText(node: Locator, text: string) {
  await node.getByTestId('message-add-text').click()
  await node.getByTestId('message-text-part').last().fill(text)
}

export async function exerciseInputDelivery(scope: Locator, prefix: 'send' | 'input' | 'parallel-send') {
  const help = scope.getByTestId(prefix + '-input-delivery-help')
  await help.hover()
  await expect(scope.page().getByRole('tooltip')).toHaveText(INPUT_DELIVERY_HELP)
  await scope.page().mouse.move(0, 0)
  const select = scope.getByTestId(prefix + '-input-delivery')
  await select.selectOption('direct')
  await select.selectOption('bracketed-paste')
  await select.selectOption('auto')
}

export async function exerciseNodeChrome(page: Page, first: Locator, second: Locator) {
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

export async function addParallelAction(lane: Locator, paletteTestId: string) {
  await lane.getByTestId('parallel-lane-add-before-output').click()
  await lane.page().getByTestId(paletteTestId).click()
}

export async function insertParallelAfter(action: Locator, paletteTestId: string) {
  await action.getByTestId('parallel-lane-add-after').click()
  await action.page().getByTestId(paletteTestId).click()
}

export async function setParallelActionId(action: Locator, id: string) {
  await action.getByTestId('parallel-action-id-input').fill(id)
  await expect(action.page().locator('[data-parallel-action-id="' + id + '"]')).toBeVisible()
}
