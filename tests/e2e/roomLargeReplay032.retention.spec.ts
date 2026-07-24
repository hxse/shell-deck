import { expect, test } from 'playwright/test'
import { createHash } from 'node:crypto'
import { XTERM_DARK_THEME, XTERM_LIGHT_THEME } from '../../src/lib/terminal/xtermTheme'
import {
  createTerminal,
  createUiTerminal,
  dragTerminalScrollbar,
  expectParserIdle,
  openNewRoom,
  parserWork,
  renderCounters,
  sendTerminalMessages,
  terminalHost,
  terminalInputFrames,
  terminalTab,
  terminalVisibleText,
  xtermOscRgb,
} from './roomLargeReplay032.helpers'

test('live Shell output and resize preserve a user-scrolled xterm viewport until they return to bottom', async ({ page, request }) => {
  await openNewRoom(page, request)
  const terminal = await createTerminal(page, 'fake')
  const host = terminalHost(page, terminal.terminalId)
  const historyBottomMarker = 'SD_SCROLL_HISTORY_BOTTOM_002'
  const history = Array.from(
    { length: 180 },
    (_, index) => `SD_SCROLL_HISTORY_${String(index).padStart(3, '0')}\r`,
  ).join('') + historyBottomMarker + '\r'

  await sendTerminalMessages(page, [
    { type: 'terminal_input', terminalId: terminal.terminalId, data: history },
  ])
  await expect(host).toHaveAttribute('data-rendered-tail', new RegExp(historyBottomMarker))
  await expectParserIdle(host)
  await expect.poll(() => terminalVisibleText(host)).toContain(historyBottomMarker)

  await dragTerminalScrollbar(page, host, 'history')
  await expect.poll(() => terminalVisibleText(host)).not.toContain(historyBottomMarker)
  expect(await terminalVisibleText(host)).toContain('SD_SCROLL_HISTORY_')

  const liveMarker = 'SD_SCROLL_LIVE_WHILE_REVIEWING_002'
  await sendTerminalMessages(page, [
    { type: 'terminal_input', terminalId: terminal.terminalId, data: liveMarker + '\r' },
  ])
  await expect(host).toHaveAttribute('data-rendered-tail', new RegExp(liveMarker))
  await expectParserIdle(host)
  expect(await terminalVisibleText(host)).not.toContain(liveMarker)
  expect(await terminalVisibleText(host)).toContain('SD_SCROLL_HISTORY_')

  const fitCount = (await renderCounters(host)).fitCount
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect.poll(async () => (await renderCounters(host)).fitCount).toBeGreaterThan(fitCount)
  expect(await terminalVisibleText(host)).not.toContain(liveMarker)
  expect(await terminalVisibleText(host)).toContain('SD_SCROLL_HISTORY_')

  await dragTerminalScrollbar(page, host, 'bottom')
  await expect.poll(() => terminalVisibleText(host)).toContain(liveMarker)

  const resumedFollowMarker = 'SD_SCROLL_BOTTOM_FOLLOW_RESUMED_002'
  await sendTerminalMessages(page, [
    { type: 'terminal_input', terminalId: terminal.terminalId, data: resumedFollowMarker + '\r' },
  ])
  await expect(host).toHaveAttribute('data-rendered-tail', new RegExp(resumedFollowMarker))
  await expectParserIdle(host)
  await expect.poll(() => terminalVisibleText(host)).toContain(resumedFollowMarker)
})

test('visited terminal views survive Shell and Text tab switches without replaying long history', async ({ page, request }) => {
  test.setTimeout(40_000)
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
    {
      type: 'mutate_terminal_text',
      terminalId: text.terminalId,
      expectedTextRevision: 0,
      mutation: { kind: 'patch', start: 0, deleteCount: 0, insert: textContent },
      resultHash: 'sha256:' + createHash('sha256').update(textContent).digest('hex'),
    },
    { type: 'terminal_input', terminalId: shell.terminalId, data: 'h'.repeat(160_000) + historyMarker + '\r' },
  ])
  await expect(shellHost).toHaveAttribute('data-rendered-tail', new RegExp(historyMarker), { timeout: 30_000 })
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
  const palette = await page.locator('html').getAttribute('data-theme-color-scheme') === 'dark' ? XTERM_DARK_THEME : XTERM_LIGHT_THEME
  const foregroundResponse = `\u001b]10;${xtermOscRgb(String(palette.foreground))}\u001b\\`
  const backgroundResponse = `\u001b]11;${xtermOscRgb(String(palette.background))}\u001b\\`
  await expect.poll(() => terminalInputFrames(page).then((frames) => ({
    deviceAttributes: frames.includes('\u001b[?1;2c'),
    cursorPosition: frames.some((frame) => /^\u001b\[\d+;\d+R$/.test(frame)),
    foreground: frames.includes(foregroundResponse),
    background: frames.includes(backgroundResponse),
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
