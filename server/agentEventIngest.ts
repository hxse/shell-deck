import type { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import { assertValidAgentEvent } from '../src/lib/agentEvents/agentEventSchema'
import type { AgentEvent } from '../src/lib/agentEvents/agentEventTypes'
import type { TerminalDeckManager } from './terminalDeckManager'

export type AgentEventIngestOptions = {
  bindHost: string
  expectedToken?: string
  manager: TerminalDeckManager
  store: AgentEventStore
}

export type AgentEventIngestResult =
  | { ok: true; event: AgentEvent }
  | { ok: false; status: number; error: string }

export function ingestAgentEvent(input: unknown, token: string | undefined, options: AgentEventIngestOptions): AgentEventIngestResult {
  if (options.bindHost !== '127.0.0.1') {
    return { ok: false, status: 403, error: 'agent_event_ingest_requires_local_bind' }
  }
  if (!options.expectedToken) {
    return { ok: false, status: 403, error: 'agent_event_ingest_token_missing' }
  }
  if (token !== options.expectedToken) {
    return { ok: false, status: 403, error: 'agent_event_ingest_token_invalid' }
  }

  let event: AgentEvent
  try {
    event = assertValidAgentEvent(input)
  } catch (error) {
    return { ok: false, status: 422, error: error instanceof Error ? error.message : String(error) }
  }

  try {
    options.manager.ensureConfig(event.configId)
    const knownTerminal = options.manager.deckSnapshot(event.configId).terminals.some((terminal) => terminal.terminalId === event.terminalId)
    if (!knownTerminal) {
      return { ok: false, status: 404, error: 'agent_event_terminal_not_found:' + event.configId + ':' + event.terminalId }
    }
    return { ok: true, event: options.store.append(event) }
  } catch (error) {
    return { ok: false, status: 422, error: error instanceof Error ? error.message : String(error) }
  }
}

export function agentEventTokenFromRequest(req: Request): string | undefined {
  const explicit = req.headers.get('x-shell-deck-ingest-token')
  if (explicit) return explicit
  const authorization = req.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length)
  return undefined
}
