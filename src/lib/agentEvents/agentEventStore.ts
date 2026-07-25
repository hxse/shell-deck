import { initializeUserDataRoot } from '../../../server/userDataRoot'
import { AgentEventSegmentStorage } from './agentEventSegmentStorage'
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

export type AgentEventStoreOptions = {
  segmentTargetBytes?: number
  admitAppend?: <T>(incomingBytes: number, publish: () => T) => T
  afterStreamClose?: () => void
}

type AgentEventStreamIdentity = Pick<
  AgentEvent,
  'serverInstanceId' | 'roomId' | 'roomGeneration'
>

export class AgentEventStore {
  readonly evidenceRoot: string
  readonly #segments: AgentEventSegmentStorage
  readonly #indexes = new Map<string, AgentEventIndex>()
  readonly #openStreams = new Map<string, AgentEventStreamIdentity>()

  constructor(root?: string, options: AgentEventStoreOptions = {}) {
    this.evidenceRoot = initializeUserDataRoot(root).agentEvents
    this.#segments = new AgentEventSegmentStorage(this.evidenceRoot, {
      targetBytes: options.segmentTargetBytes,
      admitAppend: options.admitAppend,
      afterStreamClose: options.afterStreamClose,
    })
  }

  append(event: AgentEvent): AgentEvent {
    const valid = assertValidAgentEvent(event)
    const identity = streamIdentity(valid)
    const key = streamKey(identity)
    const index = this.index(identity)
    if (index.eventIds.has(valid.eventId)) throw new Error('duplicate_agent_event_id:' + valid.eventId)
    try { this.#segments.append(identity, valid) }
    catch (error) {
      this.#indexes.delete(key)
      throw error
    }
    this.#openStreams.set(key, identity)
    indexEvent(index, valid)
    index.version += 1
    for (const wake of [...index.waiters]) wake()
    return valid
  }

  list(serverInstanceId: string, roomId: string, roomGeneration: string): AgentEvent[] {
    return [...this.index({ serverInstanceId, roomId, roomGeneration }).events]
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
    return this.#segments.activePath({ serverInstanceId, roomId, roomGeneration })
  }

  closeRoom(serverInstanceId: string, roomId: string, roomGeneration: string): void {
    const identity = { serverInstanceId, roomId, roomGeneration }
    this.#segments.close(identity)
    this.#openStreams.delete(streamKey(identity))
  }

  close(): void {
    for (const identity of [...this.#openStreams.values()]) this.#segments.close(identity)
    this.#openStreams.clear()
  }

  private matchIndex(
    match: Pick<AgentEventMatch, 'serverInstanceId' | 'roomId' | 'roomGeneration'>,
  ): AgentEventIndex {
    return this.index(match)
  }

  private matchingView(match: AgentEventMatch): AgentEvent[] {
    const index = this.matchIndex(match)
    const exact = exactCaptureKey(match)
    if (exact) return index.byCaptureKey.get(exact) ?? []
    return (index.byTerminalLaunch.get(terminalLaunchKey(match.terminalId, match.launchId)) ?? [])
      .filter((event) => matchesAgentEvent(event, match))
  }

  private index(identity: AgentEventStreamIdentity): AgentEventIndex {
    const key = streamKey(identity)
    const cached = this.#indexes.get(key)
    if (cached) return cached
    const index: AgentEventIndex = {
      events: [],
      eventIds: new Set(),
      byTerminalLaunch: new Map(),
      byCaptureKey: new Map(),
      version: 0,
      waiters: new Set(),
    }
    for (const event of this.#segments.read(identity, assertValidAgentEvent)) indexEvent(index, event)
    index.version = index.events.length
    this.#indexes.set(key, index)
    return index
  }
}

function indexEvent(index: AgentEventIndex, event: AgentEvent): void {
  if (index.eventIds.has(event.eventId)) throw new Error('duplicate_agent_event_id:' + event.eventId)
  index.events.push(event)
  index.eventIds.add(event.eventId)
  appendBucket(index.byTerminalLaunch, terminalLaunchKey(event.terminalId, event.launchId), event)
  appendBucket(index.byCaptureKey, captureKey(event), event)
}

function appendBucket(index: Map<string, AgentEvent[]>, key: string, event: AgentEvent): void {
  const bucket = index.get(key)
  if (bucket) bucket.push(event)
  else index.set(key, [event])
}

function terminalLaunchKey(terminalId: string, launchId: string): string {
  return `${terminalId}\0${launchId}`
}

function streamIdentity(event: AgentEvent): AgentEventStreamIdentity {
  return {
    serverInstanceId: event.serverInstanceId,
    roomId: event.roomId,
    roomGeneration: event.roomGeneration,
  }
}

function streamKey(identity: AgentEventStreamIdentity): string {
  return [identity.serverInstanceId, identity.roomId, identity.roomGeneration].join('\0')
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
