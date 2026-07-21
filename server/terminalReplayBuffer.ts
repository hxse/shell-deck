import type { TerminalBackendKind } from '../src/lib/protocol'

export const DEFAULT_REPLAY_BYTE_LIMIT = 2 * 1024 * 1024

const REPLAY_COMPACT_THRESHOLD = 1024

export type TerminalReplayState = {
  backendKind: TerminalBackendKind
  replay: string[]
  replayStart: number
  replayBytes: number
  replayDiscardedBytes: number
}

export function createTerminalReplayFields(): Pick<TerminalReplayState, 'replay' | 'replayStart' | 'replayBytes' | 'replayDiscardedBytes'> {
  return {
    replay: [],
    replayStart: 0,
    replayBytes: 0,
    replayDiscardedBytes: 0,
  }
}

export function appendTerminalReplay(terminal: TerminalReplayState, data: string, byteLimit: number): void {
  const dataBytes = Buffer.byteLength(data)
  if (terminal.backendKind === 'text') {
    terminal.replay.push(data)
    terminal.replayBytes += dataBytes
    return
  }
  if (dataBytes > byteLimit) {
    const tail = utf8Tail(data, byteLimit)
    terminal.replay = tail.length > 0 ? [tail] : []
    terminal.replayStart = 0
    terminal.replayBytes = Buffer.byteLength(tail)
    terminal.replayDiscardedBytes = 0
    return
  }
  terminal.replay.push(data)
  terminal.replayBytes += dataBytes
  while (terminal.replayBytes > byteLimit && terminal.replayStart < terminal.replay.length) {
    const discardedBytes = Buffer.byteLength(terminal.replay[terminal.replayStart])
    terminal.replayBytes -= discardedBytes
    terminal.replayDiscardedBytes += discardedBytes
    terminal.replayStart += 1
  }
  compactTerminalReplay(terminal, byteLimit)
}

export function replaceTerminalReplay(terminal: TerminalReplayState, content: string): void {
  terminal.replay = [content]
  terminal.replayStart = 0
  terminal.replayBytes = Buffer.byteLength(content)
  terminal.replayDiscardedBytes = 0
}

export function terminalReplayChunks(terminal: TerminalReplayState): string[] {
  return terminal.replay.slice(terminal.replayStart)
}

export function advanceTerminalOutputActivity(terminal: { outputActivityRevision: number }): void {
  terminal.outputActivityRevision += 1
}

function compactTerminalReplay(terminal: TerminalReplayState, byteLimit: number): void {
  if (terminal.replayStart === 0) return
  const bounded = terminal.replayDiscardedBytes < byteLimit
  const sparse = terminal.replayStart < REPLAY_COMPACT_THRESHOLD || terminal.replayStart * 2 < terminal.replay.length
  if (bounded && sparse) return
  terminal.replay = terminal.replay.slice(terminal.replayStart)
  terminal.replayStart = 0
  terminal.replayDiscardedBytes = 0
}

function utf8Tail(data: string, maxBytes: number): string {
  const encoded = Buffer.from(data)
  let start = Math.max(0, encoded.length - maxBytes)
  while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) start += 1
  return encoded.subarray(start).toString('utf8')
}
