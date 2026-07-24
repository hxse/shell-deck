import type { TerminalRoomClient } from '../terminalRoomClient'
import { messageOf } from './macroJsonEditSession.svelte'
import type { MacroRunnerClient } from './macroRunnerClient'
import type { MacroRunEventPage, MacroRunSummary } from './runnerTypes'

type MacroTraceSessionOptions = {
  runnerClient: MacroRunnerClient
  roomClient(): TerminalRoomClient | null
  reportError(message: string): void
}

export function createMacroTraceSession(options: MacroTraceSessionOptions) {
  let summaries = $state<MacroRunSummary[]>([])
  let events = $state<MacroRunEventPage | null>(null)
  let selectedRunId = $state<string | null>(null)
  let summaryCursor = $state<string | null>(null)
  let summaryNextCursor = $state<string | null>(null)
  let summaryBack = $state<Array<string | null>>([])
  let eventCursor = $state<string | null>(null)
  let eventNextCursor = $state<string | null>(null)
  let eventBack = $state<Array<string | null>>([])
  let summaryRequest = 0
  let eventRequest = 0

  async function refresh(report = true): Promise<void> {
    if (!options.roomClient()) return
    try {
      summaryBack = []
      if (!await loadSummaryPage(null)) return
      const selected = summaries.some((summary) => summary.runId === selectedRunId)
        ? selectedRunId
        : summaries[0]?.runId ?? null
      if (selected) await selectRun(selected)
      else {
        selectedRunId = null
        events = null
      }
    } catch (error) {
      if (report) options.reportError(messageOf(error))
    }
  }

  async function loadSummaryPage(cursor: string | null): Promise<boolean> {
    const request = ++summaryRequest
    const page = await options.runnerClient.traceSummaries(cursor)
    if (request !== summaryRequest) return false
    summaries = page.items
    summaryCursor = cursor
    summaryNextCursor = page.nextCursor
    return true
  }

  async function nextSummaryPage(): Promise<void> {
    const next = summaryNextCursor
    if (!next) return
    try {
      const previous = summaryCursor
      if (!await loadSummaryPage(next)) return
      summaryBack = [...summaryBack, previous]
      await selectFirstSummary()
    } catch (error) { options.reportError(messageOf(error)) }
  }

  async function previousSummaryPage(): Promise<void> {
    const previous = summaryBack.at(-1)
    if (previous === undefined) return
    try {
      if (!await loadSummaryPage(previous)) return
      summaryBack = summaryBack.slice(0, -1)
      await selectFirstSummary()
    } catch (error) { options.reportError(messageOf(error)) }
  }

  async function selectRun(runId: string): Promise<void> {
    selectedRunId = runId
    events = null
    eventBack = []
    try { await loadEventPage(runId, null) }
    catch (error) { options.reportError(messageOf(error)) }
  }

  async function selectFirstSummary(): Promise<void> {
    const first = summaries[0]?.runId
    if (first) await selectRun(first)
    else {
      selectedRunId = null
      events = null
    }
  }

  async function loadEventPage(runId: string, cursor: string | null): Promise<boolean> {
    const request = ++eventRequest
    const page = await options.runnerClient.traceEvents(runId, cursor)
    if (request !== eventRequest || selectedRunId !== runId) return false
    events = page
    eventCursor = cursor
    eventNextCursor = page.nextCursor
    return true
  }

  async function nextEventPage(): Promise<void> {
    const runId = selectedRunId
    const next = eventNextCursor
    if (!runId || !next) return
    try {
      const previous = eventCursor
      if (!await loadEventPage(runId, next)) return
      eventBack = [...eventBack, previous]
    } catch (error) { options.reportError(messageOf(error)) }
  }

  async function previousEventPage(): Promise<void> {
    if (!selectedRunId) return
    const previous = eventBack.at(-1)
    if (previous === undefined) return
    try {
      if (!await loadEventPage(selectedRunId, previous)) return
      eventBack = eventBack.slice(0, -1)
    } catch (error) { options.reportError(messageOf(error)) }
  }

  return {
    get summaries() { return summaries },
    get events() { return events },
    get selectedRunId() { return selectedRunId },
    get hasPreviousSummaryPage() { return summaryBack.length > 0 },
    get hasNextSummaryPage() { return summaryNextCursor !== null },
    get hasPreviousEventPage() { return eventBack.length > 0 },
    get hasNextEventPage() { return eventNextCursor !== null },
    refresh,
    selectRun,
    nextSummaryPage,
    previousSummaryPage,
    nextEventPage,
    previousEventPage,
  }
}
