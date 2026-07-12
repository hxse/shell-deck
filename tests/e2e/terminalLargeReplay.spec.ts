import { expect, test, type Page } from 'playwright/test'
import { DEFAULT_TERMINAL_PARSER_CHUNK_CODE_UNIT_LIMIT } from '../../src/lib/terminalParserWritePump'

const REAL_PTY_BURST_BYTES = 37_174_834

test('large PTY burst uses bounded parsed tail and bounded render work', async ({ page, request }) => {
  const configId = 'terminal-large-replay-030'
  const created = await request.post(`/api/configs/${configId}/terminals?backend=fake`)
  expect(created.ok()).toBe(true)
  const terminal = await created.json() as { terminalId: string }

  await page.goto(`/?configId=${configId}`)
  const host = page.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminal.terminalId}"]`).getByTestId('terminal-host')
  await expect(host).toHaveAttribute('data-rendered-tail', /READY/)

  const marker = 'SD_LARGE_BURST_COMPLETE_030'
  await sendTerminalInput(page, configId, terminal.terminalId, 'x'.repeat(40_000) + marker + '\r')

  await expect(host).toHaveAttribute('data-rendered-tail', new RegExp(marker), { timeout: 20_000 })
  const work = await host.evaluate((element) => ({
    tailLength: element.dataset.renderedTail?.length ?? 0,
    revision: Number(element.dataset.renderedRevision ?? '-1'),
    writeCount: Number(element.dataset.terminalWriteCount ?? '0'),
    fitCount: Number(element.dataset.terminalFitCount ?? '0'),
  }))

  expect(work.tailLength).toBeLessThanOrEqual(8192)
  expect(work.revision).toBeGreaterThan(0)
  expect(work.writeCount).toBeLessThan(512)
  expect(work.fitCount).toBeLessThan(25)
})

test('real PTY 37 MB output stays responsive and reaches its final marker', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000)
  const configId = `terminal-real-large-replay-030-${testInfo.repeatEachIndex}`
  const created = await request.post(`/api/configs/${configId}/terminals?backend=real`)
  expect(created.ok()).toBe(true)
  const terminal = await created.json() as { terminalId: string }

  await page.goto(`/?configId=${configId}`)
  const host = page.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminal.terminalId}"]`).getByTestId('terminal-host')
  await expect(host).toHaveAttribute('data-rendered-tail', /@/, { timeout: 10_000 })

  const marker = 'SD_REAL_LARGE_BURST_COMPLETE_030'
  await host.click()
  await page.keyboard.type(`stty -opost; yes "$(head -c 2047 /dev/zero | tr '\\0' x)" | head -c ${REAL_PTY_BURST_BYTES}; printf 'SD_REAL_%s\\n' 'LARGE_BURST_COMPLETE_030'; stty opost`)
  await expect(host).toHaveAttribute('data-rendered-tail', /stty -opost/, { timeout: 10_000 })
  await expect(host).not.toHaveAttribute('data-rendered-tail', new RegExp(marker))
  await expect.poll(async () => host.evaluate((element) => (
    Number(element.dataset.terminalEnqueuedCodeUnits ?? '0')
      - Number(element.dataset.terminalParserConsumedCodeUnits ?? '0')
  ))).toBe(0)
  const baselineRevision = Number(await host.getAttribute('data-rendered-revision'))
  const baselineWriteCount = Number(await host.getAttribute('data-terminal-write-count'))
  const baselineEnqueuedCodeUnits = Number(await host.getAttribute('data-terminal-enqueued-code-units'))
  const baselineParserConsumedCodeUnits = Number(await host.getAttribute('data-terminal-parser-consumed-code-units'))
  await page.evaluate(() => {
    const state = {
      active: true,
      frames: 0,
      lastFrameAt: performance.now(),
      maxFrameGapMs: 0,
      maxLongTaskMs: 0,
      longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
    }
    const scope = window as typeof window & {
      __shellDeckHeartbeat030?: typeof state
      __shellDeckLongTaskObserver030?: PerformanceObserver
    }
    scope.__shellDeckHeartbeat030 = state
    if (state.longTaskSupported) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.maxLongTaskMs = Math.max(state.maxLongTaskMs, entry.duration)
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
      scope.__shellDeckLongTaskObserver030 = observer
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
  await page.keyboard.press('Enter')

  await expect.poll(async () => host.evaluate((element, expected) => {
    const enqueuedDelta = Number(element.dataset.terminalEnqueuedCodeUnits ?? '0') - expected.baselineEnqueued
    const consumedDelta = Number(element.dataset.terminalParserConsumedCodeUnits ?? '0') - expected.baselineConsumed
    const state = {
      markerParsed: (element.dataset.renderedTail ?? '').includes(expected.marker),
      enqueuedDelta,
      consumedDelta,
      backlog: enqueuedDelta - consumedDelta,
      revision: Number(element.dataset.renderedRevision ?? '0'),
      writeCount: Number(element.dataset.terminalWriteCount ?? '0'),
    }
    const ready = state.markerParsed
      && enqueuedDelta >= expected.minimumCodeUnits
      && consumedDelta >= expected.minimumCodeUnits
      && consumedDelta <= enqueuedDelta
    return ready ? 'ready' : JSON.stringify(state)
  }, {
    marker,
    baselineEnqueued: baselineEnqueuedCodeUnits,
    baselineConsumed: baselineParserConsumedCodeUnits,
    minimumCodeUnits: REAL_PTY_BURST_BYTES,
  }), {
    message: 'real PTY output must reach the browser and finish xterm parsing',
    timeout: 30_000,
  }).toBe('ready')
  const work = await host.evaluate((element) => ({
    tailLength: element.dataset.renderedTail?.length ?? 0,
    revision: Number(element.dataset.renderedRevision ?? '0'),
    writeCount: Number(element.dataset.terminalWriteCount ?? '0'),
    enqueuedCodeUnits: Number(element.dataset.terminalEnqueuedCodeUnits ?? '0'),
    parserConsumedCodeUnits: Number(element.dataset.terminalParserConsumedCodeUnits ?? '0'),
    fitCount: Number(element.dataset.terminalFitCount ?? '0'),
  }))
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const performanceState = await page.evaluate(() => {
    const scope = window as typeof window & {
      __shellDeckHeartbeat030?: {
        active: boolean
        frames: number
        maxFrameGapMs: number
        maxLongTaskMs: number
        longTaskSupported: boolean
      }
      __shellDeckLongTaskObserver030?: PerformanceObserver
    }
    const state = scope.__shellDeckHeartbeat030
    if (!state) return {
      heartbeatFrames: 0,
      maxFrameGapMs: Number.POSITIVE_INFINITY,
      maxLongTaskMs: Number.POSITIVE_INFINITY,
      longTaskSupported: false,
    }
    state.active = false
    const observer = scope.__shellDeckLongTaskObserver030
    if (observer) {
      for (const entry of observer.takeRecords()) {
        state.maxLongTaskMs = Math.max(state.maxLongTaskMs, entry.duration)
      }
      observer.disconnect()
    }
    return {
      heartbeatFrames: state.frames,
      maxFrameGapMs: state.maxFrameGapMs,
      maxLongTaskMs: state.maxLongTaskMs,
      longTaskSupported: state.longTaskSupported,
    }
  })

  expect(work.tailLength).toBeLessThanOrEqual(8192)
  expect(work.revision).toBeGreaterThan(baselineRevision)
  expect(work.writeCount).toBeLessThan(2048)
  expect(work.writeCount - baselineWriteCount).toBeGreaterThanOrEqual(Math.ceil(REAL_PTY_BURST_BYTES / DEFAULT_TERMINAL_PARSER_CHUNK_CODE_UNIT_LIMIT))
  expect(work.enqueuedCodeUnits - baselineEnqueuedCodeUnits).toBeGreaterThanOrEqual(REAL_PTY_BURST_BYTES)
  expect(work.parserConsumedCodeUnits - baselineParserConsumedCodeUnits).toBeGreaterThanOrEqual(REAL_PTY_BURST_BYTES)
  expect(work.parserConsumedCodeUnits).toBeLessThanOrEqual(work.enqueuedCodeUnits)
  expect(work.fitCount).toBeLessThan(25)
  expect(performanceState.heartbeatFrames).toBeGreaterThan(1)
  expect(performanceState.maxFrameGapMs).toBeLessThan(100)
  expect(performanceState.longTaskSupported).toBe(true)
  expect(performanceState.maxLongTaskMs).toBeLessThan(100)
})

