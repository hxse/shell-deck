import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  registeredThemeIds,
  scanAppCss,
  scanProductionColorText,
  scanUiStyleResidue,
} from '../../scripts/checkUiStyleResidue'
import { DAISY_UI_THEME_IDS, THEME_PREFERENCES } from '../../src/lib/theme'
import {
  collectSvelteFiles,
  structureFingerprint,
  type StructureFingerprint,
} from '../ui-baseline/20260722A.002/structureInventory'

const projectRoot = resolve(import.meta.dir, '../..')
const structureBaseline = JSON.parse(readFileSync(
  resolve(projectRoot, 'tests/ui-baseline/20260722A.002/structureFingerprint.json'),
  'utf8',
)) as {
  revision: string
  files: Record<string, { count: number; digest: string; entryDigests?: string[] }>
}

const currentComponentFingerprints = {
  'src/lib/components/TextBoxSlot.svelte': {
    count: 10,
    digest: 'e32b5856e150654d6cf89364a56a1c913eb70f9872d378162a3aadf4a9f7e2b4',
  },
  'src/lib/components/macro/CaptureSourceEditor.svelte': {
    count: 97,
    digest: '879855f721d70f0910c26364624b932d7819ba85d312a50ff8ae3bd2fa522c65',
  },
  'src/lib/components/macro/ExtractTextEditor.svelte': {
    count: 104,
    digest: '7663ad2c0c227700fff0b90645d20bba40fb645a78e15146b9f112715d4cce60',
  },
  'src/lib/components/macro/MacroActionNodeEditor.svelte': {
    count: 38,
    digest: '2a98c105c43c770d603a61196110560425507fecb1f852a970c5f055533ce180',
  },
  'src/lib/components/macro/MacroConditionEditor.svelte': {
    count: 70,
    digest: 'e82762173430f990f987ee01de88e83f8f5071ac5d0ad22828eb5ea3470b6258',
  },
  'src/lib/components/macro/MacroControlNodeEditor.svelte': {
    count: 46,
    digest: 'ef69c6fff41f4681b6f3b977c85dcc11632643480524542ef627d09352b06e94',
  },
  'src/lib/components/macro/MacroEditorShell.svelte': {
    count: 9,
    digest: 'ed91ae9b98b5346426520def27ac723749412fd44b61ff79f0bb2a0a9e6c676e',
  },
  'src/lib/components/macro/MacroFlowNodeList.svelte': {
    count: 22,
    digest: 'aada653e28ad8d185514a73ea1a5a961b396dc1bf7971a75108eaaceb5d30bdd',
  },
  'src/lib/components/macro/MacroIconButton.svelte': {
    count: 19,
    digest: '0b8c1020b602de00623b0ea0e2ad13ca398e495a0c76263f57ecc4e3b438b1c9',
  },
  'src/lib/components/macro/MacroRunDock.svelte': {
    count: 24,
    digest: '0bf82d3b6c25da9641b2150034e181cd728011ab8423feb215e31bc1ccbe0382',
  },
  'src/lib/components/macro/NodeActionControls.svelte': {
    count: 7,
    digest: '3fd73e7bed428e834f2de6e07d35760e5ecabc84f52aae4b6bccedbad69b28cc',
  },
  'src/lib/components/macro/MacroTraceView.svelte': {
    count: 20,
    digest: '4c895618c052008c7b3a714908af75b90fecfc9cc7cf4a838b7a3de6292aafc5',
  },
  'src/lib/components/macro/MessagePartsEditor.svelte': {
    count: 22,
    digest: 'c9f8eaac2cc493ee8267212a079d72d13f8a82d553b687d57b9ea011a0b730e4',
  },
  'src/lib/components/macro/ParallelLaneTabs.svelte': {
    count: 41,
    digest: 'ca4982924ffc81dfb3e5293775c145fe0382c7cedf21aec3d88247d6e9352c2d',
  },
  'src/lib/components/macro/ParallelLaneActionEditor.svelte': {
    count: 34,
    digest: '6f29874f85e0354d25770295433225f33c07aec14fc64899a5e4326a764c0962',
  },
  'src/lib/components/macro/MacroStepList.svelte': {
    count: 13,
    digest: 'b25ad9750f5c830e59b1fa3680e19e08d3033d64b68f42e83384be7d17e42427',
  },
  'src/lib/components/macro/NotifyActionFields.svelte': {
    count: 45,
    digest: '2e10e1ea1a882c8a5c2ec4746668e91d323158d55b61375bcb1d91bb9b3ec84c',
  },
  'src/lib/components/macro/ParallelTerminalUsageBadge.svelte': {
    count: 3,
    digest: '7e70818d15af3838ac831970199cde134d716eaa0a9b961c9c29d06c54eb495c',
  },
} as const

