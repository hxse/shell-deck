import type { ITheme } from '@xterm/xterm'
import type { EffectiveColorScheme } from '../theme'

export const XTERM_LIGHT_THEME: Readonly<ITheme> = Object.freeze({
  background: '#f8fafc',
  foreground: '#1f2937',
  cursor: '#0f172a',
  cursorAccent: '#f8fafc',
  selectionBackground: '#93c5fd80',
  selectionInactiveBackground: '#cbd5e166',
  black: '#1f2937',
  red: '#b91c1c',
  green: '#047857',
  yellow: '#a16207',
  blue: '#1d4ed8',
  magenta: '#a21caf',
  cyan: '#0e7490',
  white: '#e5e7eb',
  brightBlack: '#6b7280',
  brightRed: '#dc2626',
  brightGreen: '#059669',
  brightYellow: '#ca8a04',
  brightBlue: '#2563eb',
  brightMagenta: '#c026d3',
  brightCyan: '#0891b2',
  brightWhite: '#ffffff',
})

export const XTERM_DARK_THEME: Readonly<ITheme> = Object.freeze({
  background: '#111316',
  foreground: '#e6edf3',
  cursor: '#f8fafc',
  cursorAccent: '#111316',
  selectionBackground: '#3b82f680',
  selectionInactiveBackground: '#64748b66',
  black: '#1f242b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#e879f9',
  cyan: '#22d3ee',
  white: '#d1d5db',
  brightBlack: '#6b7280',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#f0abfc',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
})

export function xtermThemeForColorScheme(colorScheme: EffectiveColorScheme): ITheme {
  return colorScheme === 'dark' ? XTERM_DARK_THEME : XTERM_LIGHT_THEME
}
