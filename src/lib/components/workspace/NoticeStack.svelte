<script lang="ts">
  let { notices, onDismiss } = $props<{
    notices: Array<{ id: number; text: string }>
    onDismiss: (id: number) => void
  }>()
</script>

{#if notices.length > 0}
  <section class="notice-stack" aria-label="Terminal notices">
    {#each notices as notice (notice.id)}
      <div class="notice" role="alert">
        <span>{notice.text}</span>
        <button type="button" aria-label="Dismiss notice" onclick={() => onDismiss(notice.id)}>Dismiss</button>
      </div>
    {/each}
  </section>
{/if}
