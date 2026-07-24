import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { assertGeneratedId, assertRoomRouteToken } from '../generatedId'
import { assertManagedRegularFile, ensurePrivateDirectory, fsyncDirectory, initializeUserDataRoot, PRIVATE_FILE_MODE } from '../../../server/userDataRoot'
import { assertValidAgentEvent } from './agentEventSchema'
import type { AgentEvent, AgentEventMatch } from './agentEventTypes'

type AgentEventIndex = {
  events: AgentEvent[]
  eventIds: Set<string>
  byTerminalLaunch: Map<string, AgentEvent[]>
  byCaptureKey: Map<string, AgentEvent[]>
  version: number
  waiters: Set<() => void>
}

export class AgentEventStore {
  readonly evidenceRoot: string
  readonly #indexes = new Map<string, AgentEventIndex>()

  constructor(root?: string) {
    this.evidenceRoot = initializeUserDataRoot(root).agentEvents
  }

  append(event: AgentEvent): AgentEvent {
    const valid = assertValidAgentEvent(event)
    const path = this.eventsPath(valid.serverInstanceId, valid.roomId, valid.roomGeneration)
    const index = this.index(path)
    if (index.eventIds.has(valid.eventId)) throw new Error('duplicate_agent_event_id:' + valid.eventId)
    try { appendJsonLine(path, valid) }
    catch (error) {
      this.#indexes.delete(path)
      throw error
    }
    indexEvent(index, valid)
    index.version += 1
    for (const wake of [...index.waiters]) wake()
    return valid
  }

  list(serverInstanceId: string, roomId: string, roomGeneration: string): AgentEvent[] {
    const path = this.eventsPath(serverInstanceId, roomId, roomGeneration)
    return [...this.index(path).events]
  }

  matching(match: AgentEventMatch): AgentEvent[] {
    return [...this.matchingView(match)]
  }

  latestMatching(match: AgentEventMatch): AgentEvent | undefined {
    return this.matchingView(match).at(-1)
  }

  countMatching(match: AgentEventMatch): number {
    return this.matchingView(match).length
  }

  nextMatching(match: AgentEventMatch, afterCount = 0, consumedIds = new Set<string>()): AgentEvent | undefined {
    const events = this.matchingView(match)
    for (let index = afterCount; index < events.length; index += 1) {
      const event = events[index]
      if (!consumedIds.has(event.eventId)) return event
    }
    return undefined
  }

  version(match: Pick<AgentEventMatch, 'serverInstanceId' | 'roomId' | 'roomGeneration'>): number {
    return this.matchIndex(match).version
  }

  waitForChange(
    match: Pick<AgentEventMatch, 'serverInstanceId' | 'roomId' | 'roomGeneration'>,
    afterVersion: number,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    const index = this.matchIndex(match)
    if (index.version > afterVersion) return Promise.resolve(true)
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs))
      const wake = () => finish(true)
      const abort = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        index.waiters.delete(wake)
        reject(new Error('run_stopped'))
      }
      const finish = (changed: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        index.waiters.delete(wake)
        resolve(changed)
      }
      index.waiters.add(wake)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else if (index.version > afterVersion) wake()
    })
  }

  eventsPath(serverInstanceId: string, roomId: string, roomGeneration: string): string {
    const server = assertGeneratedId(serverInstanceId, 'serverInstance')
    const room = assertRoomRouteToken(roomId)
    const generation = assertGeneratedId(roomGeneration, 'roomGeneration')
    const dir = join(this.evidenceRoot, server, room)
    ensurePrivateDirectory(join(this.evidenceRoot, server))
    ensurePrivateDirectory(dir)
    return join(dir, generation + '.jsonl')
  }

  private matchIndex(
    match: Pick<AgentEventMatch, 'serverInstanceId' | 'roomId' | 'roomGeneration'>,
  ): AgentEventIndex {
    return this.index(this.eventsPath(match.serverInstanceId, match.roomId, match.roomGeneration))
  }

  private matchingView(match: AgentEventMatch): AgentEvent[] {
    const index = this.matchIndex(match)
    const exact = exactCaptureKey(match)
    if (exact) return index.byCaptureKey.get(exact) ?? []
    return (index.byTerminalLaunch.get(terminalLaunchKey(match.terminalId, match.launchId)) ?? [])
      .filter((event) => matchesAgentEvent(event, match))
  }

  private index(path: string): AgentEventIndex {
    const cached = this.#indexes.get(path)
    if (cached) return cached
    const index: AgentEventIndex = {
      events: [],
      eventIds: new Set(),
      byTerminalLaunch: new Map(),
      byCaptureKey: new Map(),
      version: 0,
      waiters: new Set(),
    }
    if (existsSync(path)) {
      for (const event of readEventsFromJsonl(path)) indexEvent(index, event)
      index.version = index.events.length
    }
    this.#indexes.set(path, index)
    return index
  }
}