test('reset replaces the launch generation and stale parser callbacks cannot restore old output', async ({ page, request }) => {
  const configId = 'terminal-reset-generation-030'
  const created = await request.post(`/api/configs/${configId}/terminals?backend=fake`)
  expect(created.ok()).toBe(true)
  const terminal = await created.json() as { terminalId: string; launchId: string }

  await page.goto(`/?configId=${configId}`)
  const host = page.locator(`[data-testid="terminal-pane"][data-terminal-id="${terminal.terminalId}"]`).getByTestId('terminal-host')
  await expect(host).toHaveAttribute('data-rendered-tail', /READY/)
  const baselineRevision = Number(await host.getAttribute('data-rendered-revision'))
  const oldMarker = 'SD_OLD_GENERATION_MUST_NOT_RETURN_030'

  await sendTerminalMessages(page, configId, [
    { type: 'terminal_input', terminalId: terminal.terminalId, data: 'o'.repeat(40_000) + oldMarker + '\r' },
    { type: 'reset_terminal', terminalId: terminal.terminalId, backend: 'fake' },
  ])

  await expect.poll(async () => {
    const snapshot = await request.get(`/api/configs/${configId}/snapshot`)
    const body = await snapshot.json() as { terminals: Array<{ terminalId: string; launchId: string }> }
    return body.terminals.find((item) => item.terminalId === terminal.terminalId)?.launchId
  }).not.toBe(terminal.launchId)
  await expect.poll(async () => Number(await host.getAttribute('data-rendered-revision'))).toBeGreaterThan(baselineRevision)
  await expect(host).toHaveAttribute('data-rendered-tail', /READY/)
  await page.waitForTimeout(250)
  await expect(host).not.toHaveAttribute('data-rendered-tail', new RegExp(oldMarker))
})

async function sendTerminalInput(page: Page, configId: string, terminalId: string, data: string) {
  await sendTerminalMessages(page, configId, [{ type: 'terminal_input', terminalId, data }])
}

async function sendTerminalMessages(page: Page, configId: string, messages: Array<Record<string, unknown>>) {
  await page.evaluate(async ({ configId, messages }) => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?configId=${encodeURIComponent(configId)}`)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('terminal_input_socket_error')), { once: true })
    })
    for (const message of messages) socket.send(JSON.stringify(message))
    ;(window as typeof window & { __shellDeckInputSocket?: WebSocket }).__shellDeckInputSocket = socket
  }, { configId, messages })
}
