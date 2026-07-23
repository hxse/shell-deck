<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { loadBrowserSettings, saveBrowserSettings, type BrowserSettings, type LoadedBrowserSettings } from './lib/browserSettings'
  import RoomHome from './lib/components/RoomHome.svelte'
  import NoticeStack, { type NoticeItem } from './lib/components/workspace/NoticeStack.svelte'
  import WorkspaceShell from './lib/components/workspace/WorkspaceShell.svelte'
  import type { RoomNotificationNoticeOptions } from './lib/roomNotificationDelivery'
  import { createRoomWorkspaceState } from './lib/roomWorkspaceState.svelte'
  import { isRoomControlFeedback, sharedMutationFeedback } from './lib/sharedMutationFeedback'
  import { isThemePreference, observeDocumentTheme, THEME_PREFERENCES, themePreferenceLabel } from './lib/theme'

  let { initialBrowserSettings }: { initialBrowserSettings?: LoadedBrowserSettings } = $props()

  const initialPath = window.location.pathname
  const initialRoomId = initialPath === '/' ? '' : decodeURIComponent(initialPath.slice(1))
  let isHome = $state(initialPath === '/')
  let roomId = $state(initialRoomId)
  const loadedSettings = untrack(() => initialBrowserSettings ?? loadBrowserSettings())

  let settings = $state<BrowserSettings>(loadedSettings.settings)
  let noticeSeq = 0
  let notice = $state<NoticeItem | null>(null)
  let settingsOpen = $state(false)
  let macroDirty = $state(false)
  let libraryDirty = $state(false)

  onMount(() => {
    if (loadedSettings.reset) pushNotice('Browser settings were reset because the stored schema is invalid.')
  })

  $effect(() => {
    try { saveBrowserSettings(settings) } catch {}
  })

  $effect(() => observeDocumentTheme(settings.theme))

  const workspace = initialRoomId ? createRoomWorkspaceState({
    roomId: initialRoomId,
    notificationVolume: () => settings.notificationVolume,
    notice: pushNotice,
    notificationNotice: pushDetailedNotice,
    mutationNotice: pushMutationNotice,
    clearControlFeedback,
    enterHome: enterHomeWithoutRootRequest,
  }) : null

  onDestroy(() => { workspace?.dispose() })

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!macroDirty && !libraryDirty) return
    event.preventDefault()
    event.returnValue = ''
  }

  function enterHomeWithoutRootRequest() {
    if (isHome) return
    window.history.replaceState(null, '', '/')
    isHome = true
    roomId = ''
    libraryDirty = false
    macroDirty = false
  }

  function updateSettings(next: Partial<BrowserSettings>) {
    settings = { ...settings, ...next }
  }

  function updateMacroPanel(widthPx?: number, visible?: boolean) {
    settings = {
      ...settings,
      panels: {
        ...settings.panels,
        macro: {
          visible: visible ?? settings.panels.macro.visible,
          widthPx: widthPx ?? settings.panels.macro.widthPx,
        },
      },
    }
  }

  function updateLibraryPanel(widthPx?: number, visible?: boolean) {
    settings = {
      ...settings,
      panels: {
        ...settings.panels,
        library: {
          visible: visible ?? settings.panels.library.visible,
          widthPx: widthPx ?? settings.panels.library.widthPx,
        },
      },
    }
  }

  function updateLibraryPreference(selectedTab: 'json-template' | 'prompt' | 'note', filter: string) {
    settings = { ...settings, library: { selectedTab, filter } }
  }

  function pushNotice(text: string) {
    notice = { id: ++noticeSeq, kind: 'general', text: text.length > 500 ? text.slice(0, 500) + '...' : text }
  }

  function pushMutationNotice(reason: string, prefix = '') {
    const text = prefix + sharedMutationFeedback(reason)
    notice = { id: ++noticeSeq, kind: 'mutation', reason, level: 'warning', text: text.length > 500 ? text.slice(0, 500) + '...' : text }
  }

  function pushDetailedNotice(text: string, options: RoomNotificationNoticeOptions) {
    notice = { id: ++noticeSeq, kind: 'notification', text: text.length > 500 ? text.slice(0, 500) + '...' : text, ...options }
  }

  function clearControlFeedback(): void {
    if (notice?.kind === 'mutation' && isRoomControlFeedback(notice.reason)) notice = null
  }
