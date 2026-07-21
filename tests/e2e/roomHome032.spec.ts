import { expect, test, type Page } from 'playwright/test'

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/rooms')
  if (!response.ok()) return
  const body = await response.json() as { rooms: Array<{ roomId: string; roomGeneration: string }> }
  await Promise.all(body.rooms.map((room) => request.delete('/api/rooms/' + encodeURIComponent(room.roomId), {
    data: { expectedRoomGeneration: room.roomGeneration },
  })))
})

test('New shell skips a cwd dialog and tab/header share one single-line label', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/room_[1-9A-HJ-NP-Za-km-z]{22}$/)

  let dialogCount = 0
  page.on('dialog', async (dialog) => {
    dialogCount += 1
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: 'New shell' }).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(1)
  const tab = page.getByTestId('terminal-tab')
  const terminalId = await tab.getAttribute('data-terminal-id')
  if (!terminalId) throw new Error('terminal_id_missing')
  const label = terminalMetaLabel(page, terminalId)
  await expect(label).toContainText(' · real · running')
  await expect(tab).toHaveAttribute('title', await label.textContent() ?? '')
  expect(await label.evaluate((element) => ({
    whiteSpace: getComputedStyle(element).whiteSpace,
    overflow: getComputedStyle(element).overflow,
    textOverflow: getComputedStyle(element).textOverflow,
  }))).toEqual({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })
  expect(dialogCount).toBe(0)
})

test('live cwd updates the label and New shell inherits it after a trailing Text tab', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New shell' }).click()
  const firstShellId = await page.getByTestId('terminal-tab').getAttribute('data-terminal-id')
  if (!firstShellId) throw new Error('first_shell_id_missing')
  await expect(page.getByTestId('terminal-host')).toBeVisible()
  await page.getByTestId('terminal-host').click()
  await page.keyboard.type('cd /tmp')
  await page.keyboard.press('Enter')
  await expect(terminalMetaLabel(page, firstShellId)).toContainText(' · /tmp · real · running')

  await page.getByRole('button', { name: 'New text' }).click()
  await page.getByRole('button', { name: 'New shell' }).click()
  await expect(page.getByTestId('terminal-tab')).toHaveCount(3)
  const inheritedShellTab = page.getByTestId('terminal-tab').nth(2)
  const inheritedShellId = await inheritedShellTab.getAttribute('data-terminal-id')
  if (!inheritedShellId) throw new Error('inherited_shell_id_missing')
  await expect(terminalMetaLabel(page, inheritedShellId)).toContainText(' · /tmp · real · running')
  await expect(inheritedShellTab).toHaveAttribute('title', / · \/tmp · real · running$/)
})

test('canonical Room URL, Home lifecycle and same-user tab sync work without config scope', async ({ browser }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  await first.goto('/')
  await expect(first).toHaveURL(/\/room_[1-9A-HJ-NP-Za-km-z]{22}$/)
  await expect(first.getByTestId('room-identity')).toContainText('connected')
  await expect(first.getByTestId('empty-terminal-room')).toBeVisible()

  await first.getByRole('button', { name: 'New text' }).click()
  await expect(first.getByTestId('terminal-tab')).toHaveCount(1)
  const roomUrl = first.url()
  const second = await context.newPage()
  await second.goto(roomUrl)
  await expect(second.getByTestId('terminal-tab')).toHaveCount(1)
  await expect(second.getByTestId('text-box-editor')).toHaveAttribute('readonly', '')

  await first.getByTestId('text-box-editor').fill('shared note')
  await expect(second.getByTestId('text-box-editor')).toHaveValue('shared note')

  const homePagePromise = context.waitForEvent('page')
  await first.getByTestId('home-button').click()
  const home = await homePagePromise
  await home.waitForLoadState()
  await expect(home).toHaveURL(/\/$/)
  await expect(home.getByTestId('room-home')).toBeVisible()
  await expect(home.getByTestId('room-list').locator('li')).toHaveCount(1)
  await expect(home.getByTestId('room-capacity')).toHaveText('1 / 32')

  await home.getByTestId('new-room').click()
  await expect(home).toHaveURL(/\/room_[1-9A-HJ-NP-Za-km-z]{22}$/)
  expect(home.url()).not.toBe(roomUrl)

  const management = await context.newPage()
  await management.goto('/')
  await expect(management.getByTestId('room-list').locator('li')).toHaveCount(2)
  const originalRow = management.getByTestId('room-list').locator('li').filter({ hasText: new URL(roomUrl).pathname.slice(1) })
  management.once('dialog', (dialog) => void dialog.accept())
  await originalRow.getByRole('button', { name: 'Destroy' }).click()
  await expect(management.getByTestId('room-list').locator('li')).toHaveCount(1)
  await expect(first).toHaveURL(/\/$/)
  await expect(second).toHaveURL(/\/$/)

  management.once('dialog', (dialog) => void dialog.accept())
  await management.getByTestId('room-list').locator('li').getByRole('button', { name: 'Destroy' }).click()
  await expect(management.getByTestId('room-home-empty')).toBeVisible()
  await expect(management.getByTestId('room-capacity')).toHaveText('0 / 32')
  await management.getByTestId('room-home-empty').getByRole('button', { name: 'New Room' }).click()
  await expect(management).toHaveURL(/\/room_[1-9A-HJ-NP-Za-km-z]{22}$/)

  await context.close()
})

