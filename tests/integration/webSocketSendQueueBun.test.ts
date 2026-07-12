import { expect, test } from 'bun:test'
import { WebSocketSendQueue } from '../../server/webSocketSendQueue'

const REAL_SESSION_BYTES = 37_174_834
const FRAME_BYTES = 256 * 1024

test('real Bun websocket re-arms backpressure drains until a 37 MB burst is delivered exactly once', async () => {
  const payloads = makePayloads(REAL_SESSION_BYTES, FRAME_BYTES)
  const queueRef: { current: WebSocketSendQueue | null } = { current: null }
  let backpressureCount = 0
  let drainNotificationCount = 0
  const fatal: string[] = []

  const server = Bun.serve<{ sender: WebSocketSendQueue | null }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, bunServer) {
      const upgraded = bunServer.upgrade(request, { data: { sender: null } })
      return upgraded ? undefined : new Response('upgrade failed', { status: 400 })
    },
    websocket: {
      open(ws) {
        const sender = new WebSocketSendQueue({
          target: {
            send(data) {
              const result = ws.send(data)
              if (result < 0) backpressureCount += 1
              return result
            },
          },
          onFatal: (reason) => fatal.push(reason),
        })
        ws.data.sender = sender
        queueRef.current = sender
        for (const payload of payloads) sender.send(payload)
      },
      message() {},
      drain(ws) {
        drainNotificationCount += 1
        ws.data.sender?.notifyDrain()
      },
      close(ws) {
        ws.data.sender?.dispose()
      },
    },
  })

  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
  try {
    const receivedBytes = await receiveExactPayloads(socket, payloads)
    expect(receivedBytes).toBe(REAL_SESSION_BYTES)
    expect(backpressureCount).toBeGreaterThan(1)
    expect(drainNotificationCount).toBeGreaterThan(1)
    expect(queueRef.current?.pendingCount).toBe(0)
    expect(fatal).toEqual([])
  } finally {
    socket.close()
    await server.stop(true)
  }
}, 10_000)

function makePayloads(totalBytes: number, frameBytes: number): string[] {
  const payloads: string[] = []
  let remaining = totalBytes
  let index = 0
  while (remaining > 0) {
    const size = Math.min(frameBytes, remaining)
    const prefix = `${String(index).padStart(6, '0')}:`
    payloads.push(prefix + 'x'.repeat(size - prefix.length))
    remaining -= size
    index += 1
  }
  return payloads
}

function receiveExactPayloads(socket: WebSocket, expected: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    let index = 0
    let receivedBytes = 0
    const timeout = setTimeout(() => reject(new Error(`websocket_burst_timeout:${index}/${expected.length}`)), 8_000)

    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('websocket_burst_client_error'))
    }, { once: true })
    socket.addEventListener('message', (event) => {
      try {
        const data = String(event.data)
        expect(data).toBe(expected[index])
        receivedBytes += Buffer.byteLength(data)
        index += 1
        if (index !== expected.length) return
        clearTimeout(timeout)
        resolve(receivedBytes)
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
      }
    })
  })
}
