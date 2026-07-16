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
    reason?: string
    kind?: 'mutation' | 'notification' | 'general'
    autoDismissMs?: number
  }

  let { notice, onDismiss } = $props<{
    notice: NoticeItem | null
    onDismiss: (id: number) => void
  }>()

  let timer: ReturnType<typeof setTimeout> | null = null
  let remainingMs = 0
  let startedAt = 0

  $effect(() => {
    const current = notice
    if (!current) return
    clearTimer()
    remainingMs = current.autoDismissMs ?? 3000
    startedAt = Date.now()
    timer = setTimeout(() => onDismiss(current.id), remainingMs)
    return clearTimer
  })

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function pauseTimer() {
    if (!timer) return
    remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt))
    clearTimer()
  }

  function resumeTimer() {
    if (timer || !notice || remainingMs <= 0) return
    startedAt = Date.now()
    const id = notice.id
    timer = setTimeout(() => onDismiss(id), remainingMs)
  }
</script>

{#if notice}
  <section class="notice-stack" aria-label="Notice">
    <button class="notice-dismiss-layer" type="button" data-testid="notice-dismiss-layer" aria-label="Dismiss notice" onclick={() => onDismiss(notice.id)}></button>
    <div class="notice" class:info={notice.level === 'info'} class:success={notice.level === 'success'} class:warning={notice.level === 'warning'} class:error={notice.level === 'error'} role="alert" data-testid="notice-item" onmouseenter={pauseTimer} onmouseleave={resumeTimer}>
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
      <button type="button" data-testid="notice-dismiss" aria-label="Dismiss notice" onclick={() => onDismiss(notice.id)}>Dismiss</button>
    </div>
  </section>
{/if}
