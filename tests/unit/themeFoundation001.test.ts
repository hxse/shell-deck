import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyDocumentTheme,
  DAISY_UI_THEME_IDS,
  effectiveColorScheme,
  isThemePreference,
  observeDocumentTheme,
  THEME_PREFERENCES,
  themePreferenceLabel,
} from '../../src/lib/theme'

const EXPECTED_THEME_IDS = [
  'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate', 'synthwave', 'retro', 'cyberpunk',
  'valentine', 'halloween', 'garden', 'forest', 'aqua', 'lofi', 'pastel', 'fantasy', 'wireframe',
  'black', 'luxury', 'dracula', 'cmyk', 'autumn', 'business', 'acid', 'lemonade', 'night', 'coffee',
  'winter', 'dim', 'nord', 'sunset', 'caramellatte', 'abyss', 'silk',
] as const

test('theme catalog exposes exactly 35 daisyUI themes and 36 strict preferences', () => {
  expect(DAISY_UI_THEME_IDS).toEqual(EXPECTED_THEME_IDS)
  expect(new Set(DAISY_UI_THEME_IDS).size).toBe(35)
  expect(THEME_PREFERENCES).toEqual(['system', ...EXPECTED_THEME_IDS])
  expect(THEME_PREFERENCES).toHaveLength(36)
  for (const theme of THEME_PREFERENCES) {
    expect(isThemePreference(theme)).toBe(true)
    expect(themePreferenceLabel(theme)).toBe(theme[0].toUpperCase() + theme.slice(1))
  }
  for (const value of ['Dark', 'SYSTEM', 'auto', 'system ', '', null, 1]) expect(isThemePreference(value)).toBe(false)
})

test('the final app CSS registers the canonical catalog with one default and one prefers-dark theme', () => {
  const css = readFileSync(resolve(import.meta.dir, '../../src/app.css'), 'utf8')
  expect(css).toContain('@import "tailwindcss/theme.css" layer(theme);')
  expect(css).toContain('@import "tailwindcss/utilities.css" layer(utilities);')
  expect(css).not.toContain('@import "tailwindcss";')
  expect(css).not.toContain('preflight.css')
  const includedComponents = css.match(/include:\s*([^;]+);/)?.[1].split(',').map((entry) => entry.trim()) ?? []
  expect(includedComponents).toContain('select')
  const configured = css.match(/themes:\s*([\s\S]*?);/)?.[1]
  if (!configured) throw new Error('daisyui_theme_config_missing')
  const entries = configured.split(',').map((entry) => entry.trim())
  expect(entries.map((entry) => entry.split(/\s+/)[0])).toEqual([...EXPECTED_THEME_IDS])
  expect(entries.filter((entry) => entry.includes('--default'))).toEqual(['light --default'])
  expect(entries.filter((entry) => entry.includes('--prefersdark'))).toEqual(['dark --prefersdark'])
})

test('main applies the loaded theme before mount and imports the single final CSS entry', () => {
  const source = readFileSync(resolve(import.meta.dir, '../../src/main.ts'), 'utf8')
  expect(source.match(/import ['"].*\.css['"]/g)).toEqual(["import './app.css'"])
  expect(source.indexOf('applyDocumentTheme(loadedSettings.settings.theme)')).toBeLessThan(source.indexOf('mount(App'))
})

test('the completed migration keeps the framework entry free of presentation compatibility layers', () => {
  const css = readFileSync(resolve(import.meta.dir, '../../src/app.css'), 'utf8')
  expect(css).not.toContain('@apply')
  expect(css).not.toMatch(/@layer\s+[\w,-]+\s*\{/)
})

test('document application owns explicit and system root attributes', () => {
  const root = fakeRoot()
  expect(applyDocumentTheme('synthwave', { root })).toBe('dark')
  expect(root.attributes.get('data-theme')).toBe('synthwave')
  expect(root.attributes.get('data-theme-color-scheme')).toBe('dark')

  expect(applyDocumentTheme('cupcake', { root })).toBe('light')
  expect(root.attributes.get('data-theme-color-scheme')).toBe('light')

  expect(applyDocumentTheme('system', { root, prefersDark: true })).toBe('dark')
  expect(root.attributes.has('data-theme')).toBe(false)
  expect(root.attributes.get('data-theme-color-scheme')).toBe('dark')
  expect(effectiveColorScheme('system', false)).toBe('light')
})

test('only system observation installs a media listener and dispose removes it', () => {
  const root = fakeRoot()
  const listeners = new Set<() => void>()
  let matches = false
  let matchMediaCalls = 0
  const media = {
    get matches() { return matches },
    addEventListener(_type: 'change', listener: () => void) { listeners.add(listener) },
    removeEventListener(_type: 'change', listener: () => void) { listeners.delete(listener) },
  }
  const matchMedia = (query: string) => {
    expect(query).toBe('(prefers-color-scheme: dark)')
    matchMediaCalls += 1
    return media
  }

  const disposeSystem = observeDocumentTheme('system', { root, matchMedia })
  expect(matchMediaCalls).toBe(1)
  expect(listeners.size).toBe(1)
  expect(root.attributes.get('data-theme-color-scheme')).toBe('light')
  matches = true
  for (const listener of listeners) listener()
  expect(root.attributes.get('data-theme-color-scheme')).toBe('dark')
  disposeSystem()
  expect(listeners.size).toBe(0)

  const disposeExplicit = observeDocumentTheme('nord', { root, matchMedia })
  expect(matchMediaCalls).toBe(1)
  expect(root.attributes.get('data-theme')).toBe('nord')
  expect(root.attributes.get('data-theme-color-scheme')).toBe('light')
  disposeExplicit()
})

function fakeRoot() {
  const attributes = new Map<string, string>()
  return {
    attributes,
    setAttribute(name: string, value: string) { attributes.set(name, value) },
    removeAttribute(name: string) { attributes.delete(name) },
  }
}
