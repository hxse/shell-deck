import { expect, test } from 'bun:test'
import type { MacroDefinitionV6 } from '../../src/lib/macro/macroDefinitionTypes'
import {
  validateMacroDefinitionV6,
  validateRunnableMacroDefinitionV6,
} from '../../src/lib/macro/macroDefinitionValidation'
import { validDefinition } from './macroDefinition034.fixtures'

test('MacroDefinitionV6 requires an exact AgentEvent waitLimit branch', () => {
  const definition: MacroDefinitionV6 = {
    schemaVersion: 6,
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
          body: [
            { id: 'lane_capture', type: 'capture-source', capture: { kind: 'agent-event', terminal: { kind: 'terminal_index', index: 1 }, agent: { kind: 'codex' }, captureMode: 'prompt_only', waitLimit: { kind: 'timeout', timeoutMs: 30_000 } } },
          ],
        }],
        sharedTextOrder: 'pane_order',
        onLaneFail: 'fail',
      },
    ],
  }
  expect(validateMacroDefinitionV6(definition)).toEqual({ ok: true, value: definition })

  const legacyV5 = structuredClone(definition) as unknown as Record<string, unknown>
  legacyV5.schemaVersion = 5
  const rejectedV5 = validateMacroDefinitionV6(legacyV5)
  expect(rejectedV5.ok).toBe(false)
  if (!rejectedV5.ok) expect(rejectedV5.issues).toContainEqual({ code: 'invalid_literal', path: 'schemaVersion', message: 'schemaVersion must be 6' })

  const missing = structuredClone(definition) as unknown as { body: Array<{ capture?: Record<string, unknown> }> }
  delete missing.body[0].capture!.waitLimit
  const rejectedMissing = validateMacroDefinitionV6(missing)
  expect(rejectedMissing.ok).toBe(false)
  if (!rejectedMissing.ok) expect(rejectedMissing.issues).toContainEqual({ code: 'missing_field', path: 'body[0].capture.waitLimit', message: 'waitLimit is required' })

  const extra = structuredClone(definition) as unknown as { body: Array<{ capture?: { waitLimit: Record<string, unknown> } }> }
  extra.body[0].capture!.waitLimit.timeoutMs = 1
  const rejectedExtra = validateMacroDefinitionV6(extra)
  expect(rejectedExtra.ok).toBe(false)
  if (!rejectedExtra.ok) expect(rejectedExtra.issues).toContainEqual({ code: 'unknown_field', path: 'body[0].capture.waitLimit.timeoutMs', message: 'unknown field: timeoutMs' })

  for (const waitLimit of [null, false, true]) {
    const invalidBranch = structuredClone(definition) as unknown as { body: Array<{ capture?: Record<string, unknown> }> }
    invalidBranch.body[0].capture!.waitLimit = waitLimit as unknown as Record<string, unknown>
    expect(validateMacroDefinitionV6(invalidBranch).ok).toBe(false)
  }

  const unrelatedCapture = structuredClone(definition) as unknown as { body: Array<unknown> }
  unrelatedCapture.body[0] = {
    id: 'capture',
    type: 'capture-source',
    capture: { kind: 'terminal-buffer', terminal: { kind: 'terminal_index', index: 1 }, mode: 'scrollback-tail', maxChars: 20_000, waitLimit: { kind: 'unbounded' } },
  }
  const rejectedUnrelated = validateMacroDefinitionV6(unrelatedCapture)
  expect(rejectedUnrelated.ok).toBe(false)
  if (!rejectedUnrelated.ok) expect(rejectedUnrelated.issues).toContainEqual({ code: 'unknown_field', path: 'body[0].capture.waitLimit', message: 'unknown field: waitLimit' })

  for (const timeoutMs of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    const invalidTimeout = structuredClone(definition) as unknown as { body: Array<unknown> }
    invalidTimeout.body[0] = { id: 'capture', type: 'capture-source', capture: { kind: 'agent-event', terminal: { kind: 'terminal_index', index: 1 }, agent: { kind: 'codex' }, captureMode: 'result_only', waitLimit: { kind: 'timeout', timeoutMs } } }
    expect(validateMacroDefinitionV6(invalidTimeout).ok).toBe(false)
  }
})

