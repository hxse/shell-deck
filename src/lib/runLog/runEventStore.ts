import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import shortUuid from 'short-uuid'
import { extractArtifactRefs } from './artifactRefs'
import { ArtifactStore } from './artifactStore'
import { buildRunNodeLogs } from './runNodeLog'
import { deriveRunState } from './runDerivedState'
import { RunEventReplay } from './runEventReplay'
import { RunStoragePaths } from './runStoragePaths'
import { assertValidRunEvent } from './runEventSchema'
import type { AppendRunEventInput, ArtifactWriteResult, RunEvent, RunSnapshot, RunSummary } from './runEventTypes'

const translator = shortUuid()

type RunEventStoreOptions = {
  runIdFactory?: () => string
  eventIdFactory?: () => string
  now?: () => string
}

export type RunEventStoreUpdate = {
  configId: string
  runId: string
  event: RunEvent
}

export class RunEventStore {
  readonly paths: RunStoragePaths
  readonly artifacts: ArtifactStore
  readonly replayReader: RunEventReplay
  private queues = new Map<string, Promise<unknown>>()
  private readonly runIdFactory: () => string
  private readonly eventIdFactory: () => string
  private readonly now: () => string
  private readonly listeners = new Set<(update: RunEventStoreUpdate) => void>()

  constructor(readonly rootDir = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd(), options: RunEventStoreOptions = {}) {
    this.paths = new RunStoragePaths(rootDir)
    this.artifacts = new ArtifactStore(rootDir)
    this.replayReader = new RunEventReplay(rootDir, this.artifacts)
    this.runIdFactory = options.runIdFactory ?? createRunId
    this.eventIdFactory = options.eventIdFactory ?? createEventId
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async createRun(configId: string, data: Record<string, unknown> = {}): Promise<RunSnapshot> {
    const runId = this.runIdFactory()
    await this.appendEvent(configId, runId, { kind: 'run_started', summary: 'Run started', data })
    return this.snapshot(configId, runId)
  }

  async appendEvent(configId: string, runId: string, input: AppendRunEventInput): Promise<RunEvent> {
    const event = await this.enqueue(configId, runId, () => this.appendEventSync(configId, runId, input))
    this.notify({ configId, runId, event })
    return event
  }

  subscribe(listener: (update: RunEventStoreUpdate) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async writeArtifact(configId: string, runId: string, prefix: string, content: string, extension = 'txt', stepId?: string): Promise<ArtifactWriteResult> {
    const artifact = this.artifacts.writeText(configId, runId, prefix, content, extension)
    const event = await this.appendEvent(configId, runId, {
      kind: 'artifact_created',
      summary: 'Artifact created: ' + artifact.artifactRef,
      data: { artifact },
      stepId,
    })
    return { artifact, event, snapshot: this.snapshot(configId, runId) }
  }

  readArtifact(configId: string, runId: string, artifactRef: string): string {
    return this.artifacts.readText(configId, runId, artifactRef)
  }

  snapshot(configId: string, runId: string): RunSnapshot {
    const replay = this.replayReader.replay(configId, runId)
    return {
      runId,
      configId,
      replay,
      derivedState: deriveRunState(configId, runId, replay),
      nodeLogs: buildRunNodeLogs(replay.events, replay.error),
    }
  }

  listRuns(configId: string): RunSummary[] {
    const runsDir = this.paths.runsDir(configId)
    if (!existsSync(runsDir)) return []
    return readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.snapshot(configId, entry.name))
      .map((snapshot) => {
        const started = snapshot.replay.events.find((event) => event.kind === 'run_started')
        const templateId = typeof started?.data.templateId === 'string' ? started.data.templateId : undefined
        const templateName = typeof started?.data.templateName === 'string' ? started.data.templateName : undefined
        return {
          runId: snapshot.runId,
          configId: snapshot.configId,
          status: snapshot.derivedState.status,
          eventCount: snapshot.derivedState.eventCount,
          updatedAt: snapshot.replay.events.at(-1)?.createdAt ?? null,
          templateId,
          templateName,
        }
      })
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  }

  private notify(update: RunEventStoreUpdate): void {
    for (const listener of this.listeners) {
      try {
        listener(update)
      } catch {
        // Run log notification must not break append-only persistence.
      }
    }
  }

  private appendEventSync(configId: string, runId: string, input: AppendRunEventInput): RunEvent {
    this.paths.ensureRunDir(configId, runId)
    const replay = this.replayReader.replay(configId, runId)
    if (!replay.ok) throw new Error('run_log_recoverable_error:' + replay.error?.message)
    const event: RunEvent = {
      schemaVersion: 1,
      eventId: this.eventIdFactory(),
      eventSeq: replay.events.length + 1,
      runId,
      configId,
      kind: input.kind,
      createdAt: this.now(),
      summary: input.summary,
      data: input.data ?? {},
      ...(input.stepId ? { stepId: input.stepId } : {}),
    }
    if (replay.events.some((existing) => existing.eventId === event.eventId)) {
      throw new Error('duplicate_event_id:' + event.eventId)
    }
    assertValidRunEvent(event, { configId, runId, eventSeq: event.eventSeq })
    for (const artifactRef of extractArtifactRefs(event.data)) {
      if (!this.artifacts.exists(configId, runId, artifactRef)) throw new Error('missing_artifact_ref:' + artifactRef)
    }
    appendJsonLine(this.paths.eventsPath(configId, runId), event)
    return event
  }

  private async enqueue<T>(configId: string, runId: string, task: () => T): Promise<T> {
    const key = configId + ':' + runId
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.queues.set(key, next.catch(() => undefined))
    try {
      return await next
    } finally {
      if (this.queues.get(key) === next) this.queues.delete(key)
    }
  }
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

export function createRunId(): string {
  return 'run_' + translator.new()
}

export function createEventId(): string {
  return 'evt_' + translator.new()
}
