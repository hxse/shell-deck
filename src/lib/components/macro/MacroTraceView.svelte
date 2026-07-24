<script lang="ts">
  import type {
    MacroRunEventPage,
    MacroRunnerSnapshot,
    MacroRunSummary,
  } from '../../macro/runnerTypes'
  import { traceEventWindow } from '../../macro/runnerTypes'

  let {
    runner,
    summaries = [],
    eventsPage = null,
    selectedTraceRunId = null,
    hasPreviousSummaryPage = false,
    hasNextSummaryPage = false,
    hasPreviousEventPage = false,
    hasNextEventPage = false,
    onSelectRun,
    onPreviousSummaryPage,
    onNextSummaryPage,
    onPreviousEventPage,
    onNextEventPage,
  } = $props<{
    runner: MacroRunnerSnapshot | null
    summaries?: MacroRunSummary[]
    eventsPage?: MacroRunEventPage | null
    selectedTraceRunId?: string | null
    hasPreviousSummaryPage?: boolean
    hasNextSummaryPage?: boolean
    hasPreviousEventPage?: boolean
    hasNextEventPage?: boolean
    onSelectRun: (runId: string) => void
    onPreviousSummaryPage: () => void
    onNextSummaryPage: () => void
    onPreviousEventPage: () => void
    onNextEventPage: () => void
  }>()

  const visibleWindow = $derived(traceEventWindow(runner, selectedTraceRunId, eventsPage))
  const visibleEvents = $derived(visibleWindow?.events ?? [])
</script>

<section class="macro-section macro-trace-section run-log-panel flex min-h-full min-w-0 flex-col gap-2 overflow-auto border-t border-base-300 bg-base-100 p-2 text-[13px]" data-testid="macro-trace-view">
  <div class="macro-section-title flex items-center justify-between gap-2">
    <h3>Trace</h3>
    <span>{visibleEvents.length} shown / {visibleWindow?.totalEventCount ?? 0} total</span>
  </div>
  {#if (visibleWindow?.discardedEventCount ?? 0) > 0}
    <p class="run-log-retention alert alert-warning m-0 px-3 py-2 text-xs" data-testid="run-log-retention">Only the recent durable tail is retained. {visibleWindow?.discardedEventCount} older events were permanently deleted.</p>
  {/if}
  <div class="flex items-center justify-between gap-2">
    <button class="btn btn-secondary btn-xs" type="button" disabled={!hasPreviousSummaryPage} onclick={onPreviousSummaryPage}>Previous runs</button>
    <span class="text-xs text-base-content/60">{summaries.length} run summaries</span>
    <button class="btn btn-secondary btn-xs" type="button" disabled={!hasNextSummaryPage} onclick={onNextSummaryPage}>Next runs</button>
  </div>
  {#if summaries.length > 0}
    <div class="macro-trace-runs flex max-h-32 flex-wrap gap-1 overflow-auto" data-testid="macro-trace-runs">
      {#each summaries as trace (trace.runId)}
        <button class="btn btn-secondary btn-xs h-auto max-w-full px-2 py-1 text-[10px]" class:btn-primary={trace.runId === selectedTraceRunId} type="button" onclick={() => onSelectRun(trace.runId)}>
          <code>{trace.runId}</code> · {trace.status} · r{trace.macroRecord.revision}
        </button>
      {/each}
    </div>
  {/if}
  <div class="flex items-center justify-between gap-2">
    <button class="btn btn-secondary btn-xs" type="button" disabled={!hasPreviousEventPage} onclick={onPreviousEventPage}>Previous events</button>
    <button class="btn btn-secondary btn-xs" type="button" disabled={!hasNextEventPage} onclick={onNextEventPage}>Next events</button>
  </div>
  {#if visibleEvents.length === 0}
    <p class="empty-text m-0 text-xs text-base-content/60">No run events for this Room.</p>
  {:else}
    <ol class="run-log-list m-0 grid list-decimal gap-1 overflow-auto pl-6">
      {#each visibleEvents as event (event.eventId)}
        <li class="rounded-field bg-base-200 px-2 py-1"><code>{event.eventSeq}</code> · <strong>{event.kind}</strong> · {event.createdAt}</li>
      {/each}
    </ol>
  {/if}
</section>
