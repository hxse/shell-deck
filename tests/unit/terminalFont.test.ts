import { readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_WEIGHT, TERMINAL_FONT_WEIGHT_BOLD } from '../../src/lib/terminalFont'

test('terminal font stack prefers local Maple Mono families', () => {
  expect(TERMINAL_FONT_FAMILY.startsWith('"Maple Mono NF CN", "Maple Mono NF", "Maple Mono CN", "Maple Mono"')).toBe(true)
  expect(TERMINAL_FONT_FAMILY.includes('url(')).toBe(false)
  expect(TERMINAL_FONT_FAMILY.includes('@font-face')).toBe(false)
  expect(TERMINAL_FONT_WEIGHT).toBe(400)
  expect(TERMINAL_FONT_WEIGHT_BOLD).toBe(700)
  const frameworkCss = readFileSync('src/app.css', 'utf8')
  const textSlot = readFileSync('src/lib/components/TextBoxSlot.svelte', 'utf8')
  expect(frameworkCss).toContain('--shell-deck-terminal-font-family: ')
  expect(frameworkCss).toContain('Maple Mono NF CN')
  expect(textSlot).toContain('font-[var(--shell-deck-terminal-font-family)]')
})
