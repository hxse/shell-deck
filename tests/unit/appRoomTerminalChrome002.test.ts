import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { documentColorScheme } from '../../src/lib/theme'
import {
  XTERM_DARK_THEME,
  XTERM_LIGHT_THEME,
  xtermThemeForColorScheme,
} from '../../src/lib/terminal/xtermTheme'

const projectRoot = resolve(import.meta.dir, '../..')
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8')

const ANSI_KEYS = [
  'background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground',
  'selectionInactiveBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
] as const

test('xterm bridge exposes two complete palettes through the canonical effective appearance', () => {
  for (const palette of [XTERM_LIGHT_THEME, XTERM_DARK_THEME]) {
    for (const key of ANSI_KEYS) expect(palette[key]).toMatch(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i)
  }
  expect(xtermThemeForColorScheme('light')).toBe(XTERM_LIGHT_THEME)
  expect(xtermThemeForColorScheme('dark')).toBe(XTERM_DARK_THEME)
  expect(documentColorScheme({ getAttribute: () => 'dark' })).toBe('dark')
  expect(documentColorScheme({ getAttribute: () => 'light' })).toBe('light')
  expect(documentColorScheme({ getAttribute: () => null })).toBe('light')
})

test('TerminalSlot updates the existing xterm theme without a second theme catalog or lifecycle reset', () => {
  const source = read('src/lib/components/TerminalSlot.svelte')
  expect(source).toContain('observeDocumentColorScheme(applyTerminalTheme)')
  expect(source).toContain('theme: xtermThemeForColorScheme(colorScheme)')
  expect(source).toContain("shell-deck-terminal-test-state-request")
  expect(source).toContain('detail?.accept')
  for (const attribute of [
    'data-terminal-instance-id',
    'data-terminal-color-scheme',
    'data-terminal-base-y',
    'data-terminal-viewport-y',
    'data-terminal-cursor-x',
    'data-terminal-cursor-y',
    'data-terminal-selection',
  ]) {
    expect(source).not.toContain(attribute)
  }
  const updateBody = source.match(/function applyTerminalTheme[\s\S]*?\n  }/)?.[0]
  if (!updateBody) throw new Error('terminal_theme_update_missing')
  expect(updateBody).toContain('xterm.options.theme = xtermThemeForColorScheme(nextColorScheme)')
  for (const forbidden of ['dispose(', 'reset(', 'clear(', 'write(', 'scrollToBottom(', 'open(', 'fitToHost(']) {
    expect(updateBody).not.toContain(forbidden)
  }
  expect(source).not.toContain("theme: { background: '#111316'")
})

test('framework owns migrated components and only runtime xterm geometry remains as a global bridge', () => {
  const framework = read('src/framework.css')
  const included = framework.match(/include:\s*([^;]+);/)?.[1].split(',').map((entry) => entry.trim())
  expect(included).toEqual(['alert', 'badge', 'button', 'range', 'select', 'tab', 'textarea'])
  expect(framework.match(/\.terminal-host/g)).toHaveLength(2)
  expect(framework).not.toMatch(/#[0-9a-f]{3,8}\b/i)

  for (const component of [
    'src/App.svelte',
    'src/lib/components/RoomHome.svelte',
    'src/lib/components/TerminalSlot.svelte',
    'src/lib/components/TextBoxSlot.svelte',
    'src/lib/components/workspace/TerminalTabBar.svelte',
    'src/lib/components/workspace/NoticeStack.svelte',
  ]) {
    expect(read(component)).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  }
})

test('legacy CSS residue points only to the pending Macro and Library migration', () => {
  expect(existsSync(resolve(projectRoot, 'src/styles/room.css'))).toBe(false)
  expect(existsSync(resolve(projectRoot, 'src/styles/workspace-panels.css'))).toBe(false)
  expect(existsSync(resolve(projectRoot, 'src/styles/workbench-responsive.css'))).toBe(false)
  expect(read('src/styles.css')).not.toMatch(/room\.css|workspace-panels\.css/)
  expect(read('src/styles/macro-workbench.css')).not.toMatch(/workspace-panels\.css|workbench-responsive\.css/)

  const base = read('src/styles/base.css').trim()
  expect(base.startsWith(':where(.macro-panel, .library-panel) button')).toBe(true)
  expect(base.match(/\{/g)).toHaveLength(1)

  const remainingLegacyCss = readdirSync(resolve(projectRoot, 'src/styles'))
    .filter((name) => name.endsWith('.css'))
    .map((name) => read('src/styles/' + name))
    .join('\n')
  for (const migratedSelector of [
    '.room-', '.terminal-', '.text-box', '.settings-', '.notice', '.workspace-',
    '.tab-', '.topbar', '.panel-resize', '.side-panel', '.macro-side-panel',
    '.library-side-panel', '.switch-', '.drag-toggle',
  ]) {
    expect(remainingLegacyCss).not.toContain(migratedSelector)
  }
  const terminal = read('src/styles/terminal.css')
  expect(terminal).toContain('.macro-panel')
  expect(terminal.match(/:where\(\.macro-panel, \.library-panel\) textarea/g)).toHaveLength(2)
  expect(terminal.match(/:where\(\.macro-panel, \.library-panel\) select/g)).toHaveLength(2)
  expect(terminal).not.toContain(':not(.textarea)')
  expect(terminal).not.toContain(':not(.select)')

  const macroChrome = read('src/styles/macro-chrome.css')
  const shared = read('src/styles/workbench-shared.css')
  expect(macroChrome).not.toMatch(/(?:^|\})\s*\.macro-workbench-shell\s*\{/)
  expect(shared).not.toMatch(/(?:^|,)\s*\.macro-workbench-shell\s*(?:,|\{)/)
  expect(remainingLegacyCss).not.toMatch(/(?:^|,)\s*\.inline-actions\s*(?:,|\{)/m)
})
