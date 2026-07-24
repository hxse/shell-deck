import { expect, test } from 'bun:test'
import { BROWSER_SETTINGS_KEY, DEFAULT_BROWSER_SETTINGS, loadBrowserSettings, saveBrowserSettings } from '../../src/lib/browserSettings'
import {
  createThemeBootstrapScript,
  injectThemeBootstrap,
  THEME_BOOTSTRAP_PLACEHOLDER,
} from '../../src/lib/themeBootstrap'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('browser settings persist only current UI preferences in one versioned value', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const initial = loadBrowserSettings(storage)
  expect(Object.hasOwn(initial.settings, 'autoPrepareTerminals')).toBe(false)
  expect(initial.settings.theme).toBe('business')
  saveBrowserSettings({ ...initial.settings, theme: 'nord', terminalDragEnabled: true }, storage)
  expect(JSON.parse(values.get(BROWSER_SETTINGS_KEY)!)).toMatchObject({ schemaVersion: 4, theme: 'nord', terminalDragEnabled: true })
  expect(loadBrowserSettings(storage).reset).toBe(false)
})

test('invalid current-key values reset instead of filling, dropping or aliasing fields', () => {
  const { theme: _theme, ...settingsWithoutTheme } = DEFAULT_BROWSER_SETTINGS
  const invalidValues = [
    { ...settingsWithoutTheme, schemaVersion: 3 },
    { ...DEFAULT_BROWSER_SETTINGS, theme: undefined },
    { ...DEFAULT_BROWSER_SETTINGS, theme: 'Dark' },
    { ...DEFAULT_BROWSER_SETTINGS, themeName: 'dark' },
    {
      ...DEFAULT_BROWSER_SETTINGS,
      panels: { ...DEFAULT_BROWSER_SETTINGS.panels, library: { visible: false, widthPx: 380 } },
    },
    {
      ...DEFAULT_BROWSER_SETTINGS,
      library: { selectedTab: 'json-template', filter: '' },
    },
  ]
  for (const value of invalidValues) {
    const storage = { getItem: () => JSON.stringify(value) }
    expect(loadBrowserSettings(storage)).toEqual({ settings: DEFAULT_BROWSER_SETTINGS, reset: true })
  }
})

test('v3 and unrelated historical keys are not read, removed or converted', () => {
  const reads: string[] = []
  const storage = {
    getItem(key: string) {
      reads.push(key)
      if (key === 'shell-deck:settings:v3') return JSON.stringify({ schemaVersion: 3, theme: 'dark' })
      return key === 'shell-deck:tab-drag-enabled' ? 'true' : null
    },
  }
  expect(loadBrowserSettings(storage)).toEqual({ settings: DEFAULT_BROWSER_SETTINGS, reset: false })
  expect(reads).toEqual([BROWSER_SETTINGS_KEY])
})

test('default settings are returned as independent deep clones', () => {
  const first = loadBrowserSettings({ getItem: () => null }).settings
  const second = loadBrowserSettings({ getItem: () => null }).settings
  first.panels.macro.widthPx = 999
  expect(second).toEqual(DEFAULT_BROWSER_SETTINGS)
  expect(second).not.toBe(DEFAULT_BROWSER_SETTINGS)
  expect(second.panels).not.toBe(DEFAULT_BROWSER_SETTINGS.panels)
})

test('saver rejects non-exact v4 settings', () => {
  const writes: string[] = []
  const storage = { setItem: (_key: string, value: string) => { writes.push(value) } }
  expect(() => saveBrowserSettings({ ...DEFAULT_BROWSER_SETTINGS, theme: 'unknown' } as never, storage)).toThrow('invalid_browser_settings')
  expect(() => saveBrowserSettings({ ...DEFAULT_BROWSER_SETTINGS, extra: true } as never, storage)).toThrow('invalid_browser_settings')
  expect(writes).toEqual([])
})

test('the generated synchronous head bootstrap shares the exact browser-settings truth', () => {
  const html = readFileSync(resolve(import.meta.dir, '../../index.html'), 'utf8')
  expect(html.indexOf(THEME_BOOTSTRAP_PLACEHOLDER)).toBeGreaterThan(html.indexOf('<head>'))
  expect(html.indexOf(THEME_BOOTSTRAP_PLACEHOLDER)).toBeLessThan(html.indexOf('<title>'))
  const transformed = injectThemeBootstrap(html)
  expect(transformed).not.toContain(THEME_BOOTSTRAP_PLACEHOLDER)
  expect(transformed).toContain('<script data-shell-deck-theme-bootstrap>(() => {')

  const explicit = runThemeBootstrap(JSON.stringify({ ...structuredClone(DEFAULT_BROWSER_SETTINGS), theme: 'synthwave' }), false)
  expect(explicit.get('data-theme')).toBe('synthwave')
  expect(explicit.get('data-theme-color-scheme')).toBe('dark')

  const missing = runThemeBootstrap(null, false)
  expect(missing.get('data-theme')).toBe('business')
  expect(missing.get('data-theme-color-scheme')).toBe('dark')

  const system = runThemeBootstrap(JSON.stringify({ ...structuredClone(DEFAULT_BROWSER_SETTINGS), theme: 'system' }), true)
  expect(system.has('data-theme')).toBe(false)
  expect(system.get('data-theme-color-scheme')).toBe('dark')

  const invalid = runThemeBootstrap(JSON.stringify({ ...structuredClone(DEFAULT_BROWSER_SETTINGS), theme: 'synthwave', extra: true }), false)
  expect(invalid.get('data-theme')).toBe('business')
  expect(invalid.get('data-theme-color-scheme')).toBe('dark')
})

function runThemeBootstrap(rawSettings: string | null, prefersDark: boolean): Map<string, string> {
  const attributes = new Map<string, string>()
  const root = {
    setAttribute(name: string, value: string) { attributes.set(name, value) },
    removeAttribute(name: string) { attributes.delete(name) },
  }
  const bootstrap = new Function('window', 'document', createThemeBootstrapScript())
  bootstrap({
    localStorage: { getItem: () => rawSettings },
    matchMedia: () => ({ matches: prefersDark }),
  }, { documentElement: root })
  return attributes
}
