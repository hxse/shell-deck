import { resolve } from 'node:path'
import { DAISY_UI_THEME_IDS } from '../../src/lib/theme'
import {
  issueAt,
  lineOf,
  readIfPresent,
  scanProductionColorText,
  type UiStyleResidueIssue,
} from './shared'

const ALLOWED_CSS_IMPORTS = new Map([
  ['src/main.ts', new Set(['./app.css'])],
  ['src/lib/components/TerminalSlot.svelte', new Set(['@xterm/xterm/css/xterm.css'])],
])
const ALLOWED_APP_BLOCKS = new Set([
  '@plugin "daisyui"',
  ':root',
  '.terminal-host > .xterm',
  '.terminal-host .xterm-screen',
  '.terminal-host .xterm-viewport',
])
const ALLOWED_XTERM_PROPERTIES = new Set([
  'position', 'inset', 'top', 'right', 'bottom', 'left', 'width', 'height', 'overflow', 'overflow-x', 'overflow-y',
])

export function scanAppCss(source: string): UiStyleResidueIssue[] {
  const file = 'src/app.css'
  const issues = scanProductionColorText(file, source)
  const blocks = cssBlocks(source)
  const requiredDirectives = [
    '@layer theme, base, components, utilities;',
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
    '@plugin "daisyui" {',
  ]
  for (const directive of requiredDirectives) {
    if (!source.includes(directive)) issues.push({ file, line: 1, reason: `required framework directive missing: ${directive}` })
  }
  const imports = [...source.matchAll(/@import\s+[^;]+;/g)].map((match) => match[0].trim())
  const allowedImports = [
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
  ]
  if (imports.join('\n') !== allowedImports.join('\n')) {
    issues.push({ file, line: 1, reason: `framework imports must match the app.css allowlist; found ${imports.join(', ') || 'none'}` })
  }
  for (const forbidden of [/@apply\b/g, /@layer\s+[\w,-]+\s*\{/g]) {
    for (const match of source.matchAll(forbidden)) {
      issues.push(issueAt(file, source, match.index, 'custom CSS layer/application is forbidden'))
    }
  }

  for (const block of blocks) {
    if (!ALLOWED_APP_BLOCKS.has(block.owner)) {
      issues.push(issueAt(file, source, block.index, `CSS block is outside the app.css allowlist: ${block.owner}`))
    }
  }

  const pluginBlocks = blocks.filter((block) => block.owner === '@plugin "daisyui"')
  if (pluginBlocks.length !== 1) {
    issues.push({ file, line: lineOf(source, pluginBlocks[1]?.index ?? pluginBlocks[0]?.index ?? 0), reason: `daisyUI plugin owner must appear exactly once; found ${pluginBlocks.length}` })
  }
  for (const block of pluginBlocks) {
    const properties = declarationNames(block.body)
    if (properties.join(',') !== 'include,themes') {
      issues.push({ file, line: lineOf(source, block.index), reason: `daisyUI plugin may only declare include and themes; found ${properties.join(', ') || 'none'}` })
    }
  }

  const rootBlocks = blocks.filter((block) => block.owner === ':root')
  if (rootBlocks.length === 0) {
    issues.push({ file, line: 1, reason: 'terminal font token owner is missing' })
  } else {
    if (rootBlocks.length !== 1) {
      issues.push({ file, line: lineOf(source, rootBlocks[1]?.index ?? rootBlocks[0].index), reason: `:root must have exactly one terminal font token owner; found ${rootBlocks.length}` })
    }
    for (const block of rootBlocks) {
      const properties = declarationNames(block.body)
      if (properties.join(',') !== '--shell-deck-terminal-font-family') {
        issues.push({ file, line: lineOf(source, block.index), reason: `:root may only declare --shell-deck-terminal-font-family; found ${properties.join(', ') || 'none'}` })
      }
    }
  }

  for (const block of blocks) {
    if (!block.owner.startsWith('.terminal-host ')) continue
    for (const property of declarationNames(block.body)) {
      if (!ALLOWED_XTERM_PROPERTIES.has(property)) {
        issues.push({ file, line: lineOf(source, block.index), reason: `${block.owner} uses non-structural property ${property}` })
      }
    }
  }
  return issues
}

export function scanCssImports(file: string, source: string): UiStyleResidueIssue[] {
  const issues: UiStyleResidueIssue[] = []
  const allowed = ALLOWED_CSS_IMPORTS.get(file) ?? new Set<string>()
  for (const match of source.matchAll(/\bimport\s+(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+\.css)['"]/g)) {
    const specifier = match[1]
    if (!allowed.has(specifier)) issues.push(issueAt(file, source, match.index, `CSS import is outside the final allowlist: ${specifier}`))
  }
  for (const specifier of allowed) {
    const quoted = [`'${specifier}'`, `"${specifier}"`]
    if (!quoted.some((value) => source.includes(value))) {
      issues.push({ file, line: 1, reason: `required CSS import missing: ${specifier}` })
    }
  }
  return issues
}

export function scanThemeCatalogOwners(projectRoot: string, appCss: string): UiStyleResidueIssue[] {
  const issues: UiStyleResidueIssue[] = []
  const configured = registeredThemeIds(appCss)
  if (configured.join('\n') !== DAISY_UI_THEME_IDS.join('\n')) {
    issues.push({ file: 'src/app.css', line: 1, reason: `daisyUI themes drift from the canonical catalog: ${configured.join(', ') || 'none'}` })
  }
  if (new Set(configured).size !== configured.length) {
    issues.push({ file: 'src/app.css', line: 1, reason: 'daisyUI theme registration contains duplicates' })
  }

  const appSource = readIfPresent(resolve(projectRoot, 'src/App.svelte'))
  if (!appSource.includes('{#each THEME_PREFERENCES as theme}')) {
    issues.push({ file: 'src/App.svelte', line: 1, reason: 'Settings Theme options must use the canonical THEME_PREFERENCES catalog' })
  }
  const settingsSource = readIfPresent(resolve(projectRoot, 'src/lib/browserSettings.ts'))
  if (!settingsSource.includes('isBrowserSettingsValue(value, THEME_PREFERENCES)')) {
    issues.push({ file: 'src/lib/browserSettings.ts', line: 1, reason: 'browser settings Theme guard must pass the canonical THEME_PREFERENCES catalog to the exact shared validator' })
  }
  const bootstrapSource = readIfPresent(resolve(projectRoot, 'src/lib/themeBootstrap.ts'))
  if (!bootstrapSource.includes('isBrowserSettingsValue.toString()') || !bootstrapSource.includes('JSON.stringify(THEME_PREFERENCES)')) {
    issues.push({ file: 'src/lib/themeBootstrap.ts', line: 1, reason: 'first-paint Theme bootstrap must serialize the exact shared validator and canonical catalog' })
  }
  return issues
}

export function registeredThemeIds(source: string): string[] {
  const configured = source.match(/themes:\s*([\s\S]*?);/)?.[1]
  if (!configured) return []
  return configured.split(',').map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean)
}

function declarationNames(body: string): string[] {
  return cssDeclarations(body).map(([name]) => name)
}

function cssDeclarations(body: string): Array<[name: string, value: string]> {
  return [...body.matchAll(/(?:^|;)\s*(--[\w-]+|[a-z][\w-]*)\s*:\s*([^;]+)(?=;|$)/gm)]
    .map((match) => [match[1], match[2].trim()])
}

function cssBlocks(source: string): Array<{ owner: string; index: number; body: string; parentOwner?: string }> {
  const structuralSource = maskCssCommentsAndStructuralStringCharacters(source)
  const openBlocks: Array<{ owner: string; index: number; bodyStart: number; parentOwner?: string }> = []
  const blocks: Array<{ owner: string; index: number; body: string; parentOwner?: string }> = []

  for (let index = 0; index < structuralSource.length; index += 1) {
    const character = structuralSource[index]
    if (character === '{') {
      let boundary = index - 1
      while (boundary >= 0 && !';{}'.includes(structuralSource[boundary])) boundary -= 1
      const ownerSource = structuralSource.slice(boundary + 1, index)
      const ownerOffset = ownerSource.search(/\S/)
      const ownerIndex = boundary + 1 + Math.max(0, ownerOffset)
      openBlocks.push({ owner: ownerSource.trim(), index: ownerIndex, bodyStart: index + 1, parentOwner: openBlocks.at(-1)?.owner })
    } else if (character === '}') {
      const open = openBlocks.pop()
      if (open) blocks.push({ owner: open.owner, index: open.index, body: source.slice(open.bodyStart, index), parentOwner: open.parentOwner })
    }
  }

  return blocks.sort((left, right) => left.index - right.index)
}

function maskCssCommentsAndStructuralStringCharacters(source: string): string {
  const characters = [...source]
  let quote: '"' | "'" | null = null
  let inComment = false

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    const next = characters[index + 1]
    if (inComment) {
      if (character === '*' && next === '/') {
        characters[index] = ' '
        characters[index + 1] = ' '
        index += 1
        inComment = false
      } else if (character !== '\n') {
        characters[index] = ' '
      }
      continue
    }
    if (!quote && character === '/' && next === '*') {
      characters[index] = ' '
      characters[index + 1] = ' '
      index += 1
      inComment = true
      continue
    }
    if (quote) {
      if (character === '\\') {
        if (next && next !== '\n') characters[index + 1] = ' '
        index += 1
      } else if (character === quote) {
        quote = null
      } else if (';{}'.includes(character)) {
        characters[index] = ' '
      }
      continue
    }
    if (character === '"' || character === "'") quote = character
  }

  return characters.join('')
}
