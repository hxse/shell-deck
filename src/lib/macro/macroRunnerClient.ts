import type { MacroTerminalLayoutItem } from './macroDefinitionTypes'
import type {
  MacroRunEventPage,
  MacroRunnerActionAck,
  MacroRunnerSnapshot,
  MacroRunSummaryPage,
} from './runnerTypes'
import type { RoomSnapshot } from '../protocol'
import type { TerminalRoomClient } from '../terminalRoomClient'

export type PrepareTerminalsResult =
  | { ok: true; snapshot: RoomSnapshot }
  | { ok: false; error: 'terminal_prepare_backend_failed'; failedIndex: number; operation: 'move' | 'create'; snapshot: RoomSnapshot }

export class MacroRunnerClient {
  constructor(private readonly roomClient: () => TerminalRoomClient | null) {}

  async prepare(terminalLayout: MacroTerminalLayoutItem[], expectedTerminalStructureRevision: number): Promise<PrepareTerminalsResult> {
    const client = this.client()
    return await requestJson(`/api/rooms/${encodeURIComponent(client.roomId)}/terminals/prepare`, {
      method: 'POST', headers: client.controlHeaders(), body: JSON.stringify({ terminalLayout, expectedTerminalStructureRevision }),
    }, true) as PrepareTerminalsResult
  }

  async snapshot(): Promise<MacroRunnerSnapshot> {
    const client = this.client()
    return (await requestJson(`/api/rooms/${encodeURIComponent(client.roomId)}/runner`)).runner as MacroRunnerSnapshot
  }

  async traceSummaries(cursor: string | null = null): Promise<MacroRunSummaryPage> {
    const client = this.client()
    const query = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20'
    return (await requestJson(`/api/rooms/${encodeURIComponent(client.roomId)}/runner/traces${query}`)).page as MacroRunSummaryPage
  }

  async traceEvents(runId: string, cursor: string | null = null): Promise<MacroRunEventPage> {
    const client = this.client()
    const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100'
    return (await requestJson(`/api/rooms/${encodeURIComponent(client.roomId)}/runner/traces/${encodeURIComponent(runId)}/events${query}`)).page as MacroRunEventPage
  }

  async start(templateId: string, expectedMacroRevision: number, expectedTerminalStructureRevision: number): Promise<MacroRunnerActionAck> {
    return await this.action('start', { templateId, expectedMacroRevision, expectedTerminalStructureRevision })
  }

  async pause(): Promise<MacroRunnerActionAck> { return await this.action('pause', {}) }
  async resume(): Promise<MacroRunnerActionAck> { return await this.action('resume', {}) }
  async stop(): Promise<MacroRunnerActionAck> { return await this.action('stop', {}) }
  async updateInputDraft(invocationId: string, value: string, expectedInputRevision: number): Promise<MacroRunnerActionAck> {
    return await this.action('input-draft', { invocationId, value, expectedInputRevision })
  }

  async submitInput(invocationId: string, value: string, expectedInputRevision: number): Promise<MacroRunnerActionAck> {
    return await this.action('input', { invocationId, value, expectedInputRevision })
  }

  private async action(action: string, body: Record<string, unknown>): Promise<MacroRunnerActionAck> {
    const client = this.client()
    return (await requestJson(`/api/rooms/${encodeURIComponent(client.roomId)}/runner/${action}`, {
      method: 'POST', headers: client.controlHeaders(), body: JSON.stringify(body),
    })).ack as MacroRunnerActionAck
  }

  private client(): TerminalRoomClient {
    const client = this.roomClient()
    if (!client) throw new Error('room_disconnected')
    return client
  }
}

async function requestJson(path: string, init?: RequestInit, acceptOperationFailure = false): Promise<Record<string, unknown>> {
  const response = await fetch(path, init)
  const value = await response.json() as Record<string, unknown>
  if ((!response.ok && !(acceptOperationFailure && value.error === 'terminal_prepare_backend_failed')) || (value.ok !== true && !(acceptOperationFailure && value.error === 'terminal_prepare_backend_failed'))) {
    const error = new Error(typeof value.error === 'string' ? value.error : 'macro_runner_request_failed')
    Object.assign(error, { response: value, status: response.status })
    throw error
  }
  return value
}
