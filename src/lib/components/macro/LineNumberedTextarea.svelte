<script lang="ts">
  import { tick } from "svelte"

  let {
    value,
    onInput,
    testId = undefined,
    rows = 4,
    ariaLabel = undefined,
    insertText = undefined,
    insertLabel = undefined,
    insertTestId = undefined,
  } = $props<{
    value: string
    onInput: (value: string) => void
    testId?: string
    rows?: number
    ariaLabel?: string
    insertText?: string
    insertLabel?: string
    insertTestId?: string
  }>()

  let scrollTop = $state(0)
  let textareaElement = $state<HTMLTextAreaElement | null>(null)
  const lineCount = $derived(Math.max(1, value.split("\n").length))

  function handleScroll(event: Event) {
    scrollTop = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.scrollTop : 0
  }

  async function insertAtSelection() {
    if (insertText === undefined) return
    const start = textareaElement?.selectionStart ?? value.length
    const end = textareaElement?.selectionEnd ?? start
    onInput(value.slice(0, start) + insertText + value.slice(end))
    await tick()
    const cursor = start + insertText.length
    textareaElement?.focus()
    textareaElement?.setSelectionRange(cursor, cursor)
  }
</script>

<div class="line-numbered-textarea" data-testid={testId ? testId + "-line-editor" : undefined}>
  {#if insertText !== undefined}
    <div class="textarea-toolbar">
      <button type="button" data-testid={insertTestId} onclick={insertAtSelection}>{insertLabel ?? "Insert text"}</button>
    </div>
  {/if}
  <div class="line-number-gutter" aria-hidden="true" data-testid={testId ? testId + "-line-numbers" : undefined}>
    <div class="line-number-list" style={`transform: translateY(-${scrollTop}px)`}>
      {#each Array.from({ length: lineCount }) as _, index}
        <div>{index + 1}</div>
      {/each}
    </div>
  </div>
  <textarea
    bind:this={textareaElement}
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

  .textarea-toolbar {
    display: flex;
    grid-column: 1 / -1;
    justify-content: flex-end;
    padding: 5px 6px;
    border-bottom: 1px solid #d8e0e8;
    background: #f5f8fa;
  }

  .textarea-toolbar button {
    min-height: 26px;
    padding: 2px 8px;
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