test('delayed Text own echo coalesces rapid edits without rolling the textarea back', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    ;(window as typeof window & { __textWrites?: string[] }).__textWrites = []
    class DelayedWebSocket extends EventTarget {
      static readonly CONNECTING = NativeWebSocket.CONNECTING
      static readonly OPEN = NativeWebSocket.OPEN
      static readonly CLOSING = NativeWebSocket.CLOSING
      static readonly CLOSED = NativeWebSocket.CLOSED
      readonly CONNECTING = NativeWebSocket.CONNECTING
      readonly OPEN = NativeWebSocket.OPEN
      readonly CLOSING = NativeWebSocket.CLOSING
      readonly CLOSED = NativeWebSocket.CLOSED
      readonly #socket: WebSocket

      constructor(url: string | URL, protocols?: string | string[]) {
        super()
        this.#socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols)
        this.#socket.addEventListener('open', () => this.dispatchEvent(new Event('open')))
        this.#socket.addEventListener('close', (event) => this.dispatchEvent(new CloseEvent('close', event)))
        this.#socket.addEventListener('error', () => this.dispatchEvent(new Event('error')))
        this.#socket.addEventListener('message', (event) => {
          let delay = 0
          try {
            const message = JSON.parse(String(event.data))
            if (message.type === 'terminal_snapshot' && message.backend === 'text' && message.textRevision === 1) delay = 250
          } catch {}
          window.setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: event.data })), delay)
        })
      }

      get readyState() { return this.#socket.readyState }
      get url() { return this.#socket.url }
      get protocol() { return this.#socket.protocol }
      get extensions() { return this.#socket.extensions }
      get bufferedAmount() { return this.#socket.bufferedAmount }
      get binaryType() { return this.#socket.binaryType }
      set binaryType(value: BinaryType) { this.#socket.binaryType = value }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === 'string') {
          try {
            const message = JSON.parse(data)
            if (message.type === 'set_terminal_text') (window as typeof window & { __textWrites: string[] }).__textWrites.push(message.content)
          } catch {}
        }
        this.#socket.send(data)
      }
      close(code?: number, reason?: string) { this.#socket.close(code, reason) }
    }
    Object.defineProperty(window, 'WebSocket', { value: DelayedWebSocket, configurable: true })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'New text' }).click()
  const editor = page.getByTestId('text-box-editor')
  await editor.fill('a')
  await editor.fill('ab')
  await editor.fill('a')
  await expect(editor).toHaveValue('a')
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __textWrites?: string[] }).__textWrites)).toEqual(['a', 'a'])
  await expect(editor).toHaveValue('a')
})

function terminalMetaLabel(page: Page, terminalId: string) {
  return page.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminalId}"] .terminal-meta-label`)
}
