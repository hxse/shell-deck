import { THEME_PREFERENCES, type ThemePreference } from './theme'

export const BROWSER_SETTINGS_KEY = 'shell-deck:settings:v3'

export type BrowserSettings = {
  schemaVersion: 3
  theme: ThemePreference
  panels: {
    macro: { visible: boolean; widthPx: number }
    library: { visible: boolean; widthPx: number }
  }
  macroInsertionPlacement: 'anchored' | 'center'
  terminalDragEnabled: boolean
  notificationVolume: number
  library: { selectedTab: 'json-template' | 'prompt' | 'note'; filter: string }
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  schemaVersion: 3,
  theme: 'business',
  panels: {
    macro: { visible: true, widthPx: 760 },
    library: { visible: false, widthPx: 380 },
  },
  macroInsertionPlacement: 'anchored',
  terminalDragEnabled: false,
  notificationVolume: 2.4,
  library: { selectedTab: 'json-template', filter: '' },
}

export type LoadedBrowserSettings = { settings: BrowserSettings; reset: boolean }

export function loadBrowserSettings(storage: Pick<Storage, 'getItem'> = window.localStorage): LoadedBrowserSettings {
  const raw = storage.getItem(BROWSER_SETTINGS_KEY)
  if (raw === null) return { settings: structuredClone(DEFAULT_BROWSER_SETTINGS), reset: false }
  try {
    const value = JSON.parse(raw)
    if (!isBrowserSettings(value)) throw new Error('invalid_browser_settings')
    return { settings: value, reset: false }
  } catch {
    return { settings: structuredClone(DEFAULT_BROWSER_SETTINGS), reset: true }
  }
}

export function saveBrowserSettings(settings: BrowserSettings, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  if (!isBrowserSettings(settings)) throw new Error('invalid_browser_settings')
  storage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(settings))
}

export function isBrowserSettings(value: unknown): value is BrowserSettings {
  return isBrowserSettingsValue(value, THEME_PREFERENCES)
}

// Keep this validator self-contained: Vite serializes the same function into the
// parser-blocking head bootstrap, so first paint and the application loader cannot
// drift onto different browser-settings schemas.
export function isBrowserSettingsValue(value: unknown, themePreferences: readonly string[]): boolean {
  function isRecord(candidate: unknown): candidate is Record<string, unknown> {
    return Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate)
  }

  function hasExactKeys(candidate: Record<string, unknown>, keys: string[]): boolean {
    return Object.keys(candidate).sort().join(',') === [...keys].sort().join(',')
  }

  function isPanel(candidate: unknown): boolean {
    return isRecord(candidate)
      && hasExactKeys(candidate, ['visible', 'widthPx'])
      && typeof candidate.visible === 'boolean'
      && typeof candidate.widthPx === 'number'
      && Number.isFinite(candidate.widthPx)
      && candidate.widthPx >= 220
      && candidate.widthPx <= 1200
  }

  if (!isRecord(value) || value.schemaVersion !== 3 || !isRecord(value.panels) || !isRecord(value.library)) return false
  if (!hasExactKeys(value, ['schemaVersion', 'theme', 'panels', 'macroInsertionPlacement', 'terminalDragEnabled', 'notificationVolume', 'library'])) return false
  if (typeof value.theme !== 'string' || !themePreferences.includes(value.theme)) return false
  if (!hasExactKeys(value.panels, ['macro', 'library']) || !hasExactKeys(value.library, ['selectedTab', 'filter'])) return false
  if (!isPanel(value.panels.macro) || !isPanel(value.panels.library)) return false
  if (value.macroInsertionPlacement !== 'anchored' && value.macroInsertionPlacement !== 'center') return false
  if (typeof value.terminalDragEnabled !== 'boolean') return false
  if (typeof value.notificationVolume !== 'number' || !Number.isFinite(value.notificationVolume) || value.notificationVolume < 0 || value.notificationVolume > 10) return false
  if (typeof value.library.selectedTab !== 'string' || !['json-template', 'prompt', 'note'].includes(value.library.selectedTab) || typeof value.library.filter !== 'string') return false
  return true
}
