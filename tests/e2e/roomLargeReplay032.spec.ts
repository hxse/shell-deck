import { expect, test, type APIRequestContext, type Page } from 'playwright/test'
import { DEFAULT_TERMINAL_PARSER_CHUNK_CODE_UNIT_LIMIT } from '../../src/lib/terminalParserWritePump'

const REAL_PTY_BURST_BYTES = 37_174_834

test('large live Room burst keeps browser replay and render work bounded', async ({ page, request }) => {
  await openNewRoom(page, request)
  const terminal = await createTerminal(page, 'fake')
  const host = terminalHost(page, terminal.terminalId)
  await expect(host).toHaveAttribute('data-rendered-tail', /READY/)

  const marker = 'SD_LARGE_BURST_COMPLETE_032'
  await sendTerminalMessages(page, [
    { type: 'terminal_input', terminalId: terminal.terminalId, data: 'x'.repeat(40_000) + marker + '\r' },
  ])
  await expect(host).toHaveAttribute('data-rendered-tail', new RegExp(marker), { timeout: 20_000 })
  const work = await renderCounters(host)
  expect(work.tailLength).toBeLessThanOrEqual(8192)
  expect(work.revision).toBeGreaterThan(0)
  expect(work.writeCount).toBeLessThan(512)
  expect(work.fitCount).toBeLessThan(25)
})

test('visited terminal views survive Shell and Text tab switches without replaying long history', async ({ page, request }) => {
  await openNewRoom(page, request)
  const shell = await createTerminal(page, 'fake')
  const text = await createTerminal(page, 'text')
  const shellHost = terminalHost(page, shell.terminalId)
  const textPane = page.locator(`[data-testid="text-box-pane"][data-terminal-id="${text.terminalId}"]`)
  const textEditor = textPane.getByTestId('text-box-editor')
  const historyMarker = 'SD_RETAINED_HISTORY_039'
  const textContent = Array.from({ length: 240 }, (_, index) => `retained text line ${index + 1}`).join('\n')

  await expect(shellHost).toBeVisible()
  await expect(textPane).toHaveCount(0)
  await sendTerminalMessages(page, [
    { type: 'set_terminal_text', terminalId: text.terminalId, content: textContent },
    { type: 'terminal_input', terminalId: shell.terminalId, data: 'h'.repeat(160_000) + historyMarker + '\r' },
  ])
  await expect(shellHost).toHaveAttribute('data-rendered-tail', new RegExp(historyMarker), { timeout: 20_000 })
  await expectParserIdle(shellHost)
  await shellHost.evaluate((element) => { element.dataset.retainedViewProbe = 'same-shell-view' })

  const hiddenMarker = 'SD_HIDDEN_LIVE_OUTPUT_039'
  await terminalTab(page, text.terminalId).click()
  await expect(textEditor).toHaveValue(textContent)
  await textEditor.evaluate((element) => {
    element.scrollTop = 480
    element.dispatchEvent(new Event('scroll'))
  })
  const retainedTextScrollTop = await textEditor.evaluate((element) => element.scrollTop)
  expect(retainedTextScrollTop).toBeGreaterThan(0)
  await expect(shellHost).toHaveCount(1)
  await expect(shellHost).not.toBeVisible()
  await sendTerminalMessages(page, [{ type: 'terminal_input', terminalId: shell.terminalId, data: hiddenMarker + '\r' }])
  await expect(shellHost).toHaveAttribute('data-rendered-tail', new RegExp(hiddenMarker))
  await expectParserIdle(shellHost)

  await terminalTab(page, shell.terminalId).click()
  await expect(shellHost).toBeVisible()
  await expect(shellHost).toHaveAttribute('data-retained-view-probe', 'same-shell-view')
  const beforeSwitch = parserWork(await renderCounters(shellHost))

  for (let iteration = 0; iteration < 3; iteration += 1) {
    await terminalTab(page, text.terminalId).click()
    await expect(textPane).toBeVisible()
    expect(await textEditor.evaluate((element) => element.scrollTop)).toBe(retainedTextScrollTop)
    await expect(shellHost).toHaveCount(1)
    await expect(shellHost).not.toBeVisible()

    await terminalTab(page, shell.terminalId).click()
    await expect(shellHost).toBeVisible()
    await expect(shellHost).toHaveAttribute('data-retained-view-probe', 'same-shell-view')
    expect(parserWork(await renderCounters(shellHost))).toEqual(beforeSwitch)
  }
})

