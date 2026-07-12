import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { RealPtyBackend } from '../../server/realPtyBackend'
import type { PtyOutputBatchScheduler } from '../../server/ptyOutputBatcher'

class HoldingScheduler implements PtyOutputBatchScheduler {
  readonly delays: number[] = []
  readonly scheduled: Promise<void>
  #resolveScheduled!: () => void
  #handle = 0

  constructor() {
    this.scheduled = new Promise((resolve) => { this.#resolveScheduled = resolve })
  }

  schedule(_callback: () => void, delayMs: number): unknown {
    this.delays.push(delayMs)
    this.#handle += 1
    this.#resolveScheduled()
    return this.#handle
  }

  cancel(_handle: unknown): void {}
}

test('real PTY resize flushes pending output before manager can publish terminal state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-pty-resize-'))
  const executable = join(root, 'pending-before-resize')
  writeFileSync(executable, [
    '#!/bin/sh',
    "printf '__PENDING_BEFORE_RESIZE__'",
    'sleep 5',
    '',
  ].join('\n'), { mode: 0o755 })

  const scheduler = new HoldingScheduler()
  const backend = new RealPtyBackend(
    { cols: 80, rows: 24, shell: executable },
    { outputBatchScheduler: scheduler },
  )
  const output: string[] = []
  const order: string[] = []
  let resolveExit!: () => void
  const exited = new Promise<void>((resolve) => { resolveExit = resolve })

  try {
    backend.start({
      onData(data) {
        output.push(data)
        order.push('output')
      },
      onError(error) {
        throw error
      },
      onExit() {
        resolveExit()
      },
    })

    await Promise.race([
      scheduler.scheduled,
      Bun.sleep(5000).then(() => { throw new Error('real_pty_resize_schedule_timeout') }),
    ])
    expect(order).toEqual([])

    backend.resize(100, 30)
    order.push('state')

    expect(scheduler.delays).toEqual([4])
    expect(output.join('')).toContain('__PENDING_BEFORE_RESIZE__')
    expect(order).toEqual(['output', 'state'])
  } finally {
    backend.close()
    await Promise.race([exited, Bun.sleep(1000)])
    rmSync(root, { recursive: true, force: true })
  }
})
