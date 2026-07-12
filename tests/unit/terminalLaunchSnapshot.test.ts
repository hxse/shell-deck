import { expect, test } from 'bun:test'
import { TerminalDeckManager } from '../../server/terminalDeckManager'

test('terminal snapshots expose the current launch id and reset replaces it', () => {
  const manager = new TerminalDeckManager()
  const first = manager.createTerminal('local', { backend: 'fake', terminalId: 'term_launch_snapshot' })

  expect(first.launchId).toMatch(/^launch_/)
  expect(manager.resetTerminal('local', first.terminalId, 'fake')).toEqual({ ok: true })

  const second = manager.deckSnapshot('local').terminals[0]
  expect(second.launchId).toMatch(/^launch_/)
  expect(second.launchId).not.toBe(first.launchId)
})
