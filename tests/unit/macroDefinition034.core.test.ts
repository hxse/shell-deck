import { expect, test } from 'bun:test'
import {
  MACRO_DEFINITION_ISSUE_CODES,
  parseAndValidateMacroDefinitionJson,
  parseAndValidateMacroTerminalLayoutFromDefinitionJson,
  type MacroDefinitionIssue,
  validateMacroDefinitionV6,
  validateRunnableMacroDefinitionV6,
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
import { runtimeTerminal, validDefinition } from './macroDefinition034.fixtures'

test('Macro validation keeps the complete multi-issue code, path, message and order across value and JSON gateways', () => {
  const invalid = {
    schemaVersion: 4,
    name: '',
    description: 1,
    terminalLayout: [{ index: 2, type: 'shell', legacy: true }],
    body: [
      {
        id: 'duplicate',
        type: 'send',
        legacy: true,
        terminal: { kind: 'unassigned', index: 1 },
        message: { parts: [{ kind: 'artifact', source: { kind: 'step_artifact', stepId: 'later', artifact: 'captured_text' } }] },
        delivery: 'legacy',
        ending: 'legacy',
      },
      {
        id: 'duplicate',
        type: 'capture-source',
        capture: { kind: 'text-box', terminal: { kind: 'terminal_index', index: 2 } },
      },
    ],
    legacyTop: true,
  }
  const issues: MacroDefinitionIssue[] = [
    { code: 'invalid_literal', path: 'body[0].delivery', message: 'delivery must be auto, direct-bytes or bracketed-paste' },
    { code: 'invalid_literal', path: 'body[0].ending', message: 'ending must be none, lf, cr or crlf' },
    { code: 'unknown_field', path: 'body[0].legacy', message: 'unknown field: legacy' },
    { code: 'invalid_reference', path: 'body[0].message.parts[0].source', message: 'artifact source must reference an earlier compatible output' },
    { code: 'unknown_field', path: 'body[0].terminal.index', message: 'unknown field: index' },
    { code: 'terminal_reference_missing', path: 'body[1].capture.terminal.index', message: 'terminal reference index must exist in terminalLayout' },
    { code: 'duplicate_identifier', path: 'body[1].id', message: 'identifier must be unique' },
    { code: 'expected_string', path: 'description', message: 'value must be a string' },
    { code: 'unknown_field', path: 'legacyTop', message: 'unknown field: legacyTop' },
    { code: 'invalid_range', path: 'name', message: 'string must not be empty' },
    { code: 'invalid_literal', path: 'schemaVersion', message: 'schemaVersion must be 6' },
    { code: 'terminal_layout_not_contiguous', path: 'terminalLayout[0].index', message: 'terminalLayout index must be 1' },
    { code: 'unknown_field', path: 'terminalLayout[0].legacy', message: 'unknown field: legacy' },
  ]

  const valueResult = validateMacroDefinitionV6(invalid)
  expect(valueResult).toEqual({ ok: false, issues })
  expect(validateRunnableMacroDefinitionV6(invalid)).toEqual(valueResult)
  expect(parseAndValidateMacroDefinitionJson(JSON.stringify(invalid))).toEqual({
    ok: false,
    error: { code: 'invalid_macro_definition', issues },
  })
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

  expect(terminalSelectState({ kind: 'terminal_index', index: 1 }, [])).toEqual({
    status: 'empty',
    value: '',
    title: 'No terminals available — create a terminal first',
    placeholder: 'No terminals available — create a terminal first',
  })
  expect(terminalSelectState({ kind: 'terminal_index', index: 1 }, [shell])).toEqual({
    status: 'unconfirmed',
    value: '',
    title: 'Choose terminal 1 to confirm this target',
    placeholder: 'Choose terminal 1 to confirm this target',
  })
  expect(terminalSelectState({ kind: 'terminal_index', index: 3 }, [shell, text], [shell, text], 'shell')).toMatchObject({
    status: 'missing',
    value: '',
    placeholder: 'Missing terminal 3 — choose another terminal',
  })
  expect(terminalSelectState({ kind: 'terminal_index', index: 2 }, [shell], [shell, text], 'shell')).toMatchObject({
    status: 'incompatible',
    value: '',
    placeholder: 'Terminal 2 changed type — choose a target',
  })
  expect(terminalSelectState({ kind: 'terminal_index', index: 2 }, [], [text], 'shell')).toMatchObject({
    status: 'incompatible',
    value: '',
    placeholder: 'Terminal 2 changed type — no compatible terminals available',
  })
  expect(terminalSelectState({ kind: 'terminal_index', index: 3 }, [], [text], 'shell')).toMatchObject({
    status: 'missing',
    value: '',
    placeholder: 'Missing terminal 3 — no compatible terminals available',
  })
  expect(terminalSelectState({ kind: 'terminal_index', index: 1 }, [shell], [shell, text], 'shell')).toEqual({
    status: 'selected',
    value: '1',
    title: shell.title,
  })
  expect(terminalSelectState({ kind: 'unassigned' }, [shell])).toEqual({ status: 'unassigned', value: 'unassigned', title: 'Unassigned' })
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
  send.terminal = { kind: 'terminal_index', index: 3 }

  expect(referencedTerminalIndexes(definition)).toEqual([3])
  expect(adoptRuntimeTerminal(definition, 3, runtime)).toEqual({ ok: true })
  expect(definition.terminalLayout).toEqual([
    { index: 1, type: 'shell' },
    { index: 2, type: 'text' },
    { index: 3, type: 'shell' },
  ])

  send.terminal = { kind: 'terminal_index', index: 1 }
  reconcileVisualTerminalLayout(definition)
  expect(definition.terminalLayout).toEqual([{ index: 1, type: 'shell' }])

  definition.body = []
  reconcileVisualTerminalLayout(definition)
  expect(definition.terminalLayout).toEqual([])
  expect(adoptRuntimeTerminal(definition, 4, runtime)).toEqual({ ok: false, reason: 'runtime_terminal_unavailable' })
})

test('the unique JSON gateway reports deterministic UTF-16 positions and Prepare reads layout only', () => {
  const invalid = parseAndValidateMacroDefinitionJson('{\r\n  "schemaVersion": 6,\r\n}')
  expect(invalid).toEqual({ ok: false, error: { code: 'invalid_json', offset: 26, line: 3, column: 1, message: 'Invalid JSON at line 3, column 1' } })

  const prepare = parseAndValidateMacroTerminalLayoutFromDefinitionJson(JSON.stringify({ terminalLayout: [{ index: 1, type: 'text' }], body: 'intentionally invalid for full validation' }))
  expect(prepare).toEqual({ ok: true, value: [{ index: 1, type: 'text' }] })
  expect(new Set(MACRO_DEFINITION_ISSUE_CODES).size).toBe(MACRO_DEFINITION_ISSUE_CODES.length)
})
