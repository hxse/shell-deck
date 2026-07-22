<script lang="ts">
  import type { MacroRunnerSnapshot, MacroRunTrace } from '../../macro/runnerTypes'
  let { runner, traces = [] } = $props<{ runner: MacroRunnerSnapshot | null; traces?: MacroRunTrace[] }>()
  const visibleWindow = $derived(runner?.events.length ? runner : traces[0] ?? null)
  const visibleEvents = $derived(visibleWindow?.events ?? [])
</script>

<section class="macro-section macro-trace-section run-log-panel flex min-h-full min-w-0 flex-col gap-2 overflow-auto border-t border-base-300 bg-base-100 p-2 text-[13px]" data-testid="macro-trace-view">
  <div class="macro-section-title flex items-center justify-between gap-2">
    <h3>Trace</h3>
    <span>{visibleEvents.length} retained / {visibleWindow?.totalEventCount ?? 0} total · {traces.length} persisted runs</span>
  </div>
  {#if (visibleWindow?.discardedEventCount ?? 0) > 0}
    <p class="run-log-retention alert alert-warning m-0 px-3 py-2 text-xs" data-testid="run-log-retention">Only the recent durable tail is retained. {visibleWindow?.discardedEventCount} older events were permanently deleted.</p>
  {/if}
  {#if traces.length > 0}
    <div class="macro-trace-runs flex max-h-28 flex-wrap gap-1 overflow-auto" data-testid="macro-trace-runs">
      {#each traces as trace (trace.runId)}
        <span class="badge badge-sm badge-outline h-auto max-w-full px-2 py-1 text-[10px]" class:badge-primary={trace.runId === runner?.runId} class:active={trace.runId === runner?.runId}><code>{trace.runId}</code> · {trace.status} · r{trace.macroRecord.revision}</span>
      {/each}
    </div>
  {/if}
  {#if visibleEvents.length === 0}
    <p class="empty-text m-0 text-xs text-base-content/60">No run events for this Room.</p>
  {:else}
    <ol class="run-log-list m-0 grid list-decimal gap-1 overflow-auto pl-6">
      {#each visibleEvents as event (event.eventId)}
        <li class="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-2 border-b border-base-300 py-1 text-[11px]"><span class="run-log-time text-base-content/55">{event.createdAt}</span><strong>{event.kind}</strong><code class="whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(event.data)}</code></li>
      {/each}
    </ol>
  {/if}
</section>
