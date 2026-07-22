import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  registeredDarkThemeOverrideIds,
  scanAppCss,
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
const expectedBase300 = 'color-mix(in oklab, var(--color-base-content) 60%, var(--color-base-100))'
const expectedDarkThemeSet = new Set<string>(expectedDarkThemes)

describe('20260722C business default and dark border contrast', () => {
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

  test('app CSS registers one exact semantic contrast override per dark theme', () => {
    const css = readFileSync(resolve(projectRoot, 'src/app.css'), 'utf8')
    expect(registeredDarkThemeOverrideIds(css)).toEqual([...expectedDarkThemes])
    expect(css.match(new RegExp(escapeRegExp(expectedBase300), 'g'))).toHaveLength(2)
    expect(css.match(/--depth:\s*1;/g)).toHaveLength(2)
    expect(scanAppCss(css)).toEqual([])
  })

  test('the default residue Gate rejects dark override drift', () => {
    const css = readFileSync(resolve(projectRoot, 'src/app.css'), 'utf8')

    const wrongMix = css.replace(expectedBase300, expectedBase300.replace('60%', '50%'))
    expect(reasons(wrongMix)).toContain(`explicit dark theme --color-base-300 must be ${expectedBase300}`)

    const wrongDepth = css.replace('--depth: 1;', '--depth: 0;')
    expect(reasons(wrongDepth)).toContain('explicit dark theme --depth must be 1')

    const extraLight = css.replace('[data-theme="business"]', '[data-theme="light"]')
    expect(reasons(extraLight).some((reason) => reason.includes('explicit dark theme token owner drifts from the canonical catalog'))).toBe(true)

    const missingAbyss = css.replace(', [data-theme="abyss"]', '')
    expect(reasons(missingAbyss).some((reason) => reason.includes('explicit dark theme token owner drifts from the canonical catalog'))).toBe(true)

    const misplacedSystem = css.replace('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {', '@media (prefers-color-scheme: dark) {}\n\n:root:not([data-theme]) {').replace('\n  }\n}\n\n:root {', '\n}\n\n:root {')
    expect(reasons(misplacedSystem)).toContain('system dark theme token owner must be nested under prefers-color-scheme: dark')
  })
})

function reasons(css: string): string[] {
  return scanAppCss(css).map((issue) => issue.reason)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
