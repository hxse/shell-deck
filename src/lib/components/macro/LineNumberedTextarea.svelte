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
  class="line-numbered-textarea"
  class:without-line-numbers={!showLineNumbers}
  data-testid={testId ? testId + "-line-editor" : undefined}
  data-adaptive-textarea="true"
  data-auto-max-rows={maxRows}
  data-manual-height={temporaryManualHeight === null ? undefined : temporaryManualHeight}
>
  {#if insertActions.length > 0}
    <div class="textarea-toolbar">
      {#each insertActions as action}
        <button type="button" data-testid={action.testId} disabled={disabled} onclick={() => insertAtSelection(action)}>{action.label}</button>
      {/each}
    </div>
  {/if}
  {#if showLineNumbers}
    <div class="line-number-gutter" aria-hidden="true" data-testid={testId ? testId + "-line-numbers" : undefined}>
      <div class="line-number-list" style={`transform: translateY(-${scrollTop}px)`}>
        {#each Array.from({ length: lineCount }) as _, index}
          <div>{index + 1}</div>
        {/each}
      </div>
    </div>
  {/if}
  <textarea
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

<style>
  .line-numbered-textarea {
    --line-number-height: 1.45em;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    min-width: 0;
    max-width: 100%;
    border: 1px solid #c8d3dd;
    border-radius: 6px;
    background: #ffffff;
    overflow: hidden;
  }

  .line-numbered-textarea.without-line-numbers {
    grid-template-columns: minmax(0, 1fr);
  }

  .line-number-gutter {
    position: relative;
    min-width: 0;
    overflow: hidden;
    border-right: 1px solid #d8e0e8;
    background: #f5f7f9;
    color: #7a8793;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: var(--line-number-font-size, 12px);
    line-height: var(--line-number-height);
    user-select: none;
  }

  .textarea-toolbar {
    display: flex;
    grid-column: 1 / -1;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 5px;
    padding: 5px 6px;
    border-bottom: 1px solid #d8e0e8;
    background: #f5f8fa;
  }

  .textarea-toolbar button {
    min-width: 0;
    min-height: 26px;
    padding: 2px 8px;
    overflow-wrap: anywhere;
  }

  .line-number-list {
    position: absolute;
    top: 7px;
    right: 7px;
    left: 4px;
    text-align: right;
    will-change: transform;
  }

  .line-number-list div {
    height: var(--line-number-height);
  }

  .line-numbered-textarea textarea {
    width: 100%;
    min-width: 0;
    min-height: 0;
    border: 0 !important;
    border-radius: 0;
    background: transparent;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    line-height: var(--line-number-height);
    scrollbar-gutter: stable;
    resize: vertical;
  }

  .line-numbered-textarea textarea:focus {
    outline: 2px solid rgba(23, 105, 170, 0.25);
    outline-offset: -2px;
  }
</style>