test('App Notify repeat count and interval are required exact bounded integers', () => {
  const definition: MacroDefinitionV6 = {
    schemaVersion: 6,
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
  expect(validateMacroDefinitionV6(definition)).toEqual({ ok: true, value: definition })

  for (const field of ['repeatCount', 'repeatIntervalMs'] as const) {
    const missing = structuredClone(definition) as unknown as { body: Array<{ channels: Array<Record<string, unknown>> }> }
    delete missing.body[0].channels[0][field]
    const result = validateMacroDefinitionV6(missing)
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
    expect(validateMacroDefinitionV6(invalid).ok).toBe(false)
  }
  for (const repeatIntervalMs of [249, 60001, 500.5, Number.POSITIVE_INFINITY]) {
    const invalid = structuredClone(definition)
    const channel = invalid.body[0].type === 'notify' ? invalid.body[0].channels[0] : undefined
    if (channel?.kind !== 'app') throw new Error('expected app channel')
    channel.repeatIntervalMs = repeatIntervalMs
    expect(validateMacroDefinitionV6(invalid).ok).toBe(false)
  }
})

test('unassigned terminal and required artifact slots are persistable but never runnable', () => {
  const definition: MacroDefinitionV6 = {
    schemaVersion: 6,
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

  expect(validateMacroDefinitionV6(definition)).toEqual({ ok: true, value: definition })
  const runnable = validateRunnableMacroDefinitionV6(definition)
  expect(runnable.ok).toBe(false)
  if (!runnable.ok) expect(runnable.issues).toEqual([
    { code: 'unassigned_artifact_reference', path: 'body[0].message.parts[0].source', message: 'artifact source must be assigned before Start' },
    { code: 'unassigned_terminal_reference', path: 'body[0].terminal', message: 'terminal target must be assigned before Start' },
    { code: 'unassigned_artifact_reference', path: 'body[1].branches[0].condition.source', message: 'artifact source must be assigned before Start' },
  ])

  const malformed = structuredClone(definition) as unknown as { body: Array<Record<string, unknown>> }
  malformed.body[0].terminal = { kind: 'unassigned', index: 1 }
  const rejected = validateMacroDefinitionV6(malformed)
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
  const missing = validateMacroDefinitionV6(missingSourceShape)
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.issues).toContainEqual({ code: 'missing_field', path: 'body[0].body[0].message.parts[0].source', message: 'source is required' })

  const assignedOnly: MacroDefinitionV6 = {
    schemaVersion: 6,
    name: 'Assigned-only slots',
    description: '',
    terminalLayout: [],
    body: [
      { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminal: { kind: 'unassigned' } } },
      { id: 'input', type: 'input', terminal: { kind: 'unassigned' }, prompt: 'Input', allowEmpty: true, defaultSource: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' }, delivery: 'auto', ending: 'none' },
      {
        id: 'parallel',
        type: 'parallel',
        lanes: [{ id: 'lane', label: 'lane', body: [] }],
        sharedTextOrder: 'pane_order',
        onLaneFail: 'pause',
      },
    ],
  }
  const invalidDefault = structuredClone(assignedOnly) as unknown as { body: Array<Record<string, unknown>> }
  invalidDefault.body[1].defaultSource = { kind: 'unassigned' }
  const defaultResult = validateMacroDefinitionV6(invalidDefault)
  expect(defaultResult.ok).toBe(false)
  if (!defaultResult.ok) expect(defaultResult.issues).toContainEqual({ code: 'invalid_literal', path: 'body[1].defaultSource.kind', message: 'artifact source kind must be step_artifact' })

  const legacyParallel = structuredClone(assignedOnly) as unknown as {
    body: Array<Record<string, unknown>>
  }
  legacyParallel.body[2].merge = {
    kind: 'sectioned_text',
    separator: '\n',
    includeEmptyOutputs: false,
  }
  const legacyResult = validateMacroDefinitionV6(legacyParallel)
  expect(legacyResult.ok).toBe(false)
  if (!legacyResult.ok) expect(legacyResult.issues).toContainEqual({
    code: 'unknown_field',
    path: 'body[2].merge',
    message: 'unknown field: merge',
  })

  const legacyLaneTerminal = structuredClone(assignedOnly) as unknown as {
    body: Array<Record<string, unknown>>
  }
  const lane = (legacyLaneTerminal.body[2].lanes as Array<Record<string, unknown>>)[0]
  lane.terminal = { kind: 'terminal_index', index: 1 }
  lane.output = { id: 'lane_output', source: { kind: 'none' } }
  const laneResult = validateMacroDefinitionV6(legacyLaneTerminal)
  expect(laneResult.ok).toBe(false)
  if (!laneResult.ok) {
    expect(laneResult.issues).toContainEqual({
      code: 'unknown_field',
      path: 'body[2].lanes[0].terminal',
      message: 'unknown field: terminal',
    })
    expect(laneResult.issues).toContainEqual({
      code: 'unknown_field',
      path: 'body[2].lanes[0].output',
      message: 'unknown field: output',
    })
  }

  const missingOrder = structuredClone(assignedOnly) as unknown as {
    body: Array<Record<string, unknown>>
  }
  delete missingOrder.body[2].sharedTextOrder
  const missingOrderResult = validateMacroDefinitionV6(missingOrder)
  expect(missingOrderResult.ok).toBe(false)
  if (!missingOrderResult.ok) expect(missingOrderResult.issues).toContainEqual({
    code: 'missing_field',
    path: 'body[2].sharedTextOrder',
    message: 'sharedTextOrder is required',
  })

  const mergedArtifact = structuredClone(assignedOnly) as unknown as {
    body: Array<Record<string, unknown>>
  }
  const defaultSource = mergedArtifact.body[1].defaultSource as Record<string, unknown>
  defaultSource.artifact = 'merged_text'
  const mergedResult = validateMacroDefinitionV6(mergedArtifact)
  expect(mergedResult.ok).toBe(false)
  if (!mergedResult.ok) expect(mergedResult.issues.some((issue) => (
    issue.path === 'body[1].defaultSource.artifact' && issue.code === 'invalid_literal'
  ))).toBe(true)
})
