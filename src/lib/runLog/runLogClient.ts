import type { AppendRunEventInput, ArtifactWriteResult, RunSnapshot, RunSummary, ValidationIssue } from './runEventTypes'

type ListRunsResponse = { ok: true; runs: RunSummary[] }
type RunResponse = { ok: true; run: RunSnapshot }
type AppendEventResponse = { ok: true; event: unknown; run: RunSnapshot }
type ErrorResponse = { ok: false; error?: string; issues?: ValidationIssue[] }

export type WriteArtifactInput = {
  prefix: string
  content: string
  extension?: string
  stepId?: string
}

export class RunLogClient {
  readonly configId: string

  constructor(configId: string) {
    this.configId = configId
  }

  async list(): Promise<RunSummary[]> {
    const response = await jsonFetch<ListRunsResponse>(this.basePath())
    return response.runs
  }

  async create(data: Record<string, unknown> = {}): Promise<RunSnapshot> {
    const response = await jsonFetch<RunResponse>(this.basePath(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    })
    return response.run
  }

  async snapshot(runId: string): Promise<RunSnapshot> {
    const response = await jsonFetch<RunResponse>(this.runPath(runId))
    return response.run
  }

  async appendEvent(runId: string, event: AppendRunEventInput): Promise<RunSnapshot> {
    const response = await jsonFetch<AppendEventResponse>(this.runPath(runId) + '/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    })
    return response.run
  }

  async writeArtifact(runId: string, input: WriteArtifactInput): Promise<ArtifactWriteResult> {
    return await jsonFetch<ArtifactWriteResult & { ok: true }>(this.runPath(runId) + '/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  }

  async readArtifact(runId: string, artifactRef: string): Promise<string> {
    const suffix = artifactRef.startsWith('artifacts/') ? artifactRef.slice('artifacts/'.length) : artifactRef
    const response = await fetch(this.runPath(runId) + '/artifacts/' + encodeURIComponent(suffix))
    if (!response.ok) throw new Error(await response.text())
    return await response.text()
  }

  private basePath(): string {
    return '/api/configs/' + encodeURIComponent(this.configId) + '/runs'
  }

  private runPath(runId: string): string {
    return this.basePath() + '/' + encodeURIComponent(runId)
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json() as T | ErrorResponse
  if (!response.ok) {
    const error = body as ErrorResponse
    const details = error.issues?.map((issue) => issue.path + ': ' + issue.message).join('\n')
    throw new Error(details || error.error || 'request_failed:' + response.status)
  }
  return body as T
}