function readEventsFromJsonl(path: string): AgentEvent[] {
  const events: AgentEvent[] = []
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue
    try { events.push(assertValidAgentEvent(JSON.parse(line))) }
    catch (error) { throw new Error(path + ':' + (index + 1) + ':' + (error instanceof Error ? error.message : String(error))) }
  }
  return events
}

function appendJsonLine(path: string, value: unknown): void {
  assertManagedRegularFile(path)
  const createdDirectoryEntry = !existsSync(path)
  let fd = openSync(path, 'a+', PRIVATE_FILE_MODE)
  const originalSize = fstatSync(fd).size
  try {
    fchmodSync(fd, PRIVATE_FILE_MODE)
    const buffer = Buffer.from(JSON.stringify(value) + '\n')
    let offset = 0
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
    fsyncSync(fd)
    closeSync(fd)
    fd = -1
    if (createdDirectoryEntry) fsyncDirectory(dirname(path))
  } catch (error) {
    rollbackAppend(path, fd, originalSize, createdDirectoryEntry)
    fd = -1
    throw error
  } finally {
    if (fd !== -1) {
      try { closeSync(fd) } catch {}
    }
  }
}

function indexEvent(index: AgentEventIndex, event: AgentEvent): void {
  if (index.eventIds.has(event.eventId)) throw new Error('duplicate_agent_event_id:' + event.eventId)
  index.events.push(event)
  index.eventIds.add(event.eventId)
  appendBucket(index.byTerminalLaunch, terminalLaunchKey(event.terminalId, event.launchId), event)
  appendBucket(index.byCaptureKey, captureKey(event), event)
}

function rollbackAppend(path: string, fd: number, originalSize: number, created: boolean): void {
  try {
    const target = fd === -1 ? openSync(path, 'r+') : fd
    ftruncateSync(target, originalSize)
    fsyncSync(target)
    closeSync(target)
  } catch {
    if (fd !== -1) {
      try { closeSync(fd) } catch {}
    }
  }
  if (!created) return
  try {
    unlinkSync(path)
    fsyncDirectory(dirname(path))
  } catch {}
}

function appendBucket(index: Map<string, AgentEvent[]>, key: string, event: AgentEvent): void {
  const bucket = index.get(key)
  if (bucket) bucket.push(event)
  else index.set(key, [event])
}

function terminalLaunchKey(terminalId: string, launchId: string): string {
  return `${terminalId}\0${launchId}`
}

function captureKey(event: AgentEvent): string {
  return [
    event.terminalId,
    event.launchId,
    event.agentKind,
    event.eventKind,
    event.adapterMetadata.adapter,
  ].join('\0')
}

function exactCaptureKey(match: AgentEventMatch): string | null {
  return match.agentKind && match.eventKind && match.adapter
    ? [match.terminalId, match.launchId, match.agentKind, match.eventKind, match.adapter].join('\0')
    : null
}

function matchesAgentEvent(event: AgentEvent, match: AgentEventMatch): boolean {
  return event.serverInstanceId === match.serverInstanceId
    && event.roomId === match.roomId
    && event.roomGeneration === match.roomGeneration
    && event.terminalId === match.terminalId
    && event.launchId === match.launchId
    && (!match.agentKind || event.agentKind === match.agentKind)
    && (!match.eventKind || event.eventKind === match.eventKind)
    && (!match.adapter || event.adapterMetadata.adapter === match.adapter)
}
