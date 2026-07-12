<script lang="ts">
  import type { RunLogUpdatedMessage, TerminalIndexMapItem, TerminalSnapshot } from '../protocol'
  import { MacroTemplateClient } from '../macro/macroTemplateClient'
  import { parseMacroJsonDraft } from '../macro/macroJsonDraft'
  import { MacroRunnerClient } from '../macro/macroRunnerClient'
  import type { ProfileCatalogSummary } from '../macro/profileCatalogSummary'
  import { validateMacroTemplate } from '../macro/templateSchema'
  import type { MacroRunnerSnapshot } from '../macro/runnerTypes'
  import type { MacroTemplate, TemplateSummary } from '../macro/templateTypes'
  import MacroEditorShell from './macro/MacroEditorShell.svelte'
  import MacroJsonView from './macro/MacroJsonView.svelte'
  import MacroTraceView from './macro/MacroTraceView.svelte'
  import MacroWorkbenchChrome from './macro/MacroWorkbenchChrome.svelte'
  import type { MacroInsertionPaletteMode } from '../workspace/uiLayoutTypes'

  type MacroView = 'editor' | 'json' | 'trace'
  type LockSensitiveOperation = {
    generation: number
    configId: string
    selectedTemplateId: string | null
    draftId: string | null
    draftRevision: number
  }
  type JsonEditSession = {
    generation: number
    configId: string
    templateId: string
  }

  let { configId, terminals, indexMap, insertionPaletteMode, onResetWidth, runLogRefreshToken = 0, runLogRefreshEvent = null } = $props<{
    configId: string
    terminals: TerminalSnapshot[]
    indexMap: TerminalIndexMapItem[]
    insertionPaletteMode: MacroInsertionPaletteMode
    onResetWidth?: () => void
    runLogRefreshToken?: number
    runLogRefreshEvent?: RunLogUpdatedMessage | null
  }>()

  let loadedConfigId = $state('')
  let catalog = $state<ProfileCatalogSummary | null>(null)
  let templates = $state<TemplateSummary[]>([])
  let draft = $state<MacroTemplate | null>(null)
  let selectedTemplateId = $state<string | null>(null)
  let templateSearch = $state('')
  let statusText = $state('')
  let errorText = $state<string | null>(null)
  let macroView = $state<MacroView>('editor')
  let runner = $state<MacroRunnerSnapshot | null>(null)
  let runnerInput = $state('')
  let runnerInputKey = $state('')
  let telegramProfileIds = $state<string[]>([])
  let telegramProfilesError = $state('')
  let jsonEditing = $state(false)
  let jsonSaving = $state(false)
  let jsonEditText = $state('')
  let jsonEditTemplateId = $state('')
  let jsonEditConfigId = $state('')
  let jsonEditError = $state<string | null>(null)
  let jsonEditGeneration = $state(0)
  let lockSensitiveGeneration = $state(0)
  let lockSensitivePendingCount = $state(0)
  let draftRevision = $state(0)

  const validation = $derived(draft ? validateMacroTemplate(draft, { indexMap, terminals }) : { ok: true, issues: [] })
  const jsonPreview = $derived(draft ? JSON.stringify(draft, null, 2) : '')
  const filteredTemplates = $derived(templates.filter((template) => !templateSearch.trim() || template.name.toLowerCase().includes(templateSearch.trim().toLowerCase()) || template.id.toLowerCase().includes(templateSearch.trim().toLowerCase())))
  const selectedTemplateName = $derived(templates.find((template) => template.id === selectedTemplateId)?.name ?? draft?.name ?? null)
  const lockSensitiveOperationPending = $derived(lockSensitivePendingCount > 0)

  $effect(() => {
    if (loadedConfigId !== configId) {
      clearJsonEdit()
      loadedConfigId = configId
      void reloadAll()
    }
  })

  $effect(() => {
    const waiting = runner?.waitingInput
    const nextKey = waiting ? (runner?.runId ?? '') + ':' + waiting.stepId : ''
    if (nextKey !== runnerInputKey) {
      runnerInputKey = nextKey
      runnerInput = waiting?.defaultText ?? ''
    }
  })

  function runnerClient() {
    return new MacroRunnerClient(configId)
  }

  async function reloadAll() {
    const operation = beginLockSensitiveOperation()
    const templateApi = new MacroTemplateClient(operation.configId)
    const runApi = new MacroRunnerClient(operation.configId)
    errorText = null
    statusText = 'Loading templates'
    try {
      const nextCatalog = await templateApi.profileCatalog()
      if (!canCommitLockSensitiveOperation(operation)) return

      let nextTelegramProfileIds: string[] = []
      let nextTelegramProfilesError = ''
      try {
        nextTelegramProfileIds = await loadTelegramProfileIds()
      } catch (error) {
        nextTelegramProfilesError = messageOf(error)
      }
      if (!canCommitLockSensitiveOperation(operation)) return

      const nextTemplates = await templateApi.list()
      if (!canCommitLockSensitiveOperation(operation)) return
      const nextSelectedTemplateId = operation.selectedTemplateId && nextTemplates.some((item) => item.id === operation.selectedTemplateId)
        ? operation.selectedTemplateId
        : nextTemplates[0]?.id ?? null
      const nextDraft = nextSelectedTemplateId ? await templateApi.read(nextSelectedTemplateId) : null
      if (!canCommitLockSensitiveOperation(operation)) return
      const nextRunner = await runApi.snapshot()
      if (!canCommitLockSensitiveOperation(operation)) return

      catalog = nextCatalog
      telegramProfileIds = nextTelegramProfileIds
      telegramProfilesError = nextTelegramProfilesError
      templates = nextTemplates
      selectedTemplateId = nextSelectedTemplateId
      replaceDraft(nextDraft)
      runner = nextRunner
      statusText = 'Ready'
    } catch (error) {
      if (!canCommitLockSensitiveOperation(operation)) return
      errorText = messageOf(error)
      statusText = 'Load failed'
    } finally {
      finishLockSensitiveOperation()
    }
  }

  async function createTemplate() {
    if (blockForLockSensitiveOperation('creating a template')) return
    const operation = beginLockSensitiveOperation()
    const api = new MacroTemplateClient(operation.configId)
    errorText = null
    try {
      const nextDraft = await api.create()
      if (!canCommitLockSensitiveOperation(operation)) return
      const nextTemplates = await api.list()
      if (!canCommitLockSensitiveOperation(operation)) return
      replaceDraft(nextDraft)
      selectedTemplateId = nextDraft.id
      templates = nextTemplates
      statusText = 'Template created'
    } catch (error) {
      if (!canCommitLockSensitiveOperation(operation)) return
      errorText = messageOf(error)
    } finally {
      finishLockSensitiveOperation()
    }
  }

  async function selectTemplate(templateId: string) {
    if (blockForLockSensitiveOperation('selecting another template')) return
    const operation = beginLockSensitiveOperation()
    const api = new MacroTemplateClient(operation.configId)
    errorText = null
    try {
      const nextDraft = await api.read(templateId)
      if (!canCommitLockSensitiveOperation(operation)) return
      selectedTemplateId = templateId
      replaceDraft(nextDraft)
      statusText = 'Template loaded'
    } catch (error) {
      if (!canCommitLockSensitiveOperation(operation)) return
      errorText = messageOf(error)
    } finally {
      finishLockSensitiveOperation()
    }
  }

  async function saveTemplate() {
    if (blockForLockSensitiveOperation('saving the visual draft')) return
    if (!draft) return
    if (!validation.ok) {
      errorText = 'Fix validation errors before save.'
      return
    }
    const operation = beginLockSensitiveOperation()
    const api = new MacroTemplateClient(operation.configId)
    const template = cloneTemplate(draft)
    errorText = null
    try {
      const nextDraft = await api.save(template)
      if (!canCommitLockSensitiveOperation(operation)) return
      const nextTemplates = await api.list()
      if (!canCommitLockSensitiveOperation(operation)) return
      replaceDraft(nextDraft)
      templates = nextTemplates
      statusText = 'Saved'
    } catch (error) {
      if (!canCommitLockSensitiveOperation(operation)) return
      errorText = messageOf(error)
    } finally {
      finishLockSensitiveOperation()
    }
  }

  async function duplicateTemplate() {
    if (blockForLockSensitiveOperation('duplicating the template')) return
    if (!draft) return
    const operation = beginLockSensitiveOperation()
    const api = new MacroTemplateClient(operation.configId)
    const templateId = draft.id
    errorText = null
    try {
      const nextDraft = await api.duplicate(templateId)
      if (!canCommitLockSensitiveOperation(operation)) return
      const nextTemplates = await api.list()
      if (!canCommitLockSensitiveOperation(operation)) return
      replaceDraft(nextDraft)
      selectedTemplateId = nextDraft.id
      templates = nextTemplates
      statusText = 'Duplicated'
    } catch (error) {
      if (!canCommitLockSensitiveOperation(operation)) return
      errorText = messageOf(error)
    } finally {
      finishLockSensitiveOperation()
    }
  }

  async function deleteTemplate() {
    if (blockForLockSensitiveOperation('deleting the template')) return
    if (!draft) return
    if (!window.confirm('Delete macro template "' + draft.name + '"?')) {
      statusText = 'Delete cancelled'
      return
    }
    const operation = beginLockSensitiveOperation()
    const api = new MacroTemplateClient(operation.configId)
    const templateId = draft.id
    errorText = null
    try {
      await api.delete(templateId)
      if (!canCommitLockSensitiveOperation(operation)) return
      const nextTemplates = await api.list()
      if (!canCommitLockSensitiveOperation(operation)) return
      selectedTemplateId = null
      replaceDraft(null)
      templates = nextTemplates
      statusText = 'Deleted'
    } catch (error) {
      if (!canCommitLockSensitiveOperation(operation)) return
      errorText = messageOf(error)
    } finally {
      finishLockSensitiveOperation()
    }
  }

  async function exportTemplate() {
    if (blockForLockSensitiveOperation('exporting the template')) return
    if (!draft) return
    const operation = beginLockSensitiveOperation()
    const api = new MacroTemplateClient(operation.configId)
    const templateId = draft.id
    errorText = null
    try {
      const exported = await api.exportTemplate(templateId)
      if (!canCommitLockSensitiveOperation(operation)) return
      const blob = new Blob([JSON.stringify(exported, null, 2) + '\n'], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = exported.id + '.json'
      link.click()
      URL.revokeObjectURL(link.href)
      statusText = 'Exported'
    } catch (error) {
      if (!canCommitLockSensitiveOperation(operation)) return
      errorText = messageOf(error)
    } finally {
      finishLockSensitiveOperation()
    }
  }

  async function importTemplate(event: Event) {
    if (blockForLockSensitiveOperation('importing a template')) return
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const operation = beginLockSensitiveOperation()
    const api = new MacroTemplateClient(operation.configId)
    errorText = null
    try {
      const imported = JSON.parse(await file.text())
      if (!canCommitLockSensitiveOperation(operation)) return
      const nextDraft = await api.importTemplate(imported)
      if (!canCommitLockSensitiveOperation(operation)) return
      const nextTemplates = await api.list()
      if (!canCommitLockSensitiveOperation(operation)) return
      replaceDraft(nextDraft)
      selectedTemplateId = nextDraft.id
      templates = nextTemplates
      statusText = 'Imported'
    } catch (error) {
      if (!canCommitLockSensitiveOperation(operation)) return
      errorText = messageOf(error)
    } finally {
      finishLockSensitiveOperation()
      input.value = ''
    }
  }

  async function loadTelegramProfileIds(): Promise<string[]> {
    const response = await fetch('/api/notification-profiles/telegram')
    if (!response.ok) throw new Error('telegram_profiles_load_failed')
    const body = await response.json() as { ok?: boolean; error?: unknown; profiles?: Array<{ profileId?: unknown }> }
    if (body.ok === false) throw new Error(typeof body.error === 'string' ? body.error : 'telegram_profiles_unavailable')
    return (body.profiles ?? []).flatMap((profile) => typeof profile.profileId === 'string' ? [profile.profileId] : [])
  }

  function updateDraft(mutator: (template: MacroTemplate) => void) {
    if (blockForJsonEdit('editing the visual draft')) return
    if (lockSensitiveOperationPending) {
      draftRevision += 1
      blockForPendingOperation('editing the visual draft')
      return
    }
    if (!draft) return
    const next = cloneTemplate(draft)
    mutator(next)
    replaceDraft(next)
  }

  async function macroControl(action: 'start' | 'pause' | 'resume' | 'stop') {
    if (action === 'start' && blockForLockSensitiveOperation('starting the runner')) return
    errorText = null
    if (action === 'start' && !draft) {
      statusText = 'Create or select a template first'
      return
    }
    if (action === 'start' && !validation.ok) {
      errorText = 'Fix validation errors before start.'
      statusText = 'Start blocked'
      return
    }
    if (action === 'start' && draft) {
      const operation = beginLockSensitiveOperation()
      const templateApi = new MacroTemplateClient(operation.configId)
      const runApi = new MacroRunnerClient(operation.configId)
      const template = cloneTemplate(draft)
      try {
        const nextDraft = await templateApi.save(template)
        if (!canCommitLockSensitiveOperation(operation)) return
        const nextTemplates = await templateApi.list()
        if (!canCommitLockSensitiveOperation(operation)) return
        const nextRunner = await runApi.start({ templateId: nextDraft.id })
        if (!canCommitLockSensitiveOperation(operation)) return
        replaceDraft(nextDraft)
        selectedTemplateId = nextDraft.id
        templates = nextTemplates
        runner = nextRunner
        statusText = 'Runner ' + runner.status
        refreshRunnerSoon()
      } catch (error) {
        if (!canCommitLockSensitiveOperation(operation)) return
        errorText = messageOf(error)
        statusText = 'Runner start failed'
      } finally {
        finishLockSensitiveOperation()
      }
      return
    }

    try {
      const api = runnerClient()
      if (action === 'pause') runner = await api.pause()
      if (action === 'resume') runner = await api.resume()
      if (action === 'stop') runner = await api.stop()
      statusText = 'Runner ' + (runner?.status ?? action)
      if (action === 'resume') refreshRunnerSoon()
    } catch (error) {
      errorText = messageOf(error)
      statusText = 'Runner ' + action + ' failed'
    }
  }

  function refreshRunnerSoon(attempt = 0) {
    const isLiveRefreshStatus = runner?.status === 'running' || runner?.status === 'waiting'
    if (!isLiveRefreshStatus || attempt > 130) return
    const delayMs = attempt < 10 ? 100 : 1000
    window.setTimeout(async () => {
      await refreshRunner()
      refreshRunnerSoon(attempt + 1)
    }, delayMs)
  }

  async function submitRunnerInput() {
    errorText = null
    try {
      runner = await runnerClient().submitInput({ text: runnerInput })
      runnerInput = ''
      runnerInputKey = ''
      statusText = 'Runner ' + runner.status
      refreshRunnerSoon()
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function refreshRunner() {
    errorText = null
    try {
      runner = await runnerClient().snapshot()
      statusText = 'Runner ' + runner.status
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  function messageOf(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }

  function startJsonEdit() {
    if (!draft) return
    if (blockForPendingOperation('editing JSON')) return
    lockSensitiveGeneration += 1
    jsonEditGeneration += 1
    jsonEditText = jsonPreview
    jsonEditTemplateId = draft.id
    jsonEditConfigId = configId
    jsonEditError = null
    errorText = null
    jsonEditing = true
    statusText = 'Editing JSON'
  }

  async function saveJsonEdit() {
    if (!jsonEditing || jsonSaving) return
    const parsed = parseMacroJsonDraft(jsonEditText, {
      templateId: jsonEditTemplateId,
      configId: jsonEditConfigId,
      indexMap,
      terminals,
    })
    if (!parsed.ok) {
      jsonEditError = parsed.error
      statusText = 'JSON save blocked'
      return
    }
    if (jsonEditConfigId !== configId) {
      jsonEditError = 'The active config changed. Cancel this JSON edit and try again.'
      statusText = 'JSON save blocked'
      return
    }

    const session: JsonEditSession = {
      generation: jsonEditGeneration,
      configId: jsonEditConfigId,
      templateId: jsonEditTemplateId,
    }
    const api = new MacroTemplateClient(session.configId)
    jsonSaving = true
    jsonEditError = null
    errorText = null
    try {
      const nextDraft = await api.save(parsed.template)
      if (!isCurrentJsonEditSession(session)) return
      const nextTemplates = await api.list()
      if (!isCurrentJsonEditSession(session)) return
      replaceDraft(nextDraft)
      selectedTemplateId = nextDraft.id
      templates = nextTemplates
      clearJsonEdit()
      statusText = 'JSON saved'
    } catch (error) {
      if (!isCurrentJsonEditSession(session)) return
      jsonEditError = messageOf(error)
      statusText = 'JSON save failed'
    } finally {
      if (isCurrentJsonEditSession(session)) jsonSaving = false
    }
  }

  function cancelJsonEdit() {
    if (jsonSaving) return
    clearJsonEdit()
    statusText = 'JSON edit cancelled'
  }

  function clearJsonEdit() {
    jsonEditGeneration += 1
    jsonEditing = false
    jsonSaving = false
    jsonEditText = ''
    jsonEditTemplateId = ''
    jsonEditConfigId = ''
    jsonEditError = null
  }

  function changeMacroView(view: MacroView) {
    if (jsonEditing && view !== 'json') {
      blockForJsonEdit('switching Macro views')
      return
    }
    macroView = view
  }

  function blockForJsonEdit(action: string): boolean {
    if (!jsonEditing) return false
    jsonEditError = 'Save or Cancel JSON editing before ' + action + '.'
    statusText = 'JSON edit locked'
    return true
  }

  function blockForPendingOperation(action: string): boolean {
    if (!lockSensitiveOperationPending) return false
    errorText = 'Wait for the pending template operation before ' + action + '.'
    statusText = 'Template operation pending'
    return true
  }

  function blockForLockSensitiveOperation(action: string): boolean {
    return blockForJsonEdit(action) || blockForPendingOperation(action)
  }

  function beginLockSensitiveOperation(): LockSensitiveOperation {
    lockSensitiveGeneration += 1
    lockSensitivePendingCount += 1
    return {
      generation: lockSensitiveGeneration,
      configId,
      selectedTemplateId,
      draftId: draft?.id ?? null,
      draftRevision,
    }
  }

  function finishLockSensitiveOperation() {
    lockSensitivePendingCount = Math.max(0, lockSensitivePendingCount - 1)
  }

  function canCommitLockSensitiveOperation(operation: LockSensitiveOperation): boolean {
    return operation.generation === lockSensitiveGeneration
      && operation.configId === configId
      && operation.selectedTemplateId === selectedTemplateId
      && operation.draftId === (draft?.id ?? null)
      && operation.draftRevision === draftRevision
      && !jsonEditing
  }

  function isCurrentJsonEditSession(session: JsonEditSession): boolean {
    return jsonEditing
      && session.generation === jsonEditGeneration
      && session.configId === configId
      && session.configId === jsonEditConfigId
      && session.templateId === jsonEditTemplateId
  }

  function cloneTemplate(template: MacroTemplate): MacroTemplate {
    return JSON.parse(JSON.stringify(template)) as MacroTemplate
  }

  function replaceDraft(nextDraft: MacroTemplate | null) {
    draft = nextDraft
    draftRevision += 1
  }
</script>

<aside class="macro-panel" data-testid="macro-panel">
  <MacroWorkbenchChrome
    {templates}
    {filteredTemplates}
    {draft}
    {selectedTemplateId}
    {selectedTemplateName}
    {templateSearch}
    {errorText}
    {macroView}
    {runner}
    {statusText}
    {jsonEditing}
    operationPending={lockSensitiveOperationPending}
    {runnerInput}
    onTemplateSearchChange={(value) => { templateSearch = value }}
    onSelectTemplate={selectTemplate}
    onCreateTemplate={createTemplate}
    onSaveTemplate={saveTemplate}
    onDuplicateTemplate={duplicateTemplate}
    onImportTemplate={importTemplate}
    onExportTemplate={exportTemplate}
    onDeleteTemplate={deleteTemplate}
    onUpdateDraft={updateDraft}
    onResetWidth={onResetWidth}
    onRunnerInputChange={(value) => { runnerInput = value }}
    onSubmitRunnerInput={submitRunnerInput}
    onRefreshRunner={refreshRunner}
    onMacroControl={macroControl}
    onViewChange={changeMacroView}
  />

  {#if macroView === 'trace'}
    <MacroTraceView {configId} refreshToken={runLogRefreshToken} refreshEvent={runLogRefreshEvent} templateId={selectedTemplateId} templateName={selectedTemplateName} />
  {:else if macroView === 'editor'}
    <MacroEditorShell {draft} {terminals} {indexMap} {validation} {insertionPaletteMode} {telegramProfileIds} {telegramProfilesError} locked={lockSensitiveOperationPending} onUpdateDraft={updateDraft} />
  {:else}
    <MacroJsonView
      {draft}
      {jsonPreview}
      editing={jsonEditing}
      saving={jsonSaving}
      editText={jsonEditText}
      editError={jsonEditError}
      operationPending={lockSensitiveOperationPending}
      onStartEdit={startJsonEdit}
      onEditTextChange={(value) => { jsonEditText = value; jsonEditError = null }}
      onSave={saveJsonEdit}
      onCancel={cancelJsonEdit}
      onExportTemplate={exportTemplate}
    />
  {/if}
</aside>
