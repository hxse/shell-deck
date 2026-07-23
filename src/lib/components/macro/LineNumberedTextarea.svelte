<script lang="ts">
  import { onMount, tick } from "svelte"

  export type TextareaInsertAction = {
    text: string
    label: string
    testId?: string
  }

  let {
    value,
    onInput,
    testId = undefined,
    maxRows = 3,
    ariaLabel = undefined,
    insertActions = [],
    showLineNumbers = true,
    disabled = false,
    readOnly = false,
  } = $props<{
    value: string
    onInput: (value: string) => void
    testId?: string
    maxRows?: number
    ariaLabel?: string
    insertActions?: TextareaInsertAction[]
    showLineNumbers?: boolean
    disabled?: boolean
    readOnly?: boolean
  }>()

  const RESIZE_TOLERANCE_PX = 2

  let scrollTop = $state(0)
  let textareaElement = $state<HTMLTextAreaElement | null>(null)
  let displayHeight = $state<number | null>(null)
  let autoHeight = $state(0)
  let contentHeight = $state(0)
  let temporaryManualHeight = $state<number | null>(null)
  let expectedWidth = 0
  let pointerResizeStart: { width: number; height: number } | null = null
  let resizeFrame: number | null = null
  let resizeObserver: ResizeObserver | null = null
  let hasMeasured = false
  let mounted = false
  const lineCount = $derived(Math.max(1, value.split("\n").length))
  const overflowY = $derived(displayHeight !== null && contentHeight > displayHeight + RESIZE_TOLERANCE_PX ? "auto" : "hidden")
  const textareaStyle = $derived(displayHeight === null
    ? "max-height: 60vh;"
    : `height: ${displayHeight}px; max-height: 60vh; overflow-y: ${overflowY};`)

  function numericStyle(value: string): number {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function hardMaxHeight(): number {
    return Math.max(1, window.innerHeight * 0.6)
  }

  function measureAdaptiveHeight() {
    const textarea = textareaElement
    if (!textarea) return

    const previousHeight = textarea.style.height
    const previousMinHeight = textarea.style.minHeight
    textarea.style.height = "0px"
    textarea.style.minHeight = "0px"

    const style = getComputedStyle(textarea)
    const lineHeight = numericStyle(style.lineHeight) || numericStyle(style.fontSize) * 1.45 || 20
    const verticalChrome = numericStyle(style.paddingTop)
      + numericStyle(style.paddingBottom)
      + numericStyle(style.borderTopWidth)
      + numericStyle(style.borderBottomWidth)
    const measuredContentHeight = textarea.scrollHeight
    const automaticCap = Math.max(lineHeight + verticalChrome, maxRows * lineHeight + verticalChrome)
    const hardMax = hardMaxHeight()
    const nextAutoHeight = Math.min(measuredContentHeight + lineHeight, automaticCap, hardMax)
    const clampedManualHeight = temporaryManualHeight === null ? null : Math.min(temporaryManualHeight, hardMax)
    temporaryManualHeight = clampedManualHeight !== null && clampedManualHeight > nextAutoHeight + RESIZE_TOLERANCE_PX ? clampedManualHeight : null
    const nextDisplayHeight = Math.max(nextAutoHeight, temporaryManualHeight ?? 0)

    textarea.style.height = previousHeight
    textarea.style.minHeight = previousMinHeight
    contentHeight = measuredContentHeight
    autoHeight = nextAutoHeight
    displayHeight = nextDisplayHeight
    expectedWidth = textarea.clientWidth
    textarea.style.height = nextDisplayHeight + "px"
    hasMeasured = true
  }

  function scheduleMeasure() {
    if (!mounted) return
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null
      measureAdaptiveHeight()
    })
  }

  function handleObservedResize() {
    const textarea = textareaElement
    if (!textarea) return
    if (!hasMeasured) {
      scheduleMeasure()
      return
    }
    const widthChanged = Math.abs(textarea.clientWidth - expectedWidth) > RESIZE_TOLERANCE_PX
    if (widthChanged) {
      expectedWidth = textarea.clientWidth
      scheduleMeasure()
    }
  }

  function handleResizePointerDown() {
    const textarea = textareaElement
    if (!textarea) return
    const rect = textarea.getBoundingClientRect()
    pointerResizeStart = { width: rect.width, height: rect.height }
  }

  function finishResizePointerSession() {
    const textarea = textareaElement
    const start = pointerResizeStart
    pointerResizeStart = null
    if (!textarea || !start) return
    const rect = textarea.getBoundingClientRect()
    if (Math.abs(rect.width - start.width) > RESIZE_TOLERANCE_PX) {
      scheduleMeasure()
      return
    }
    if (Math.abs(rect.height - start.height) <= RESIZE_TOLERANCE_PX) return
    const clampedHeight = Math.min(rect.height, hardMaxHeight())
    temporaryManualHeight = clampedHeight > autoHeight + RESIZE_TOLERANCE_PX ? clampedHeight : null
    displayHeight = temporaryManualHeight ?? autoHeight
    textarea.style.height = displayHeight + "px"
  }

  function handleViewportResize() {
    scheduleMeasure()
  }

  function handleScroll(event: Event) {
    scrollTop = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.scrollTop : 0
  }

  function handleInput(event: Event) {
    if (!(event.currentTarget instanceof HTMLTextAreaElement)) return
    onInput(event.currentTarget.value)
    scheduleMeasure()
  }

  async function insertAtSelection(action: TextareaInsertAction) {
    const start = textareaElement?.selectionStart ?? value.length
    const end = textareaElement?.selectionEnd ?? start
    onInput(value.slice(0, start) + action.text + value.slice(end))
    await tick()
    const cursor = start + action.text.length
    textareaElement?.focus()
    textareaElement?.setSelectionRange(cursor, cursor)
    scheduleMeasure()
  }

  $effect(() => {
    value
    maxRows
    insertActions.length
    showLineNumbers
    void tick().then(scheduleMeasure)
  })

  onMount(() => {
    mounted = true
    measureAdaptiveHeight()
    resizeObserver = new ResizeObserver(handleObservedResize)
    if (textareaElement) resizeObserver.observe(textareaElement)
    window.addEventListener("resize", handleViewportResize)
    window.addEventListener("pointerup", finishResizePointerSession)
    window.addEventListener("pointercancel", finishResizePointerSession)
    void document.fonts?.ready.then(scheduleMeasure)
    document.fonts?.addEventListener("loadingdone", scheduleMeasure)
    return () => {
      resizeObserver?.disconnect()
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      window.removeEventListener("resize", handleViewportResize)
      window.removeEventListener("pointerup", finishResizePointerSession)
      window.removeEventListener("pointercancel", finishResizePointerSession)
      mounted = false
      document.fonts?.removeEventListener("loadingdone", scheduleMeasure)
    }
  })
