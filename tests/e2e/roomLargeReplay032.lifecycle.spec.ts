import { expect, test } from 'playwright/test'
import {
  createTerminal,
  openNewRoom,
  sendTerminalMessages,
  terminalHost,
} from './roomLargeReplay032.helpers'

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
