import { expect, test } from 'bun:test'
import { chunkInput, encodeControlFrame, encodeControlMessage, HELPER_INPUT_CHANNEL, parseControlMessage } from '../../server/ptyControl'

test('input channel is helper stdin pipe, not command file polling', () => {
  expect(HELPER_INPUT_CHANNEL).toBe('helper-stdin-pipe')
})

test('long input is chunked without dropping data', () => {
  const paste = 'x'.repeat(9000)
  const chunks = chunkInput(paste, 1024)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.join('')).toBe(paste)
  expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 1024)).toBe(true)
})

test('control frames encode helper channel type and payload length', () => {
  const frame = encodeControlFrame({ type: 'resize', cols: 100, rows: 30 })
  expect(frame.readUInt8(0)).toBe('r'.charCodeAt(0))
  expect(frame.readUInt32BE(1)).toBe(Buffer.byteLength('100 30'))
  expect(frame.subarray(5).toString()).toBe('100 30')
})

test('control messages parse as structured stdin frames', () => {
  const frame = encodeControlMessage({ type: 'resize', cols: 100, rows: 30 })
  expect(parseControlMessage(frame)).toEqual({ type: 'resize', cols: 100, rows: 30 })
})