</script>

<div
  class="line-numbered-textarea grid min-w-0 max-w-full grid-cols-[36px_minmax(0,1fr)] overflow-hidden rounded-md border border-base-300 bg-base-100 [--line-number-height:1.45em] [&.without-line-numbers]:grid-cols-1"
  class:without-line-numbers={!showLineNumbers}
  data-testid={testId ? testId + "-line-editor" : undefined}
  data-adaptive-textarea="true"
  data-auto-max-rows={maxRows}
  data-manual-height={temporaryManualHeight === null ? undefined : temporaryManualHeight}
>
  {#if insertActions.length > 0}
    <div class="textarea-toolbar col-[1/-1] flex min-w-0 flex-wrap justify-end gap-1 border-b border-base-300 bg-base-200/60 px-1.5 py-1">
      {#each insertActions as action}
        <button class="template-token-button btn btn-xs btn-primary !h-5 !min-h-5 min-w-0 px-1.5 !text-[11px] leading-tight [overflow-wrap:anywhere]" type="button" data-testid={action.testId} title={'Insert ' + action.text} disabled={disabled} onclick={() => insertAtSelection(action)}>{action.label}</button>
      {/each}
    </div>
  {/if}
  {#if showLineNumbers}
    <div class="line-number-gutter relative min-w-0 select-none overflow-hidden border-r border-base-300 bg-base-200/70 font-mono text-base-content/50 text-[var(--line-number-font-size,12px)] leading-[var(--line-number-height)]" aria-hidden="true" data-testid={testId ? testId + "-line-numbers" : undefined}>
      <div class="line-number-list absolute top-[7px] right-[7px] left-1 text-right will-change-transform [&>div]:h-[var(--line-number-height)]" style={`transform: translateY(-${scrollTop}px)`}>
        {#each Array.from({ length: lineCount }) as _, index}
          <div>{index + 1}</div>
        {/each}
      </div>
    </div>
  {/if}
  <textarea
    class="textarea box-border w-full min-w-0 min-h-0 resize-y !rounded-none !border-0 bg-transparent font-mono leading-[var(--line-number-height)] [scrollbar-gutter:stable] focus:outline-2 focus:-outline-offset-2 focus:outline-primary/30 disabled:cursor-not-allowed disabled:bg-base-200/80 disabled:text-base-content/45 read-only:cursor-not-allowed read-only:bg-base-200/80 read-only:text-base-content/55"
    bind:this={textareaElement}
    data-testid={testId}
    aria-label={ariaLabel}
    rows="1"
    {disabled}
    readonly={readOnly}
    value={value}
    style={textareaStyle}
    oninput={handleInput}
    onpointerdown={handleResizePointerDown}
    onscroll={handleScroll}
  ></textarea>
</div>
