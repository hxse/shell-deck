<script lang="ts">
  export type NoticeItem = {
    id: number
    text: string
    title?: string
    level?: 'info' | 'success' | 'warning' | 'error'
    createdAt?: string
    notificationId?: string
    runId?: string
    stepId?: string
    systemStatus?: string
  }

  let { notice, onDismiss } = $props<{
    notice: NoticeItem | null
    onDismiss: (id: number) => void
  }>()
</script>

{#if notice}
  <section class="notice-stack" aria-label="Macro notification">
    <button class="notice-dismiss-layer" type="button" aria-label="Dismiss notice" onclick={() => onDismiss(notice.id)}></button>
    <div class="notice" class:info={notice.level === 'info'} class:success={notice.level === 'success'} class:warning={notice.level === 'warning'} class:error={notice.level === 'error'} role="alert" data-testid="notice-item">
      <span class="notice-copy">
        <small>
          {#if notice.title}<span>title: {notice.title}</span>{/if}
          <span>message: {notice.text}</span>
          {#if notice.level}<span>level: {notice.level}</span>{/if}
          {#if notice.createdAt}<span>time: {notice.createdAt}</span>{/if}
          {#if notice.notificationId}<span>notification_id: {notice.notificationId}</span>{/if}
          {#if notice.runId}<span>run_id: {notice.runId}</span>{/if}
          {#if notice.stepId}<span>step_id: {notice.stepId}</span>{/if}
          {#if notice.systemStatus}<span>system_status: {notice.systemStatus}</span>{/if}
        </small>
      </span>
      <button type="button" aria-label="Dismiss notice" onclick={() => onDismiss(notice.id)}>Dismiss</button>
    </div>
  </section>
{/if}
