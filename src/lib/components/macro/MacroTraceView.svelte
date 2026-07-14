<script lang="ts">
  import type { MacroRunnerSnapshot, MacroRunTrace } from '../../macro/runnerTypes'
  let { runner, traces = [] } = $props<{ runner: MacroRunnerSnapshot | null; traces?: MacroRunTrace[] }>()
  const visibleWindow = $derived(runner?.events.length ? runner : traces[0] ?? null)
  const visibleEvents = $derived(visibleWindow?.events ?? [])
</script>

<section class="macro-section macro-trace-section run-log-panel" data-testid="macro-trace-view">
  <div class="macro-section-title">
    <h3>Trace</h3>
    <span>{visibleEvents.length} retained / {visibleWindow?.totalEventCount ?? 0} total · {traces.length} persisted runs</span>
  </div>
  {#if (visibleWindow?.discardedEventCount ?? 0) > 0}
    <p class="run-log-retention" data-testid="run-log-retention">Only the recent durable tail is retained. {visibleWindow?.discardedEventCount} older events were permanently deleted.</p>
  {/if}
  {#if traces.length > 0}
    <div class="macro-trace-runs" data-testid="macro-trace-runs">
      {#each traces as trace (trace.runId)}
        <span class:active={trace.runId === runner?.runId}><code>{trace.runId}</code> · {trace.status} · r{trace.macroRecord.revision}</span>
      {/each}
    </div>
  {/if}
  {#if visibleEvents.length === 0}
    <p class="empty-text">No run events for this Room.</p>
  {:else}
    <ol class="run-log-list">
      {#each visibleEvents as event (event.eventId)}
        <li><span class="run-log-time">{event.createdAt}</span><strong>{event.kind}</strong><code>{JSON.stringify(event.data)}</code></li>
      {/each}
    </ol>
  {/if}
</section>
