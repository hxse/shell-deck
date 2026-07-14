export const BROWSER_SETTINGS_KEY = 'shell-deck:settings:v2'

export type BrowserSettings = {
  schemaVersion: 2
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
  schemaVersion: 2,
  panels: {
    macro: { visible: true, widthPx: 760 },
    library: { visible: false, widthPx: 380 },
  },
  macroInsertionPlacement: 'anchored',
  terminalDragEnabled: false,
  notificationVolume: 2.4,
  library: { selectedTab: 'json-template', filter: '' },
}

export function loadBrowserSettings(storage: Pick<Storage, 'getItem'> = window.localStorage): { settings: BrowserSettings; reset: boolean } {
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
  if (!isRecord(value) || value.schemaVersion !== 2 || !isRecord(value.panels) || !isRecord(value.library)) return false
  if (!hasExactKeys(value, ['schemaVersion', 'panels', 'macroInsertionPlacement', 'terminalDragEnabled', 'notificationVolume', 'library'])) return false
  if (!hasExactKeys(value.panels, ['macro', 'library']) || !hasExactKeys(value.library, ['selectedTab', 'filter'])) return false
  if (!isPanel(value.panels.macro) || !isPanel(value.panels.library)) return false
  if (value.macroInsertionPlacement !== 'anchored' && value.macroInsertionPlacement !== 'center') return false
  if (typeof value.terminalDragEnabled !== 'boolean') return false
  if (typeof value.notificationVolume !== 'number' || !Number.isFinite(value.notificationVolume) || value.notificationVolume < 0 || value.notificationVolume > 10) return false
  if (!['json-template', 'prompt', 'note'].includes(String(value.library.selectedTab)) || typeof value.library.filter !== 'string') return false
  return true
}

function isPanel(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ['visible', 'widthPx']) && typeof value.visible === 'boolean' && typeof value.widthPx === 'number' && Number.isFinite(value.widthPx) && value.widthPx >= 220 && value.widthPx <= 1200
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}
