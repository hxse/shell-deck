import { expect, test } from 'bun:test'
import {
  DEFAULT_PTY_OUTPUT_BATCH_BYTES,
  DEFAULT_PTY_OUTPUT_BATCH_DELAY_MS,
  PtyOutputBatcher,
  type PtyOutputBatchScheduler,
} from '../../server/ptyOutputBatcher'

class ManualScheduler implements PtyOutputBatchScheduler {
  readonly delays: number[] = []
  readonly tasks = new Map<number, () => void>()
  #nextId = 1

  schedule(callback: () => void, delayMs: number): unknown {
    const id = this.#nextId++
    this.delays.push(delayMs)
    this.tasks.set(id, callback)
    return id
  }

  cancel(handle: unknown): void {
    this.tasks.delete(Number(handle))
  }

  runAll(): void {
    while (this.tasks.size > 0) {
      const [id, callback] = this.tasks.entries().next().value as [number, () => void]
      this.tasks.delete(id)
      callback()
    }
  }
}

test('PTY output batcher coalesces 20,000 tiny chunks by byte threshold and timer', () => {
  const scheduler = new ManualScheduler()
  const batches: string[] = []
  const batcher = new PtyOutputBatcher({ scheduler, onBatch: (data) => batches.push(data) })
  const chunk = 'tiny'.repeat(4)

  for (let index = 0; index < 20_000; index += 1) batcher.push(chunk)

  expect(DEFAULT_PTY_OUTPUT_BATCH_BYTES).toBe(256 * 1024)
  expect(DEFAULT_PTY_OUTPUT_BATCH_DELAY_MS).toBe(4)
  expect(batches).toHaveLength(1)
  expect(Buffer.byteLength(batches[0])).toBe(DEFAULT_PTY_OUTPUT_BATCH_BYTES)
  expect(scheduler.tasks.size).toBe(1)
  expect(scheduler.delays.every((delay) => delay === DEFAULT_PTY_OUTPUT_BATCH_DELAY_MS)).toBe(true)

  scheduler.runAll()

  expect(batches).toHaveLength(2)
  expect(batches.join('')).toBe(chunk.repeat(20_000))
})

test('PTY output batcher preserves split control sequences and Unicode across manual flush', () => {
  const scheduler = new ManualScheduler()
  const batches: string[] = []
  const batcher = new PtyOutputBatcher({ scheduler, onBatch: (data) => batches.push(data) })
  const chunks = ['\u001b[38;5;', '196m', '界😀', '\u001b]0;title', '\u0007', 'tail']

  for (const chunk of chunks) batcher.push(chunk)
  batcher.flush()
  batcher.flush()
  scheduler.runAll()

  expect(batches).toEqual([chunks.join('')])
  expect(scheduler.tasks.size).toBe(0)
})

test('PTY output batch threshold flushes a whole incoming Unicode chunk', () => {
  const scheduler = new ManualScheduler()
  const batches: string[] = []
  const batcher = new PtyOutputBatcher({ batchBytes: 4, scheduler, onBatch: (data) => batches.push(data) })

  batcher.push('界界')

  expect(Buffer.byteLength('界界')).toBe(6)
  expect(batches).toEqual(['界界'])
  expect(scheduler.tasks.size).toBe(0)
})
