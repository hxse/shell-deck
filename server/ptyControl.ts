export type PtyControlMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'close' }

export const HELPER_INPUT_CHANNEL = 'helper-stdin-pipe' as const

export function chunkInput(data: string, maxChunkBytes = 4096): string[] {
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes < 1) {
    throw new Error('invalid_chunk_size')
  }
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const char of data) {
    const bytes = Buffer.byteLength(char)
    if (current.length > 0 && currentBytes + bytes > maxChunkBytes) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += char
    currentBytes += bytes
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

export function encodeControlFrame(message: PtyControlMessage): Buffer {
  const payload = framePayload(message)
  const frame = Buffer.alloc(5 + payload.length)
  frame.writeUInt8(frameType(message), 0)
  frame.writeUInt32BE(payload.length, 1)
  payload.copy(frame, 5)
  return frame
}

function frameType(message: PtyControlMessage): number {
  if (message.type === 'input') return 'i'.charCodeAt(0)
  if (message.type === 'resize') return 'r'.charCodeAt(0)
  return 'c'.charCodeAt(0)
}

function framePayload(message: PtyControlMessage): Buffer {
  if (message.type === 'input') return Buffer.from(message.data)
  if (message.type === 'resize') return Buffer.from(String(message.cols) + ' ' + String(message.rows))
  return Buffer.alloc(0)
}

export function encodeControlMessage(message: PtyControlMessage): string {
  return JSON.stringify(message) + '\n'
}

export function parseControlMessage(line: string): PtyControlMessage {
  const value = JSON.parse(line) as PtyControlMessage
  if (value.type === 'input' && typeof value.data === 'string') {
    return value
  }
  if (value.type === 'resize' && Number.isInteger(value.cols) && Number.isInteger(value.rows)) {
    return value
  }
  if (value.type === 'close') {
    return value
  }
  throw new Error('invalid_control_message')
}
