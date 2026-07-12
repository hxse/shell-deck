import { expect, test } from 'bun:test'
import {
  TerminalParserWritePump,
  type TerminalParserWriteTarget,
} from '../../src/lib/terminalParserWritePump'
import type { TerminalRenderUpdate } from '../../src/lib/terminalViewState'

class ControlledTarget implements TerminalParserWriteTarget {
  readonly writes: string[] = []
  readonly callbacks: Array<() => void> = []

  write(data: string, callback: () => void): void {
    this.writes.push(data)
    this.callbacks.push(callback)
  }

  completeNext(): void {
    const callback = this.callbacks.shift()
    if (!callback) throw new Error('missing_parser_callback')
    callback()
  }
}

test('parser pump validates its chunk limit and requires a target', () => {
  expect(() => new TerminalParserWritePump({
    chunkCodeUnitLimit: 0,
    onUpdateParsed() {},
  })).toThrow('invalid_terminal_parser_chunk_code_unit_limit')
  expect(() => new TerminalParserWritePump({
    maxOutstandingChunks: 0,
    onUpdateParsed() {},
  })).toThrow('invalid_terminal_parser_max_outstanding_chunks')

  const pump = new TerminalParserWritePump({ onUpdateParsed() {} })
  expect(pump.maxOutstandingChunks).toBe(4)
  expect(() => pump.enqueue(update(1, 'orphan'))).toThrow('terminal_parser_target_missing')
})

test('parser pump keeps one write outstanding and never splits a surrogate pair', () => {
  const target = new ControlledTarget()
  const parsed: number[] = []
  const pump = new TerminalParserWritePump({
    chunkCodeUnitLimit: 4,
    maxOutstandingChunks: 1,
    onUpdateParsed: (item) => parsed.push(item.revision),
  })
  const data = 'abc😀defgh'

  pump.setTarget(target)
  pump.enqueue(update(1, data))
  expect(target.writes).toEqual(['abc'])
  expect(target.callbacks).toHaveLength(1)

  while (target.callbacks.length > 0) target.completeNext()

  expect(target.writes.join('')).toBe(data)
  expect(parsed).toEqual([1])
  for (const chunk of target.writes) {
    expect(isLowSurrogate(chunk.charCodeAt(0))).toBe(false)
    expect(isHighSurrogate(chunk.charCodeAt(chunk.length - 1))).toBe(false)
  }
})

test('parser pump drains complete logical updates in exact order', () => {
  const target = new ControlledTarget()
  const parsed: number[] = []
  const parsedChunks: string[] = []
  const pump = new TerminalParserWritePump({
    chunkCodeUnitLimit: 3,
    maxOutstandingChunks: 1,
    onChunkParsed: (data) => parsedChunks.push(data),
    onUpdateParsed: (item) => parsed.push(item.revision),
  })

  pump.setTarget(target)
  pump.enqueue(update(1, 'abcdef'))
  pump.enqueue(update(2, 'XYZ'))
  expect(target.writes).toEqual(['abc'])

  target.completeNext()
  expect(target.writes).toEqual(['abc', 'def'])
  expect(parsed).toEqual([])

  target.completeNext()
  expect(target.writes).toEqual(['abc', 'def', 'XYZ'])
  expect(parsed).toEqual([1])

  target.completeNext()
  expect(parsed).toEqual([1, 2])
  expect(parsedChunks).toEqual(['abc', 'def', 'XYZ'])
})

