import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  readdirSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { assertGeneratedId } from '../src/lib/generatedId'
import { assertEvidenceEvent, type EvidenceEvent } from './evidenceRecordValidation'
import {
  assertManagedRegularFile,
  ensurePrivateDirectory,
  fsyncDirectory,
  PRIVATE_FILE_MODE,
  publishPrivateFileDelete,
  type PublishedFileMutationReceipt,
} from './userDataRoot'

export const RUN_EVENT_RETENTION_LIMIT = 1_000
export const RUN_EVENT_SEGMENT_SIZE = 100

export type EvidenceAppendReceipt =
  | { published: true; durability: 'confirmed' }
  | { published: true; durability: 'uncertain'; postPublishError: unknown }

export function retainedFirstEventSeq(lastEventSeq: number): number {
  if (lastEventSeq <= RUN_EVENT_RETENTION_LIMIT) return 1
  return segmentStart(lastEventSeq - RUN_EVENT_RETENTION_LIMIT) + RUN_EVENT_SEGMENT_SIZE
}

export function shouldPruneEvidenceAt(eventSeq: number): boolean {
  return eventSeq > RUN_EVENT_RETENTION_LIMIT && (eventSeq - 1) % RUN_EVENT_SEGMENT_SIZE === 0
}

export class EvidenceSegmentStorage {
  constructor(
    private readonly runsRoot: string,
    private readonly deleteSegmentFile: (path: string) => PublishedFileMutationReceipt = publishPrivateFileDelete,
  ) {}

  ensureEventsDirectory(runId: string): void {
    ensurePrivateDirectory(this.eventsDirectory(runId))
  }

  append(runId: string, event: EvidenceEvent, afterPublish: () => void): EvidenceAppendReceipt {
    return appendPrivateJsonLine(this.segmentPath(runId, segmentStart(event.eventSeq)), event, afterPublish)
  }

  eventAtSequence(runId: string, eventSeq: number): EvidenceEvent | undefined {
    const start = segmentStart(eventSeq)
    const path = this.segmentPath(runId, start)
    if (!existsSync(path)) return undefined
    return this.readSegment(runId, start).find((event) => event.eventSeq === eventSeq)
  }

  read(runId: string): EvidenceEvent[] {
    if (!existsSync(this.eventsDirectory(runId))) return []
    const events = this.segmentStarts(runId).flatMap((start) => this.readSegment(runId, start))
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].eventSeq !== events[index - 1].eventSeq + 1) throw new Error('invalid_evidence_event_sequence')
    }
    return events
  }

  readSegment(runId: string, start: number): EvidenceEvent[] {
    const path = this.segmentPath(runId, start)
    recoverPartialFinalLine(path)
    if (!existsSync(path)) return []
    const events: EvidenceEvent[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const event = assertEvidenceEvent(JSON.parse(line))
      if (event.runId !== runId || segmentStart(event.eventSeq) !== start) throw new Error('invalid_evidence_event_sequence')
      if (events.length && event.eventSeq !== events.at(-1)!.eventSeq + 1) throw new Error('invalid_evidence_event_sequence')
      events.push(event)
    }
    return events
  }

  pruneSegments(runId: string, lastEventSeq: number): void {
    for (const start of this.segmentStarts(runId)) {
      if (lastEventSeq - start + 1 <= RUN_EVENT_RETENTION_LIMIT) break
      const path = this.segmentPath(runId, start)
      const receipt = this.deleteSegmentFile(path)
      if (receipt.durability === 'uncertain' && existsSync(path)) throw new Error('evidence_segment_prune_state_unknown')
    }
  }

  segmentStarts(runId: string): number[] {
    const directory = this.eventsDirectory(runId)
    if (!existsSync(directory)) return []
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{12}\.jsonl$/.test(entry.name))
      .map((entry) => Number(entry.name.slice(0, 12)))
      .sort((left, right) => left - right)
  }

  private runDirectory(runId: string): string {
    return join(this.runsRoot, assertGeneratedId(runId, 'run'))
  }

  private eventsDirectory(runId: string): string {
    return join(this.runDirectory(runId), 'events')
  }

  private segmentPath(runId: string, start: number): string {
    return join(this.eventsDirectory(runId), String(start).padStart(12, '0') + '.jsonl')
  }
}

function appendPrivateJsonLine(path: string, value: unknown, afterPublish: () => void): EvidenceAppendReceipt {
  ensurePrivateDirectory(dirname(path))
  recoverPartialFinalLine(path)
  assertManagedRegularFile(path)
  const createdDirectoryEntry = !existsSync(path)
  const fd = openSync(path, 'a+', PRIVATE_FILE_MODE)
  const originalSize = fstatSync(fd).size
  const buffer = Buffer.from(JSON.stringify(value) + '\n')
  let completeLine = false
  let postPublishError: unknown
  try {
    fchmodSync(fd, PRIVATE_FILE_MODE)
    let offset = 0
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
    completeLine = true
    try { fsyncSync(fd) } catch (error) { postPublishError = error }
  } catch (error) {
    if (!completeLine) {
      try { ftruncateSync(fd, originalSize); fsyncSync(fd) } catch {}
      throw error
    }
    postPublishError = error
  } finally {
    try { closeSync(fd) } catch (error) { if (completeLine && postPublishError === undefined) postPublishError = error }
  }
  if (postPublishError === undefined) {
    try {
      afterPublish()
      // Appending bytes only requires the file fsync above. The directory fsync is
      // required when this append created a new segment entry.
      if (createdDirectoryEntry) fsyncDirectory(dirname(path))
    } catch (error) { postPublishError = error }
  }
  return postPublishError === undefined
    ? { published: true, durability: 'confirmed' }
    : { published: true, durability: 'uncertain', postPublishError }
}

function recoverPartialFinalLine(path: string): void {
  if (!existsSync(path)) return
  const bytes = readFileSync(path)
  if (bytes.length === 0 || bytes.at(-1) === 0x0a) return
  const lastNewline = bytes.lastIndexOf(0x0a)
  const fd = openSync(path, 'r+')
  try {
    ftruncateSync(fd, lastNewline + 1)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

function segmentStart(eventSeq: number): number {
  return Math.floor((eventSeq - 1) / RUN_EVENT_SEGMENT_SIZE) * RUN_EVENT_SEGMENT_SIZE + 1
}
