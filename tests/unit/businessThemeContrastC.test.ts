import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  scanAppCss,
  scanInteractiveComponentSemantics,
  scanMacroPresentationSemantics,
} from '../../scripts/checkUiStyleResidue'
import { DEFAULT_BROWSER_SETTINGS } from '../../src/lib/browserSettings'
import {
  DAISY_UI_THEME_IDS,
  DARK_DAISY_UI_THEME_IDS,
  effectiveColorScheme,
} from '../../src/lib/theme'

const projectRoot = resolve(import.meta.dir, '../..')
const expectedDarkThemes = [
  'dark',
  'synthwave',
  'halloween',
  'forest',
  'aqua',
  'black',
  'luxury',
  'dracula',
  'business',
  'night',
  'coffee',
  'dim',
  'sunset',
  'abyss',
] as const
const expectedDarkThemeSet = new Set<string>(expectedDarkThemes)

describe('20260722C/20260723A business default and native theme ownership', () => {
  test('business is the single fresh/reset browser default', () => {
    expect(DEFAULT_BROWSER_SETTINGS.theme).toBe('business')
  })

  test('the canonical dark catalog is exact and owns effective appearance', () => {
    expect(DARK_DAISY_UI_THEME_IDS).toEqual([...expectedDarkThemes])
    expect(new Set(DARK_DAISY_UI_THEME_IDS).size).toBe(expectedDarkThemes.length)
    for (const theme of DAISY_UI_THEME_IDS) {
      expect(effectiveColorScheme(theme, false)).toBe(expectedDarkThemeSet.has(theme) ? 'dark' : 'light')
    }
  })

  test('app CSS delegates every palette and component token to built-in themes', () => {
    const css = readFileSync(resolve(projectRoot, 'src/app.css'), 'utf8')
    expect(css).not.toContain('[data-theme=')
    expect(css).not.toContain('prefers-color-scheme')
    expect(css).not.toContain('--color-base-')
    expect(css).not.toContain('--depth')
    expect(scanAppCss(css)).toEqual([])
  })

  test('the default residue Gate rejects application-owned theme overrides', () => {
    const css = readFileSync(resolve(projectRoot, 'src/app.css'), 'utf8')
    const explicitOverride = css.replace(':root {', ':where([data-theme="business"]) { --depth: 1; }\n\n:root {')
    expect(reasons(explicitOverride)).toContain('CSS block is outside the app.css allowlist: :where([data-theme="business"])')

    const systemOverride = css.replace(':root {', '@media (prefers-color-scheme: dark) { :root { --depth: 1; } }\n\n:root {')
    expect(reasons(systemOverride)).toContain('CSS block is outside the app.css allowlist: @media (prefers-color-scheme: dark)')
  })

  test('interactive controls must own native daisyUI semantics without structural borders', () => {
    expect(controlReasons('<input class="input box-border input-xs input-ghost bg-base-content/15" />')).toEqual([])
    expect(controlReasons('<select class="select box-border select-xs select-ghost bg-base-content/15"><option>x</option></select>')).toEqual([])
    expect(controlReasons('<button class="btn btn-xs btn-primary">Edit</button>')).toEqual([])
    expect(controlReasons('<button class="btn btn-xs btn-success">Save</button>')).toEqual([])
    expect(controlReasons('<button class="btn btn-xs btn-ghost">Cancel</button>')).toEqual([])
    expect(controlReasons('<div role="tab" class="tab">Shell 1</div>')).toEqual([])

    expect(controlReasons('<input class="input input-xs border-base-300" />')).toContain('interactive control must not consume the structural border-base-300 token')
    expect(controlReasons('<input class="input input-xs input-ghost bg-base-200" />')).toContain('input must directly declare box-border because the project does not load Tailwind preflight')
    expect(controlReasons('<select class="select select-xs bg-base-content/15"><option>x</option></select>')).toContain('select must use the daisyUI select-ghost surface or an explicit borderless composite-editor exception')
    expect(controlReasons('<input class="input box-border input-xs input-ghost bg-base-200" />')).toContain('input input-ghost must pair with the single theme-derived bg-base-content/15 field fill')
    expect(controlReasons('<select class="select box-border select-xs select-ghost bg-base-content/10"><option>x</option></select>')).toContain('select select-ghost must pair with the single theme-derived bg-base-content/15 field fill')
    expect(controlReasons('<button class="btn btn-xs btn-outline">Edit</button>')).toContain('interactive control must use a daisyUI solid semantic or intentional ghost state instead of btn-outline')
    expect(controlReasons('<button class="btn btn-xs btn-soft">Edit</button>')).toEqual(expect.arrayContaining([
      'visible command must not use low-contrast btn-soft in the business theme',
      'visible btn must declare a solid semantic surface or an intentional btn-ghost tertiary state',
    ]))
    expect(controlReasons('<button class="btn btn-xs">Edit</button>')).toContain('visible btn must declare a solid semantic surface or an intentional btn-ghost tertiary state')
    expect(controlReasons('<div role="tab" class="border border-base-300">Shell 1</div>')).toEqual(expect.arrayContaining([
      'role=tab control must directly declare daisyUI tab semantics',
      'interactive control must not consume the structural border-base-300 token',
    ]))

    const ancestor = '<section class="[&_input]:border [&_button]:bg-base-100"><input class="input box-border input-ghost bg-base-content/15" /></section>'
    expect(scanInteractiveComponentSemantics('src/lib/components/MacroPanel.svelte', ancestor).map((issue) => issue.reason))
      .toContain('MacroPanel ancestor control presentation is forbidden; declare the daisyUI component on the control itself')
  })

  test('saved Macro content remains readable and flow nodes own semantic depth separators', () => {
    const editorFile = 'src/lib/components/macro/MacroEditorShell.svelte'
    const panelFile = 'src/lib/components/MacroPanel.svelte'
    const flowFile = 'src/lib/components/macro/MacroFlowNodeList.svelte'
    const editor = readFileSync(resolve(projectRoot, editorFile), 'utf8')
    const panel = readFileSync(resolve(projectRoot, panelFile), 'utf8')
    const flow = readFileSync(resolve(projectRoot, flowFile), 'utf8')
    expect(scanMacroPresentationSemantics(editorFile, editor)).toEqual([])
    expect(scanMacroPresentationSemantics(panelFile, panel)).toEqual([])
    expect(scanMacroPresentationSemantics(flowFile, flow)).toEqual([])

    const dimmedEditor = editor.replace(
      'data-[editor-locked=true]:[&_input]:pointer-events-none',
      'data-[editor-locked=true]:[&_input]:pointer-events-none data-[editor-locked=true]:[&_input]:text-base-content/55',
    )
    expect(scanMacroPresentationSemantics(editorFile, dimmedEditor).map((issue) => issue.reason))
      .toContain('saved Macro read-only content must remain full contrast; lock state belongs to the semantic notice')

    const noticeWithoutKeyboardActivation = editor.replace(
      'onkeydown={normalReadOnly ? activateNormalReadOnlyNotice : undefined}',
      '',
    )
    expect(scanMacroPresentationSemantics(editorFile, noticeWithoutKeyboardActivation).map((issue) => issue.reason))
      .toContain('normal saved Macro notice must exclusively own direct Edit activation token onkeydown={normalReadOnly ? activateNormalReadOnlyNotice : undefined}')

    const panelWithoutCanonicalEdit = panel.replace(
      'onBeginEdit={() => void beginEdit()} {onMutationDenied} onUpdateDraft={updateDraft}',
      '{onMutationDenied} onUpdateDraft={updateDraft}',
    )
    expect(scanMacroPresentationSemantics(panelFile, panelWithoutCanonicalEdit).map((issue) => issue.reason))
      .toContain('normal saved Macro notice must delegate to the canonical beginEdit content lease path')

    const separatorWithoutPrimary = flow.replace('after:from-primary after:via-primary/70', '')
    expect(scanMacroPresentationSemantics(flowFile, separatorWithoutPrimary).map((issue) => issue.reason))
      .toContain('flow node must pair semantic vertical depth guides with the theme-derived ::after separator token after:from-primary after:via-primary/70')
  })
})

function reasons(css: string): string[] {
  return scanAppCss(css).map((issue) => issue.reason)
}

function controlReasons(source: string): string[] {
  return scanInteractiveComponentSemantics('src/Test.svelte', source).map((issue) => issue.reason)
}
