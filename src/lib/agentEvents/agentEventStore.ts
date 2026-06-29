import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import shortUuid from 'short-uuid'
import { assertValidPublicId } from '../identifier'
import { assertValidAgentEvent } from './agentEventSchema'
import type { AgentEvent, AgentEventMatch } from './agentEventTypes'

const translator = shortUuid()

export class AgentEventStore {
  constructor(readonly rootDir = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()) {}

  append(event: AgentEvent): AgentEvent {
    const valid = assertValidAgentEvent(event)
    appendJsonLine(this.eventsPath(valid.configId), valid)
    return valid
  }

  spool(event: AgentEvent): string {
    const valid = assertValidAgentEvent(event)
    const path = join(this.agentEventsDir(valid.configId), 'spool-' + Date.now() + '-' + translator.new() + '.jsonl')
    const tmpPath = path + '.writing-' + translator.new()
    writeJsonLineAtomic(tmpPath, path, valid)
    return path
  }

  importSpool(configId: string): number {
    const dir = this.agentEventsDir(configId)
    if (!existsSync(dir)) return 0
    let imported = 0
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl') || !entry.name.startsWith('spool-')) continue
      const path = join(dir, entry.name)
      const importingPath = path + '.importing'
      renameSync(path, importingPath)
      try {
        for (const event of readEventsFromJsonl(importingPath)) {
          if (event.configId !== configId) throw new Error('spool_config_mismatch:' + event.configId)
          this.append(event)
          imported += 1
        }
        unlinkSync(importingPath)
      } catch (error) {
        renameSync(importingPath, path)
        throw error
      }
    }
    return imported
  }

  list(configId: string): AgentEvent[] {
    const path = this.eventsPath(configId)
    if (!existsSync(path)) return []
    return readEventsFromJsonl(path)
  }

  latestMatching(match: AgentEventMatch): AgentEvent | undefined {
    return this.matching(match).at(-1)
  }

  matching(match: AgentEventMatch): AgentEvent[] {
    return this.list(match.configId).filter((event) => matchesAgentEvent(event, match))
  }

  countMatching(match: AgentEventMatch): number {
    return this.matching(match).length
  }

  nextMatching(match: AgentEventMatch, afterCount = 0, consumedKeys = new Set<string>()): AgentEvent | undefined {
    return this.matching(match).slice(afterCount).find((event) => !consumedKeys.has(agentEventKey(event)))
  }

  eventsPath(configId: string): string {
    return join(this.agentEventsDir(configId), 'events.jsonl')
  }

  agentEventsDir(configId: string): string {
    return join(this.configDir(configId), 'agent-events')
  }

  configDir(configId: string): string {
    return join(this.rootDir, '.shell-deck', 'configs', assertValidPublicId(configId, 'configId'))
  }
}

function readEventsFromJsonl(path: string): AgentEvent[] {
  const text = readFileSync(path, 'utf8')
  const events: AgentEvent[] = []
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue
    try {
      events.push(assertValidAgentEvent(JSON.parse(line)))
    } catch (error) {
      throw new Error(path + ':' + (index + 1) + ':' + (error instanceof Error ? error.message : String(error)))
    }
  }
  return events
}

function appendJsonLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'a')
  try {
    const line = JSON.stringify(value) + '\n'
    writeSync(fd, line)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function writeJsonLineAtomic(tmpPath: string, finalPath: string, value: unknown): void {
  mkdirSync(dirname(finalPath), { recursive: true })
  let fd: number | null = null
  try {
    fd = openSync(tmpPath, 'wx')
    const line = JSON.stringify(value) + '\n'
    writeSync(fd, line)
    fsyncSync(fd)
  } catch (error) {
    if (fd !== null) {
      try { closeSync(fd) } catch {}
      fd = null
    }
    try { unlinkSync(tmpPath) } catch {}
    throw error
  } finally {
    if (fd !== null) closeSync(fd)
  }
  renameSync(tmpPath, finalPath)
  const dirFd = openSync(dirname(finalPath), 'r')
  try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
}

export function agentEventKey(event: AgentEvent): string {
  return [event.configId, event.terminalId, event.launchId, event.agentSessionId, event.agentTurnId ?? '', event.receivedAt, event.eventKind, event.adapterMetadata.adapter, event.capturedText?.length ?? 0].join('|')
}

function matchesAgentEvent(event: AgentEvent, match: AgentEventMatch): boolean {
  if (event.terminalId !== match.terminalId) return false
  if (match.agentKind && event.agentKind !== match.agentKind) return false
  if (match.eventKind && event.eventKind !== match.eventKind) return false
  if (match.adapter && event.adapterMetadata.adapter !== match.adapter) return false
  return true
}
