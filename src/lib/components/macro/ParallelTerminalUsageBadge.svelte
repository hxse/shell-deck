<script lang="ts">
  import type { ParallelTerminalUsage } from '../../macro/parallelTerminalUsage'
  import {
    parallelTerminalUsageHelp,
    parallelTerminalUsageLabel,
  } from '../../macro/parallelTerminalUsage'

  let { usage } = $props<{ usage?: ParallelTerminalUsage }>()
</script>

{#if usage}
  <details class="dropdown dropdown-end">
    <summary
      class="badge badge-sm badge-ghost h-auto min-h-5 cursor-help whitespace-normal py-0.5 text-left text-[10px]"
      class:badge-info={usage.kind === 'shared_text'}
      data-testid="parallel-terminal-usage"
      title={parallelTerminalUsageHelp(usage)}
      aria-label={`${parallelTerminalUsageLabel(usage)}. ${parallelTerminalUsageHelp(usage)}`}
    >{parallelTerminalUsageLabel(usage)}</summary>
    <div class="dropdown-content z-[70] mt-1 w-72 rounded-box bg-base-300 p-2 text-xs shadow-xl">
      {parallelTerminalUsageHelp(usage)}
    </div>
  </details>
{/if}
