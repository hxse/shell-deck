import type { TerminalRenderUpdate } from './terminalViewState'

export const DEFAULT_TERMINAL_PARSER_CHUNK_CODE_UNIT_LIMIT = 32 * 1024
export const DEFAULT_TERMINAL_PARSER_MAX_OUTSTANDING_CHUNKS = 4

export type TerminalParserWriteTarget = {
  write(data: string, callback: () => void): void
}

export type TerminalParserWritePumpOptions = {
  chunkCodeUnitLimit?: number
  maxOutstandingChunks?: number
  onChunkWrite?(data: string, update: TerminalRenderUpdate, target: TerminalParserWriteTarget): void
  onChunkParsed?(data: string, update: TerminalRenderUpdate, target: TerminalParserWriteTarget): void
  onUpdateParsed(update: TerminalRenderUpdate, target: TerminalParserWriteTarget): void
}

type PendingParserUpdate = {
  update: TerminalRenderUpdate
  offset: number
  outstandingChunks: number
}

export class TerminalParserWritePump {
  readonly chunkCodeUnitLimit: number
  readonly maxOutstandingChunks: number
  readonly #onChunkWrite: TerminalParserWritePumpOptions['onChunkWrite']
  readonly #onChunkParsed: TerminalParserWritePumpOptions['onChunkParsed']
  readonly #onUpdateParsed: TerminalParserWritePumpOptions['onUpdateParsed']
  #target: TerminalParserWriteTarget | null = null
  #generation = 0
  #queue: PendingParserUpdate[] = []
  #outstandingChunks = 0
  #pumping = false

  constructor(options: TerminalParserWritePumpOptions) {
    const chunkCodeUnitLimit = options.chunkCodeUnitLimit ?? DEFAULT_TERMINAL_PARSER_CHUNK_CODE_UNIT_LIMIT
    if (!Number.isInteger(chunkCodeUnitLimit) || chunkCodeUnitLimit <= 0) {
      throw new Error('invalid_terminal_parser_chunk_code_unit_limit')
    }
    const maxOutstandingChunks = options.maxOutstandingChunks ?? DEFAULT_TERMINAL_PARSER_MAX_OUTSTANDING_CHUNKS
    if (!Number.isInteger(maxOutstandingChunks) || maxOutstandingChunks <= 0) {
      throw new Error('invalid_terminal_parser_max_outstanding_chunks')
    }
    this.chunkCodeUnitLimit = chunkCodeUnitLimit
    this.maxOutstandingChunks = maxOutstandingChunks
    this.#onChunkWrite = options.onChunkWrite
    this.#onChunkParsed = options.onChunkParsed
    this.#onUpdateParsed = options.onUpdateParsed
  }

  setTarget(target: TerminalParserWriteTarget | null): void {
    this.#generation += 1
    this.#target = target
    this.#queue = []
    this.#outstandingChunks = 0
    this.#pumping = false
  }

  enqueue(update: TerminalRenderUpdate): void {
    if (!this.#target) throw new Error('terminal_parser_target_missing')
    this.#queue.push({ update, offset: 0, outstandingChunks: 0 })
    this.pump()
  }

  private pump(): void {
    const target = this.#target
    const generation = this.#generation
    if (!target || this.#pumping) return
    this.#pumping = true
    try {
      while (generation === this.#generation && target === this.#target) {
        const pending = this.#queue[0]
        if (!pending) return
        if (pending.offset >= pending.update.data.length) {
          if (pending.outstandingChunks > 0) return
          this.#queue.shift()
          this.#onUpdateParsed(pending.update, target)
          continue
        }
        if (this.#outstandingChunks >= this.maxOutstandingChunks) return

        const previousOffset = pending.offset
        const end = nextChunkEnd(pending.update.data, previousOffset, this.chunkCodeUnitLimit)
        const chunk = pending.update.data.slice(previousOffset, end)
        let callbackCompleted = false
        pending.offset = end
        pending.outstandingChunks += 1
        this.#outstandingChunks += 1

        try {
          this.#onChunkWrite?.(chunk, pending.update, target)
          target.write(chunk, () => {
            if (generation !== this.#generation || target !== this.#target) return
            callbackCompleted = true
            if (pending.outstandingChunks <= 0 || this.#outstandingChunks <= 0) {
              throw new Error('terminal_parser_outstanding_corrupt')
            }
            pending.outstandingChunks -= 1
            this.#outstandingChunks -= 1
            this.#onChunkParsed?.(chunk, pending.update, target)
            if (generation !== this.#generation || target !== this.#target) return
            if (pending.offset >= pending.update.data.length && pending.outstandingChunks === 0) {
              if (this.#queue[0] !== pending) throw new Error('terminal_parser_queue_corrupt')
              this.#queue.shift()
              this.#onUpdateParsed(pending.update, target)
            }
            this.pump()
          })
        } catch (error) {
          if (!callbackCompleted && generation === this.#generation && target === this.#target) {
            pending.offset = previousOffset
            pending.outstandingChunks -= 1
            this.#outstandingChunks -= 1
          }
          throw error
        }
      }
    } finally {
      if (generation === this.#generation && target === this.#target) {
        this.#pumping = false
      }
    }
  }
}

function nextChunkEnd(data: string, offset: number, limit: number): number {
  let end = Math.min(data.length, offset + limit)
  if (end >= data.length || end <= offset) return end

  const previous = data.charCodeAt(end - 1)
  const next = data.charCodeAt(end)
  if (isHighSurrogate(previous) && isLowSurrogate(next)) {
    end -= 1
    if (end === offset) end = Math.min(data.length, offset + 2)
  }
  return end
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff
}
