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
    expect(Object.keys(current).sort()).toEqual(Object.keys(structureBaseline.files).sort())

    for (const [path, expected] of Object.entries(structureBaseline.files)) {
      if ([
        'src/App.svelte',
        'src/lib/components/MacroPanel.svelte',
        'src/lib/components/macro/MacroEditorShell.svelte',
        'src/lib/components/macro/MacroFlowNodeList.svelte',
      ].includes(path)) continue
      expect({ count: current[path].count, digest: current[path].digest }).toEqual({
        count: expected.count,
        digest: expected.digest,
      })
    }

    const appBaseline = structureBaseline.files['src/App.svelte']
    expect(appBaseline.entryDigests).toHaveLength(41)
    const appDelta = structureDelta(appBaseline.entryDigests ?? [], current['src/App.svelte'])
    expect(appDelta.removed).toEqual([])
    expect(appDelta.added).toEqual([
      'src/App.svelte::RegularElement:label::',
      'src/App.svelte::RegularElement:span::',
      'src/App.svelte::RegularElement:select::data-testid="theme-select"|value={settings.theme}|onchange={(event) => { if (isThemePreference(event.currentTarget.value)) updateSettings({ theme: event.currentTarget.value }) }}',
      'src/App.svelte::RegularElement:option::value={theme}',
    ])

    const macroPanelBaseline = structureBaseline.files['src/lib/components/MacroPanel.svelte']
    expect(macroPanelBaseline.entryDigests).toHaveLength(7)
    const macroPanelDelta = structureDelta(
      macroPanelBaseline.entryDigests ?? [],
      current['src/lib/components/MacroPanel.svelte'],
    )
    expect(macroPanelDelta.removed).toEqual([
      '02a9ab3d43f0ccab21b77d0e594a6799edd9bb8a1f4559ffd77bee418c8358cc',
    ])
    expect(macroPanelDelta.added).toEqual([
      "src/lib/components/MacroPanel.svelte::Component:MacroEditorShell::{draft}|validation={portableValidation}|{runnableValidation}|runtimePositions={terminalPositions}|{insertionPaletteMode}|{telegramProfileIds}|{telegramProfilesError}|locked={editorLocked}|editorKey={`${selectedRecord?.id ?? 'new'}:${editorGeneration}`}|lockedReason={runActive ? 'macro_run_active' : !canMutateShared ? 'room_control_required' : operationPending ? 'operation_pending' : leaseLost ? 'content_edit_lease_lost' : 'content_edit_lease_required'}|currentNodeId={runActive ? runner?.currentNodeId ?? null : null}|onBeginEdit={() => void beginEdit()}|{onMutationDenied}|onUpdateDraft={updateDraft}",
    ])

    const editorBaseline = structureBaseline.files['src/lib/components/macro/MacroEditorShell.svelte']
    expect(editorBaseline.entryDigests).toHaveLength(9)
    const editorDelta = structureDelta(
      editorBaseline.entryDigests ?? [],
      current['src/lib/components/macro/MacroEditorShell.svelte'],
    )
    expect(editorDelta.removed).toEqual([
      'eac4b6faa80c5a39bca540fe26a2ea32935047399423bb11185e323b0d50ac69',
    ])
    expect(editorDelta.added).toEqual([
      "src/lib/components/macro/MacroEditorShell.svelte::RegularElement:div::data-testid=\"macro-editor-lock-notice\"|data-lock-reason={lockedReason}|data-click-to-edit={normalReadOnly}|role={normalReadOnly ? 'button' : 'status'}|tabindex={normalReadOnly ? 0 : undefined}|onclick={normalReadOnly ? activateNormalReadOnlyNotice : undefined}|onkeydown={normalReadOnly ? activateNormalReadOnlyNotice : undefined}",
    ])

    const flowPath = 'src/lib/components/macro/MacroFlowNodeList.svelte'
    expect(structureBaseline.files[flowPath]).toEqual({
      count: 22,
      digest: '7bbb9d90fd1bbccec7c662ef8615dfedde25a26c8d7a6a7d8306ed97ad1e40ee',
    })
    expect({
      count: current[flowPath].count,
      digest: current[flowPath].digest,
      controllerBinding: current[flowPath].entries.filter((entry) => (
        entry.includes('::Component:MacroInsertionPalette::')
      )),
    }).toEqual({
      count: 22,
      digest: '504a2ebf4fb51fb4ee0696c0fec78f2910ac9db12ee93b266e8ae2ee503935b2',
      controllerBinding: [
        "src/lib/components/macro/MacroFlowNodeList.svelte::Component:MacroInsertionPalette::anchored={insertion.paletteAnchored}|position={insertion.position}|{insertionPaletteMode}|summary={insertion.summary}|actionOnly={insertion.actionOnly}|allowsLoopControls={insertion.allowsLoopControls}|actionItems={insertion.actionPaletteItems}|flowItems={insertion.flowPaletteItems}|moveNodeId={insertion.moveNodeId}|movableNodeChoices={movableNodeChoices()}|blocked={insertion.notice.startsWith('Insertion failed:')}|bind:paletteElement={insertion.paletteElement}|onMoveNodeIdChange={insertion.setMoveNodeId}|onInsert={insertFromPalette}|onMoveExisting={moveExistingNodeFromPalette}|onCancel={cancelInsertion}",
      ],
    })

    expect(Object.values(structureBaseline.files).reduce((sum, file) => sum + file.count, 0)).toBe(835)
    expect(Object.values(current).reduce((sum, file) => sum + file.count, 0)).toBe(839)

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
