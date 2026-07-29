import { describe, expect, test } from 'bun:test'
import {
  extractMacroText,
  matchesMacroCondition,
  readMacroArtifact,
  renderMacroMessage,
  type MacroArtifactMap,
} from '../../server/macroTextEvaluation'
import type {
  FlowV2ArtifactSource,
  MacroDefinitionV6,
} from '../../src/lib/macro/macroDefinitionTypes'
import {
  validateMacroDefinitionV6,
  validateRunnableMacroDefinitionV6,
} from '../../src/lib/macro/macroDefinitionValidation'
import { compactCanonicalJson } from '../../src/lib/macro/structuredJson'

const JSON_SOURCE = {
  kind: 'step_artifact',
  stepId: 'capture_decision',
  artifact: 'captured_json',
} as const

describe('20260724B structured JSON textual forwarding', () => {
  test('all textual consumers accept an earlier typed JSON artifact', () => {
    const definition = forwardingDefinition()
    expect(validateMacroDefinitionV6(definition)).toEqual({ ok: true, value: definition })
    expect(validateRunnableMacroDefinitionV6(definition)).toEqual({ ok: true, value: definition })
  })

  test('Parallel consumes outer artifacts but publishes no implicit merged artifact', () => {
    const definition = forwardingDefinition()
    definition.body.push({
      id: 'after_parallel',
      type: 'send',
      terminal: { kind: 'terminal_index', index: 1 },
      message: {
        parts: [{
          kind: 'artifact',
          source: { kind: 'step_artifact', stepId: 'parallel', artifact: 'extracted_text' },
        }],
      },
      delivery: 'direct',
      ending: 'cr',
    })
    const result = validateMacroDefinitionV6(definition)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'invalid_reference',
      path: 'body[7].message.parts[0].source',
    }))
  })

  test('one compact canonical projection powers messages, text matching, and extraction', () => {
    const value = { z: 1, nested: { y: true, a: ['line\nnext', null] } }
    const artifacts = jsonArtifacts(value)
    const projected = '{"nested":{"a":["line\\nnext",null],"y":true},"z":1}'
    expect(compactCanonicalJson(value)).toBe(projected)
    expect(readMacroArtifact(artifacts, JSON_SOURCE)).toBe(projected)
    expect(renderMacroMessage({
      parts: [
        { kind: 'text', text: 'payload=' },
        { kind: 'artifact', source: JSON_SOURCE },
      ],
    }, artifacts, undefined)).toBe(`payload=${projected}`)
    expect(matchesMacroCondition(artifacts, {
      kind: 'text_match',
      source: JSON_SOURCE,
      matcher: { kind: 'simple', op: 'contains', text: '"z":1' },
      scope: { kind: 'whole' },
    })).toBe(true)
    expect(extractMacroText(projected, {
      id: 'extract',
      type: 'extract_text',
      source: JSON_SOURCE,
      split: { kind: 'regex', pattern: '"z":', keepEmpty: false },
      filters: [],
      select: { mode: 'index', index: 1 },
      extract: { kind: 'none' },
      trim: 'both',
      onEmpty: 'fail',
    })).toBe('1}')
    expect(compactCanonicalJson([{ z: 1, a: 2 }, true])).toBe('[{"a":2,"z":1},true]')
    expect(compactCanonicalJson('line\nnext')).toBe('"line\\nnext"')
    expect(compactCanonicalJson(2)).toBe('2')
  })

  test('text stays verbatim and source/value kind mismatches still fail loudly', () => {
    const textSource = {
      kind: 'step_artifact',
      stepId: 'capture_text',
      artifact: 'captured_text',
    } as const
    const textArtifacts: MacroArtifactMap = new Map([[
      'capture_text',
      new Map([['captured_text', { kind: 'text', value: 'raw\ntext' }]]),
    ]])
    expect(readMacroArtifact(textArtifacts, textSource)).toBe('raw\ntext')
    expect(() => readMacroArtifact(
      new Map([['capture_decision', new Map([['captured_json', { kind: 'text', value: '{}' }]])]]),
      JSON_SOURCE,
    )).toThrow('artifact_type_mismatch')
    expect(() => readMacroArtifact(
      new Map([['capture_text', new Map([['captured_text', { kind: 'json', value: {} }]])]]),
      textSource,
    )).toThrow('artifact_type_mismatch')
  })
})

function jsonArtifacts(value: Parameters<typeof compactCanonicalJson>[0]): MacroArtifactMap {
  return new Map([[
    'capture_decision',
    new Map([['captured_json', { kind: 'json', value }]]),
  ]])
}

function forwardingDefinition(): MacroDefinitionV6 {
  const source = (): FlowV2ArtifactSource => ({ ...JSON_SOURCE })
  return {
    schemaVersion: 6,
    name: 'Forward structured JSON',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [
      {
        id: 'capture_decision',
        type: 'capture-source',
        capture: {
          kind: 'structured-json',
          terminal: { kind: 'terminal_index', index: 1 },
          schema: true,
          waitLimit: { kind: 'unbounded' },
        },
      },
      {
        id: 'send_json',
        type: 'send',
        terminal: { kind: 'terminal_index', index: 1 },
        message: { parts: [{ kind: 'artifact', source: source() }] },
        delivery: 'direct',
        ending: 'cr',
      },
      {
        id: 'notify_json',
        type: 'notify',
        level: 'info',
        title: 'JSON',
        message: { parts: [{ kind: 'artifact', source: source() }] },
        channels: [{ kind: 'system' }],
        onFailure: 'fail',
      },
      {
        id: 'input_json',
        type: 'input',
        terminal: { kind: 'terminal_index', index: 1 },
        prompt: 'Confirm',
        allowEmpty: false,
        delivery: 'direct',
        ending: 'cr',
        defaultSource: JSON_SOURCE,
      },
      {
        id: 'extract_json',
        type: 'extract_text',
        source: source(),
        split: { kind: 'lines', keepEmpty: false },
        filters: [],
        select: { mode: 'all' },
        extract: { kind: 'none' },
        trim: 'none',
        onEmpty: 'fail',
      },
      {
        id: 'text_branch',
        type: 'if',
        branches: [{
          kind: 'if',
          condition: {
            kind: 'text_match',
            source: source(),
            matcher: { kind: 'simple', op: 'contains', text: '"decision"' },
            scope: { kind: 'whole' },
          },
          body: [{ id: 'wait', type: 'wait', mode: 'duration', durationMs: 1 }],
        }],
      },
      {
        id: 'parallel',
        type: 'parallel',
        lanes: [{
          id: 'lane',
          label: 'lane',
          body: [
            {
              id: 'lane_send_json',
              type: 'send',
              terminal: { kind: 'terminal_index', index: 1 },
              message: { parts: [{ kind: 'artifact', source: source() }] },
              delivery: 'direct',
              ending: 'cr',
            },
          ],
        }],
        sharedTextOrder: 'pane_order',
        onLaneFail: 'fail',
      },
    ],
  }
}
