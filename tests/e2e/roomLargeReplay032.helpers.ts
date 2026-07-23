import { expect, type APIRequestContext, type Page } from 'playwright/test'

export async function openNewRoom(page: Page, request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/rooms')
  expect(response.status()).toBe(201)
  const body = await response.json() as { url: string }
  await page.goto(body.url)
  await expect(page.getByTestId('room-identity')).toContainText('connected')
}

export async function createTerminal(page: Page, backend: 'fake' | 'real' | 'text'): Promise<{ terminalId: string; launchId: string }> {
  const terminal = await page.evaluate(async (requestedBackend) => {
    type HarnessScope = typeof window & { __shellDeckControllerSocket033?: WebSocket }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const scope = window as HarnessScope
    let socket = scope.__shellDeckControllerSocket033
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      socket = new WebSocket(`${protocol}//${location.host}/ws/rooms/${location.pathname.slice(1)}`)
      scope.__shellDeckControllerSocket033 = socket
      await new Promise<void>((resolve, reject) => {
        let clientId = ''
        let controlEpoch: number | null = null
        let takingControl = false
        const timer = window.setTimeout(() => reject(new Error('room_control_timeout')), 5000)
        const maybeTakeControl = async () => {
          if (!clientId || controlEpoch === null || takingControl) return
          takingControl = true
          try {
            const response = await fetch(`/api/rooms/${encodeURIComponent(location.pathname.slice(1))}/control/take-over`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-shell-deck-client-id': clientId },
              body: JSON.stringify({ expectedControlEpoch: controlEpoch, confirmed: true }),
            })
            const body = await response.json() as { ok?: boolean; error?: string }
            if (!response.ok || body.ok !== true) throw new Error(body.error ?? 'room_control_takeover_failed')
            window.clearTimeout(timer)
            resolve()
          } catch (error) { reject(error) }
        }
        socket!.addEventListener('error', () => reject(new Error('room_control_socket_error')), { once: true })
        socket!.addEventListener('message', (event) => {
          const message = JSON.parse(String(event.data)) as { type: string; clientId?: string; view?: { controlEpoch?: number } }
          if (message.type === 'client_registered' && message.clientId) clientId = message.clientId
          if (message.type === 'room_control' && typeof message.view?.controlEpoch === 'number') controlEpoch = message.view.controlEpoch
          void maybeTakeControl()
        })
      })
    }
    return await new Promise<{ terminalId: string; launchId: string }>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('terminal_create_timeout')), 5000)
      socket.addEventListener('error', () => reject(new Error('terminal_create_socket_error')), { once: true })
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; terminalId?: string; launchId?: string; backend?: string }
        if (message.type !== 'terminal_snapshot' || message.backend !== requestedBackend || !message.terminalId || !message.launchId) return
        window.clearTimeout(timer)
        resolve({ terminalId: message.terminalId, launchId: message.launchId })
      })
      socket.send(JSON.stringify({ type: 'create_terminal', backend: requestedBackend }))
    })
  }, backend)
  await expect(page.locator(`[data-testid="terminal-tab"][data-terminal-id="${terminal.terminalId}"]`)).toBeVisible()
  return terminal
}

export async function createUiTerminal(page: Page, buttonName: 'New shell' | 'New text'): Promise<{ terminalId: string }> {
  const tabs = page.getByTestId('terminal-tab')
  const previousCount = await tabs.count()
  await page.getByRole('button', { name: buttonName, exact: true }).click()
  await expect(tabs).toHaveCount(previousCount + 1)
  const terminalId = await tabs.nth(previousCount).getAttribute('data-terminal-id')
  if (!terminalId) throw new Error('ui_terminal_id_missing')
  return { terminalId }
}

export async function sendTerminalMessages(page: Page, messages: Array<Record<string, unknown>>): Promise<void> {
  await page.evaluate((payloads) => {
    const socket = (window as typeof window & { __shellDeckControllerSocket033?: WebSocket }).__shellDeckControllerSocket033
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('room_controller_socket_missing')
    for (const message of payloads) socket.send(JSON.stringify(message))
  }, messages)
}

export function terminalHost(page: Page, terminalId: string) {
  return page.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminalId}"]`).getByTestId('terminal-host')
}

export function terminalTab(page: Page, terminalId: string) {
  return page.locator(`[data-testid="terminal-tab"][data-terminal-id="${terminalId}"]`)
}

export async function terminalVisibleText(host: ReturnType<typeof terminalHost>): Promise<string> {
  return await host.locator('.xterm-rows').innerText()
}

