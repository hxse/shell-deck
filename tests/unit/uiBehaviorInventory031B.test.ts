import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parse } from 'svelte/compiler'
import {
  attributedBehaviorChanges,
  attributedControlChanges,
  baseline031ARuntimeControlIds,
  baseline031ASourceInteractiveControlCount,
  baseline031ASourceInteractiveControlDigest,
  runtimeControlInventory,
  sourceInteractiveControlCount,
  sourceInteractiveControlCount032,
  sourceInteractiveControlDigest,
  sourceInteractiveControlDigest032,
} from '../ui-baseline/031B/controlInventory'

const projectRoot = resolve(import.meta.dir, '../..')
const sourceRoots = [
  resolve(projectRoot, 'src/App.svelte'),
  resolve(projectRoot, 'src/lib/components'),
]

describe('.031B evolving UI source inventory', () => {
  test('.031A historical source truth remains immutable', () => {
    expect(baseline031ASourceInteractiveControlCount).toBe(202)
    expect(baseline031ASourceInteractiveControlDigest).toBe('7de9ac2946db94a2134e22539477094c04cc95caef6f44afce0738ff388fec19')
  })

  test('.032 source snapshot remains available after later contract evolution', () => {
    expect(sourceInteractiveControlCount032).toBe(18)
    expect(sourceInteractiveControlDigest032).toBe('08cd10d9663687281cecf5f1b2d761cd55570efafabd57bf0de9972aba8a2b2d')
  })

  test('.033 interactive source controls match its attributed current snapshot', () => {
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

  test('every runtime control delta from .031A is attributed to the later task', () => {
    const baseline = new Set<string>(baseline031ARuntimeControlIds)
    const current = new Set(runtimeControlInventory.map(({ key }) => key))
    const changes = new Map(attributedControlChanges.map((entry) => [entry.key, entry]))
    const delta = new Set([
      ...[...baseline].filter((key) => !current.has(key)),
      ...[...current].filter((key) => !baseline.has(key)),
    ])

    expect(new Set(changes.keys())).toEqual(delta)
    for (const key of delta) {
      const change = changes.get(key)
      expect(change?.changedBy === '20260627A.032' || change?.changedBy === '20260627A.033').toBe(true)
      expect(change?.oldBehavior).toBeTruthy()
      expect(change?.newBehavior).toBeTruthy()
      expect(change?.spec).toBeTruthy()
    }
    expect(changes.get('take-control')?.changedBy).toBe('20260627A.033')
  })

  test('.033 attributes every controller-only behavior change on surviving controls', () => {
    expect(attributedBehaviorChanges.map(({ key }) => key).sort()).toEqual([
      'terminal-create-real',
      'terminal-create-text',
      'terminal-host',
      'terminal-tab',
      'terminal-tab-close',
      'text-box-editor',
    ])
    expect(attributedBehaviorChanges.every((entry) => entry.changedBy === '20260627A.033' && entry.oldBehavior && entry.newBehavior && entry.spec)).toBe(true)
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
