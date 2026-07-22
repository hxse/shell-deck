export const DAISY_UI_THEME_IDS = [
  'light',
  'dark',
  'cupcake',
  'bumblebee',
  'emerald',
  'corporate',
  'synthwave',
  'retro',
  'cyberpunk',
  'valentine',
  'halloween',
  'garden',
  'forest',
  'aqua',
  'lofi',
  'pastel',
  'fantasy',
  'wireframe',
  'black',
  'luxury',
  'dracula',
  'cmyk',
  'autumn',
  'business',
  'acid',
  'lemonade',
  'night',
  'coffee',
  'winter',
  'dim',
  'nord',
  'sunset',
  'caramellatte',
  'abyss',
  'silk',
] as const

export const THEME_PREFERENCES = ['system', ...DAISY_UI_THEME_IDS] as const

export type DaisyUiThemeId = typeof DAISY_UI_THEME_IDS[number]
export type ThemePreference = typeof THEME_PREFERENCES[number]
export type EffectiveColorScheme = 'light' | 'dark'

const themePreferences = new Set<string>(THEME_PREFERENCES)
const darkThemeIds = new Set<DaisyUiThemeId>([
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
])

type ThemeRoot = Pick<HTMLElement, 'removeAttribute' | 'setAttribute'>
type ThemeChangeListener = () => void
type ThemeMediaQuery = {
  readonly matches: boolean
  addEventListener(type: 'change', listener: ThemeChangeListener): void
  removeEventListener(type: 'change', listener: ThemeChangeListener): void
}
type MatchMedia = (query: string) => ThemeMediaQuery

type ThemeApplicationOptions = {
  root?: ThemeRoot
  prefersDark?: boolean
}

type ThemeObservationOptions = {
  root?: ThemeRoot
  matchMedia?: MatchMedia
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && themePreferences.has(value)
}

export function themePreferenceLabel(theme: ThemePreference): string {
  return theme[0].toUpperCase() + theme.slice(1)
}

export function effectiveColorScheme(theme: ThemePreference, prefersDark: boolean): EffectiveColorScheme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return darkThemeIds.has(theme) ? 'dark' : 'light'
}

export function applyDocumentTheme(
  theme: ThemePreference,
  options: ThemeApplicationOptions = {},
): EffectiveColorScheme {
  const root = options.root ?? document.documentElement
  const prefersDark = theme === 'system'
    ? options.prefersDark ?? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
  const colorScheme = effectiveColorScheme(theme, prefersDark)

  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  root.setAttribute('data-theme-color-scheme', colorScheme)

  return colorScheme
}

export function observeDocumentTheme(
  theme: ThemePreference,
  options: ThemeObservationOptions = {},
): () => void {
  const root = options.root ?? document.documentElement
  if (theme !== 'system') {
    applyDocumentTheme(theme, { root })
    return () => {}
  }

  const matchMedia = options.matchMedia ?? window.matchMedia.bind(window)
  const media = matchMedia('(prefers-color-scheme: dark)')
  const applySystemTheme = () => applyDocumentTheme('system', { root, prefersDark: media.matches })
  applySystemTheme()
  media.addEventListener('change', applySystemTheme)
  return () => media.removeEventListener('change', applySystemTheme)
}
