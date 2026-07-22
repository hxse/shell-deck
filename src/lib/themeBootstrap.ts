import {
  BROWSER_SETTINGS_KEY,
  DEFAULT_BROWSER_SETTINGS,
  isBrowserSettingsValue,
} from './browserSettings'
import { effectiveColorScheme, THEME_PREFERENCES } from './theme'

export const THEME_BOOTSTRAP_PLACEHOLDER = '<script data-shell-deck-theme-bootstrap></script>'

export function createThemeBootstrapScript(): string {
  const darkThemes = THEME_PREFERENCES.filter((theme) => (
    theme !== 'system' && effectiveColorScheme(theme, false) === 'dark'
  ))

  return `(() => {
  const isBrowserSettingsValue = ${isBrowserSettingsValue.toString()};
  const themePreferences = ${JSON.stringify(THEME_PREFERENCES)};
  const darkThemes = new Set(${JSON.stringify(darkThemes)});
  let theme = ${JSON.stringify(DEFAULT_BROWSER_SETTINGS.theme)};
  try {
    const raw = window.localStorage.getItem(${JSON.stringify(BROWSER_SETTINGS_KEY)});
    if (raw !== null) {
      const value = JSON.parse(raw);
      if (isBrowserSettingsValue(value, themePreferences)) theme = value.theme;
    }
  } catch {}
  let prefersDark = false;
  if (theme === 'system') {
    try { prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch {}
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  document.documentElement.setAttribute(
    'data-theme-color-scheme',
    theme === 'system' ? (prefersDark ? 'dark' : 'light') : (darkThemes.has(theme) ? 'dark' : 'light'),
  );
})();`
}

export function injectThemeBootstrap(html: string): string {
  const occurrences = html.split(THEME_BOOTSTRAP_PLACEHOLDER).length - 1
  if (occurrences !== 1) throw new Error(`theme_bootstrap_placeholder_count:${occurrences}`)
  return html.replace(
    THEME_BOOTSTRAP_PLACEHOLDER,
    `<script data-shell-deck-theme-bootstrap>${createThemeBootstrapScript()}</script>`,
  )
}
