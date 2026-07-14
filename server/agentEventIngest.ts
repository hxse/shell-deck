import { createGeneratedId } from '../src/lib/generatedId'
import type { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import { assertValidAgentEventInput } from '../src/lib/agentEvents/agentEventSchema'
import type { AgentEvent } from '../src/lib/agentEvents/agentEventTypes'
import type { TerminalRoomManager } from './terminalRoomManager'

export type AgentEventIngestOptions = {
  roomId: string
  expectedToken: string
  manager: TerminalRoomManager
  store: AgentEventStore
  now?: () => string
  eventIdFactory?: () => string
}

export type AgentEventIngestResult =
  | { ok: true; event: AgentEvent }
  | { ok: false; status: number; error: string }

export function ingestAgentEvent(input: unknown, token: string | undefined, options: AgentEventIngestOptions): AgentEventIngestResult {
  if (!token || token !== options.expectedToken) return { ok: false, status: 403, error: 'agent_event_ingest_token_invalid' }
  let body
  try { body = assertValidAgentEventInput(input) }
  catch (error) { return { ok: false, status: 422, error: error instanceof Error ? error.message : String(error) } }

  let ticket
  try {
    ticket = options.manager.admit(options.roomId)
    ticket.assertActive()
    if (!options.manager.hasTerminalLaunch(options.roomId, body.roomGeneration, body.terminalId, body.launchId)) {
      return { ok: false, status: 404, error: 'agent_event_runtime_membership_mismatch' }
    }
    const eventIdFactory = options.eventIdFactory ?? (() => createGeneratedId('runEvent'))
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const event: AgentEvent = {
        ...body,
        eventId: eventIdFactory(),
        serverInstanceId: options.manager.serverInstanceId,
        roomId: options.roomId,
        receivedAt: (options.now ?? (() => new Date().toISOString()))(),
      }
      ticket.assertActive()
      try { return { ok: true, event: options.store.append(event) } }
      catch (error) {
        if (error instanceof Error && error.message.startsWith('duplicate_agent_event_id:')) continue
        throw error
      }
    }
    throw new Error('agent_event_id_collision')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, status: message === 'room_not_found' ? 404 : message === 'room_destroying' ? 409 : 422, error: message }
  } finally {
    ticket?.finish()
  }
}

export function agentEventTokenFromRequest(req: Request): string | undefined {
  const explicit = req.headers.get('x-shell-deck-ingest-token')
  if (explicit) return explicit
  const authorization = req.headers.get('authorization')
  return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
}
