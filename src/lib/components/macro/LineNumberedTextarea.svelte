<script lang="ts">
  let {
    value,
    onInput,
    testId = undefined,
    rows = 4,
    ariaLabel = undefined,
  } = $props<{
    value: string
    onInput: (value: string) => void
    testId?: string
    rows?: number
    ariaLabel?: string
  }>()

  let scrollTop = $state(0)
  const lineCount = $derived(Math.max(1, value.split("\n").length))

  function handleScroll(event: Event) {
    scrollTop = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.scrollTop : 0
  }
</script>

<div class="line-numbered-textarea" data-testid={testId ? testId + "-line-editor" : undefined}>
  <div class="line-number-gutter" aria-hidden="true" data-testid={testId ? testId + "-line-numbers" : undefined}>
    <div class="line-number-list" style={`transform: translateY(-${scrollTop}px)`}>
      {#each Array.from({ length: lineCount }) as _, index}
        <div>{index + 1}</div>
      {/each}
    </div>
  </div>
  <textarea
    data-testid={testId}
    aria-label={ariaLabel}
    rows={rows}
    value={value}
    oninput={(event) => onInput(event.currentTarget.value)}
    onscroll={handleScroll}
  ></textarea>
</div>

<style>
  .line-numbered-textarea {
    --line-number-height: 1.45em;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    min-width: 0;
    border: 1px solid #c8d3dd;
    border-radius: 6px;
    background: #ffffff;
    overflow: hidden;
  }

  .line-number-gutter {
    position: relative;
    min-width: 0;
    overflow: hidden;
    border-right: 1px solid #d8e0e8;
    background: #f5f7f9;
    color: #7a8793;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: var(--line-number-height);
    user-select: none;
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
    border: 0 !important;
    border-radius: 0;
    background: transparent;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    line-height: var(--line-number-height);
    resize: vertical;
  }

  .line-numbered-textarea textarea:focus {
    outline: 2px solid rgba(23, 105, 170, 0.25);
    outline-offset: -2px;
  }
</style>
