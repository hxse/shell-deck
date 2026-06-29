import { existsSync, readFileSync } from 'node:fs'
import { extractArtifactRefs } from './artifactRefs'
import { ArtifactStore } from './artifactStore'
import { assertArtifactRef } from './identifier'
import { RunStoragePaths } from './runStoragePaths'
import { validateRunEvent } from './runEventSchema'
import type { RecoverableReplayError, ReplayResult, RunEvent } from './runEventTypes'

export class RunEventReplay {
  readonly paths: RunStoragePaths
  readonly artifacts: ArtifactStore

  constructor(rootDir = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd(), artifacts = new ArtifactStore(rootDir)) {
    this.paths = new RunStoragePaths(rootDir)
    this.artifacts = artifacts
  }

  replay(configId: string, runId: string): ReplayResult {
    const path = this.paths.eventsPath(configId, runId)
    if (!existsSync(path)) return { ok: true, events: [], diagnostics: this.orphanDiagnostics(configId, runId, []) }

    const content = readFileSync(path, 'utf8')
    if (content.length === 0) return { ok: true, events: [], diagnostics: this.orphanDiagnostics(configId, runId, []) }

    const hasTrailingNewline = content.endsWith('\n')
    const lines = (hasTrailingNewline ? content.slice(0, -1) : content).split('\n')
    const parseLimit = hasTrailingNewline ? lines.length : Math.max(0, lines.length - 1)
    const events: RunEvent[] = []
    const eventIds = new Set<string>()

    for (let index = 0; index < parseLimit; index += 1) {
      const lineNumber = index + 1
      const line = lines[index]
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        return this.error(events, {
          kind: 'invalid_json',
          message: error instanceof Error ? error.message : String(error),
          lineNumber,
        })
      }

      const expectedSeq = events.length + 1
      const validation = validateRunEvent(parsed, { configId, runId, eventSeq: expectedSeq })
      if (!validation.ok) {
        const hasSeqIssue = validation.issues.some((issue) => issue.path === 'eventSeq')
        return this.error(events, {
          kind: hasSeqIssue ? 'event_seq_gap' : 'schema_mismatch',
          message: validation.issues.map((issue) => issue.path + ': ' + issue.message).join('; '),
          lineNumber,
        })
      }

      const event = parsed as RunEvent
      if (eventIds.has(event.eventId)) {
        return this.error(events, {
          kind: 'duplicate_event_id',
          message: 'duplicate eventId ' + event.eventId,
          lineNumber,
          eventSeq: event.eventSeq,
        })
      }
      eventIds.add(event.eventId)

      for (const artifactRef of extractArtifactRefs(event.data)) {
        try {
          assertArtifactRef(artifactRef)
        } catch (error) {
          return this.error(events, {
            kind: 'schema_mismatch',
            message: error instanceof Error ? error.message : String(error),
            lineNumber,
            eventSeq: event.eventSeq,
          })
        }
        if (!this.artifacts.exists(configId, runId, artifactRef)) {
          return this.error(events, {
            kind: 'missing_artifact',
            message: 'artifact ref is missing: ' + artifactRef,
            lineNumber,
            eventSeq: event.eventSeq,
            artifactRef,
            failedEvent: event,
          })
        }
      }

      events.push(event)
    }

    if (!hasTrailingNewline) {
      return this.error(events, {
        kind: 'trailing_half_line',
        message: 'events.jsonl must end with a newline',
        lineNumber: lines.length,
      })
    }

    return { ok: true, events, diagnostics: this.orphanDiagnostics(configId, runId, events) }
  }

  private error(events: RunEvent[], error: RecoverableReplayError): ReplayResult {
    return { ok: false, events, error, diagnostics: [] }
  }

  private orphanDiagnostics(configId: string, runId: string, events: RunEvent[]): string[] {
    const referenced = new Set(events.flatMap((event) => extractArtifactRefs(event.data)))
    return this.artifacts.listRefs(configId, runId)
      .filter((ref) => !referenced.has(ref))
      .map((ref) => 'orphan_artifact:' + ref)
  }
}
