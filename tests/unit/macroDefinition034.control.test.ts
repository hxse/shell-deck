import { expect, test } from 'bun:test'
import type { MacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionTypes'
import { validateMacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionValidation'
import { validDefinition } from './macroDefinition034.fixtures'

test('MacroDefinitionV5 accepts only index/type terminal layout and current text-list template tokens', () => {
  const definition = validDefinition()
  const result = validateMacroDefinitionV5(definition)
  expect(result).toEqual({ ok: true, value: definition })

  const legacy = structuredClone(definition) as unknown as Record<string, unknown>
  legacy.schemaVersion = 2
  legacy.configId = 'local'
  const rejected = validateMacroDefinitionV5(legacy)
  expect(rejected.ok).toBe(false)
  if (!rejected.ok) {
    expect(rejected.issues).toContainEqual({ code: 'unknown_field', path: 'configId', message: 'unknown field: configId' })
    expect(rejected.issues).toContainEqual({ code: 'invalid_literal', path: 'schemaVersion', message: 'schemaVersion must be 5' })
  }

  const physicalTarget = structuredClone(definition) as MacroDefinitionV5
  Object.assign(physicalTarget.body[0], { terminal: { kind: 'id', value: 'term_old' } })
  const physicalRejected = validateMacroDefinitionV5(physicalTarget)
  expect(physicalRejected.ok).toBe(false)
  if (!physicalRejected.ok) expect(physicalRejected.issues.some((issue) => issue.path === 'body[0].terminal' && issue.code === 'unknown_field')).toBe(true)
})

test('optional Flow fields stay optional and negative text selection remains current syntax', () => {
  const definition: MacroDefinitionV5 = {
    schemaVersion: 5,
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
  expect(validateMacroDefinitionV5(definition)).toEqual({ ok: true, value: definition })
})

test('parallel lanes require one final local Output and reject cross-lane artifacts', () => {
  const definition: MacroDefinitionV5 = {
    schemaVersion: 5,
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
          terminal: { kind: 'terminal_index', index: 1 },
          body: [
            { id: 'capture_one', type: 'capture-source', capture: { kind: 'terminal-buffer', mode: 'scrollback-tail', maxChars: 1000 } },
            { id: 'output_one', type: 'output', source: { kind: 'step_artifact', stepId: 'capture_one', artifact: 'captured_text' } },
          ],
        },
        {
          id: 'lane_two',
          label: 'two',
          terminal: { kind: 'terminal_index', index: 2 },
          body: [{ id: 'output_two', type: 'output', source: { kind: 'step_artifact', stepId: 'capture_one', artifact: 'captured_text' } }],
        },
      ],
      merge: { kind: 'sectioned_text', separator: '\n--- {laneId} ---\n', includeEmptyOutputs: false },
      onLaneFail: 'fail',
    }],
  }
  const result = validateMacroDefinitionV5(definition)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.issues).toContainEqual({
    code: 'invalid_reference',
    path: 'body[0].lanes[1].body[0].source',
    message: 'artifact source must reference an earlier compatible output',
  })

  const missingOutput = structuredClone(definition) as MacroDefinitionV5
  missingOutput.body[0] = {
    ...(missingOutput.body[0] as Extract<MacroDefinitionV5['body'][number], { type: 'parallel' }>),
    lanes: [{ id: 'lane', label: '', terminal: { kind: 'terminal_index', index: 1 }, body: [{ id: 'send', type: 'send', message: { parts: [] }, delivery: 'auto', ending: 'cr' }] }],
  }
  const missing = validateMacroDefinitionV5(missingOutput)
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.issues.some((issue) => issue.path === 'body[0].lanes[0].body' && issue.code === 'semantic_conflict')).toBe(true)
})