describe('20260722B.004 UI theme migration closeout', () => {
  test('the repeatable residue Gate accepts the production tree', () => {
    expect(scanUiStyleResidue(projectRoot)).toEqual([])
  })

  test('the residue helpers report concrete fixed-color and compatibility CSS owners', () => {
    const colorIssues = scanProductionColorText('src/example.svelte', '<div class="bg-[#fff] hover:bg-[red]" style="color: rgb(1, 2, 3)"></div>')
    expect(colorIssues.map(({ file, line, reason }) => ({ file, line, reason }))).toEqual([
      { file: 'src/example.svelte', line: 1, reason: 'hard-coded hex UI color is forbidden' },
      { file: 'src/example.svelte', line: 1, reason: 'hard-coded functional UI color is forbidden' },
      { file: 'src/example.svelte', line: 1, reason: 'Tailwind arbitrary UI color utility is forbidden' },
    ])

    const appCss = readFileSync(resolve(projectRoot, 'src/app.css'), 'utf8')
    const compatibilityIssues = scanAppCss(`${appCss}\n.legacy-panel { color: red; }\n`)
    expect(compatibilityIssues).toContainEqual(expect.objectContaining({
      file: 'src/app.css',
      reason: 'CSS block is outside the app.css allowlist: .legacy-panel',
    }))
    expect(scanAppCss(`${appCss}\n:root { --legacy-color: red; }\n`)).toContainEqual(expect.objectContaining({
      file: 'src/app.css',
      reason: ':root may only declare --shell-deck-terminal-font-family; found --legacy-color',
    }))
    expect(scanAppCss(`${appCss}\n.terminal-host > .xterm { position: absolute; background: red; }\n`)).toContainEqual(expect.objectContaining({
      file: 'src/app.css',
      reason: '.terminal-host > .xterm uses non-structural property background',
    }))
    expect(scanAppCss(`${appCss}\n@import "legacy.css";\n`)).toContainEqual(expect.objectContaining({
      file: 'src/app.css',
      reason: expect.stringContaining('framework imports must match the app.css allowlist'),
    }))
  })

  test('CSS registration, strict preference values and Settings options share one catalog', () => {
    const appCss = readFileSync(resolve(projectRoot, 'src/app.css'), 'utf8')
    expect(registeredThemeIds(appCss)).toEqual([...DAISY_UI_THEME_IDS])
    expect(new Set(DAISY_UI_THEME_IDS).size).toBe(35)
    expect(THEME_PREFERENCES).toEqual(['system', ...DAISY_UI_THEME_IDS])
    expect(THEME_PREFERENCES).toHaveLength(36)
  })

  test('final structure has only the exact registered deltas from the parent revision', () => {
    const files = collectSvelteFiles(resolve(projectRoot, 'src')).sort()
    const current = Object.fromEntries(files.map((path) => [
      relative(projectRoot, path).split('\\').join('/'),
      structureFingerprint(projectRoot, path),
    ]))
    expect(structureBaseline.revision).toBe('wylwysvyyrvy')
    expect(Object.keys(current).sort()).toEqual([
      ...Object.keys(structureBaseline.files)
        .filter((path) => path !== 'src/lib/components/LibraryPanel.svelte'),
      'src/lib/components/macro/MacroConditionEditor.svelte',
      'src/lib/components/macro/NotifyActionFields.svelte',
      'src/lib/components/macro/ParallelTerminalUsageBadge.svelte',
    ].sort())

    for (const [path, expected] of Object.entries(structureBaseline.files)) {
      if ([
        'src/App.svelte',
        'src/lib/components/LibraryPanel.svelte',
        'src/lib/components/MacroPanel.svelte',
        'src/lib/components/macro/MacroEditorShell.svelte',
        ...Object.keys(currentComponentFingerprints),
        'src/lib/components/macro/MacroFlowNodeList.svelte',
        'src/lib/components/macro/MacroTemplateSelector.svelte',
        'src/lib/components/macro/MacroWorkbenchChrome.svelte',
        'src/lib/components/workspace/WorkspaceShell.svelte',
      ].includes(path)) continue
      expect({ count: current[path].count, digest: current[path].digest }).toEqual({
        count: expected.count,
        digest: expected.digest,
      })
    }

    expect(Object.fromEntries(Object.keys(currentComponentFingerprints).map((path) => [
      path,
      { count: current[path].count, digest: current[path].digest },
    ]))).toEqual(currentComponentFingerprints)

    const appBaseline = structureBaseline.files['src/App.svelte']
    expect(appBaseline.entryDigests).toHaveLength(41)
    const appDelta = structureDelta(appBaseline.entryDigests ?? [], current['src/App.svelte'])
    expect(appDelta.removed).toEqual([
      '990c1978e82bd57c5483ebb92c485d4b1b572429784b8f08975e6740fb2d23a2',
      'a9704aabc90ec2300ec5b8120ca8b5f804d6d5e05f8b3a6495ec6b2836602548',
      'c173291bd4a2a2d027d1e06e68a96d3abd7fc33cd7218f3965453c6d039fc475',
      'c173291bd4a2a2d027d1e06e68a96d3abd7fc33cd7218f3965453c6d039fc475',
      '4e8c43e0d681f08d2399e930fb279d629e277285146c3a4d7ef3758fef16dea5',
    ])
    expect(appDelta.added).toEqual([
      'src/App.svelte::RegularElement:label::',
      'src/App.svelte::RegularElement:span::',
      'src/App.svelte::RegularElement:select::data-testid="theme-select"|value={settings.theme}|onchange={(event) => { if (isThemePreference(event.currentTarget.value)) updateSettings({ theme: event.currentTarget.value }) }}',
      'src/App.svelte::RegularElement:option::value={theme}',
      "src/App.svelte::Component:WorkspaceShell::client={workspace.client}|terminals={workspace.terminals}|activeTerminal={workspace.activeTerminal}|activeTerminalId={workspace.activeTerminalId}|draggingTerminalId={workspace.draggingTerminalId}|tabDragEnabled={settings.terminalDragEnabled}|sharedReadOnly={!workspace.canMutateShared}|macroVisible={settings.panels.macro.visible}|macroWidthPx={settings.panels.macro.widthPx}|canMutateShared={workspace.canMutateShared}|terminalStructureRevision={workspace.terminalStructureRevision}|terminalPositions={workspace.terminalPositions}|terminalStructureLocked={workspace.terminalStructureLocked}|runnerSnapshot={workspace.runnerSnapshot}|contentRecordChanges={workspace.contentRecordChanges}|contentEditLeaseChanges={workspace.contentEditLeaseChanges}|connectionGeneration={workspace.connectionGeneration}|insertionPaletteMode={settings.macroInsertionPlacement}|onMacroWidthChange={(widthPx) => updateMacroPanel(widthPx)}|onMacroDirtyChange={(dirty) => { macroDirty = dirty }}|onRoomSnapshot={workspace.applyRoomSnapshot}|onSelectTerminal={workspace.selectTerminal}|onCloseTerminal={workspace.closeTerminalTab}|onStartTabDrag={(event, terminalId) => workspace.startDrag(event, terminalId, settings.terminalDragEnabled)}|onDropOnTab={(event, terminal, sourceTerminalId) => workspace.dropOnTab(event, terminal, settings.terminalDragEnabled, sourceTerminalId)}|onTabDragEnd={workspace.finishTabDrag}|onTabKeydown={workspace.tabKeydown}|onMutationDenied={pushMutationNotice}",
    ])

    const macroPanelBaseline = structureBaseline.files['src/lib/components/MacroPanel.svelte']
    expect(macroPanelBaseline.entryDigests).toHaveLength(7)
    const macroPanelDelta = structureDelta(
      macroPanelBaseline.entryDigests ?? [],
      current['src/lib/components/MacroPanel.svelte'],
    )
    expect(macroPanelDelta.removed).toEqual([
      '5cffe3ac292d09e5bd6250c990edc52f6ac634c116d4f1c2ea4916f8f2474284',
      '02a9ab3d43f0ccab21b77d0e594a6799edd9bb8a1f4559ffd77bee418c8358cc',
      'a2e1e92633924c0b780e1ad6d07d109e593c3b9271e1269c26dcf388ea680ab5',
    ])
    expect(macroPanelDelta.added).toEqual([
      "src/lib/components/MacroPanel.svelte::Component:MacroWorkbenchChrome::{templates}|{filteredTemplates}|{draft}|{selectedRecord}|{templateSearch}|{dirty}|{contentEditing}|mutationAllowed={canMutateShared}|errorText={displayedErrorText}|{macroView}|{runner}|{statusText}|{runnerInput}|{runnerInputSyncing}|{preparing}|prepareDisabled={prepareState.disabled}|prepareDisabledReason={prepareState.reason}|closeAllDisabled={Boolean(closeAllDisabledReason)}|{closeAllDisabledReason}|startDisabled={startState.disabled}|startDisabledReason={startState.reason}|{jsonEditing}|{operationPending}|{runActive}|onTemplateSearchChange={(value) => { templateSearch = value }}|onSelectTemplate={selectTemplate}|onCreateTemplate={() => void createTemplate()}|onBeginEdit={() => void beginEdit()}|onSaveTemplate={() => void saveTemplate()}|onCancelEdit={() => void cancelEdit()}|onDeleteTemplate={() => void deleteTemplate()}|onUpdateDraft={updateDraft}|onResetWidth={onResetWidth}|onPrepare={() => void prepareTerminals()}|onCloseAll={closeAllTerminals}|onRunnerInputChange={updateRunnerInput}|onSubmitRunnerInput={() => void submitRunnerInput()}|onRefreshRunner={() => void refreshRunner()}|onMacroControl={(action) => void controlRunner(action)}|onViewChange={(view) => { if (!jsonEditing) { macroView = view; if (view === 'trace') void refreshTraces() } }}",
      "src/lib/components/MacroPanel.svelte::Component:MacroEditorShell::{draft}|validation={portableValidation}|{runnableValidation}|runtimePositions={terminalPositions}|{insertionPaletteMode}|{telegramProfileIds}|{telegramProfilesError}|locked={editorLocked}|editorKey={`${selectedRecord?.id ?? 'new'}:${editorGeneration}`}|lockedReason={runActive ? 'macro_run_active' : !canMutateShared ? 'room_control_required' : operationPending ? 'operation_pending' : leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required'}|currentNodeId={runActive ? runner?.currentNodeId ?? null : null}|onBeginEdit={() => void beginEdit()}|{onMutationDenied}|onUpdateDraft={updateDraft}",
      "src/lib/components/MacroPanel.svelte::Component:MacroTraceView::{runner}|summaries={traces}|eventsPage={traceEvents}|{selectedTraceRunId}|hasPreviousSummaryPage={runnerSession.hasPreviousTracePage}|hasNextSummaryPage={runnerSession.hasNextTracePage}|hasPreviousEventPage={runnerSession.hasPreviousTraceEventPage}|hasNextEventPage={runnerSession.hasNextTraceEventPage}|onSelectRun={(runId) => void runnerSession.selectTrace(runId)}|onPreviousSummaryPage={() => void runnerSession.previousTraceSummaryPage()}|onNextSummaryPage={() => void runnerSession.nextTraceSummaryPage()}|onPreviousEventPage={() => void runnerSession.previousTraceEventPage()}|onNextEventPage={() => void runnerSession.nextTraceEventPage()}",
    ])

    expect(structureBaseline.files['src/lib/components/LibraryPanel.svelte']).toEqual({
      count: 47,
      digest: '4e911729639d5f6d191f5e49cd9ecc8d1facfeb86a6db09ef1265476f00fdae6',
    })
    expect(current['src/lib/components/LibraryPanel.svelte']).toBeUndefined()
    expect({
      selector: {
        count: current['src/lib/components/macro/MacroTemplateSelector.svelte'].count,
        digest: current['src/lib/components/macro/MacroTemplateSelector.svelte'].digest,
      },
      chrome: {
        count: current['src/lib/components/macro/MacroWorkbenchChrome.svelte'].count,
        digest: current['src/lib/components/macro/MacroWorkbenchChrome.svelte'].digest,
      },
      workspace: {
        count: current['src/lib/components/workspace/WorkspaceShell.svelte'].count,
        digest: current['src/lib/components/workspace/WorkspaceShell.svelte'].digest,
      },
    }).toEqual({
      selector: { count: 31, digest: '49043727ae109d3fa38512728dce96eec2a33b33cbd341125de6838f9dc437ee' },
      chrome: { count: 9, digest: '787056aa4c2ee14cc52405bc7868611f17fdc8a0a2d25aab4ceff720d6601dab' },
      workspace: { count: 12, digest: '2a44c50cac4159cb82425e42350c99d9dea2fc13f99d2bcf121be7142ec8f10a' },
    })

    expect(Object.values(structureBaseline.files).reduce((sum, file) => sum + file.count, 0)).toBe(835)
    expect(Object.values(current).reduce((sum, file) => sum + file.count, 0)).toBe(854)

    const app = readFileSync(resolve(projectRoot, 'src/App.svelte'), 'utf8')
    expect(app.match(/data-testid="theme-select"/g)).toHaveLength(1)
    expect(app).toContain('{#each THEME_PREFERENCES as theme}')
    expect(app).not.toMatch(/data-testid="[^"]*theme[^"]*button"/i)
    expect(app).not.toMatch(/<button[^>]*>\s*Theme\s*<\/button>/i)

    const terminal = readFileSync(resolve(projectRoot, 'src/lib/components/TerminalSlot.svelte'), 'utf8')
    for (const attribute of [
      'data-terminal-instance-id',
      'data-terminal-color-scheme',
      'data-terminal-base-y',
      'data-terminal-viewport-y',
      'data-terminal-cursor-x',
      'data-terminal-cursor-y',
      'data-terminal-selection',
    ]) {
      expect(terminal).not.toContain(attribute)
    }
    expect(terminal).toContain('shell-deck-terminal-test-state-request')
  })
})

