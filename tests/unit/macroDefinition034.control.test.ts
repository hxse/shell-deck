import { expect, test } from 'bun:test'
import type { MacroDefinitionV6 } from '../../src/lib/macro/macroDefinitionTypes'
import { validateMacroDefinitionV6 } from '../../src/lib/macro/macroDefinitionValidation'
import { validDefinition } from './macroDefinition034.fixtures'

test('MacroDefinitionV6 accepts only index/type terminal layout and current text-list template tokens', () => {
  const definition = validDefinition()
  const result = validateMacroDefinitionV6(definition)
  expect(result).toEqual({ ok: true, value: definition })

  const legacy = structuredClone(definition) as unknown as Record<string, unknown>
  legacy.schemaVersion = 2
  legacy.configId = 'local'
  const rejected = validateMacroDefinitionV6(legacy)
  expect(rejected.ok).toBe(false)
  if (!rejected.ok) {
    expect(rejected.issues).toContainEqual({ code: 'unknown_field', path: 'configId', message: 'unknown field: configId' })
    expect(rejected.issues).toContainEqual({ code: 'invalid_literal', path: 'schemaVersion', message: 'schemaVersion must be 6' })
  }

  const physicalTarget = structuredClone(definition) as MacroDefinitionV6
  Object.assign(physicalTarget.body[0], { terminal: { kind: 'id', value: 'term_old' } })
  const physicalRejected = validateMacroDefinitionV6(physicalTarget)
  expect(physicalRejected.ok).toBe(false)
  if (!physicalRejected.ok) expect(physicalRejected.issues.some((issue) => issue.path === 'body[0].terminal' && issue.code === 'unknown_field')).toBe(true)
})

test('optional Flow fields stay optional and negative text selection remains current syntax', () => {
  const definition: MacroDefinitionV6 = {
    schemaVersion: 6,
    name: 'optional fields',
    description: '',
    terminalLayout: [{ index: 1, type: 'text' }],
    body: [
      { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminal: { kind: 'terminal_index', index: 1 } } },
      { id: 'input', type: 'input', terminal: { kind: 'terminal_index', index: 1 }, prompt: 'Continue', allowEmpty: true, delivery: 'direct', ending: 'none' },
      {
        id: 'if_node',
        type: 'if',
        branches: [{
          kind: 'if',
          condition: {
            kind: 'text_match',
            source: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' },
            matcher: { kind: 'regex', pattern: '.*' },
            scope: { kind: 'lines', mode: 'any' },
          },
          body: [{ id: 'branch_send', type: 'send', terminal: { kind: 'terminal_index', index: 1 }, message: { parts: [{ kind: 'artifact', source: { kind: 'unassigned' } }] }, delivery: 'direct', ending: 'none' }],
        }],
      },
      {
        id: 'extract',
        type: 'extract_text',
        source: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' },
        split: { kind: 'regex', pattern: '\\n', keepEmpty: false },
        filters: [],
        select: { mode: 'index', index: -1 },
        extract: { kind: 'regex', pattern: '(.*)', group: 1 },
        trim: 'none',
        onEmpty: 'fail',
      },
      { id: 'finish', type: 'finish' },
    ],
  }
  expect(validateMacroDefinitionV6(definition)).toEqual({ ok: true, value: definition })
})

test('parallel panes use explicit action targets, allow empty bodies and reject cross-pane artifacts', () => {
  const definition: MacroDefinitionV6 = {
    schemaVersion: 6,
    name: 'parallel scope',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }, { index: 2, type: 'shell' }],
    body: [{
      id: 'parallel',
      type: 'parallel',
      lanes: [
        {
          id: 'lane_one',
          label: 'one',
          body: [
            { id: 'capture_one', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'terminal_index', index: 1 }, mode: 'scrollback-tail', maxChars: 1000 } },
          ],
        },
        {
          id: 'lane_two',
          label: 'two',
          body: [{
            id: 'extract_two',
            type: 'extract_text',
            source: { kind: 'step_artifact', stepId: 'capture_one', artifact: 'captured_text' },
            split: { kind: 'lines', keepEmpty: false },
            filters: [],
            select: { mode: 'all' },
            extract: { kind: 'none' },
            trim: 'right',
            onEmpty: 'pause',
          }],
        },
      ],
      sharedTextOrder: 'pane_order',
      onLaneFail: 'fail',
    }],
  }
  const result = validateMacroDefinitionV6(definition)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.issues).toContainEqual({
    code: 'invalid_reference',
    path: 'body[0].lanes[1].body[0].source',
    message: 'artifact source must reference an earlier compatible output',
  })

  const emptyPane = structuredClone(definition) as MacroDefinitionV6
  emptyPane.body[0] = {
    ...(emptyPane.body[0] as Extract<MacroDefinitionV6['body'][number], { type: 'parallel' }>),
    lanes: [{ id: 'lane', label: '', body: [] }],
  }
  expect(validateMacroDefinitionV6(emptyPane)).toEqual({ ok: true, value: emptyPane })
})