export async function dragTerminalScrollbar(
  page: Page,
  host: ReturnType<typeof terminalHost>,
  destination: 'history' | 'bottom',
): Promise<void> {
  await host.hover()
  const scrollbar = host.locator('.xterm-scrollable-element > .scrollbar.vertical')
  const slider = scrollbar.locator('> .slider')
  await expect(scrollbar).toHaveClass(/visible/)
  const [scrollbarBox, sliderBox] = await Promise.all([scrollbar.boundingBox(), slider.boundingBox()])
  if (!scrollbarBox || !sliderBox) throw new Error('terminal_scrollbar_geometry_missing')

  const x = sliderBox.x + sliderBox.width / 2
  const startY = sliderBox.y + sliderBox.height / 2
  const targetY = destination === 'history'
    ? scrollbarBox.y + scrollbarBox.height * 0.25
    : scrollbarBox.y + scrollbarBox.height - 2
  await page.mouse.move(x, startY)
  await page.mouse.down()
  await page.mouse.move(x, targetY, { steps: 5 })
  await page.mouse.up()
}

export async function terminalInputFrames(page: Page): Promise<string[]> {
  return await page.evaluate(() => [
    ...(window as typeof window & { __terminalInputFrames032?: string[] }).__terminalInputFrames032 ?? [],
  ])
}

export async function renderCounters(host: ReturnType<typeof terminalHost>) {
  return await host.evaluate((element) => ({
    tailLength: element.dataset.renderedTail?.length ?? 0,
    revision: Number(element.dataset.renderedRevision ?? '0'),
    writeCount: Number(element.dataset.terminalWriteCount ?? '0'),
    enqueuedCodeUnits: Number(element.dataset.terminalEnqueuedCodeUnits ?? '0'),
    parserConsumedCodeUnits: Number(element.dataset.terminalParserConsumedCodeUnits ?? '0'),
    fitCount: Number(element.dataset.terminalFitCount ?? '0'),
  }))
}

export async function expectParserIdle(host: ReturnType<typeof terminalHost>): Promise<void> {
  await expect.poll(async () => host.evaluate((element) =>
    Number(element.dataset.terminalEnqueuedCodeUnits ?? '0') - Number(element.dataset.terminalParserConsumedCodeUnits ?? '0'),
  )).toBe(0)
}

export function parserWork(counters: Awaited<ReturnType<typeof renderCounters>>) {
  return {
    revision: counters.revision,
    writeCount: counters.writeCount,
    enqueuedCodeUnits: counters.enqueuedCodeUnits,
    parserConsumedCodeUnits: counters.parserConsumedCodeUnits,
  }
}

export function xtermOscRgb(color: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) throw new Error('xterm_palette_color_invalid:' + color)
  return `rgb:${match[1]}${match[1]}/${match[2]}${match[2]}/${match[3]}${match[3]}`.toLowerCase()
}

export async function installHeartbeat(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { active: true, frames: 0, lastFrameAt: performance.now(), maxFrameGapMs: 0, maxLongTaskMs: 0, longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask') }
    const scope = window as typeof window & { __roomHeartbeat032?: typeof state; __roomLongTaskObserver032?: PerformanceObserver }
    scope.__roomHeartbeat032 = state
    if (state.longTaskSupported) {
      const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) state.maxLongTaskMs = Math.max(state.maxLongTaskMs, entry.duration) })
      observer.observe({ entryTypes: ['longtask'] })
      scope.__roomLongTaskObserver032 = observer
    }
    const tick = (timestamp: number) => {
      if (!state.active) return
      state.maxFrameGapMs = Math.max(state.maxFrameGapMs, timestamp - state.lastFrameAt)
      state.lastFrameAt = timestamp
      state.frames += 1
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

export async function stopHeartbeat(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  return await page.evaluate(() => {
    const scope = window as typeof window & { __roomHeartbeat032?: { active: boolean; frames: number; maxFrameGapMs: number; maxLongTaskMs: number; longTaskSupported: boolean }; __roomLongTaskObserver032?: PerformanceObserver }
    const state = scope.__roomHeartbeat032!
    state.active = false
    const observer = scope.__roomLongTaskObserver032
    if (observer) {
      for (const entry of observer.takeRecords()) state.maxLongTaskMs = Math.max(state.maxLongTaskMs, entry.duration)
      observer.disconnect()
    }
    return { frames: state.frames, maxFrameGapMs: state.maxFrameGapMs, maxLongTaskMs: state.maxLongTaskMs, longTaskSupported: state.longTaskSupported }
  })
}
