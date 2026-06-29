import { expect, test } from 'playwright/test'

test('browser tabs render live output, alias rename, replay and drag reorder', async ({ browser }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()

  await first.goto('/')
  await second.goto('/')
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
  await late.goto('/')
  await expect(late.getByTestId('terminal-tab')).toHaveCount(3)
  await expect(late.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminalId}"]`).getByTestId('terminal-host')).toHaveAttribute('data-rendered-replay', /ECHO:ui-live/)

  await expect(first.getByTestId('terminal-tab').first()).toHaveAttribute('draggable', 'false')
  await first.getByTestId('tab-drag-toggle').click()
  await expect(first.getByTestId('terminal-tab').first()).toHaveAttribute('draggable', 'true')
  await first.getByTestId('terminal-tab').first().dragTo(first.getByTestId('terminal-tab').nth(1))
  await expect(second.getByTestId('terminal-tab').nth(1)).toHaveAttribute('data-terminal-id', terminalId!)

  await context.close()
})
