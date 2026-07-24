import type { MacroRunStore } from '../../server/macroRunStore'
import type { MacroRunnerService } from '../../server/macroRunnerService'
import type { MacroRunEvent, MacroRunSummary } from '../../src/lib/macro/runnerTypes'

export type AggregatedMacroTrace = MacroRunSummary & { events: MacroRunEvent[] }

export function storeTracesForRoom(
  store: MacroRunStore,
  roomId: string,
): AggregatedMacroTrace[] {
  const summaries = store.traceSummariesForRoom(roomId, 100, null).items
  return summaries.map((summary) => ({
    ...summary,
    events: readAllEvents((cursor) => store.traceEventsForRoom(roomId, summary.runId, 100, cursor)),
  }))
}

export function serviceTracesForRoom(
  service: MacroRunnerService,
  roomId: string,
): AggregatedMacroTrace[] {
  const summaries = service.traceSummaries(roomId, 100, null).items
  return summaries.map((summary) => ({
    ...summary,
    events: readAllEvents((cursor) => service.traceEvents(roomId, summary.runId, 100, cursor)),
  }))
}

function readAllEvents(
  page: (cursor: string | null) => { events: MacroRunEvent[]; nextCursor: string | null },
): MacroRunEvent[] {
  const events: MacroRunEvent[] = []
  let cursor: string | null = null
  do {
    const next = page(cursor)
    events.push(...next.events)
    cursor = next.nextCursor
  } while (cursor)
  return events
}