function structureDelta(baseline: string[], current: StructureFingerprint): { removed: string[]; added: string[] } {
  const matrix = Array.from(
    { length: baseline.length + 1 },
    () => Array<number>(current.entryDigests.length + 1).fill(0),
  )
  for (let baselineIndex = baseline.length - 1; baselineIndex >= 0; baselineIndex -= 1) {
    for (let currentIndex = current.entryDigests.length - 1; currentIndex >= 0; currentIndex -= 1) {
      matrix[baselineIndex][currentIndex] = baseline[baselineIndex] === current.entryDigests[currentIndex]
        ? matrix[baselineIndex + 1][currentIndex + 1] + 1
        : Math.max(matrix[baselineIndex + 1][currentIndex], matrix[baselineIndex][currentIndex + 1])
    }
  }

  const removed: string[] = []
  const added: string[] = []
  let baselineIndex = 0
  let currentIndex = 0
  while (baselineIndex < baseline.length && currentIndex < current.entryDigests.length) {
    if (baseline[baselineIndex] === current.entryDigests[currentIndex]) {
      baselineIndex += 1
      currentIndex += 1
    } else if (matrix[baselineIndex + 1][currentIndex] >= matrix[baselineIndex][currentIndex + 1]) {
      removed.push(baseline[baselineIndex])
      baselineIndex += 1
    } else {
      added.push(current.entries[currentIndex])
      currentIndex += 1
    }
  }
  removed.push(...baseline.slice(baselineIndex))
  added.push(...current.entries.slice(currentIndex))
  return { removed, added }
}
