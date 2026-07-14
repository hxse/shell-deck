import { expect, test } from 'bun:test'
import { BROWSER_SETTINGS_KEY, DEFAULT_BROWSER_SETTINGS, loadBrowserSettings, saveBrowserSettings } from '../../src/lib/browserSettings'

test('browser settings persist only current UI preferences in one versioned value', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const initial = loadBrowserSettings(storage)
  expect(Object.hasOwn(initial.settings, 'autoPrepareTerminals')).toBe(false)
  saveBrowserSettings({ ...initial.settings, terminalDragEnabled: true }, storage)
  expect(JSON.parse(values.get(BROWSER_SETTINGS_KEY)!)).toMatchObject({ schemaVersion: 2, terminalDragEnabled: true })
  expect(loadBrowserSettings(storage).reset).toBe(false)
})

test('invalid or old browser schemas reset instead of aliasing fields', () => {
  const storage = { getItem: () => JSON.stringify({ ...DEFAULT_BROWSER_SETTINGS, schemaVersion: 1, autoPrepareTerminals: true }) }
  expect(loadBrowserSettings(storage)).toEqual({ settings: DEFAULT_BROWSER_SETTINGS, reset: true })
})

test('unrelated historical keys are not read, removed or converted', () => {
  const reads: string[] = []
  const storage = {
    getItem(key: string) {
      reads.push(key)
      return key === 'shell-deck:tab-drag-enabled' ? 'true' : null
    },
  }
  expect(loadBrowserSettings(storage)).toEqual({ settings: DEFAULT_BROWSER_SETTINGS, reset: false })
  expect(reads).toEqual([BROWSER_SETTINGS_KEY])
})
