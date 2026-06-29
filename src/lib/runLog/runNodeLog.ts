import { extractArtifactRefs } from './artifactRefs'
import type { RecoverableReplayError, RunEvent, RunNodeLog } from './runEventTypes'

type NodeErrorMeta = {
  error?: string
  failedEvent?: RunEvent
  missingArtifactRefs: Set<string>
}

export function buildRunNodeLogs(events: RunEvent[], replayError?: RecoverableReplayError): RunNodeLog[] {
  const runEvents: RunEvent[] = []
  const stepEvents = new Map<string, RunEvent[]>()
  const errorMeta = new Map<string, NodeErrorMeta>()

  for (const event of events) {
    if (!event.stepId) {
      runEvents.push(event)
      continue
    }
    const existing = stepEvents.get(event.stepId) ?? []
    existing.push(event)
    stepEvents.set(event.stepId, existing)
  }

  if (replayError?.kind === 'missing_artifact' && replayError.failedEvent) {
    const nodeId = replayError.failedEvent.stepId ?? 'run'
    const meta = errorMeta.get(nodeId) ?? { missingArtifactRefs: new Set<string>() }
    meta.error = replayError.message
    meta.failedEvent = replayError.failedEvent
    if (replayError.artifactRef) meta.missingArtifactRefs.add(replayError.artifactRef)
    errorMeta.set(nodeId, meta)
    if (nodeId !== 'run' && !stepEvents.has(nodeId)) stepEvents.set(nodeId, [])
  }

  const logs: RunNodeLog[] = []
  if (runEvents.length > 0 || errorMeta.has('run')) {
    logs.push(toNodeLog('run', 'Run', 'run', runEvents, errorMeta.get('run')))
  }
  for (const [stepId, grouped] of stepEvents) {
    logs.push(toNodeLog(stepId, 'Step ' + stepId, 'step', grouped, errorMeta.get(stepId)))
  }
  return logs
}

function toNodeLog(nodeId: string, title: string, scope: RunNodeLog['scope'], events: RunEvent[], meta?: NodeErrorMeta): RunNodeLog {
  return {
    nodeId,
    title,
    scope,
    events,
    artifactRefs: [...new Set(events.flatMap((event) => extractArtifactRefs(event.data)))].sort(),
    missingArtifactRefs: [...(meta?.missingArtifactRefs ?? [])].sort(),
    ...(meta?.error ? { error: meta.error } : {}),
    ...(meta?.failedEvent ? { failedEvent: meta.failedEvent } : {}),
  }
}
