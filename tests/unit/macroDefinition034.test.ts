import { expect, test } from 'bun:test'
import type { MacroDefinitionV3 } from '../../src/lib/macro/macroDefinitionTypes'
import {
  MACRO_DEFINITION_ISSUE_CODES,
  parseAndValidateMacroDefinitionJson,
  parseAndValidateMacroTerminalLayoutFromDefinitionJson,
  validateMacroDefinitionV3,
  validateMacroTerminalLayout,
} from '../../src/lib/macro/macroDefinitionValidation'
import { validateMacroRuntimeBinding } from '../../src/lib/macro/macroRuntimeBinding'
import {
  adoptRuntimeTerminal,
  reconcileVisualTerminalLayout,
  referencedTerminalIndexes,
} from '../../src/lib/macro/macroTerminalLayoutAuthoring'
import {
  terminalChoice,
  terminalRuntimeChoices,
  terminalSelectState,
} from '../../src/lib/macro/macroTerminalChoices'
import type { TerminalRuntimePosition } from '../../src/lib/protocol'

test('MacroDefinitionV3 accepts only index/type terminal layout and current text-list template tokens', () => {
  const definition = validDefinition()
  const result = validateMacroDefinitionV3(definition)
  expect(result).toEqual({ ok: true, value: definition })

  const legacy = structuredClone(definition) as unknown as Record<string, unknown>
  legacy.schemaVersion = 2
  legacy.configId = 'local'
  const rejected = validateMacroDefinitionV3(legacy)
  expect(rejected.ok).toBe(false)
  if (!rejected.ok) {
    expect(rejected.issues).toContainEqual({ code: 'unknown_field', path: 'configId', message: 'unknown field: configId' })
    expect(rejected.issues).toContainEqual({ code: 'invalid_literal', path: 'schemaVersion', message: 'schemaVersion must be 3' })
  }

  const physicalTarget = structuredClone(definition) as MacroDefinitionV3
  Object.assign(physicalTarget.body[0], { terminal: { kind: 'id', value: 'term_old' } })
  const physicalRejected = validateMacroDefinitionV3(physicalTarget)
  expect(physicalRejected.ok).toBe(false)
  if (!physicalRejected.ok) expect(physicalRejected.issues.some((issue) => issue.path === 'body[0].terminal' && issue.code === 'unknown_field')).toBe(true)
})

test('terminal layout is empty-or-contiguous, unbounded by product policy, and runtime readiness is separate', () => {
  expect(validateMacroTerminalLayout([])).toEqual({ ok: true, value: [] })
  const large = Array.from({ length: 80 }, (_, offset) => ({ index: offset + 1, type: offset % 2 ? 'text' : 'shell' }))
  expect(validateMacroTerminalLayout(large).ok).toBe(true)
  const gap = validateMacroTerminalLayout([{ index: 2, type: 'shell' }])
  expect(gap.ok).toBe(false)
  if (!gap.ok) expect(gap.issues[0]).toMatchObject({ code: 'terminal_layout_not_contiguous', path: 'terminalLayout[0].index' })

  expect(validateMacroRuntimeBinding([{ index: 1, type: 'shell' }], [{ index: 1, type: 'shell', terminalId: 'term', launchId: 'launch', readiness: 'starting' }])).toMatchObject({ status: 'not-ready', code: 'macro_terminal_not_ready' })
})

test('terminal selectors expose only live terminal positions and explain unconfirmed, stale or incompatible targets', () => {
  const shell = terminalChoice({ index: 1, type: 'shell' })
  const text = terminalChoice({ index: 2, type: 'text' })

  expect(terminalSelectState(1, [])).toEqual({
    status: 'empty',
    value: '',
    title: 'No terminals available — create a terminal first',
    placeholder: 'No terminals available — create a terminal first',
  })
  expect(terminalSelectState(1, [shell])).toEqual({
    status: 'unconfirmed',
    value: '',
    title: 'Choose terminal 1 to confirm this target',
    placeholder: 'Choose terminal 1 to confirm this target',
  })
  expect(terminalSelectState(3, [shell, text], [shell, text], 'shell')).toMatchObject({
    status: 'missing',
    value: '',
    placeholder: 'Missing terminal 3 — choose another terminal',
  })
  expect(terminalSelectState(2, [shell], [shell, text], 'shell')).toMatchObject({
    status: 'incompatible',
    value: '',
    placeholder: 'Terminal 2 changed type — choose a target',
  })
  expect(terminalSelectState(2, [], [text], 'shell')).toMatchObject({
    status: 'incompatible',
    value: '',
    placeholder: 'Terminal 2 changed type — no compatible terminals available',
  })
  expect(terminalSelectState(3, [], [text], 'shell')).toMatchObject({
    status: 'missing',
    value: '',
    placeholder: 'Missing terminal 3 — no compatible terminals available',
  })
  expect(terminalSelectState(1, [shell], [shell, text], 'shell')).toEqual({
    status: 'selected',
    value: '1',
    title: shell.title,
  })
})

