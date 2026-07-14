import { expect, test } from 'bun:test'
import {
  WebSocketSendQueue,
  type WebSocketSendTarget,
} from '../../server/webSocketSendQueue'

class ScriptedSendTarget implements WebSocketSendTarget {
  readonly sent: string[] = []
  readonly results: Array<number | Error>

  constructor(results: Array<number | Error>) {
    this.results = [...results]
  }

  send(data: string): number {
    this.sent.push(data)
    const result = this.results.shift()
    if (result instanceof Error) throw result
    return result ?? Buffer.byteLength(data)
  }
}

class ManualDrainScheduler {
  readonly callbacks: Array<() => void> = []

  schedule(callback: () => void): void {
    this.callbacks.push(callback)
  }

  flushNext(): void {
    const callback = this.callbacks.shift()
    if (!callback) throw new Error('missing_drain_callback')
    callback()
  }
}

test('websocket send queue validates its byte limit', () => {
  const target = new ScriptedSendTarget([])
  expect(() => new WebSocketSendQueue({
    target,
    maxPendingBytes: 0,
    onFatal() {},
  })).toThrow('invalid_websocket_send_queue_byte_limit')
})

test('websocket send queue holds later messages after Bun accepts a backpressured frame', () => {
  const target = new ScriptedSendTarget([-1, 1, 1])
  const scheduler = new ManualDrainScheduler()
  const fatal: string[] = []
  const queue = new WebSocketSendQueue({
    target,
    scheduleDrain: (callback) => scheduler.schedule(callback),
    onFatal: (reason) => fatal.push(reason),
  })

  queue.send('first')
  queue.send('second')
  queue.send('third')

  expect(target.sent).toEqual(['first'])
  expect(queue.blocked).toBe(true)
  expect(queue.pendingCount).toBe(2)
  expect(queue.pendingBytes).toBe(Buffer.byteLength('secondthird'))

  queue.notifyDrain()
  expect(target.sent).toEqual(['first'])
  expect(queue.drainScheduled).toBe(true)
  scheduler.flushNext()

  expect(target.sent).toEqual(['first', 'second', 'third'])
  expect(queue.blocked).toBe(false)
  expect(queue.pendingCount).toBe(0)
  expect(queue.pendingBytes).toBe(0)
  expect(fatal).toEqual([])
})

test('a frame accepted with backpressure is removed once and never resent', () => {
  const target = new ScriptedSendTarget([-1, -1, 1])
  const scheduler = new ManualDrainScheduler()
  const queue = new WebSocketSendQueue({
    target,
    scheduleDrain: (callback) => scheduler.schedule(callback),
    onFatal() {},
  })

  queue.send('first')
  queue.send('second')
  queue.send('third')
  queue.notifyDrain()
  scheduler.flushNext()

  expect(target.sent).toEqual(['first', 'second'])
  expect(queue.pendingCount).toBe(1)
  expect(queue.blocked).toBe(true)

  queue.notifyDrain()
  scheduler.flushNext()

  expect(target.sent).toEqual(['first', 'second', 'third'])
  expect(queue.pendingCount).toBe(0)
  expect(queue.blocked).toBe(false)
})

test('duplicate drain notifications coalesce and a disposed queue ignores scheduled work', () => {
  const target = new ScriptedSendTarget([-1, 1])
  const scheduler = new ManualDrainScheduler()
  const queue = new WebSocketSendQueue({
    target,
    scheduleDrain: (callback) => scheduler.schedule(callback),
    onFatal() {},
  })

  queue.send('first')
  queue.send('second')
  queue.notifyDrain()
  queue.notifyDrain()

  expect(scheduler.callbacks).toHaveLength(1)
  queue.dispose()
  scheduler.flushNext()
  expect(target.sent).toEqual(['first'])
})

test('dropped or failed sends close the queue instead of silently losing order', () => {
  for (const scripted of [0, new Error('send_failed')]) {
    const target = new ScriptedSendTarget([scripted])
    const fatal: string[] = []
    const queue = new WebSocketSendQueue({ target, onFatal: (reason) => fatal.push(reason) })

    queue.send('first')
    queue.send('ignored-after-fatal')

    expect(queue.disposed).toBe(true)
    expect(queue.pendingCount).toBe(0)
    expect(target.sent).toEqual(['first'])
    expect(fatal).toEqual([scripted === 0 ? 'websocket_send_dropped' : 'websocket_send_failed'])
  }
})

test('pending queue overflow is byte-bounded and fails the client loudly', () => {
  const target = new ScriptedSendTarget([-1])
  const fatal: string[] = []
  const queue = new WebSocketSendQueue({
    target,
    maxPendingBytes: 5,
    onFatal: (reason) => fatal.push(reason),
  })

  queue.send('blocked')
  queue.send('界')
  expect(queue.pendingBytes).toBe(3)

  queue.send('界')

  expect(queue.disposed).toBe(true)
  expect(queue.pendingBytes).toBe(0)
  expect(fatal).toEqual(['websocket_send_queue_overflow'])
})