</script>

<svelte:window onbeforeunload={handleBeforeUnload} />

{#if isHome}
  <RoomHome onNotice={pushNotice} onMutationNotice={pushMutationNotice} />
{:else if workspace}
  <main class="room-shell flex h-screen min-h-screen flex-col overflow-hidden bg-base-200 text-base-content">
    <header class="topbar compact-topbar box-border flex min-h-9 items-center justify-between border-b border-base-300 bg-base-100 px-2 py-[3px] [@media(max-width:640px)]:flex-col [@media(max-width:640px)]:items-start">
      <div class="brand-line flex min-w-0 items-baseline gap-1.5 overflow-hidden"><h1 class="m-0 shrink-0 text-sm leading-tight font-bold">shell-deck</h1><p class="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-base-content/60" data-testid="room-identity">{roomId} · {workspace.connected ? 'connected' : 'disconnected'}</p></div>
      <div class="actions flex flex-wrap items-center gap-1 sm:flex-nowrap [@media(max-width:640px)]:flex-wrap">
        {#if !workspace.connected || !workspace.controlView}
          <span class="room-control-status reconnecting badge badge-sm badge-ghost box-border min-h-[30px] px-[9px] py-[5px] text-xs leading-none whitespace-nowrap" data-testid="room-control-status">Reconnecting · Read-only</span>
        {:else if workspace.controlView.mode === 'controller'}
          <span class="room-control-status controller badge badge-sm badge-success badge-soft box-border min-h-[30px] px-[9px] py-[5px] text-xs leading-none whitespace-nowrap" data-testid="room-control-status">Control: This device</span>
        {:else}
          <button
            type="button"
            class="room-control-takeover btn btn-sm btn-warning box-border h-[30px] min-h-[30px] px-[9px] py-[5px] text-xs leading-none whitespace-nowrap"
            data-testid="take-control"
            onclick={() => void workspace.takeControl()}
            disabled={workspace.controlPending}
          >{workspace.controlPending ? 'Taking control…' : 'Read-only · Take control'}</button>
        {/if}
        <button type="button" class="btn btn-sm btn-ghost box-border h-7 min-h-7 rounded-[5px] px-[7px] text-xs" data-testid="home-button" onclick={() => window.open('/', '_blank', 'noopener')}>Home</button>
        <button type="button" class="panel-toggle btn btn-sm btn-secondary box-border h-7 min-h-7 w-[86px] justify-center gap-[5px] rounded-[5px] px-[7px] text-xs leading-none [&[aria-pressed=true]_.switch-track]:bg-primary [&[aria-pressed=true]_.switch-thumb]:translate-x-2.5" class:btn-active={settings.panels.macro.visible} aria-pressed={settings.panels.macro.visible} data-testid="macro-panel-toggle" onclick={() => updateMacroPanel(undefined, !settings.panels.macro.visible)}>
          <span class="switch-track relative h-3.5 w-6 shrink-0 rounded-full bg-base-content/30 shadow-inner" aria-hidden="true"><span class="switch-thumb absolute top-0.5 left-0.5 size-2.5 rounded-full bg-base-100 shadow-sm transition-transform"></span></span><span>Macro</span>
        </button>
        <button type="button" class="panel-toggle btn btn-sm btn-secondary box-border h-7 min-h-7 w-[86px] justify-center gap-[5px] rounded-[5px] px-[7px] text-xs leading-none [&[aria-pressed=true]_.switch-track]:bg-primary [&[aria-pressed=true]_.switch-thumb]:translate-x-2.5" class:btn-active={settings.panels.library.visible} aria-pressed={settings.panels.library.visible} data-testid="library-panel-toggle" onclick={() => updateLibraryPanel(undefined, !settings.panels.library.visible)}>
          <span class="switch-track relative h-3.5 w-6 shrink-0 rounded-full bg-base-content/30 shadow-inner" aria-hidden="true"><span class="switch-thumb absolute top-0.5 left-0.5 size-2.5 rounded-full bg-base-100 shadow-sm transition-transform"></span></span><span>Library</span>
        </button>
        <button type="button" class="terminal-create-button btn btn-sm btn-primary box-border !h-7 !min-h-7 rounded-[5px] px-[7px] text-xs !pointer-events-auto aria-disabled:cursor-not-allowed" data-testid="terminal-create-real" onclick={workspace.createShell} aria-disabled={!workspace.canMutateShared || workspace.terminalStructureLocked}>New shell</button>
        <button type="button" class="terminal-create-button btn btn-sm btn-primary box-border !h-7 !min-h-7 rounded-[5px] px-[7px] text-xs !pointer-events-auto aria-disabled:cursor-not-allowed" data-testid="terminal-create-text" onclick={workspace.createText} aria-disabled={!workspace.canMutateShared || workspace.terminalStructureLocked}>New text</button>
        <button type="button" class="settings-button btn btn-sm btn-primary relative z-[61] box-border h-7 min-h-7 min-w-[70px] rounded-[5px] px-[7px] text-xs" data-testid="settings-button" onclick={() => { settingsOpen = !settingsOpen }}>Settings</button>
      </div>
    </header>
    {#if settingsOpen}
      <button class="popover-dismiss-layer settings-dismiss-layer fixed inset-0 z-[59] cursor-default rounded-none border-0 bg-transparent p-0" type="button" data-testid="settings-dismiss-layer" aria-label="Close settings" onclick={() => { settingsOpen = false }}></button>
      <section class="settings-popover fixed top-12 right-2.5 z-[60] grid w-[min(320px,calc(100vw-20px))] gap-3 rounded-box border border-base-300 bg-base-100 p-3 text-base-content shadow-xl" data-testid="settings-popover">
        <div class="settings-popover-head flex items-center justify-between gap-3"><strong>Settings</strong><button class="btn btn-xs btn-ghost" type="button" data-testid="settings-close" onclick={() => { settingsOpen = false }}>Close</button></div>
        <label class="grid gap-1 text-xs font-semibold text-base-content">
          <span>Theme</span>
          <select
            class="select box-border select-sm select-ghost w-full bg-base-content/15"
            data-testid="theme-select"
            value={settings.theme}
            onchange={(event) => {
              if (isThemePreference(event.currentTarget.value)) updateSettings({ theme: event.currentTarget.value })
            }}
          >
            {#each THEME_PREFERENCES as theme}
              <option value={theme}>{themePreferenceLabel(theme)}</option>
            {/each}
          </select>
        </label>
        <button
          type="button"
          class="drag-toggle settings-drag-toggle btn btn-sm btn-secondary w-full justify-center gap-2 px-[9px] leading-none [&[aria-pressed=true]_.switch-track]:bg-primary [&[aria-pressed=true]_.switch-thumb]:translate-x-3"
          class:btn-active={settings.terminalDragEnabled}
          data-testid="tab-drag-toggle"
          aria-pressed={settings.terminalDragEnabled}
          onclick={() => updateSettings({ terminalDragEnabled: !settings.terminalDragEnabled })}
        ><span class="switch-track relative h-4 w-7 shrink-0 rounded-full bg-base-content/30 shadow-inner" aria-hidden="true"><span class="switch-thumb absolute top-0.5 left-0.5 size-3 rounded-full bg-base-100 shadow-sm transition-transform"></span></span><span>Drag terminals</span></button>
        <button
          type="button"
          class="settings-control-button btn btn-sm btn-primary w-full justify-start text-left"
          class:btn-active={settings.macroInsertionPlacement === 'anchored'}
          data-testid="macro-insertion-placement"
          aria-pressed={settings.macroInsertionPlacement === 'anchored'}
          onclick={() => updateSettings({ macroInsertionPlacement: settings.macroInsertionPlacement === 'anchored' ? 'center' : 'anchored' })}
        >Action picker: {settings.macroInsertionPlacement === 'anchored' ? 'near trigger' : 'centered'}</button>
        <label class="settings-volume-control grid gap-2 text-[13px]">
          <span class="flex items-center justify-between gap-3"><span>Notification volume</span><output class="font-[var(--shell-deck-terminal-font-family)] text-base-content/70" data-testid="notification-volume-output">{Math.round(settings.notificationVolume * 100)}%</output></span>
          <input class="range range-xs w-full" type="range" min="0" max="1000" step="10" value={Math.round(settings.notificationVolume * 100)} data-testid="notification-volume" oninput={(event) => updateSettings({ notificationVolume: Number(event.currentTarget.value) / 100 })} />
        </label>
        <button type="button" class="settings-control-button btn btn-sm btn-primary w-full justify-start text-left" data-testid="notification-success-sound-test" onclick={() => { void workspace.playNotificationSound('success', 'success') }}>Play success sound</button>
      </section>
    {/if}
    <NoticeStack {notice} onDismiss={(id) => { if (notice?.id === id) notice = null }} />
    <WorkspaceShell
      client={workspace.client}
      terminals={workspace.terminals}
      activeTerminal={workspace.activeTerminal}
      activeTerminalId={workspace.activeTerminalId}
      draggingTerminalId={workspace.draggingTerminalId}
      tabDragEnabled={settings.terminalDragEnabled}
      sharedReadOnly={!workspace.canMutateShared}
      macroVisible={settings.panels.macro.visible}
      macroWidthPx={settings.panels.macro.widthPx}
      libraryVisible={settings.panels.library.visible}
      libraryWidthPx={settings.panels.library.widthPx}
      librarySelectedTab={settings.library.selectedTab}
      libraryFilter={settings.library.filter}
      canMutateShared={workspace.canMutateShared}
      terminalStructureRevision={workspace.terminalStructureRevision}
      terminalPositions={workspace.terminalPositions}
      terminalStructureLocked={workspace.terminalStructureLocked}
      runnerSnapshot={workspace.runnerSnapshot}
      contentRecordChanges={workspace.contentRecordChanges}
      contentEditLeaseChanges={workspace.contentEditLeaseChanges}
      connectionGeneration={workspace.connectionGeneration}
      insertionPaletteMode={settings.macroInsertionPlacement}
      onMacroWidthChange={(widthPx) => updateMacroPanel(widthPx)}
      onMacroDirtyChange={(dirty) => { macroDirty = dirty }}
      onLibraryWidthChange={(widthPx) => updateLibraryPanel(widthPx)}
      onLibraryPreferenceChange={updateLibraryPreference}
      onLibraryDirtyChange={(dirty) => { libraryDirty = dirty }}
      onRoomSnapshot={workspace.applyRoomSnapshot}
      onSelectTerminal={workspace.selectTerminal}
      onCloseTerminal={workspace.closeTerminalTab}
      onStartTabDrag={(event, terminalId) => workspace.startDrag(event, terminalId, settings.terminalDragEnabled)}
      onDropOnTab={(event, terminal) => workspace.dropOnTab(event, terminal, settings.terminalDragEnabled)}
      onTabDragEnd={workspace.finishTabDrag}
      onTabKeydown={workspace.tabKeydown}
      onMutationDenied={pushMutationNotice}
    />
  </main>
{/if}

{#if isHome}<NoticeStack {notice} onDismiss={(id) => { if (notice?.id === id) notice = null }} />{/if}
