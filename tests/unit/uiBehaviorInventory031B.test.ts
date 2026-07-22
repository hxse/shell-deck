import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parse } from 'svelte/compiler'
import {
  attributedBehaviorChanges,
  codexControlExclusions,
  attributedControlChanges,
  attributedControlChanges035,
  attributedRestorations034,
  baseline031ARuntimeControlIds,
  baseline031ASourceInteractiveControlCount,
  baseline031ASourceInteractiveControlDigest,
  libraryRuntimeControlInventory,
  macroRuntimeControlInventory034,
  macroRuntimeControlInventory,
  runtimeControlInventory,
  sourceInteractiveControlCount,
  sourceInteractiveControlCount032,
  sourceInteractiveControlCount033,
  sourceInteractiveControlCount034,
  sourceInteractiveControlCount035,
  sourceInteractiveControlCount038,
  sourceInteractiveControlDigest,
  sourceInteractiveControlDigest032,
  sourceInteractiveControlDigest033,
  sourceInteractiveControlDigest034,
  sourceInteractiveControlDigest035,
  sourceInteractiveControlDigest038,
  workspaceRuntimeControlInventory034,
} from '../ui-baseline/031B/controlInventory'

const projectRoot = resolve(import.meta.dir, '../..')
const sourceRoots = [
  resolve(projectRoot, 'src/App.svelte'),
  resolve(projectRoot, 'src/lib/components'),
]

