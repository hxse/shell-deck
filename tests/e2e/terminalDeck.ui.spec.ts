import { expect, test } from 'playwright/test'

test("browser tabs render live output, alias rename, replay and drag reorder", async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()

  await request.post("/api/configs/terminal-deck-e2e/terminals?backend=fake")
  await request.post("/api/configs/terminal-deck-e2e/terminals?backend=fake")
  await first.goto('/?configId=terminal-deck-e2e')
  await second.goto('/?configId=terminal-deck-e2e')
  await expect(first.getByTestId('terminal-tab')).toHaveCount(2)
  await expect(second.getByTestId('terminal-tab')).toHaveCount(2)

  const terminalId = await first.getByTestId('terminal-tab').first().getAttribute('data-terminal-id')
  const secondTerminalId = await first.getByTestId('terminal-tab').nth(1).getAttribute('data-terminal-id')
  expect(terminalId).toBeTruthy()
  expect(secondTerminalId).toBeTruthy()

  await first.getByTestId('terminal-tab').first().dblclick()
  await first.getByTestId('terminal-alias-input').fill('reviewer')
  await first.keyboard.press('Enter')
  await expect(first.getByTestId('terminal-tab').first()).toHaveAttribute('data-terminal-alias', 'reviewer')
  await expect(second.locator(`[data-testid="terminal-tab"][data-terminal-id="${terminalId}"]`)).toHaveAttribute('data-terminal-alias', 'reviewer')

  const firstHost = first.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminalId}"]`).getByTestId('terminal-host')
  const secondHost = second.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminalId}"]`).getByTestId('terminal-host')

  await firstHost.click()
  await first.keyboard.type('ui-live')
  await expect(firstHost).toHaveAttribute('data-rendered-replay', /ui-live/)
  const terminalSizing = await firstHost.evaluate((host) => {
    const xterm = host.querySelector('.xterm') as HTMLElement | null
    const viewport = host.querySelector('.xterm-viewport') as HTMLElement | null
    return {
      hostHeight: host.getBoundingClientRect().height,
      xtermHeight: xterm?.getBoundingClientRect().height ?? 0,
      viewportBackground: viewport ? getComputedStyle(viewport).backgroundColor : '',
    }
  })
  expect(terminalSizing.xtermHeight).toBeGreaterThan(terminalSizing.hostHeight * 0.85)
  expect(terminalSizing.viewportBackground).toBe('rgb(17, 19, 22)')
  await first.keyboard.press('Enter')

  await expect(firstHost).toHaveAttribute('data-rendered-replay', /ECHO:ui-live/)
  await expect(secondHost).toHaveAttribute('data-rendered-replay', /ECHO:ui-live/)

  await first.locator(`[data-testid="terminal-tab"][data-terminal-id="${secondTerminalId}"]`).click()
  const firstPageSecondHost = first.locator(`[data-testid="terminal-pane"][data-terminal-id="${secondTerminalId}"]`).getByTestId('terminal-host')
  await expect(firstPageSecondHost).not.toHaveAttribute('data-rendered-replay', /ECHO:ui-live/)
  await firstPageSecondHost.click()
  await first.keyboard.type('second-only')
  await first.keyboard.press('Enter')
  await expect(firstPageSecondHost).toHaveAttribute('data-rendered-replay', /ECHO:second-only/)

  await first.locator(`[data-testid="terminal-tab"][data-terminal-id="${terminalId}"]`).click()
  await expect(firstHost).toHaveAttribute('data-rendered-replay', /ECHO:ui-live/)
  await expect(firstHost).not.toHaveAttribute('data-rendered-replay', /ECHO:second-only/)

  await first.getByRole('button', { name: 'New fake' }).click()
  await expect(first.getByTestId('terminal-tab')).toHaveCount(3)
  const createdTerminalId = await first.getByTestId('terminal-tab').nth(2).getAttribute('data-terminal-id')
  expect(createdTerminalId).toBeTruthy()
  const createdHost = first.locator(`[data-testid="terminal-pane"][data-terminal-id="${createdTerminalId}"]`).getByTestId('terminal-host')
  await expect(createdHost).toHaveAttribute('data-rendered-replay', /READY/)
  await expect(createdHost).not.toHaveAttribute('data-rendered-replay', /ECHO:ui-live|ECHO:second-only/)

  const late = await context.newPage()
  await late.goto('/?configId=terminal-deck-e2e')
  await expect(late.getByTestId('terminal-tab')).toHaveCount(3)
  await expect(late.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminalId}"]`).getByTestId('terminal-host')).toHaveAttribute('data-rendered-replay', /ECHO:ui-live/)

  await expect(first.getByTestId('terminal-tab').first()).toHaveAttribute('draggable', 'false')
  await first.getByTestId('tab-drag-toggle').click()
  await expect(first.getByTestId('terminal-tab').first()).toHaveAttribute('draggable', 'true')
  await first.getByTestId('terminal-tab').first().dragTo(first.getByTestId('terminal-tab').nth(1))
  await expect(second.getByTestId('terminal-tab').nth(1)).toHaveAttribute('data-terminal-id', terminalId!)


  first.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Close terminal')
    await dialog.dismiss()
  })
  const createdTab = first.locator('[data-testid="terminal-tab"][data-terminal-id="' + createdTerminalId + '"]')
  await createdTab.getByTestId('terminal-tab-close').click()
  await expect(first.getByTestId('terminal-tab')).toHaveCount(3)

  first.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Close terminal')
    await dialog.accept()
  })
  await createdTab.getByTestId('terminal-tab-close').click()
  await expect(first.getByTestId('terminal-tab')).toHaveCount(2)
  await expect(second.getByTestId('terminal-tab')).toHaveCount(2)
  await expect(late.getByTestId('terminal-tab')).toHaveCount(2)
  await expect(first.locator('[data-testid="terminal-tab"][data-terminal-id="' + createdTerminalId + '"]')).toHaveCount(0)
  await context.close()
})

test('real shell keeps cursor visible after repeated empty prompts', async ({ page, request }) => {
  await request.post('/api/configs/terminal-enter-scroll-e2e/terminals?backend=real')
  await page.goto('/?configId=terminal-enter-scroll-e2e')
  const host = page.getByTestId('terminal-host').first()
  await expect(host).toBeVisible()
  await host.click()

  for (let index = 0; index < 90; index += 1) await page.keyboard.press('Enter')

  await expect.poll(async () => await terminalViewportState(host), { timeout: 5000 }).toMatchObject({ cursorVisible: true, screenFits: true })
  await page.keyboard.press('Control+C')
  await expect.poll(async () => (await terminalViewportState(host)).cursorVisible, { timeout: 5000 }).toBe(true)
})

async function terminalViewportState(host: { evaluate: <T>(callback: (host: HTMLElement) => T | Promise<T>) => Promise<T> }) {
  return await host.evaluate((element) => {
    const xterm = element.querySelector('.xterm') as HTMLElement | null
    const screen = element.querySelector('.xterm-screen') as HTMLElement | null
    const cursor = element.querySelector('.xterm-cursor, .xterm-cursor-layer .xterm-cursor') as HTMLElement | null
    const xtermRect = xterm?.getBoundingClientRect()
    const screenRect = screen?.getBoundingClientRect()
    const cursorRect = cursor?.getBoundingClientRect()
    return {
      cursorVisible: Boolean(cursorRect && xtermRect && cursorRect.bottom <= xtermRect.bottom + 1 && cursorRect.top >= xtermRect.top - 1),
      screenFits: Boolean(screenRect && xtermRect && screenRect.bottom <= xtermRect.bottom + 1),
    }
  })
}