test('real Room PTY streams 37 MB to its final marker without blocking browser progress', async ({ page, request }) => {
  test.setTimeout(60_000)
  await openNewRoom(page, request)
  const terminal = await createTerminal(page, 'real')
  const host = terminalHost(page, terminal.terminalId)
  await expect(host).toHaveAttribute('data-rendered-tail', /@/, { timeout: 10_000 })

  const marker = 'SD_REAL_LARGE_BURST_COMPLETE_032'
  await sendTerminalMessages(page, [{
    type: 'terminal_input',
    terminalId: terminal.terminalId,
    data: `stty -opost; yes "$(head -c 2047 /dev/zero | tr '\\0' x)" | head -c ${REAL_PTY_BURST_BYTES}; printf 'SD_REAL_%s\\n' 'LARGE_BURST_COMPLETE_032'; stty opost`,
  }])
  await expect(host).toHaveAttribute('data-rendered-tail', /stty -opost/, { timeout: 10_000 })
  await expect.poll(async () => host.evaluate((element) => Number(element.dataset.terminalEnqueuedCodeUnits ?? '0') - Number(element.dataset.terminalParserConsumedCodeUnits ?? '0'))).toBe(0)
  const baseline = await renderCounters(host)
  await installHeartbeat(page)
  await sendTerminalMessages(page, [{ type: 'terminal_input', terminalId: terminal.terminalId, data: '\r' }])

  await expect.poll(async () => host.evaluate((element, expected) => {
    const enqueued = Number(element.dataset.terminalEnqueuedCodeUnits ?? '0') - expected.enqueued
    const consumed = Number(element.dataset.terminalParserConsumedCodeUnits ?? '0') - expected.consumed
    return (element.dataset.renderedTail ?? '').includes(expected.marker)
      && enqueued >= expected.minimum
      && consumed >= expected.minimum
      && consumed <= enqueued
  }, { marker, enqueued: baseline.enqueuedCodeUnits, consumed: baseline.parserConsumedCodeUnits, minimum: REAL_PTY_BURST_BYTES }), { timeout: 30_000 }).toBe(true)

  const work = await renderCounters(host)
  const heartbeat = await stopHeartbeat(page)
  expect(work.tailLength).toBeLessThanOrEqual(8192)
  expect(work.revision).toBeGreaterThan(baseline.revision)
  expect(work.writeCount).toBeLessThan(2048)
  expect(work.writeCount - baseline.writeCount).toBeGreaterThanOrEqual(Math.ceil(REAL_PTY_BURST_BYTES / DEFAULT_TERMINAL_PARSER_CHUNK_CODE_UNIT_LIMIT))
  expect(work.enqueuedCodeUnits - baseline.enqueuedCodeUnits).toBeGreaterThanOrEqual(REAL_PTY_BURST_BYTES)
  expect(work.parserConsumedCodeUnits - baseline.parserConsumedCodeUnits).toBeGreaterThanOrEqual(REAL_PTY_BURST_BYTES)
  expect(work.parserConsumedCodeUnits).toBeLessThanOrEqual(work.enqueuedCodeUnits)
  expect(work.fitCount).toBeLessThan(25)
  expect(heartbeat.frames).toBeGreaterThan(1)
  expect(heartbeat.maxFrameGapMs).toBeLessThan(100)
  expect(heartbeat.longTaskSupported).toBe(true)
  expect(heartbeat.maxLongTaskMs).toBeLessThan(100)
})

test('Room terminal reset replaces launch output and stale parser callbacks cannot return', async ({ page, request }) => {
  await openNewRoom(page, request)
  const terminal = await createTerminal(page, 'fake')
  const host = terminalHost(page, terminal.terminalId)
  await expect(host).toHaveAttribute('data-rendered-tail', /READY/)
  const oldMarker = 'SD_OLD_GENERATION_MUST_NOT_RETURN_032'

  await sendTerminalMessages(page, [
    { type: 'terminal_input', terminalId: terminal.terminalId, data: 'o'.repeat(40_000) + oldMarker + '\r' },
    { type: 'reset_terminal', terminalId: terminal.terminalId, backend: 'fake' },
  ])
  await expect(host).toHaveAttribute('data-rendered-tail', /READY/)
  await page.waitForTimeout(250)
  await expect(host).not.toHaveAttribute('data-rendered-tail', new RegExp(oldMarker))
})

