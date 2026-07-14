import { closeSync, existsSync, fchmodSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertGeneratedId, assertRoomRouteToken } from '../generatedId'
import { assertManagedRegularFile, ensurePrivateDirectory, fsyncDirectory, initializeUserDataRoot, PRIVATE_FILE_MODE } from '../../../server/userDataRoot'
import { assertValidAgentEvent } from './agentEventSchema'
import type { AgentEvent, AgentEventMatch } from './agentEventTypes'

export class AgentEventStore {
  readonly evidenceRoot: string

  constructor(root?: string) {
    this.evidenceRoot = initializeUserDataRoot(root).agentEvents
  }

  append(event: AgentEvent): AgentEvent {
    const valid = assertValidAgentEvent(event)
    const existing = this.list(valid.serverInstanceId, valid.roomId, valid.roomGeneration)
    if (existing.some((candidate) => candidate.eventId === valid.eventId)) throw new Error('duplicate_agent_event_id:' + valid.eventId)
    appendJsonLine(this.eventsPath(valid.serverInstanceId, valid.roomId, valid.roomGeneration), valid)
    return valid
  }

  list(serverInstanceId: string, roomId: string, roomGeneration: string): AgentEvent[] {
    const path = this.eventsPath(serverInstanceId, roomId, roomGeneration)
    if (!existsSync(path)) return []
    return readEventsFromJsonl(path)
  }

  matching(match: AgentEventMatch): AgentEvent[] {
    return this.list(match.serverInstanceId, match.roomId, match.roomGeneration).filter((event) => matchesAgentEvent(event, match))
  }

  latestMatching(match: AgentEventMatch): AgentEvent | undefined {
    return this.matching(match).at(-1)
  }

  countMatching(match: AgentEventMatch): number {
    return this.matching(match).length
  }

  nextMatching(match: AgentEventMatch, afterCount = 0, consumedIds = new Set<string>()): AgentEvent | undefined {
    return this.matching(match).slice(afterCount).find((event) => !consumedIds.has(event.eventId))
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
  const fd = openSync(path, 'a', PRIVATE_FILE_MODE)
  try {
    fchmodSync(fd, PRIVATE_FILE_MODE)
    const buffer = Buffer.from(JSON.stringify(value) + '\n')
    let offset = 0
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  fsyncDirectory(dirname(path))
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
