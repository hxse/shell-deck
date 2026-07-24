import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMacroDraftMutationTracker } from '../../src/lib/macro/macroDraftMutation'
import type { MacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionTypes'

describe('20260724C Macro draft mutation hot path', () => {
  test('mutates one draft object and preserves exact dirty reversion', () => {
    const base = definition('Saved')
    const draft = structuredClone(base)
    const identity = draft
    const tracker = createMacroDraftMutationTracker()

    tracker.replaceBase(base)
    expect(tracker.apply(draft, (value) => { value.name = 'Edited' })).toBe(true)
    expect(draft).toBe(identity)
    expect(draft.name).toBe('Edited')

    expect(tracker.apply(draft, (value) => { value.name = 'Saved' })).toBe(false)
    expect(draft).toBe(identity)
  })

  test('tracks affected paths and becomes clean immediately after exact reversion', () => {
    const tracker = createMacroDraftMutationTracker()
    const base = definition('Saved')
    base.body = [{ id: 'wait', type: 'wait', mode: 'duration', durationMs: 1 }]
    const draft = structuredClone(base)

    tracker.replaceBase(base)
    expect(tracker.apply(draft, (value) => { value.description = 'one' })).toBe(true)
    expect(tracker.apply(draft, (value) => {
      const wait = value.body[0]
      if (wait.type === 'wait' && wait.mode === 'duration') wait.durationMs = 2
    })).toBe(true)
    expect(tracker.apply(draft, (value) => { value.description = '' })).toBe(true)
    expect(tracker.apply(draft, (value) => {
      const wait = value.body[0]
      if (wait.type === 'wait' && wait.mode === 'duration') wait.durationMs = 1
    })).toBe(false)
  })

  test('source keeps hot text edits on the shared in-place gateway', () => {
    const session = source('src/lib/macro/macroRecordSession.svelte.ts')
    const messages = source('src/lib/components/macro/MessagePartsEditor.svelte')
    const control = source('src/lib/components/macro/MacroControlNodeEditor.svelte')
    const tree = source('src/lib/components/macro/macroFlowTreeController.svelte.ts')
    expect(session).not.toContain('const next = cloneJsonValue(draft)')
    expect(session).not.toContain('JSON.stringify(baseDefinition)')
    expect(session).toContain('draftMutations.apply(draft, mutator)')
    expect(messages).not.toContain('JSON.parse(JSON.stringify(message))')
    expect(messages).toContain('onUpdate((target: MessageSpec)')
    expect(control).toContain('{#each node.range.items as item, itemIndex (item)}')
    expect(control + tree).not.toContain('textListItemEditorKey')
    expect(tree).not.toContain('textListStructureVersions')
  })
})

function definition(name: string): MacroDefinitionV5 {
  return {
    schemaVersion: 5,
    name,
    description: '',
    terminalLayout: [],
    body: [],
  }
}

function source(path: string): string {
  return readFileSync(resolve(import.meta.dir, '../..', path), 'utf8')
}