test('parser pump invalidates queued callbacks when the target generation changes', () => {
  const oldTarget = new ControlledTarget()
  const nextTarget = new ControlledTarget()
  const parsed: number[] = []
  const parsedChunks: string[] = []
  const pump = new TerminalParserWritePump({
    chunkCodeUnitLimit: 3,
    maxOutstandingChunks: 1,
    onChunkParsed: (data) => parsedChunks.push(data),
    onUpdateParsed: (item) => parsed.push(item.revision),
  })

  pump.setTarget(oldTarget)
  pump.enqueue(update(1, 'old-data'))
  pump.setTarget(nextTarget)
  pump.enqueue(update(2, 'new'))

  oldTarget.completeNext()
  expect(parsed).toEqual([])
  expect(parsedChunks).toEqual([])
  expect(nextTarget.writes).toEqual(['new'])

  nextTarget.completeNext()
  expect(parsed).toEqual([2])
  expect(parsedChunks).toEqual(['new'])
})

test('parser pump fills a bounded write window without crossing logical updates', () => {
  const target = new ControlledTarget()
  const parsed: number[] = []
  const pump = new TerminalParserWritePump({
    chunkCodeUnitLimit: 3,
    maxOutstandingChunks: 2,
    onUpdateParsed: (item) => parsed.push(item.revision),
  })

  pump.setTarget(target)
  pump.enqueue(update(1, 'abcdefghi'))
  pump.enqueue(update(2, 'XYZ123'))
  expect(target.writes).toEqual(['abc', 'def'])
  expect(target.callbacks).toHaveLength(2)

  target.completeNext()
  expect(target.writes).toEqual(['abc', 'def', 'ghi'])
  expect(target.callbacks).toHaveLength(2)
  expect(parsed).toEqual([])

  target.completeNext()
  expect(target.writes).toEqual(['abc', 'def', 'ghi'])
  expect(parsed).toEqual([])

  target.completeNext()
  expect(parsed).toEqual([1])
  expect(target.writes).toEqual(['abc', 'def', 'ghi', 'XYZ', '123'])
  expect(target.callbacks).toHaveLength(2)

  target.completeNext()
  expect(parsed).toEqual([1])
  target.completeNext()
  expect(parsed).toEqual([1, 2])
})

test('parser pump supports synchronous write callbacks without recursive pumping', () => {
  const writes: string[] = []
  const parsed: number[] = []
  const pump = new TerminalParserWritePump({
    chunkCodeUnitLimit: 1,
    onUpdateParsed: (item) => parsed.push(item.revision),
  })

  pump.setTarget({
    write(data, callback) {
      writes.push(data)
      callback()
    },
  })
  pump.enqueue(update(1, 'x'.repeat(10_000)))

  expect(writes).toHaveLength(10_000)
  expect(parsed).toEqual([1])
})

test('parser pump rolls back a synchronously rejected chunk and retries it in order', () => {
  const writes: string[] = []
  const callbacks: Array<() => void> = []
  const parsed: number[] = []
  let rejectNext = true
  const pump = new TerminalParserWritePump({
    chunkCodeUnitLimit: 3,
    maxOutstandingChunks: 2,
    onUpdateParsed: (item) => parsed.push(item.revision),
  })

  pump.setTarget({
    write(data, callback) {
      if (rejectNext) {
        rejectNext = false
        throw new Error('parser_write_rejected')
      }
      writes.push(data)
      callbacks.push(callback)
    },
  })

  expect(() => pump.enqueue(update(1, 'abcdef'))).toThrow('parser_write_rejected')
  pump.enqueue(update(2, 'XYZ'))
  expect(writes).toEqual(['abc', 'def'])

  while (callbacks.length > 0) callbacks.shift()!()
  expect(writes).toEqual(['abc', 'def', 'XYZ'])
  expect(parsed).toEqual([1, 2])
})

test('parser pump completes an empty update without issuing a write', () => {
  const target = new ControlledTarget()
  const parsed: number[] = []
  const pump = new TerminalParserWritePump({
    onUpdateParsed: (item) => parsed.push(item.revision),
  })

  pump.setTarget(target)
  pump.enqueue(update(1, ''))

  expect(target.writes).toEqual([])
  expect(parsed).toEqual([1])
})

function update(revision: number, data: string): TerminalRenderUpdate {
  return { revision, kind: 'append', data }
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff
}
