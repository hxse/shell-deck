import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dir, '../..')
const iconButton = source('src/lib/components/macro/MacroIconButton.svelte')
const nodeActions = source('src/lib/components/macro/NodeActionControls.svelte')
const controlEditor = source('src/lib/components/macro/MacroControlNodeEditor.svelte')

test('Macro insertion controls share one explicit plus-arrow glyph language', () => {
  const before = branch(iconButton, 'insert-before', 'insert-after')
  const after = branch(iconButton, 'insert-after', 'else')

  expect(before).toContain('<path d="M1.5 8h5.5" />')
  expect(before).toContain('<path d="M4.25 5.25v5.5" />')
  expect(before).toContain('<path d="M11.5 13V3m-3 3 3-3 3 3" />')
  expect(after).toContain('<path d="M1.5 8h5.5" />')
  expect(after).toContain('<path d="M4.25 5.25v5.5" />')
  expect(after).toContain('<path d="M11.5 3v10m-3-3 3 3 3-3" />')
  expect(iconButton).not.toMatch(/insert-(above|below)/)
})

test('node and text-list insertion controls consume before/after without duplicate SVG', () => {
  expect(nodeActions).not.toContain('<svg')
  expect(nodeActions).toMatch(
    /kind="up".*kind="down".*kind="insert-before".*kind="insert-after".*kind="remove"/s,
  )
  expect(controlEditor).toContain('kind="insert-before" label="Insert item before"')
  expect(controlEditor).toContain('kind="insert-after" label="Insert item after"')
  expect(controlEditor).not.toMatch(/kind="insert-(above|below)"/)
})

function source(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8')
}

function branch(sourceText: string, kind: string, nextKind: string): string {
  const start = sourceText.indexOf(`{:else if kind === "${kind}"}`)
  const endToken = nextKind === 'else' ? '{:else}' : `{:else if kind === "${nextKind}"}`
  const end = sourceText.indexOf(endToken, start + 1)
  if (start < 0 || end < 0) throw new Error(`missing icon branch: ${kind}`)
  return sourceText.slice(start, end)
}
