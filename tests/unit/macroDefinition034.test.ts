import { expect, test } from 'bun:test'
import type { MacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionTypes'
import {
  MACRO_DEFINITION_ISSUE_CODES,
  parseAndValidateMacroDefinitionJson,
  parseAndValidateMacroTerminalLayoutFromDefinitionJson,
  type MacroDefinitionIssue,
  validateMacroDefinitionV5,
  validateRunnableMacroDefinitionV5,
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
    { code: 'invalid_literal', path: 'schemaVersion', message: 'schemaVersion must be 5' },
    { code: 'terminal_layout_not_contiguous', path: 'terminalLayout[0].index', message: 'terminalLayout index must be 1' },
    { code: 'unknown_field', path: 'terminalLayout[0].legacy', message: 'unknown field: legacy' },
  ]

  const valueResult = validateMacroDefinitionV5(invalid)
  expect(valueResult).toEqual({ ok: false, issues })
  expect(validateRunnableMacroDefinitionV5(invalid)).toEqual(valueResult)
  expect(parseAndValidateMacroDefinitionJson(JSON.stringify(invalid))).toEqual({
    ok: false,
    error: { code: 'invalid_macro_definition', issues },
  })
})

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

test('MacroDefinitionV5 requires an exact AgentEvent waitLimit branch', () => {
  const definition: MacroDefinitionV5 = {
    schemaVersion: 5,
    name: 'Agent wait limits',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [
      { id: 'capture', type: 'capture-source', capture: { kind: 'agent-event', terminal: { kind: 'terminal_index', index: 1 }, agent: { kind: 'codex' }, captureMode: 'result_only', waitLimit: { kind: 'unbounded' } } },
      {
        id: 'parallel',
        type: 'parallel',
        lanes: [{
          id: 'lane',
          label: 'lane',
          terminal: { kind: 'terminal_index', index: 1 },
          body: [
            { id: 'lane_capture', type: 'capture-source', capture: { kind: 'agent-event', agent: { kind: 'codex' }, captureMode: 'prompt_only', waitLimit: { kind: 'timeout', timeoutMs: 30_000 } } },
            { id: 'output', type: 'output', source: { kind: 'step_artifact', stepId: 'lane_capture', artifact: 'captured_text' } },
          ],
        }],
        merge: { kind: 'sectioned_text', separator: '\n', includeEmptyOutputs: true },
        onLaneFail: 'fail',
      },
    ],
  }
  expect(validateMacroDefinitionV5(definition)).toEqual({ ok: true, value: definition })

  const legacyV4 = structuredClone(definition) as unknown as Record<string, unknown>
  legacyV4.schemaVersion = 4
  const rejectedV4 = validateMacroDefinitionV5(legacyV4)
  expect(rejectedV4.ok).toBe(false)
  if (!rejectedV4.ok) expect(rejectedV4.issues).toContainEqual({ code: 'invalid_literal', path: 'schemaVersion', message: 'schemaVersion must be 5' })

  const missing = structuredClone(definition) as unknown as { body: Array<{ capture?: Record<string, unknown> }> }
  delete missing.body[0].capture!.waitLimit
  const rejectedMissing = validateMacroDefinitionV5(missing)
  expect(rejectedMissing.ok).toBe(false)
  if (!rejectedMissing.ok) expect(rejectedMissing.issues).toContainEqual({ code: 'missing_field', path: 'body[0].capture.waitLimit', message: 'waitLimit is required' })

  const extra = structuredClone(definition) as unknown as { body: Array<{ capture?: { waitLimit: Record<string, unknown> } }> }
  extra.body[0].capture!.waitLimit.timeoutMs = 1
  const rejectedExtra = validateMacroDefinitionV5(extra)
  expect(rejectedExtra.ok).toBe(false)
  if (!rejectedExtra.ok) expect(rejectedExtra.issues).toContainEqual({ code: 'unknown_field', path: 'body[0].capture.waitLimit.timeoutMs', message: 'unknown field: timeoutMs' })

  for (const waitLimit of [null, false, true]) {
    const invalidBranch = structuredClone(definition) as unknown as { body: Array<{ capture?: Record<string, unknown> }> }
    invalidBranch.body[0].capture!.waitLimit = waitLimit as unknown as Record<string, unknown>
    expect(validateMacroDefinitionV5(invalidBranch).ok).toBe(false)
  }

  const unrelatedCapture = structuredClone(definition) as unknown as { body: Array<unknown> }
  unrelatedCapture.body[0] = {
    id: 'capture',
    type: 'capture-source',
    capture: { kind: 'terminal-buffer', terminal: { kind: 'terminal_index', index: 1 }, mode: 'scrollback-tail', maxChars: 20_000, waitLimit: { kind: 'unbounded' } },
  }
  const rejectedUnrelated = validateMacroDefinitionV5(unrelatedCapture)
  expect(rejectedUnrelated.ok).toBe(false)
  if (!rejectedUnrelated.ok) expect(rejectedUnrelated.issues).toContainEqual({ code: 'unknown_field', path: 'body[0].capture.waitLimit', message: 'unknown field: waitLimit' })

  for (const timeoutMs of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    const invalidTimeout = structuredClone(definition) as unknown as { body: Array<unknown> }
    invalidTimeout.body[0] = { id: 'capture', type: 'capture-source', capture: { kind: 'agent-event', terminal: { kind: 'terminal_index', index: 1 }, agent: { kind: 'codex' }, captureMode: 'result_only', waitLimit: { kind: 'timeout', timeoutMs } } }
    expect(validateMacroDefinitionV5(invalidTimeout).ok).toBe(false)
  }
})

