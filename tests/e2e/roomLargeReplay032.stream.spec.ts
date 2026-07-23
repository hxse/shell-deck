import { expect, test } from 'playwright/test'
import { DEFAULT_TERMINAL_PARSER_CHUNK_CODE_UNIT_LIMIT } from '../../src/lib/terminalParserWritePump'
import {
  createTerminal,
  installHeartbeat,
  openNewRoom,
  renderCounters,
  sendTerminalMessages,
  stopHeartbeat,
  terminalHost,
} from './roomLargeReplay032.helpers'

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
