<script lang="ts">
  import type { RunLogUpdatedMessage, TerminalIndexMapItem, TerminalSnapshot } from '../protocol'
  import { MacroTemplateClient } from '../macro/macroTemplateClient'
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

  const validation = $derived(draft ? validateMacroTemplate(draft, { indexMap, terminals }) : { ok: true, issues: [] })
  const jsonPreview = $derived(draft ? JSON.stringify(draft, null, 2) : '')
  const filteredTemplates = $derived(templates.filter((template) => !templateSearch.trim() || template.name.toLowerCase().includes(templateSearch.trim().toLowerCase()) || template.id.toLowerCase().includes(templateSearch.trim().toLowerCase())))
  const selectedTemplateName = $derived(templates.find((template) => template.id === selectedTemplateId)?.name ?? draft?.name ?? null)

  $effect(() => {
    if (loadedConfigId !== configId) {
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

  function client() {
    return new MacroTemplateClient(configId)
  }

  function runnerClient() {
    return new MacroRunnerClient(configId)
  }

  async function reloadAll() {
    errorText = null
    statusText = 'Loading templates'
    try {
      const api = client()
      catalog = await api.profileCatalog()
      await refreshTelegramProfileIds()
      templates = await api.list()
      if (selectedTemplateId && templates.some((item) => item.id === selectedTemplateId)) {
        draft = await api.read(selectedTemplateId)
      } else if (templates[0]) {
        selectedTemplateId = templates[0].id
        draft = await api.read(templates[0].id)
      } else {
        selectedTemplateId = null
        draft = null
      }
      runner = await runnerClient().snapshot()
      statusText = 'Ready'
    } catch (error) {
      errorText = messageOf(error)
      statusText = 'Load failed'
    }
  }

  async function createTemplate() {
    errorText = null
    try {
      draft = await client().create()
      selectedTemplateId = draft.id
      templates = await client().list()
      statusText = 'Template created'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function selectTemplate(templateId: string) {
    errorText = null
    try {
      selectedTemplateId = templateId
      draft = await client().read(templateId)
      statusText = 'Template loaded'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function saveTemplate() {
    if (!draft) return
    if (!validation.ok) {
      errorText = 'Fix validation errors before save.'
      return
    }
    errorText = null
    try {
      draft = await client().save(draft)
      templates = await client().list()
      statusText = 'Saved'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function duplicateTemplate() {
    if (!draft) return
    errorText = null
    try {
      draft = await client().duplicate(draft.id)
      selectedTemplateId = draft.id
      templates = await client().list()
      statusText = 'Duplicated'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function deleteTemplate() {
    if (!draft) return
    if (!window.confirm('Delete macro template "' + draft.name + '"?')) {
      statusText = 'Delete cancelled'
      return
    }
    errorText = null
    try {
      await client().delete(draft.id)
      selectedTemplateId = null
      draft = null
      templates = await client().list()
      statusText = 'Deleted'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function exportTemplate() {
    if (!draft) return
    errorText = null
    try {
      const exported = await client().exportTemplate(draft.id)
      const blob = new Blob([JSON.stringify(exported, null, 2) + '\n'], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = exported.id + '.json'
      link.click()
      URL.revokeObjectURL(link.href)
      statusText = 'Exported'
    } catch (error) {
      errorText = messageOf(error)
    }
  }

  async function importTemplate(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    errorText = null
    try {
      const imported = JSON.parse(await file.text())
      draft = await client().importTemplate(imported)
      selectedTemplateId = draft.id
      templates = await client().list()
      statusText = 'Imported'
    } catch (error) {
      errorText = messageOf(error)
    } finally {
      input.value = ''
    }
  }

  async function refreshTelegramProfileIds() {
    telegramProfilesError = ''
    try {
      telegramProfileIds = await loadTelegramProfileIds()
    } catch (error) {
      telegramProfileIds = []
      telegramProfilesError = messageOf(error)
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
    if (!draft) return
    const next = JSON.parse(JSON.stringify(draft)) as MacroTemplate
    mutator(next)
    draft = next
  }

  async function macroControl(action: 'start' | 'pause' | 'resume' | 'stop') {
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
    try {
      const api = runnerClient()
      if (action === 'start' && draft) {
        draft = await client().save(draft)
        selectedTemplateId = draft.id
        templates = await client().list()
        runner = await api.start({ templateId: draft.id })
      }
      if (action === 'pause') runner = await api.pause()
      if (action === 'resume') runner = await api.resume()
      if (action === 'stop') runner = await api.stop()
      statusText = 'Runner ' + (runner?.status ?? action)
      if (action === 'start' || action === 'resume') refreshRunnerSoon()
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
    onViewChange={(view) => { macroView = view }}
  />

  {#if macroView === 'trace'}
    <MacroTraceView {configId} refreshToken={runLogRefreshToken} refreshEvent={runLogRefreshEvent} templateId={selectedTemplateId} templateName={selectedTemplateName} />
  {:else if macroView === 'editor'}
    <MacroEditorShell bind:draft {terminals} {indexMap} {validation} {insertionPaletteMode} {telegramProfileIds} {telegramProfilesError} />
  {:else}
    <MacroJsonView {draft} {validation} {jsonPreview} onSaveTemplate={saveTemplate} onExportTemplate={exportTemplate} />
  {/if}
</aside>