test('App Notify repeat count and interval are required exact bounded integers', () => {
  const definition: MacroDefinitionV5 = {
    schemaVersion: 5,
    name: 'Repeated app notification',
    description: '',
    terminalLayout: [],
    body: [{
      id: 'notify',
      type: 'notify',
      level: 'warning',
      title: 'Attention',
      message: { parts: [{ kind: 'text', text: 'Review the terminal.' }] },
      channels: [{ kind: 'app', toast: true, sound: 'alert', repeatCount: 3, repeatIntervalMs: 1000 }],
      onFailure: 'continue',
    }],
  }
  expect(validateMacroDefinitionV5(definition)).toEqual({ ok: true, value: definition })

  for (const field of ['repeatCount', 'repeatIntervalMs'] as const) {
    const missing = structuredClone(definition) as unknown as { body: Array<{ channels: Array<Record<string, unknown>> }> }
    delete missing.body[0].channels[0][field]
    const result = validateMacroDefinitionV5(missing)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues).toContainEqual({
      code: 'missing_field',
      path: `body[0].channels[0].${field}`,
      message: `${field} is required`,
    })
  }

  for (const repeatCount of [0, 11, 1.5, Number.POSITIVE_INFINITY]) {
    const invalid = structuredClone(definition)
    const channel = invalid.body[0].type === 'notify' ? invalid.body[0].channels[0] : undefined
    if (channel?.kind !== 'app') throw new Error('expected app channel')
    channel.repeatCount = repeatCount
    expect(validateMacroDefinitionV5(invalid).ok).toBe(false)
  }
  for (const repeatIntervalMs of [249, 60001, 500.5, Number.POSITIVE_INFINITY]) {
    const invalid = structuredClone(definition)
    const channel = invalid.body[0].type === 'notify' ? invalid.body[0].channels[0] : undefined
    if (channel?.kind !== 'app') throw new Error('expected app channel')
    channel.repeatIntervalMs = repeatIntervalMs
    expect(validateMacroDefinitionV5(invalid).ok).toBe(false)
  }
})

test('unassigned terminal and required artifact slots are persistable but never runnable', () => {
  const definition: MacroDefinitionV5 = {
    schemaVersion: 5,
    name: 'Persistable draft',
    description: '',
    terminalLayout: [],
    body: [
      {
        id: 'send',
        type: 'send',
        terminal: { kind: 'unassigned' },
        message: { parts: [{ kind: 'artifact', source: { kind: 'unassigned' } }] },
        delivery: 'auto',
        ending: 'cr',
      },
      {
        id: 'if',
        type: 'if',
        branches: [{
          kind: 'if',
          condition: {
            kind: 'text_match',
            source: { kind: 'unassigned' },
            matcher: { kind: 'simple', op: 'contains', text: '' },
            scope: { kind: 'whole' },
          },
          body: [{ id: 'wait', type: 'wait', mode: 'duration', durationMs: 1 }],
        }],
      },
    ],
  }

  expect(validateMacroDefinitionV5(definition)).toEqual({ ok: true, value: definition })
  const runnable = validateRunnableMacroDefinitionV5(definition)
  expect(runnable.ok).toBe(false)
  if (!runnable.ok) expect(runnable.issues).toEqual([
    { code: 'unassigned_artifact_reference', path: 'body[0].message.parts[0].source', message: 'artifact source must be assigned before Start' },
    { code: 'unassigned_terminal_reference', path: 'body[0].terminal', message: 'terminal target must be assigned before Start' },
    { code: 'unassigned_artifact_reference', path: 'body[1].branches[0].condition.source', message: 'artifact source must be assigned before Start' },
  ])

  const malformed = structuredClone(definition) as unknown as { body: Array<Record<string, unknown>> }
  malformed.body[0].terminal = { kind: 'unassigned', index: 1 }
  const rejected = validateMacroDefinitionV5(malformed)
  expect(rejected.ok).toBe(false)
  if (!rejected.ok) expect(rejected.issues).toContainEqual({ code: 'unknown_field', path: 'body[0].terminal.index', message: 'unknown field: index' })
})