describe('.031B evolving UI source inventory', () => {
  test('.031A historical browser journey remains byte-frozen outside current Playwright discovery', () => {
    const historicalPath = resolve(projectRoot, 'tests/e2e/comprehensiveUiBehavior031B.historical.ts')
    const digest = createHash('sha256').update(readFileSync(historicalPath)).digest('hex')
    const accidentallyDiscoverable = readdirSync(resolve(projectRoot, 'tests/e2e'))
      .filter((name) => name.startsWith('comprehensiveUiBehavior031B') && name.endsWith('.spec.ts'))

    expect(digest).toBe('358c2f4cb913d9f9f132ae770015a502dd07f02c752b5259b06e836d508160bc')
    expect(accidentallyDiscoverable).toEqual([])
  })

  test('.031A historical source truth remains immutable', () => {
    expect(baseline031ASourceInteractiveControlCount).toBe(202)
    expect(baseline031ASourceInteractiveControlDigest).toBe('7de9ac2946db94a2134e22539477094c04cc95caef6f44afce0738ff388fec19')
  })

  test('.032 source snapshot remains available after later contract evolution', () => {
    expect(sourceInteractiveControlCount032).toBe(18)
    expect(sourceInteractiveControlDigest032).toBe('08cd10d9663687281cecf5f1b2d761cd55570efafabd57bf0de9972aba8a2b2d')
  })

  test('.033 source snapshot remains available after Macro restoration', () => {
    expect(sourceInteractiveControlCount033).toBe(19)
    expect(sourceInteractiveControlDigest033).toBe('4ff921d1d3f120d6cffee8b2b842a9edfefcc545dedf2fec0d8080d6185afb3b')
  })

  test('.034 source snapshot remains available after later contract evolution', () => {
    expect(sourceInteractiveControlCount034).toBe(175)
    expect(sourceInteractiveControlDigest034).toBe('ab466194c9bed56c5377668fcaf78e14d520a87067bac8f0d65dc413e59c4834')
  })

  test('.035 source snapshot remains available after Library restoration', () => {
    expect(sourceInteractiveControlCount035).toBe(174)
    expect(sourceInteractiveControlDigest035).toBe('c0be373c0b0c28b1ac83084b4d7bda99417c1345a0b303ebbb45283429298584')
  })

  test('.038 source snapshot remains available after App workspace decomposition', () => {
    expect(sourceInteractiveControlCount038).toBe(199)
    expect(sourceInteractiveControlDigest038).toBe('278ac0156e82120cbe483e2fb764273d28b7c21b78661c5b9a299bbd5a8e2c63')
  })

  test('20260722A.001 interactive source controls match the current path-only snapshot', () => {
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
      expect(['20260627A.032', '20260627A.033', '20260627A.034', '20260627A.036', '20260627A.038', '20260722A.001'].includes(change?.changedBy ?? '')).toBe(true)
      expect(change?.oldBehavior).toBeTruthy()
      expect(change?.newBehavior).toBeTruthy()
      expect(change?.spec).toBeTruthy()
    }
    expect(changes.get('take-control')?.changedBy).toBe('20260627A.033')
    expect(changes.get('macro-edit')?.changedBy).toBe('20260627A.034')
    expect(changes.get('macro-cancel-edit')?.changedBy).toBe('20260627A.034')
    expect(changes.get('macro-prepare-terminals')?.changedBy).toBe('20260627A.034')
    expect(changes.get('macro-insertion-placement')?.changedBy).toBe('20260627A.034')
    expect(changes.get('for-text-list-add')?.changedBy).toBe('20260722A.001')
    expect(changes.get('for-text-list-item-insert-above')?.changedBy).toBe('20260722A.001')
    expect(changes.get('for-text-list-item-insert-below')?.changedBy).toBe('20260722A.001')
    expect(changes.get('notify-app-repeat-count')?.changedBy).toBe('20260722A.001')
    expect(changes.get('notify-app-repeat-interval-ms')?.changedBy).toBe('20260722A.001')
    expect(changes.get('parallel-collect-lane-text')?.changedBy).toBe('20260722A.001')
  })

  test('.034 attributes every restored current-schema Macro control without reviving removed product behavior', () => {
    const runtimeKeys = macroRuntimeControlInventory034.map(({ key }) => key)
    const attributedKeys = attributedRestorations034.map(({ key }) => key)
    expect(new Set(attributedKeys)).toEqual(new Set(runtimeKeys))
    expect(new Set(runtimeKeys).size).toBe(runtimeKeys.length)
    expect(attributedRestorations034.every((entry) => entry.changedBy === '20260627A.034' && entry.oldBehavior && entry.newBehavior && entry.spec)).toBe(true)
    expect(runtimeKeys).not.toContain('macro-duplicate')
    expect(runtimeKeys).not.toContain('macro-import')
    expect(runtimeKeys).not.toContain('macro-export')
    expect(runtimeKeys).not.toContain('capture-agent-kind')
  })

  test('.038 attributes its AgentEvent wait-limit controls without adding them to the non-Codex journey', () => {
    const expected = [
      'capture-agent-timeout-enabled',
      'capture-agent-timeout-ms',
      'parallel-capture-agent-timeout-enabled',
      'parallel-capture-agent-timeout-ms',
    ]
    const current = macroRuntimeControlInventory.map(({ key }) => key)
    for (const key of expected) {
      expect(current).not.toContain(key)
      expect(codexControlExclusions.find((entry) => entry.key === key)?.changedBy).toBe('20260627A.038')
    }
  })

  test('.035 attributes removal of manual Home refresh without rewriting the .034 runtime snapshot', () => {
    expect(workspaceRuntimeControlInventory034.map(({ key }) => key)).toContain('home-refresh')
    expect(runtimeControlInventory.map(({ key }) => key)).not.toContain('home-refresh')
    expect(attributedControlChanges035).toEqual([expect.objectContaining({
      key: 'home-refresh',
      changedBy: '20260627A.035',
      oldBehavior: expect.any(String),
      newBehavior: expect.any(String),
      spec: expect.any(String),
    })])
  })

  test('.036 attributes the current Library controls without reviving legacy Prompt scope or Duplicate behavior', () => {
    const keys = libraryRuntimeControlInventory.map(({ key }) => key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('library-panel-toggle')
    expect(keys).toContain('library-load-into-macro')
    expect(keys).toContain('macro-save-to-library')
    expect(keys.some((key) => key.includes('scope') || key.includes('duplicate') || key.includes('import') || key.includes('export'))).toBe(false)
    for (const key of keys) expect(attributedControlChanges.find((entry) => entry.key === key)?.changedBy).toBe('20260627A.036')
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