test('visual terminal layout is driven by explicit Action targets rather than terminal creation events', () => {
  const runtime = [
    runtimeTerminal(1, 'shell'),
    runtimeTerminal(2, 'text'),
    runtimeTerminal(3, 'shell'),
  ]
  expect(terminalRuntimeChoices(runtime).map(({ index, type, label }) => ({ index, type, label }))).toEqual([
    { index: 1, type: 'shell', label: '1 · shell' },
    { index: 2, type: 'text', label: '2 · text' },
    { index: 3, type: 'shell', label: '3 · shell' },
  ])

  const definition = validDefinition()
  definition.terminalLayout = []
  const send = definition.body[0].type === 'for' ? definition.body[0].body[0] : undefined
  if (!send || send.type !== 'send') throw new Error('expected send fixture')
  send.terminalIndex = 3

  expect(referencedTerminalIndexes(definition)).toEqual([3])
  expect(adoptRuntimeTerminal(definition, 3, runtime)).toEqual({ ok: true })
  expect(definition.terminalLayout).toEqual([
    { index: 1, type: 'shell' },
    { index: 2, type: 'text' },
    { index: 3, type: 'shell' },
  ])

  send.terminalIndex = 1
  reconcileVisualTerminalLayout(definition)
  expect(definition.terminalLayout).toEqual([{ index: 1, type: 'shell' }])

  definition.body = []
  reconcileVisualTerminalLayout(definition)
  expect(definition.terminalLayout).toEqual([])
  expect(adoptRuntimeTerminal(definition, 4, runtime)).toEqual({ ok: false, reason: 'runtime_terminal_unavailable' })
})

test('the unique JSON gateway reports deterministic UTF-16 positions and Prepare reads layout only', () => {
  const invalid = parseAndValidateMacroDefinitionJson('{\r\n  "schemaVersion": 3,\r\n}')
  expect(invalid).toEqual({ ok: false, error: { code: 'invalid_json', offset: 26, line: 3, column: 1, message: 'Invalid JSON at line 3, column 1' } })

  const prepare = parseAndValidateMacroTerminalLayoutFromDefinitionJson(JSON.stringify({ terminalLayout: [{ index: 1, type: 'text' }], body: 'intentionally invalid for full validation' }))
  expect(prepare).toEqual({ ok: true, value: [{ index: 1, type: 'text' }] })
  expect(new Set(MACRO_DEFINITION_ISSUE_CODES).size).toBe(MACRO_DEFINITION_ISSUE_CODES.length)
})

test('optional Flow fields stay optional and negative text selection remains current syntax', () => {
  const definition: MacroDefinitionV3 = {
    schemaVersion: 3,
    name: 'optional fields',
    description: '',
    terminalLayout: [{ index: 1, type: 'text' }],
    body: [
      { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminalIndex: 1 } },
      { id: 'input', type: 'input', terminalIndex: 1, prompt: 'Continue', allowEmpty: true, delivery: 'direct', ending: 'none' },
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
          body: [{ id: 'branch_send', type: 'send', terminalIndex: 1, message: { parts: [{ kind: 'artifact' }] }, delivery: 'direct', ending: 'none' }],
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
  expect(validateMacroDefinitionV3(definition)).toEqual({ ok: true, value: definition })
})

test('parallel lanes require one final local Output and reject cross-lane artifacts', () => {
  const definition: MacroDefinitionV3 = {
    schemaVersion: 3,
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
          terminalIndex: 1,
          body: [
            { id: 'capture_one', type: 'capture-source', capture: { kind: 'terminal-buffer', mode: 'scrollback-tail', maxChars: 1000 } },
            { id: 'output_one', type: 'output', source: { kind: 'step_artifact', stepId: 'capture_one', artifact: 'captured_text' } },
          ],
        },
        {
          id: 'lane_two',
          label: 'two',
          terminalIndex: 2,
          body: [{ id: 'output_two', type: 'output', source: { kind: 'step_artifact', stepId: 'capture_one', artifact: 'captured_text' } }],
        },
      ],
      merge: { kind: 'sectioned_text', separator: '\n--- {laneId} ---\n', includeEmptyOutputs: false },
      onLaneFail: 'fail',
    }],
  }
  const result = validateMacroDefinitionV3(definition)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.issues).toContainEqual({
    code: 'invalid_reference',
    path: 'body[0].lanes[1].body[0].source',
    message: 'artifact source must reference an earlier compatible output',
  })

  const missingOutput = structuredClone(definition) as MacroDefinitionV3
  missingOutput.body[0] = {
    ...(missingOutput.body[0] as Extract<MacroDefinitionV3['body'][number], { type: 'parallel' }>),
    lanes: [{ id: 'lane', label: '', terminalIndex: 1, body: [{ id: 'send', type: 'send', message: { parts: [] }, delivery: 'auto', ending: 'cr' }] }],
  }
  const missing = validateMacroDefinitionV3(missingOutput)
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.issues.some((issue) => issue.path === 'body[0].lanes[0].body' && issue.code === 'semantic_conflict')).toBe(true)
})

function validDefinition(): MacroDefinitionV3 {
  return {
    schemaVersion: 3,
    name: 'V3 macro',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [{
      id: 'loop',
      type: 'for',
      range: { kind: 'text-list', items: [{ key: 'phase', value: 'one' }] },
      body: [{ id: 'send', type: 'send', terminalIndex: 1, message: { parts: [{ kind: 'template', template: '{{index}} {{key}} {{value}}' }] }, delivery: 'auto', ending: 'cr' }],
    }],
  }
}

function runtimeTerminal(index: number, type: 'shell' | 'text'): TerminalRuntimePosition {
  return {
    index,
    type,
    terminalId: `term_${index}`,
    launchId: `launch_${index}`,
    readiness: 'ready',
  }
}
