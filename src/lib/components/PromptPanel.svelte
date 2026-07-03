<script lang="ts">
  import type { PromptUpdatedMessage } from '../protocol'
  import { PromptClient } from '../prompts/promptClient'
  import type { PromptRecord, PromptScope, PromptScopeFilter, PromptSummary } from '../prompts/promptTypes'

  let { configId, refreshToken = 0, refreshEvent = null, onResetWidth } = $props<{
    configId: string
    refreshToken?: number
    refreshEvent?: PromptUpdatedMessage | null
    onResetWidth?: () => void
  }>()

  type PromptDraft = Omit<PromptRecord, 'promptId' | 'createdAt' | 'updatedAt'> & {
    promptId?: string
    createdAt?: string
    updatedAt?: string
  }

  let loadedConfigId = $state('')
  let seenRefreshToken = $state(-1)
  let prompts = $state<PromptSummary[]>([])
  let selectedPromptId = $state<string | null>(null)
  let selectedScope = $state<PromptScope>('project')
  let scopeFilter = $state<PromptScopeFilter>('all')
  let searchText = $state('')
  let draft = $state<PromptDraft | null>(null)
  let dirty = $state(false)
  let statusText = $state('')
  let errorText = $state<string | null>(null)
  let remoteNotice = $state<string | null>(null)

  const selectedSummary = $derived(prompts.find((prompt) => prompt.promptId === selectedPromptId && prompt.scope === selectedScope) ?? null)
  const selectedPromptKey = $derived(selectedSummary ? promptKey(selectedSummary) : '')

  $effect(() => {
    if (loadedConfigId !== configId) {
      loadedConfigId = configId
      selectedPromptId = null
      draft = null
      dirty = false
      seenRefreshToken = refreshToken
      void reloadList()
    }
  })

  $effect(() => {
    const token = refreshToken
    if (loadedConfigId !== configId || token === seenRefreshToken) return
    seenRefreshToken = token
    void refreshAfterRemoteUpdate(refreshEvent)
  })

  function api() {
    return new PromptClient(configId)
  }

  async function reloadList() {
    errorText = null
    try {
      prompts = await api().list(scopeFilter, searchText)
      statusText = prompts.length + ' prompts'
      remoteNotice = null
      if (selectedPromptId && !prompts.some((prompt) => prompt.promptId === selectedPromptId && prompt.scope === selectedScope)) {
        selectedPromptId = null
        draft = null
        dirty = false
      }
    } catch (error) {
      errorText = messageOf(error)
      statusText = 'Load failed'
    }
  }

  async function refreshAfterRemoteUpdate(event: PromptUpdatedMessage | null) {
    if (dirty) {
      remoteNotice = 'Remote prompt changes are available. Save or discard your draft before refresh.'
      return
    }
    const currentPromptId = selectedPromptId
    const currentScope = selectedScope
    errorText = null
    try {
      const visiblePrompts = await api().list(scopeFilter, searchText)
      prompts = visiblePrompts
      statusText = prompts.length + ' prompts'
      remoteNotice = null
      if (!currentPromptId) return
      const allPrompts = await api().list('all', '')
      let targetScope = currentScope
      let currentSummary = allPrompts.find((prompt) => prompt.promptId === currentPromptId && prompt.scope === currentScope)
      const isSelectedScopeMove = event?.action === 'moved'
        && event.promptId === currentPromptId
        && event.oldScope === currentScope
        && Boolean(event.newScope)
      if (!currentSummary && isSelectedScopeMove) {
        targetScope = event.newScope as PromptScope
        currentSummary = allPrompts.find((prompt) => prompt.promptId === currentPromptId && prompt.scope === targetScope)
      }
      if (!currentSummary) {
        selectedPromptId = null
        draft = null
        dirty = false
        statusText = 'Prompt removed'
        return
      }
      draft = await api().read(targetScope, currentPromptId)
      selectedPromptId = currentPromptId
      selectedScope = targetScope
      dirty = false
      statusText = 'Prompt refreshed'
    } catch (error) {
      if (currentPromptId) {
        selectedPromptId = null
        draft = null
        dirty = false
      }
      errorText = messageOf(error)
      statusText = 'Load failed'
    }
  }

  function promptKey(prompt: Pick<PromptSummary, 'scope' | 'promptId'>): string {
    return prompt.scope + ':' + prompt.promptId
  }

  async function selectPromptByKey(key: string) {
    const prompt = prompts.find((item) => promptKey(item) === key)
    if (prompt) await selectPrompt(prompt)
  }

  async function selectPrompt(prompt: PromptSummary) {
    if (dirty && !window.confirm('Discard unsaved prompt draft?')) return
    errorText = null
    try {
      selectedPromptId = prompt.promptId
      selectedScope = prompt.scope
      draft = await api().read(prompt.scope, prompt.promptId)
      dirty = false
      statusText = 'Prompt loaded'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  function createPrompt(scope: PromptScope) {
    selectedPromptId = null
    selectedScope = scope
    draft = {
      schemaVersion: 1,
      scope,
      configId: scope === 'project' ? configId : undefined,
      title: 'New Prompt',
      body: '',
      tags: [],
      description: '',
    }
    dirty = true
    statusText = 'Draft created'
    remoteNotice = null
  }

  function updateDraft(mutator: (prompt: PromptDraft) => void) {
    if (!draft) return
    const next = { ...draft, tags: [...(draft.tags ?? [])] }
    mutator(next)
    if (next.scope === 'project') next.configId = configId
    if (next.scope === 'global') delete next.configId
    draft = next
    dirty = true
  }

  async function savePrompt() {
    if (!draft) return
    if (!draft.title.trim()) {
      errorText = 'Prompt title is required.'
      return
    }
    errorText = null
    try {
      const saved = draft.promptId
        ? await api().save(draft as PromptRecord, selectedScope)
        : await api().create(draft.scope, draft)
      draft = saved
      selectedPromptId = saved.promptId
      selectedScope = saved.scope
      dirty = false
      statusText = 'Saved'
      if (scopeFilter !== 'all' && scopeFilter !== saved.scope) scopeFilter = saved.scope
      await reloadList()
      draft = saved
      selectedPromptId = saved.promptId
      selectedScope = saved.scope
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function deletePrompt() {
    if (!draft?.promptId) return
    const scopeLabel = selectedScope === 'global' ? 'global' : 'project'
    if (!window.confirm('Delete ' + scopeLabel + ' prompt "' + draft.title + '"?')) {
      statusText = 'Delete cancelled'
      return
    }
    errorText = null
    try {
      await api().delete(selectedScope, draft.promptId)
      selectedPromptId = null
      draft = null
      dirty = false
      statusText = 'Deleted'
      await reloadList()
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function copyPrompt() {
    if (!draft) return
    await navigator.clipboard.writeText(draft.body)
    statusText = 'Copied'
  }

  function tagsText(prompt: PromptDraft): string {
    return (prompt.tags ?? []).join(', ')
  }

  function setTags(value: string) {
    updateDraft((prompt) => {
      prompt.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean)
    })
  }

  function messageOf(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
</script>

<aside class="prompt-panel" data-testid="prompt-panel">
  <div class="prompt-header">
    <div>
      <h2>Prompts</h2>
      <p>{statusText || 'Prompt library'}</p>
    </div>
    <button type="button" data-testid="prompt-reset-width" onclick={() => onResetWidth?.()}>Reset width</button>
  </div>

  {#if errorText}
    <div class="prompt-error" role="alert">{errorText}</div>
  {/if}
  {#if remoteNotice}
    <div class="prompt-notice" role="status">{remoteNotice}</div>
  {/if}

  <section class="prompt-section prompt-toolbar" data-testid="prompt-toolbar">
    <label>Scope
      <select data-testid="prompt-scope-filter" bind:value={scopeFilter} onchange={reloadList}>
        <option value="all">All</option>
        <option value="project">Project</option>
        <option value="global">Global</option>
      </select>
    </label>
    <label>Search
      <input data-testid="prompt-search" bind:value={searchText} oninput={reloadList} placeholder="title, body, tag" />
    </label>
    <label class="prompt-selector-label">Prompt
      <select data-testid="prompt-selector" value={selectedPromptKey} onchange={(event) => selectPromptByKey(event.currentTarget.value)}>
        <option value="">{prompts.length === 0 ? 'No prompts found' : 'Select prompt'}</option>
        {#each prompts as prompt (prompt.scope + ':' + prompt.promptId)}
          <option data-testid="prompt-list-item" value={promptKey(prompt)}>{prompt.title} · {prompt.scope}{#if prompt.tags?.length} · {prompt.tags.join(', ')}{/if}</option>
        {/each}
      </select>
    </label>
    <div class="prompt-editor-actions prompt-toolbar-actions" data-testid="prompt-actions">
      <button type="button" data-testid="prompt-new-project" onclick={() => createPrompt('project')}>New project</button>
      <button type="button" data-testid="prompt-new-global" onclick={() => createPrompt('global')}>New global</button>
      <button type="button" data-testid="prompt-save" onclick={savePrompt} disabled={!draft}>Save</button>
      <button type="button" data-testid="prompt-copy" onclick={copyPrompt} disabled={!draft}>Copy</button>
      <button type="button" data-testid="prompt-delete" onclick={deletePrompt} disabled={!draft?.promptId}>Delete</button>
    </div>
  </section>

  <section class="prompt-section prompt-editor" data-testid="prompt-editor">
    <div class="prompt-section-title">
      <h3>Edit</h3>
      {#if dirty}<span>unsaved</span>{/if}
    </div>
    {#if draft}
      <label>Scope
        <select data-testid="prompt-edit-scope" value={draft.scope} onchange={(event) => updateDraft((prompt) => { prompt.scope = event.currentTarget.value as PromptScope })}>
          <option value="project">Project</option>
          <option value="global">Global</option>
        </select>
      </label>
      <label>Title
        <input data-testid="prompt-title" value={draft.title} oninput={(event) => updateDraft((prompt) => { prompt.title = event.currentTarget.value })} />
      </label>
      <label>Tags
        <input data-testid="prompt-tags" value={tagsText(draft)} oninput={(event) => setTags(event.currentTarget.value)} placeholder="review, fix" />
      </label>
      <label>Body
        <textarea data-testid="prompt-body" value={draft.body} oninput={(event) => updateDraft((prompt) => { prompt.body = event.currentTarget.value })}></textarea>
      </label>
      {#if draft.body.trim().length === 0}<p class="hint">Prompt body is empty.</p>{/if}

    {:else}
      <p class="empty-text">Select or create a prompt.</p>
    {/if}
  </section>
</aside>
