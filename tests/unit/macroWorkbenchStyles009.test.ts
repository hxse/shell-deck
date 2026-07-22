import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dir, '../..')
const stylesEntry = resolve(projectRoot, 'src/styles.css')

type CssRule = {
  context: string[]
  header: string
  body: string
}

describe('Macro workbench style decomposition', () => {
  test('loaded selector/declaration inventory and repeated-rule order stay frozen', () => {
    const rules = parseRules(expandImports(stylesEntry))
    const inventory = rules
      .map((rule) => ruleSignature(rule))
      .sort()
      .join('\n\u0000\n')
    const occurrences = new Map<string, string[]>()
    for (const rule of rules) {
      const key = [...rule.context, rule.header].join('\n')
      const bodies = occurrences.get(key) ?? []
      bodies.push(rule.body)
      occurrences.set(key, bodies)
    }
    const repeatedRuleOrder = [...occurrences.entries()]
      .filter(([, bodies]) => bodies.length > 1)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bodies]) => key + '\n' + bodies.join('\n\u0000\n'))
      .join('\n\u0001\n')
    const semanticRules = rules.flatMap((rule) => splitSelectors(rule.header).map((selector) => ({
      context: rule.context,
      selector,
      body: rule.body,
    })))
    const semanticInventory = semanticRules
      .map((rule) => [...rule.context, rule.selector, rule.body].join('\n'))
      .sort()
      .join('\n\u0000\n')
    const cascadeProperties = new Map<string, string[]>()
    for (const rule of semanticRules) {
      for (const [property, value] of parseDeclarations(rule.body)) {
        const key = [rule.selector, property].join('\n')
        const values = cascadeProperties.get(key) ?? []
        values.push([...rule.context, value].join('\n'))
        cascadeProperties.set(key, values)
      }
    }
    const repeatedCascadePropertyOrder = [...cascadeProperties.entries()]
      .filter(([, values]) => values.length > 1)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => key + '\n' + values.join('\n\u0000\n'))
      .join('\n\u0001\n')

    expect({
      ruleCount: rules.length,
      repeatedRuleCount: [...occurrences.values()].filter((bodies) => bodies.length > 1).length,
      inventoryHash: sha256(inventory),
      repeatedRuleOrderHash: sha256(repeatedRuleOrder),
      semanticRuleCount: semanticRules.length,
      semanticInventoryHash: sha256(semanticInventory),
      repeatedCascadePropertyCount: [...cascadeProperties.values()].filter((values) => values.length > 1).length,
      repeatedCascadePropertyOrderHash: sha256(repeatedCascadePropertyOrder),
    }).toEqual({
      ruleCount: 516,
      repeatedRuleCount: 43,
      inventoryHash: 'b8ff5d3f87a3d0dbac78dce72a6f24453739cb0a921597b7cd70938038073075',
      repeatedRuleOrderHash: 'c91aa7a29eae6d4717f427e189f5c6606610475056fc3fcb46c276d28b0be789',
      semanticRuleCount: 637,
      semanticInventoryHash: 'f44c2bdbf2c8e4d53b013ea85c0e2f25871ad7afd3486c5d291c753fa6789ce0',
      repeatedCascadePropertyCount: 164,
      repeatedCascadePropertyOrderHash: 'ecef3815d9e846981db30971c9ba220c2c206447a5eab135db3ef6a383068cfb',
    })
    expect(cascadeProperties.get('.run-list button\nfont-size')).toEqual(['12px', '13px'])
    expect(cascadeProperties.get('.macro-run-status-dock .macro-run-controls\ngrid-template-columns')).toEqual([
      'repeat(4, minmax(58px, 1fr))',
      '@media (max-width: 760px)\nrepeat(2, minmax(0, 1fr))',
      'none',
    ])
  })

  test('one manifest owns the focused workbench modules without legacy implementation files', () => {
    const entry = readFileSync(stylesEntry, 'utf8')
    expect(entry.match(/macro-workbench\.css/g)).toHaveLength(1)
    for (const name of [
      'macro-chrome.css',
      'macro-editor.css',
      'macro-flow.css',
      'macro-trace.css',
      'library-workbench.css',
      'workbench-responsive.css',
      'workbench-shared.css',
    ]) {
      expect(existsSync(resolve(projectRoot, 'src/styles', name))).toBe(true)
    }
    for (const legacy of ['macro-workbench-base.css', 'macro-workbench-cleanup.css', 'macro-step-editor.css', 'run-log.css']) {
      expect(existsSync(resolve(projectRoot, 'src/styles', legacy))).toBe(false)
    }
  })
})

