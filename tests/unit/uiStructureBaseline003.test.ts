import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { structureFingerprint } from '../ui-baseline/20260722A.002/structureInventory'

const projectRoot = resolve(import.meta.dir, '../..')
const componentRoot = resolve(projectRoot, 'src/lib/components')
const macroRoot = resolve(componentRoot, 'macro')
const workbenchSources = [
  resolve(componentRoot, 'MacroPanel.svelte'),
  ...readdirSync(macroRoot)
    .filter((name) => name.endsWith('.svelte'))
    .sort()
    .map((name) => resolve(macroRoot, name)),
]
const baseline = JSON.parse(readFileSync(
  resolve(projectRoot, 'tests/ui-baseline/20260722A.002/structureFingerprint.json'),
  'utf8',
)) as {
  revision: string
  files: Record<string, { count: number; digest: string }>
}

describe('20260722B.003 parent structure baseline', () => {
  test('20260724A preserves every unaffected workbench fingerprint and freezes the exact removed controls', () => {
    expect(baseline.revision).toBe('wylwysvyyrvy')
    const actual = Object.fromEntries(workbenchSources.map((path) => {
      const { count, digest } = structureFingerprint(projectRoot, path)
      return [relative(projectRoot, path).split('\\').join('/'), { count, digest }]
    }))
    const changed = new Set([
      'src/lib/components/MacroPanel.svelte',
      'src/lib/components/LibraryPanel.svelte',
      'src/lib/components/macro/MacroEditorShell.svelte',
      'src/lib/components/macro/MacroFlowNodeList.svelte',
      'src/lib/components/macro/MacroTemplateSelector.svelte',
      'src/lib/components/macro/MacroWorkbenchChrome.svelte',
    ])
    const expected = Object.fromEntries(Object.entries(baseline.files)
      .filter(([path]) => (
        path === 'src/lib/components/MacroPanel.svelte'
        || path === 'src/lib/components/LibraryPanel.svelte'
        || path.startsWith('src/lib/components/macro/')
      ))
      .filter(([path]) => !changed.has(path))
      .map(([path, value]) => [path, { count: value.count, digest: value.digest }]))
    const stableActual = Object.fromEntries(Object.entries(actual).filter(([path]) => !changed.has(path)))

    expect(Object.keys(actual)).toHaveLength(24)
    expect(Object.values(actual).reduce((sum, file) => sum + file.count, 0)).toBe(680)
    expect(stableActual).toEqual(expected)
    expect(actual['src/lib/components/MacroPanel.svelte']).toEqual({
      count: 7,
      digest: 'a25c6bd3b23b5ac84ba5c45b700998ff7bd5dcd92ffb8ec909a57b24e4aba992',
    })
    expect(actual['src/lib/components/macro/MacroTemplateSelector.svelte']).toEqual({
      count: 31,
      digest: '51c2d5d29b6e96ffb91f9a1ebfbb521794aad6df83d3ef740414acca705be1fa',
    })
    expect(actual['src/lib/components/macro/MacroWorkbenchChrome.svelte']).toEqual({
      count: 9,
      digest: 'b7652ac4db283c1c007c53f245aa6d95c05bb5e8c716139dbe4c720aa396383a',
    })
    expect(baseline.files['src/lib/components/LibraryPanel.svelte']).toEqual({
      count: 47,
      digest: '4e911729639d5f6d191f5e49cd9ecc8d1facfeb86a6db09ef1265476f00fdae6',
    })
    expect(actual['src/lib/components/LibraryPanel.svelte']).toBeUndefined()
  })
})
