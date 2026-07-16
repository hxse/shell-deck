import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parse } from 'svelte/compiler'
import { sourceInteractiveControlCount, sourceInteractiveControlDigest } from '../ui-baseline/031B/controlInventory'

const projectRoot = resolve(import.meta.dir, '../..')
const sourceRoots = [
  resolve(projectRoot, 'src/App.svelte'),
  resolve(projectRoot, 'src/lib/components'),
]

describe('.031B UI source inventory', () => {
  test('all .031A interactive source controls match the frozen snapshot', () => {
    const discovered = discoverInteractiveControls()
    const digest = createHash('sha256').update(JSON.stringify(discovered)).digest('hex')
    expect({
      count: discovered.length,
      digest,
      unidentified: discovered.filter((signature) => signature.includes('UNIDENTIFIED:')),
    }).toEqual({
      count: sourceInteractiveControlCount,
      digest: sourceInteractiveControlDigest,
      unidentified: [],
    })
  })
})

function discoverInteractiveControls(): string[] {
  return sourceRoots
    .flatMap((root) => root.endsWith('.svelte') ? [root] : collectSvelteFiles(root))
    .flatMap((path) => signaturesForFile(path))
    .sort()
}

function collectSvelteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectSvelteFiles(path)
    return entry.isFile() && entry.name.endsWith('.svelte') ? [path] : []
  })
}

function signaturesForFile(path: string): string[] {
  const source = readFileSync(path, 'utf8')
  const file = relative(projectRoot, path)
  const signatures: string[] = []
  const ast = parse(source, { modern: true }) as unknown as { fragment: unknown }
  walk(ast.fragment, (node) => {
    const record = node as {
      type?: string
      name?: string
      attributes?: Array<{ type?: string; name?: string; start?: number; end?: number }>
      fragment?: unknown
    }
    if (record.type === 'RegularElement' && ['button', 'summary', 'input', 'select', 'textarea'].includes(record.name ?? '')) {
      signatures.push(`${file}::${record.name}::${controlIdentity(record.attributes ?? [], record.fragment, source)}`)
      return
    }
    if (record.type === 'RegularElement' && attributeSource(record.attributes ?? [], 'role', source) === 'role="separator"') {
      signatures.push(`${file}::role:separator:${record.name}::${controlIdentity(record.attributes ?? [], record.fragment, source)}`)
      return
    }
    if (record.type === 'RegularElement' && record.name !== 'button' && attributeSource(record.attributes ?? [], 'role', source) === 'role="tab"') {
      signatures.push(`${file}::role:tab:${record.name}::${controlIdentity(record.attributes ?? [], record.fragment, source)}`)
      return
    }
    if (record.type === 'Component' && record.name === 'MacroIconButton') {
      signatures.push(`${file}::MacroIconButton::${controlIdentity(record.attributes ?? [], record.fragment, source)}`)
    }
  })
  return signatures
}

function walk(value: unknown, visit: (node: object) => void) {
  if (!value || typeof value !== 'object') return
  visit(value)
  for (const [key, child] of Object.entries(value)) {
    if (key === 'parent' || key === 'metadata' || key === 'loc') continue
    if (Array.isArray(child)) {
      for (const item of child) walk(item, visit)
    } else {
      walk(child, visit)
    }
  }
}

function controlIdentity(
  attrs: Array<{ type?: string; name?: string; start?: number; end?: number }>,
  fragment: unknown,
  source: string,
): string {
  const candidates = [
    attributeSource(attrs, 'data-testid', source),
    attributeSource(attrs, 'testId', source),
    attributeSource(attrs, 'aria-label', source),
    attributeSource(attrs, 'title', source),
    attributeSource(attrs, 'id', source),
    literalText(fragment),
  ].filter(Boolean)
  return candidates[0] ?? `UNIDENTIFIED:${normalize(JSON.stringify(attrs)).slice(0, 160)}`
}

function attributeSource(
  attrs: Array<{ type?: string; name?: string; start?: number; end?: number }>,
  name: string,
  source: string,
): string {
  const attribute = attrs.find((candidate) => candidate.type === 'Attribute' && candidate.name === name)
  return attribute && typeof attribute.start === 'number' && typeof attribute.end === 'number'
    ? normalize(source.slice(attribute.start, attribute.end))
    : ''
}

function literalText(fragment: unknown): string {
  const parts: string[] = []
  walk(fragment, (node) => {
    const record = node as { type?: string; data?: unknown }
    if (record.type === 'Text' && typeof record.data === 'string') parts.push(record.data)
  })
  const text = normalize(parts.join(' '))
  return text ? `text:${text}` : ''
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
