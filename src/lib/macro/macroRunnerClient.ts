import type { MacroTerminalLayoutItem } from './macroDefinitionTypes'
import type { MacroRunnerSnapshot, MacroRunTrace } from './runnerTypes'
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

  async traces(): Promise<MacroRunTrace[]> {
    const client = this.client()
    return (await requestJson(`/api/rooms/${encodeURIComponent(client.roomId)}/runner/traces`)).traces as MacroRunTrace[]
  }

  async start(templateId: string, expectedMacroRevision: number, expectedTerminalStructureRevision: number): Promise<MacroRunnerSnapshot> {
    return await this.action('start', { templateId, expectedMacroRevision, expectedTerminalStructureRevision })
  }

  async pause(): Promise<MacroRunnerSnapshot> { return await this.action('pause', {}) }
  async resume(): Promise<MacroRunnerSnapshot> { return await this.action('resume', {}) }
  async stop(): Promise<MacroRunnerSnapshot> { return await this.action('stop', {}) }
  async submitInput(value: string): Promise<MacroRunnerSnapshot> { return await this.action('input', { value }) }

  private async action(action: string, body: Record<string, unknown>): Promise<MacroRunnerSnapshot> {
    const client = this.client()
    return (await requestJson(`/api/rooms/${encodeURIComponent(client.roomId)}/runner/${action}`, {
      method: 'POST', headers: client.controlHeaders(), body: JSON.stringify(body),
    })).runner as MacroRunnerSnapshot
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
