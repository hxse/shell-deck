<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import type { ContentEditLeaseChangedMessage, ContentRecordChangedMessage } from '../protocol'
  import type { TerminalRoomClient } from '../terminalRoomClient'
  import {
    createLibrarySession,
    formatLibraryMacroValidation,
    libraryKindLabel,
    type LibraryLoadResult,
    type LibraryTab,
  } from '../library/librarySession.svelte'
  import { parseAndValidateMacroDefinitionJson, validateRunnableMacroDefinitionV5 } from '../macro/macroDefinitionValidation'
  import LineNumberedTextarea from './macro/LineNumberedTextarea.svelte'

  let {
    roomClient,
    canMutateShared,
    selectedTab,
    filter,
    contentRecordChanges,
    contentLeaseChanges,
    connectionGeneration,
    onPreferenceChange,
    onDirtyChange,
    onLoadIntoMacro,
    onMutationDenied,
    onResetWidth,
  } = $props<{
    roomClient: TerminalRoomClient | null
    canMutateShared: boolean
    selectedTab: LibraryTab
    filter: string
    contentRecordChanges: Array<ContentRecordChangedMessage & { sequence: number }>
    contentLeaseChanges: Array<ContentEditLeaseChangedMessage & { sequence: number }>
    connectionGeneration: number
    onPreferenceChange: (selectedTab: LibraryTab, filter: string) => void
    onDirtyChange: (dirty: boolean) => void
    onLoadIntoMacro: (itemId: string, expectedRevision: number) => Promise<LibraryLoadResult>
    onMutationDenied: (reason: string) => void
    onResetWidth?: () => void
  }>()

  let validationText = $state<string | null>(null)
  let copyLabel = $state('Copy')
  const session = createLibrarySession({
    initialTab: untrack(() => selectedTab),
    initialFilter: untrack(() => filter),
    roomClient: () => roomClient,
    canMutateShared: () => canMutateShared,
    connectionGeneration: () => connectionGeneration,
    contentRecordChanges: () => contentRecordChanges,
    contentLeaseChanges: () => contentLeaseChanges,
    onPreferenceChange: (nextTab, nextFilter) => onPreferenceChange(nextTab, nextFilter),
    onLoadIntoMacro: (itemId, expectedRevision) => onLoadIntoMacro(itemId, expectedRevision),
    onMutationDenied: (reason) => onMutationDenied(reason),
    onValidationText: (value) => { validationText = value },
  })

  const kind = $derived(session.kind)
  const searchText = $derived(session.searchText)
  const items = $derived(session.items)
  const selectedItem = $derived(session.selectedItem)
  const selectedKey = $derived(session.selectedKey)
  const draft = $derived(session.draft)
  const editing = $derived(session.editing)
  const editLease = $derived(session.editLease)
  const leaseView = $derived(session.leaseView)
  const publishedCreateBufferPreserved = $derived(session.publishedCreateBufferPreserved)
  const dirty = $derived(session.dirty)
  const operationPending = $derived(session.operationPending)
  const statusText = $derived(session.statusText)
  const errorText = $derived(session.errorText)
  const listProblem = $derived(session.listProblem)
  const remoteNotice = $derived(session.remoteNotice)
  const editorReadOnly = $derived(!editing || operationPending || !canMutateShared || (selectedItem !== null && editLease === null))

  onMount(session.mount)

  $effect(() => { onDirtyChange(dirty || publishedCreateBufferPreserved) })

  async function copyContent() {
    if (!draft) return
    try {
      await navigator.clipboard.writeText(draft.content)
      copyLabel = 'Copied'
      session.setErrorText(null)
      window.setTimeout(() => { copyLabel = 'Copy' }, 900)
    } catch {
      copyLabel = 'Copy'
      session.deny('clipboard_write_failed')
    }
  }

  function validateMacro() {
    if (!draft || kind !== 'macro-template') return
    const result = parseAndValidateMacroDefinitionJson(draft.content)
    if (result.ok) {
      const runnable = validateRunnableMacroDefinitionV5(result.value)
      const unassigned = runnable.ok ? [] : runnable.issues.filter((issue) => issue.code === 'unassigned_terminal_reference' || issue.code === 'unassigned_artifact_reference')
      validationText = unassigned.length > 0
        ? `Valid MacroDefinitionV5 · ${unassigned.length} unassigned reference${unassigned.length === 1 ? '' : 's'} (not runnable)\n${unassigned.map((issue) => issue.path).join('\n')}`
        : 'Valid MacroDefinitionV5 · runnable'
    } else validationText = formatLibraryMacroValidation(result)
    session.setErrorText(result.ok ? null : result.error.code)
  }

  const changeKind = session.changeKind
  const updateSearch = session.updateSearch
  const selectByKey = session.selectByKey
  const newItem = session.newItem
  const beginEdit = session.beginEdit
  const saveItem = session.saveItem
  const cancelEdit = session.cancelEdit
  const removeItem = session.removeItem
  const refreshLibrary = session.refreshLibrary
  const loadIntoMacro = session.loadIntoMacro
  const updateDraft = session.updateDraft
  const setTags = session.setTags
  const kindLabel = libraryKindLabel
