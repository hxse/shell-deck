import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { structureFingerprint } from '../ui-baseline/20260722A.002/structureInventory'

const projectRoot = resolve(import.meta.dir, '../..')
const componentRoot = resolve(projectRoot, 'src/lib/components')
const macroRoot = resolve(componentRoot, 'macro')
const workbenchSources = [
  resolve(componentRoot, 'MacroPanel.svelte'),
  resolve(componentRoot, 'LibraryPanel.svelte'),
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
  test('every workbench component matches the per-file 20260722A.002 fingerprint', () => {
    expect(baseline.revision).toBe('wylwysvyyrvy')
    const actual = Object.fromEntries(workbenchSources.map((path) => {
      const { count, digest } = structureFingerprint(projectRoot, path)
      return [relative(projectRoot, path).split('\\').join('/'), { count, digest }]
    }))
    const expected = Object.fromEntries(Object.entries(baseline.files).filter(([path]) => (
      path === 'src/lib/components/MacroPanel.svelte'
      || path === 'src/lib/components/LibraryPanel.svelte'
      || path.startsWith('src/lib/components/macro/')
    )))

    expect(Object.keys(actual)).toHaveLength(25)
    expect(Object.values(actual).reduce((sum, file) => sum + file.count, 0)).toBe(728)
    expect(actual).toEqual(expected)
  })
})