test('historical terminal queries stay inert on real page hydration and later tab switches retain that xterm', async ({ page, request }) => {
  await page.addInitScript(() => {
    const nativeSend = WebSocket.prototype.send
    ;(window as typeof window & { __terminalInputFrames032?: string[] }).__terminalInputFrames032 = []
    WebSocket.prototype.send = function(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof data === 'string') {
        try {
          const message = JSON.parse(data) as { type?: string; data?: string }
          if (message.type === 'terminal_input' && typeof message.data === 'string') {
            ;(window as typeof window & { __terminalInputFrames032: string[] }).__terminalInputFrames032.push(message.data)
          }
        } catch {
          // Non-JSON WebSocket payloads are outside the Room protocol under test.
        }
      }
      return nativeSend.call(this, data)
    }
  })

  await openNewRoom(page, request)
  const shell = await createUiTerminal(page, 'New shell')
  const text = await createUiTerminal(page, 'New text')
  await terminalTab(page, shell.terminalId).click()
  const host = terminalHost(page, shell.terminalId)
  await expect(host).toHaveAttribute('data-rendered-tail', /@/, { timeout: 10_000 })

  await host.click()
  await page.keyboard.type("printf '\\033[c\\033[6n\\033]10;?\\033\\\\\\033]11;?\\033\\\\'")
  await page.keyboard.press('Enter')
  await expect.poll(() => terminalInputFrames(page).then((frames) => ({
    deviceAttributes: frames.includes('\u001b[?1;2c'),
    cursorPosition: frames.some((frame) => /^\u001b\[\d+;\d+R$/.test(frame)),
    foreground: frames.includes('\u001b]10;rgb:e6e6/eded/f3f3\u001b\\'),
    background: frames.includes('\u001b]11;rgb:1111/1313/1616\u001b\\'),
  }))).toEqual({ deviceAttributes: true, cursorPosition: true, foreground: true, background: true })

  await page.keyboard.press('Control+C')
  await page.reload()
  await expect(page.getByTestId('room-identity')).toContainText('connected')
  await expect(page.getByTestId('room-control-status')).toHaveText('Control: This device')
  const hydrated = terminalHost(page, shell.terminalId)
  await expect(hydrated).toBeVisible()
  await expectParserIdle(hydrated)
  expect(await terminalInputFrames(page)).toEqual([])
  await hydrated.evaluate((element) => { element.dataset.retainedViewProbe = 'hydrated-shell-view' })
  const hydratedWork = parserWork(await renderCounters(hydrated))

  for (let iteration = 0; iteration < 3; iteration += 1) {
    await terminalTab(page, text.terminalId).click()
    await terminalTab(page, shell.terminalId).click()
    await expect(hydrated).toHaveAttribute('data-retained-view-probe', 'hydrated-shell-view')
    expect(parserWork(await renderCounters(hydrated))).toEqual(hydratedWork)
  }

  expect(await terminalInputFrames(page)).toEqual([])
  page.once('dialog', (dialog) => dialog.accept())
  await terminalTab(page, shell.terminalId).getByTestId('terminal-tab-close').click()
  await expect(hydrated).toHaveCount(0)
})

async function openNewRoom(page: Page, request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/rooms')
  expect(response.status()).toBe(201)
  const body = await response.json() as { url: string }
  await page.goto(body.url)
  await expect(page.getByTestId('room-identity')).toContainText('connected')
}

async function createTerminal(page: Page, backend: 'fake' | 'real' | 'text'): Promise<{ terminalId: string; launchId: string }> {
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

async function createUiTerminal(page: Page, buttonName: 'New shell' | 'New text'): Promise<{ terminalId: string }> {
  const tabs = page.getByTestId('terminal-tab')
  const previousCount = await tabs.count()
  await page.getByRole('button', { name: buttonName, exact: true }).click()
  await expect(tabs).toHaveCount(previousCount + 1)
  const terminalId = await tabs.nth(previousCount).getAttribute('data-terminal-id')
  if (!terminalId) throw new Error('ui_terminal_id_missing')
  return { terminalId }
}

async function sendTerminalMessages(page: Page, messages: Array<Record<string, unknown>>): Promise<void> {
  await page.evaluate((payloads) => {
    const socket = (window as typeof window & { __shellDeckControllerSocket033?: WebSocket }).__shellDeckControllerSocket033
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('room_controller_socket_missing')
    for (const message of payloads) socket.send(JSON.stringify(message))
  }, messages)
}

function terminalHost(page: Page, terminalId: string) {
  return page.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminalId}"]`).getByTestId('terminal-host')
}

function terminalTab(page: Page, terminalId: string) {
  return page.locator(`[data-testid="terminal-tab"][data-terminal-id="${terminalId}"]`)
}

async function terminalInputFrames(page: Page): Promise<string[]> {
  return await page.evaluate(() => [
    ...(window as typeof window & { __terminalInputFrames032?: string[] }).__terminalInputFrames032 ?? [],
  ])
}

async function renderCounters(host: ReturnType<typeof terminalHost>) {
  return await host.evaluate((element) => ({
    tailLength: element.dataset.renderedTail?.length ?? 0,
    revision: Number(element.dataset.renderedRevision ?? '0'),
    writeCount: Number(element.dataset.terminalWriteCount ?? '0'),
    enqueuedCodeUnits: Number(element.dataset.terminalEnqueuedCodeUnits ?? '0'),
    parserConsumedCodeUnits: Number(element.dataset.terminalParserConsumedCodeUnits ?? '0'),
    fitCount: Number(element.dataset.terminalFitCount ?? '0'),
  }))
}

async function expectParserIdle(host: ReturnType<typeof terminalHost>): Promise<void> {
  await expect.poll(async () => host.evaluate((element) =>
    Number(element.dataset.terminalEnqueuedCodeUnits ?? '0') - Number(element.dataset.terminalParserConsumedCodeUnits ?? '0'),
  )).toBe(0)
}

function parserWork(counters: Awaited<ReturnType<typeof renderCounters>>) {
  return {
    revision: counters.revision,
    writeCount: counters.writeCount,
    enqueuedCodeUnits: counters.enqueuedCodeUnits,
    parserConsumedCodeUnits: counters.parserConsumedCodeUnits,
  }
}

async function installHeartbeat(page: Page): Promise<void> {
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

async function stopHeartbeat(page: Page) {
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
