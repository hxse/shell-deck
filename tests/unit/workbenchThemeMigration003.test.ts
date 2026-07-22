import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parse } from 'svelte/compiler'

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

const legacyStyles = [
  'base.css',
  'terminal.css',
  'macro-workbench.css',
  'macro-chrome.css',
  'macro-editor.css',
  'macro-flow.css',
  'macro-trace.css',
  'library-workbench.css',
  'workbench-responsive.css',
  'workbench-shared.css',
]

const formerlyLocalStyleOwners = [
  'MessagePartsEditor.svelte',
  'TemplatableScalarField.svelte',
  'MacroJsonView.svelte',
  'MacroControlNodeEditor.svelte',
  'MacroFlowNodeList.svelte',
  'LineNumberedTextarea.svelte',
  'ExtractTextEditor.svelte',
  'MacroStepList.svelte',
  'MacroTerminalSelect.svelte',
  'TerminalInputDeliveryField.svelte',
]

describe('20260722B.003 Macro and Library theme migration', () => {
  test('non-presentation workbench structure has the frozen current fingerprint', () => {
    const inventory = workbenchSources.flatMap((path) => structureInventory(path))
    expect({
      files: workbenchSources.length,
      entries: inventory.length,
      digest: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
    }).toEqual({
      files: 25,
      entries: 728,
      digest: 'e17259d76cee38c24e1634cbf13bff37b64281e64a6dc6c878b32bb09baeee17',
    })
  })

  test('the old workbench cascade and its mixed-file handoff are absent', () => {
    expect(readFileSync(resolve(projectRoot, 'src/styles.css'), 'utf8').trim()).toBe('')
    for (const name of legacyStyles) {
      expect(existsSync(resolve(projectRoot, 'src/styles', name))).toBe(false)
    }
    for (const name of formerlyLocalStyleOwners) {
      expect(readFileSync(resolve(macroRoot, name), 'utf8')).not.toContain('<style')
    }
    expect(workbenchSources.every((path) => !readFileSync(path, 'utf8').includes('<style'))).toBe(true)
  })

  test('workbench presentation is semantic and contains no fixed light-theme colors', () => {
    const source = workbenchSources.map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(source).toContain('bg-base-100')
    expect(source).toContain('text-base-content')
    expect(source).toContain('border-primary')
    expect(source).toContain('alert-warning')
    expect(source).toContain('alert-error')
    expect(source).toContain('btn-success')
    expect(source).toContain('select-warning')
    expect(source).not.toMatch(/#[\da-fA-F]{6}(?![\da-fA-F])|rgba?\s*\(/)
    expect(source).not.toContain('--flow-depth-color')
    expect(source).not.toContain('flowDepthColors')
  })

  test('the focused daisyUI component set covers the migrated controls', () => {
    const css = readFileSync(resolve(projectRoot, 'src/framework.css'), 'utf8')
    const included = css.match(/include:\s*([^;]+);/)?.[1]
      .split(',')
      .map((entry) => entry.trim()) ?? []
    expect(new Set(included)).toEqual(new Set([
      'alert', 'badge', 'button', 'card', 'checkbox', 'fieldset', 'input', 'range', 'select', 'tab', 'textarea',
    ]))
  })

  test('recent Macro controls and non-color run feedback remain in their existing owners', () => {
    const flow = readFileSync(resolve(macroRoot, 'MacroControlNodeEditor.svelte'), 'utf8')
    const scalar = readFileSync(resolve(macroRoot, 'TemplatableScalarField.svelte'), 'utf8')
    const message = readFileSync(resolve(macroRoot, 'MessagePartsEditor.svelte'), 'utf8')
    const action = readFileSync(resolve(macroRoot, 'MacroActionNodeEditor.svelte'), 'utf8')
    const parallel = readFileSync(resolve(macroRoot, 'ParallelLaneTabs.svelte'), 'utf8')
    const runDock = readFileSync(resolve(macroRoot, 'MacroRunDock.svelte'), 'utf8')
    const editor = readFileSync(resolve(macroRoot, 'MacroEditorShell.svelte'), 'utf8')
    const tokens = readFileSync(resolve(projectRoot, 'src/lib/macro/scopedTextTemplate.ts'), 'utf8')

    expect(flow).toContain('for-text-list-item-insert-above')
    expect(flow).toContain('for-text-list-item-insert-below')
    for (const token of ['{{index}}', '{{key}}', '{{value}}']) {
      expect(tokens).toContain(token)
    }
    expect(scalar + message).toContain('LOOP_INDEX_TEMPLATE_TOKEN')
    expect(scalar + message).toContain('LOOP_KEY_TEMPLATE_TOKEN')
    expect(scalar + message).toContain('LOOP_VALUE_TEMPLATE_TOKEN')
    expect(scalar + message).not.toContain('Available:')
    expect(action).toContain('notify-app-repeat-count')
    expect(action).toContain('notify-app-repeat-interval-ms')
    expect(parallel).toContain('parallel-collect-lane-text')
    expect(runDock).toContain('Current stage')
    expect(runDock).toContain('data-current-node-id')
    expect(editor).toContain('macro_run_active')
    expect(editor).toContain('disabled={hardDisabled}')
  })

  test('compact geometry and nested overflow are expressed by static utilities', () => {
    const panel = readFileSync(resolve(componentRoot, 'MacroPanel.svelte'), 'utf8')
    const flow = readFileSync(resolve(macroRoot, 'MacroFlowNodeList.svelte'), 'utf8')
    const lineEditor = readFileSync(resolve(macroRoot, 'LineNumberedTextarea.svelte'), 'utf8')
    const runDock = readFileSync(resolve(macroRoot, 'MacroRunDock.svelte'), 'utf8')

    expect(panel).toContain('macro-view-scroll min-h-0 min-w-0 flex-1 overflow-auto')
    expect(panel).toContain('[&_button]:h-7')
    expect(flow).toContain('flow-block grid min-w-0')
    expect(flow).toContain('border-l-4')
    expect(lineEditor).toContain('!h-5 !min-h-5')
    expect(runDock).toContain('macro-run-controls flex flex-wrap')
  })
})

function structureInventory(path: string): string[] {
  const source = readFileSync(path, 'utf8')
  const ast = parse(source, { modern: true }) as unknown as { fragment: unknown }
  const entries: string[] = []
  walk(ast.fragment, (node) => {
    const record = node as {
      type?: string
      name?: string
      start?: number
      end?: number
      attributes?: Array<{ type?: string; name?: string; start?: number; end?: number }>
    }
    if (!['RegularElement', 'Component'].includes(record.type ?? '')) return
    const attributes = (record.attributes ?? [])
      .filter((attribute) => attribute.name !== 'class' && attribute.name !== 'style')
      .filter((attribute) => !attribute.type?.includes('Class') && !attribute.type?.includes('Style'))
      .map((attribute) => source.slice(attribute.start, attribute.end).replace(/\s+/g, ' ').trim())
    entries.push(`${relative(projectRoot, path)}::${record.type}:${record.name}::${attributes.join('|')}`)
  })
  return entries
}

function walk(value: unknown, visit: (node: object) => void): void {
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
