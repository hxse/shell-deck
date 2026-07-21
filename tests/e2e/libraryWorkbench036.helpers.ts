import { expect, type BrowserContext, type Locator, type Page } from 'playwright/test'

declare global {
  interface Window { __sdRejectClipboard?: boolean; __shellDeckTestSockets?: WebSocket[] }
}

const ROOM_URL = /\/room_[1-9A-HJ-NP-Za-km-z]{22}$/

async function newRoomPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  await page.goto('/')
  if (await page.getByTestId('room-home').isVisible()) {
    const button = await page.getByTestId('new-room').count() ? page.getByTestId('new-room') : page.getByTestId('new-room-empty')
    await button.click()
  }
  await expect(page).toHaveURL(ROOM_URL)
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  return page
}

async function ensureLibraryVisible(page: Page) {
  if (!await page.getByTestId('library-side-panel').isVisible()) await page.getByTestId('library-panel-toggle').click()
  await expect(page.getByTestId('library-panel')).toBeVisible()
}

async function ensureController(page: Page) {
  if (await page.getByTestId('take-control').count()) {
    const acceptTakeover = (dialog: import('playwright/test').Dialog) => { void dialog.accept() }
    page.on('dialog', acceptTakeover)
    try { await page.getByTestId('take-control').click() }
    finally { page.off('dialog', acceptTakeover) }
  }
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
}

async function selectLibraryItem(page: Page, title: string) {
  const option = page.getByTestId('library-selector').locator('option', { hasText: title }).first()
  const value = await option.getAttribute('value')
  if (!value) throw new Error('missing Library option for ' + title)
  await page.getByTestId('library-selector').selectOption(value)
}

async function installWebSocketCapture(context: BrowserContext) {
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    const sockets: WebSocket[] = []
    class CapturedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        sockets.push(this)
      }
    }
    window.WebSocket = CapturedWebSocket
    window.__shellDeckTestSockets = sockets
  })
}

async function closeCapturedWebSocket(page: Page) {
  await page.evaluate(() => {
    const socket = (window.__shellDeckTestSockets ?? []).findLast((candidate) => candidate.readyState === WebSocket.OPEN)
    if (!socket) throw new Error('test_websocket_not_found')
    socket.close(4000, 'forced_reconnect')
  })
}

async function installClipboardHarness(context: BrowserContext) {
  await context.addInitScript(() => {
    let clipboardText = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          if (window.__sdRejectClipboard) return Promise.reject(new Error('synthetic_clipboard_failure'))
          clipboardText = value
          return Promise.resolve()
        },
        readText() { return Promise.resolve(clipboardText) },
      },
    })
  })
}

async function clickAndCover(locator: Locator, key: string, covered: Set<string>) {
  await locator.click()
  covered.add(key)
}

async function fillAndCover(locator: Locator, value: string, key: string, covered: Set<string>) {
  await locator.fill(value)
  covered.add(key)
}

async function dragResizeHandle(page: Page, testId: string, deltaX: number) {
  const handle = page.getByTestId(testId)
  const box = await handle.boundingBox()
  if (!box) throw new Error('missing resize handle ' + testId)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2)
  await page.mouse.up()
}

async function clickWithDialog(target: Locator, action: 'accept' | 'dismiss', expectedText: string) {
  const page = target.page()
  const dialogPromise = page.waitForEvent('dialog')
  const clickPromise = target.click()
  const dialog = await dialogPromise
  expect(dialog.message()).toContain(expectedText)
  if (action === 'accept') await dialog.accept()
  else await dialog.dismiss()
  await clickPromise
}

export {
  newRoomPage,
  ensureLibraryVisible,
  ensureController,
  selectLibraryItem,
  installWebSocketCapture,
  closeCapturedWebSocket,
  installClipboardHarness,
  clickAndCover,
  fillAndCover,
  dragResizeHandle,
  clickWithDialog,
}