</script>

<aside class="prompt-panel library-panel flex min-h-0 min-w-0 w-full flex-col gap-2 overflow-auto border border-base-300 bg-base-100 p-2 text-[13px] text-base-content shadow-sm [&_label]:grid [&_label]:min-w-0 [&_label]:gap-1 [&_label]:text-[11px] [&_label]:font-semibold" data-testid="library-panel" data-kind={kind} data-dirty={dirty} data-editing={editing}>
  <div class="prompt-header library-header sticky top-0 z-10 flex min-h-[38px] items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-2 py-[3px]">
    <div class="min-w-0"><h2 class="m-0 text-sm font-bold">Library</h2><p class="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-base-content/60" data-testid="library-status">{statusText}</p></div>
    <button class="btn btn-xs btn-ghost" type="button" data-testid="library-reset-width" onclick={() => onResetWidth?.()}>Reset width</button>
  </div>

  {#if errorText}<div class="prompt-error alert alert-error px-3 py-2 text-xs" role="alert" data-testid="library-error">{errorText}</div>{/if}
  {#if listProblem}<div class="prompt-error alert alert-error px-3 py-2 text-xs" role="alert" data-testid="library-list-problem">{listProblem}</div>{/if}
  {#if remoteNotice}<div class="prompt-notice alert alert-info px-3 py-2 text-xs" role="status" data-testid="library-remote-notice">{remoteNotice}</div>{/if}

  <nav class="library-kind-tabs tabs tabs-box grid grid-cols-3 gap-1 bg-base-200 p-1" data-testid="library-kind-tabs" aria-label="Library content kind">
    <button type="button" class="tab h-7 min-h-7 px-1.5 text-xs" class:active={kind === 'macro-template'} class:tab-active={kind === 'macro-template'} data-testid="library-tab-macro-template" aria-disabled={operationPending} onclick={() => void changeKind('macro-template')}>Macro JSON</button>
    <button type="button" class="tab h-7 min-h-7 px-1.5 text-xs" class:active={kind === 'prompt'} class:tab-active={kind === 'prompt'} data-testid="library-tab-prompt" aria-disabled={operationPending} onclick={() => void changeKind('prompt')}>Prompt</button>
    <button type="button" class="tab h-7 min-h-7 px-1.5 text-xs" class:active={kind === 'note'} class:tab-active={kind === 'note'} data-testid="library-tab-note" aria-disabled={operationPending} onclick={() => void changeKind('note')}>Note</button>
  </nav>

  <section class="prompt-section prompt-toolbar library-toolbar card grid gap-2 bg-base-200/60 p-2 shadow-sm" data-testid="library-toolbar" aria-busy={operationPending}>
    <label>Search
      <input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="library-search" value={searchText} oninput={(event) => updateSearch(event.currentTarget.value)} placeholder="title, description, tags, content" />
    </label>
    <label>{kindLabel(kind)}
      <select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="library-selector" value={selectedKey} aria-disabled={operationPending} onchange={(event) => void selectByKey(event.currentTarget.value)}>
        <option value="">{items.length === 0 ? 'No items found' : 'Select item'}</option>
        {#each items as item (item.kind + ':' + item.itemId)}
          <option data-testid="library-list-item" value={item.kind + ':' + item.itemId}>{item.title}{item.tags.length ? ' · ' + item.tags.join(', ') : ''}</option>
        {/each}
      </select>
    </label>
    <div class="prompt-editor-actions library-actions flex flex-wrap items-center gap-1" data-testid="library-actions">
      <button class="btn btn-xs btn-primary !pointer-events-auto aria-disabled:cursor-not-allowed" type="button" data-testid="library-new" onclick={() => void newItem()} aria-disabled={!canMutateShared || operationPending}>New</button>
      <button class="btn btn-xs btn-primary !pointer-events-auto aria-disabled:cursor-not-allowed" type="button" data-testid="library-edit" onclick={() => void beginEdit()} aria-disabled={!canMutateShared || !selectedItem || operationPending}>Edit</button>
      <button class="btn btn-xs btn-success !pointer-events-auto aria-disabled:cursor-not-allowed" type="button" data-testid="library-save" onclick={() => void saveItem()} aria-disabled={!canMutateShared || !draft || operationPending}>{operationPending ? 'Working…' : 'Save'}</button>
      <button class="btn btn-xs btn-ghost" type="button" data-testid="library-cancel" onclick={() => void cancelEdit()} disabled={!draft || operationPending}>{publishedCreateBufferPreserved ? 'Discard local copy' : editing ? selectedItem ? dirty ? 'Cancel' : 'Done' : 'Discard' : 'Cancel'}</button>
      <button class="btn btn-xs btn-ghost" type="button" data-testid="library-copy" onclick={() => void copyContent()} disabled={!draft}>{copyLabel}</button>
      {#if kind === 'macro-template'}<button class="btn btn-xs btn-secondary !pointer-events-auto aria-disabled:cursor-not-allowed" type="button" data-testid="library-load-into-macro" onclick={() => void loadIntoMacro()} aria-disabled={!canMutateShared || !selectedItem || operationPending}>Load into Macro</button>{/if}
      <button class="btn btn-xs btn-error !pointer-events-auto aria-disabled:cursor-not-allowed" type="button" data-testid="library-remove" onclick={() => void removeItem()} aria-disabled={!canMutateShared || !selectedItem || operationPending}>Remove</button>
      <button class="btn btn-xs btn-ghost" type="button" data-testid="library-refresh" onclick={() => void refreshLibrary()} disabled={operationPending}>Refresh</button>
    </div>
  </section>

  <section class="prompt-section prompt-editor library-editor card grid gap-2 bg-base-200/60 p-2 shadow-sm" data-testid="library-editor" aria-busy={operationPending}>
    <div class="prompt-section-title flex items-center justify-between gap-2"><h3 class="m-0 text-[13px] font-bold">{editing ? 'Edit' : 'View'}</h3>{#if dirty}<span class="badge badge-warning badge-sm" data-testid="library-dirty">unsaved</span>{/if}</div>
    {#if draft}
      <label>Title
        <input class="input box-border input-xs input-ghost w-full bg-base-content/15 read-only:cursor-not-allowed read-only:text-base-content/60" data-testid="library-title" value={draft.title} readonly={editorReadOnly} oninput={(event) => updateDraft('title', event.currentTarget.value)} />
      </label>
      <label>Description
        <input class="input box-border input-xs input-ghost w-full bg-base-content/15 read-only:cursor-not-allowed read-only:text-base-content/60" data-testid="library-description" value={draft.description} readonly={editorReadOnly} oninput={(event) => updateDraft('description', event.currentTarget.value)} />
      </label>
      <label>Tags
        <input class="input box-border input-xs input-ghost w-full bg-base-content/15 read-only:cursor-not-allowed read-only:text-base-content/60" data-testid="library-tags" value={draft.tags.join(', ')} readonly={editorReadOnly} oninput={(event) => setTags(event.currentTarget.value)} placeholder="review, reusable" />
      </label>
      <div class="library-content-label text-[11px] font-semibold">Content</div>
      <div class:library-json-editor={kind === 'macro-template'}>
        <LineNumberedTextarea testId="library-content" value={draft.content} maxRows={24} ariaLabel={`${kindLabel(kind)} content`}
          showLineNumbers={kind === 'macro-template'} readOnly={editorReadOnly} disabled={operationPending}
          onInput={(value) => updateDraft('content', value)} />
      </div>
      {#if kind === 'macro-template'}
        <div class="prompt-editor-actions library-macro-actions flex justify-end">
          <button class="btn btn-xs btn-primary" type="button" data-testid="library-validate" onclick={validateMacro}>Validate</button>
        </div>
        {#if validationText}<pre class="library-validation m-0 max-h-[180px] overflow-auto rounded-field border border-base-300 bg-base-200 p-2 font-mono text-xs whitespace-pre-wrap" data-testid="library-validation" role="status">{validationText}</pre>{/if}
      {/if}
      {#if leaseView}<small class="badge badge-sm badge-soft text-[10px]" data-testid="library-lease-status">Lease {leaseView.mode} · epoch {leaseView.leaseEpoch}</small>{/if}
    {:else}
      <p class="empty-text m-0 text-xs text-base-content/60">Select or create a {kindLabel(kind)} item.</p>
    {/if}
  </section>
</aside>
