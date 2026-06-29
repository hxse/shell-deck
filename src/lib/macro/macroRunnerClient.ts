import type { MacroRunnerSnapshot, StartMacroRunRequest, SubmitMacroInputRequest } from './runnerTypes'

type SnapshotResponse = { ok: true; runner: MacroRunnerSnapshot }
type ErrorResponse = { ok: false; error?: string; existingRunId?: string }

export class MacroRunnerClient {
  readonly configId: string

  constructor(configId: string) {
    this.configId = configId
  }

  async snapshot(): Promise<MacroRunnerSnapshot> {
    const response = await jsonFetch<SnapshotResponse>(this.basePath())
    return response.runner
  }

  async start(request: StartMacroRunRequest): Promise<MacroRunnerSnapshot> {
    return await this.action('start', request)
  }

  async pause(): Promise<MacroRunnerSnapshot> {
    return await this.action('pause', {})
  }

  async resume(nextStepId?: string): Promise<MacroRunnerSnapshot> {
    return await this.action('resume', nextStepId ? { nextStepId } : {})
  }

  async stop(): Promise<MacroRunnerSnapshot> {
    return await this.action('stop', {})
  }

  async submitInput(request: SubmitMacroInputRequest): Promise<MacroRunnerSnapshot> {
    return await this.action('input', request)
  }

  private async action(action: string, body: unknown): Promise<MacroRunnerSnapshot> {
    const response = await jsonFetch<SnapshotResponse>(this.basePath() + '/' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.runner
  }

  private basePath(): string {
    return '/api/configs/' + encodeURIComponent(this.configId) + '/runner'
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json() as T | ErrorResponse
  if (!response.ok) {
    const error = body as ErrorResponse
    throw new Error(error.error || 'request_failed:' + response.status)
  }
  return body as T
}