function expandImports(path: string, stack: string[] = []): string {
  if (stack.includes(path)) throw new Error('css_import_cycle:' + [...stack, path].join(' -> '))
  const source = readFileSync(path, 'utf8')
  return source.replace(/@import\s+(['"])([^'"]+)\1\s*;/g, (_match, _quote, relativePath: string) => {
    return expandImports(resolve(dirname(path), relativePath), [...stack, path])
  })
}

function parseRules(source: string, context: string[] = []): CssRule[] {
  const rules: CssRule[] = []
  let position = 0
  while (position < source.length) {
    position = skipTrivia(source, position)
    if (position >= source.length) break
    const headerStart = position
    const delimiter = findHeaderDelimiter(source, position)
    if (delimiter < 0) break
    const header = source.slice(headerStart, delimiter).trim()
    if (source[delimiter] === ';') {
      position = delimiter + 1
      continue
    }
    const close = findMatchingBrace(source, delimiter)
    const body = source.slice(delimiter + 1, close).trim()
    if (/^@(media|supports|container|layer)\b/.test(header)) {
      rules.push(...parseRules(body, [...context, header]))
    } else if (header.length > 0) {
      rules.push({ context, header, body })
    }
    position = close + 1
  }
  return rules
}

function skipTrivia(source: string, from: number): number {
  let position = from
  while (position < source.length) {
    if (/\s/.test(source[position])) {
      position += 1
      continue
    }
    if (source.startsWith('/*', position)) {
      const close = source.indexOf('*/', position + 2)
      if (close < 0) throw new Error('unterminated_css_comment')
      position = close + 2
      continue
    }
    break
  }
  return position
}

function findHeaderDelimiter(source: string, from: number): number {
  let quote: string | null = null
  let comment = false
  for (let position = from; position < source.length; position += 1) {
    const character = source[position]
    if (comment) {
      if (character === '*' && source[position + 1] === '/') {
        comment = false
        position += 1
      }
      continue
    }
    if (quote) {
      if (character === '\\') position += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '/' && source[position + 1] === '*') {
      comment = true
      position += 1
    } else if (character === '"' || character === "'") quote = character
    else if (character === '{' || character === ';') return position
  }
  return -1
}

function findMatchingBrace(source: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  let comment = false
  for (let position = open; position < source.length; position += 1) {
    const character = source[position]
    if (comment) {
      if (character === '*' && source[position + 1] === '/') {
        comment = false
        position += 1
      }
      continue
    }
    if (quote) {
      if (character === '\\') position += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '/' && source[position + 1] === '*') {
      comment = true
      position += 1
    } else if (character === '"' || character === "'") quote = character
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return position
    }
  }
  throw new Error('unterminated_css_rule')
}

function ruleSignature(rule: CssRule): string {
  return [...rule.context, rule.header, rule.body].join('\n')
}

function splitSelectors(header: string): string[] {
  const selectors: string[] = []
  let start = 0
  let depth = 0
  let quote: string | null = null
  for (let position = 0; position < header.length; position += 1) {
    const character = header[position]
    if (quote) {
      if (character === '\\') position += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth -= 1
    else if (character === ',' && depth === 0) {
      selectors.push(header.slice(start, position).trim())
      start = position + 1
    }
  }
  selectors.push(header.slice(start).trim())
  return selectors.filter(Boolean)
}

function parseDeclarations(body: string): Array<[string, string]> {
  const declarations: Array<[string, string]> = []
  let start = 0
  let depth = 0
  let quote: string | null = null
  const consume = (end: number) => {
    const declaration = body.slice(start, end).trim()
    start = end + 1
    const colon = declaration.indexOf(':')
    if (colon > 0) declarations.push([
      declaration.slice(0, colon).trim(),
      declaration.slice(colon + 1).trim(),
    ])
  }
  for (let position = 0; position < body.length; position += 1) {
    const character = body[position]
    if (quote) {
      if (character === '\\') position += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth -= 1
    else if (character === ';' && depth === 0) consume(position)
  }
  consume(body.length)
  return declarations
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