test('unassigned is rejected outside the finite required-reference whitelist', () => {
  const missingMessageSource = validDefinition()
  const send = missingMessageSource.body[0].type === 'for' ? missingMessageSource.body[0].body[0] : undefined
  if (!send || send.type !== 'send') throw new Error('expected send fixture')
  send.message.parts = [{ kind: 'artifact', source: { kind: 'unassigned' } }]
  const missingSourceShape = structuredClone(missingMessageSource) as unknown as { body: Array<{ body: Array<{ message: { parts: Array<Record<string, unknown>> } }> }> }
  delete missingSourceShape.body[0].body[0].message.parts[0].source
  const missing = validateMacroDefinitionV5(missingSourceShape)
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.issues).toContainEqual({ code: 'missing_field', path: 'body[0].body[0].message.parts[0].source', message: 'source is required' })

  const assignedOnly: MacroDefinitionV5 = {
    schemaVersion: 5,
    name: 'Assigned-only slots',
    description: '',
    terminalLayout: [],
    body: [
      { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminal: { kind: 'unassigned' } } },
      { id: 'input', type: 'input', terminal: { kind: 'unassigned' }, prompt: 'Input', allowEmpty: true, defaultSource: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' }, delivery: 'auto', ending: 'none' },
      {
        id: 'parallel',
        type: 'parallel',
        lanes: [{ id: 'lane', label: 'lane', terminal: { kind: 'unassigned' }, body: [{ id: 'output', type: 'output', source: { kind: 'none' } }] }],
        merge: { kind: 'sectioned_text', separator: '\n', includeEmptyOutputs: false },
        onLaneFail: 'pause',
      },
    ],
  }
  const invalidDefault = structuredClone(assignedOnly) as unknown as { body: Array<Record<string, unknown>> }
  invalidDefault.body[1].defaultSource = { kind: 'unassigned' }
  const defaultResult = validateMacroDefinitionV5(invalidDefault)
  expect(defaultResult.ok).toBe(false)
  if (!defaultResult.ok) expect(defaultResult.issues).toContainEqual({ code: 'invalid_literal', path: 'body[1].defaultSource.kind', message: 'artifact source kind must be step_artifact' })

  const invalidOutput = structuredClone(assignedOnly) as unknown as { body: Array<{ lanes?: Array<{ body: Array<{ source: unknown }> }> }> }
  invalidOutput.body[2].lanes![0].body[0].source = { kind: 'unassigned' }
  const outputResult = validateMacroDefinitionV5(invalidOutput)
  expect(outputResult.ok).toBe(false)
  if (!outputResult.ok) expect(outputResult.issues).toContainEqual({ code: 'invalid_literal', path: 'body[2].lanes[0].body[0].source.kind', message: 'artifact source kind must be step_artifact' })
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
  const invalid = parseAndValidateMacroDefinitionJson('{\r\n  "schemaVersion": 5,\r\n}')
  expect(invalid).toEqual({ ok: false, error: { code: 'invalid_json', offset: 26, line: 3, column: 1, message: 'Invalid JSON at line 3, column 1' } })

  const prepare = parseAndValidateMacroTerminalLayoutFromDefinitionJson(JSON.stringify({ terminalLayout: [{ index: 1, type: 'text' }], body: 'intentionally invalid for full validation' }))
  expect(prepare).toEqual({ ok: true, value: [{ index: 1, type: 'text' }] })
  expect(new Set(MACRO_DEFINITION_ISSUE_CODES).size).toBe(MACRO_DEFINITION_ISSUE_CODES.length)
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

function validDefinition(): MacroDefinitionV5 {
  return {
    schemaVersion: 5,
    name: 'V5 macro',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [{
      id: 'loop',
      type: 'for',
      range: { kind: 'text-list', items: [{ key: 'phase', value: 'one' }] },
      body: [{ id: 'send', type: 'send', terminal: { kind: 'terminal_index', index: 1 }, message: { parts: [{ kind: 'template', template: '{{index}} {{key}} {{value}}' }] }, delivery: 'auto', ending: 'cr' }],
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
