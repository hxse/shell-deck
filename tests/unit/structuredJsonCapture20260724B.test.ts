import { describe, expect, test } from 'bun:test'
import { matchesMacroCondition, type MacroArtifactMap } from '../../server/macroTextEvaluation'
import { submitStructuredJson } from '../../scripts/submitStructuredJson'
import {
  artifactChoicesBefore,
  jsonArtifactChoices,
} from '../../src/lib/macro/macroArtifactChoices'
import type { MacroDefinitionV5 } from '../../src/lib/macro/macroDefinitionTypes'
import {
  validateMacroDefinitionV5,
  validateRunnableMacroDefinitionV5,
} from '../../src/lib/macro/macroDefinitionValidation'
import {
  canonicalJson,
  compileStructuredJsonSchema,
  resolveJsonPointer,
  structuredJsonSubmissionPrompt,
  validateJsonPointer,
} from '../../src/lib/macro/structuredJson'

describe('20260724B structured JSON definition contract', () => {
  test('valid schema, typed artifact, and json_match are runnable', () => {
    const definition = structuredDefinition()
    expect(validateMacroDefinitionV5(definition)).toEqual({ ok: true, value: definition })
    expect(validateRunnableMacroDefinitionV5(definition)).toEqual({ ok: true, value: definition })

    const choices = artifactChoicesBefore(definition, 'branch')
    expect(jsonArtifactChoices(choices).map((choice) => choice.label))
      .toEqual(['capture_decision.captured_json'])
    expect(choices.map((choice) => choice.label))
      .toEqual(['capture_decision.captured_json'])
  })

  test('invalid schemas, pointers, typed JSON inputs, and Parallel placement fail loudly', () => {
    const remoteSchema = structuredClone(structuredDefinition()) as unknown as {
      body: Array<{ capture?: { schema: unknown } }>
    }
    remoteSchema.body[0].capture!.schema = { $ref: 'https://example.invalid/schema.json' }
    expect(issueCodes(remoteSchema)).toContain('invalid_json_schema')

    const badPointer = structuredClone(structuredDefinition())
    const branch = badPointer.body[1]
    if (branch.type !== 'if') throw new Error('expected if')
    branch.branches[0].condition = { ...branch.branches[0].condition, pointer: '/bad~2key' } as never
    expect(issueCodes(badPointer)).toContain('invalid_json_pointer')

    const jsonConsumesText = structuredClone(structuredDefinition()) as unknown as {
      body: Array<Record<string, unknown>>
    }
    jsonConsumesText.body[0] = {
      id: 'capture_text',
      type: 'capture-source',
      capture: {
        kind: 'terminal-buffer',
        terminal: { kind: 'terminal_index', index: 1 },
        mode: 'scrollback-tail',
        maxChars: 100,
      },
    }
    const condition = ((jsonConsumesText.body[1].branches as Array<{ condition: Record<string, unknown> }>)[0]).condition
    condition.source = { kind: 'step_artifact', stepId: 'capture_text', artifact: 'captured_text' }
    expect(issueCodes(jsonConsumesText)).toContain('invalid_literal')

    const parallel = structuredClone(structuredDefinition()) as unknown as {
      body: Array<Record<string, unknown>>
    }
    parallel.body = [{
      id: 'parallel',
      type: 'parallel',
      lanes: [{
        id: 'lane',
        label: 'lane',
        terminal: { kind: 'terminal_index', index: 1 },
        body: [
          {
            id: 'bad_capture',
            type: 'capture-source',
            capture: { kind: 'structured-json', schema: true, waitLimit: { kind: 'unbounded' } },
          },
          { id: 'output', type: 'output', source: { kind: 'none' } },
        ],
      }],
      merge: { kind: 'sectioned_text', separator: '\n', includeEmptyOutputs: false },
      onLaneFail: 'fail',
    }]
    expect(issueCodes(parallel)).toContain('semantic_conflict')
  })
})

describe('20260724B JSON Schema and matcher semantics', () => {
  test('schema validation and pointer resolution are deterministic', () => {
    const compiled = compileStructuredJsonSchema({
      type: 'object',
      required: ['decision'],
      additionalProperties: false,
      properties: { decision: { enum: ['continue', 'retry'] } },
    })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    expect(compiled.validator.validate({ decision: 'retry' })).toEqual([])
    expect(compiled.validator.validate({ decision: 'other' })).toEqual([{
      path: '/decision',
      keyword: 'enum',
      message: 'must be equal to one of the allowed values',
    }])

    const schemaWithId = {
      $id: 'https://shell-deck.invalid/decision',
      $defs: { decision: { enum: ['continue', 'retry'] } },
      $ref: '#/$defs/decision',
    }
    const firstCompile = compileStructuredJsonSchema(schemaWithId)
    const secondCompile = compileStructuredJsonSchema(structuredClone(schemaWithId))
    expect(firstCompile.ok).toBe(true)
    expect(secondCompile.ok).toBe(true)
    if (firstCompile.ok && secondCompile.ok) {
      expect(firstCompile.validator.validate('retry')).toEqual([])
      expect(secondCompile.validator.validate('other')).toEqual([{
        path: '',
        keyword: 'enum',
        message: 'must be equal to one of the allowed values',
      }])
    }
    expect(compileStructuredJsonSchema({
      $id: 'https://shell-deck.invalid/remote',
      $ref: 'https://shell-deck.invalid/remote',
    })).toEqual({
      ok: false,
      message: '$ref must use a local fragment',
    })
    expect(compileStructuredJsonSchema({
      type: 'object',
      properties: {
        child: { $dynamicRef: 'https://shell-deck.invalid/child' },
      },
    })).toEqual({
      ok: false,
      message: '$dynamicRef must use a local fragment',
    })
    for (const dataBearingSchema of [
      {
        type: 'object',
        properties: {
          $ref: { type: 'string' },
          $dynamicRef: { type: 'string' },
        },
      },
      {
        $defs: {
          $ref: { type: 'string' },
          $dynamicRef: { type: 'number' },
        },
      },
      { const: { $ref: 'https://shell-deck.invalid/data' } },
      { enum: [{ $dynamicRef: 'https://shell-deck.invalid/data' }] },
      { examples: [{ $ref: 'https://shell-deck.invalid/data' }] },
    ]) {
      expect(compileStructuredJsonSchema(dataBearingSchema).ok).toBe(true)
    }

    const value = { 'a/b': { '~key': ['zero', { count: 2 }] } }
    expect(resolveJsonPointer(value, '/a~1b/~0key/1/count')).toEqual({ found: true, value: 2 })
    expect(resolveJsonPointer(value, '')).toEqual({ found: true, value })
    expect(resolveJsonPointer(value, '/a~1b/~0key/01')).toEqual({ found: false })
    expect(validateJsonPointer('/bad~2escape')).toBeTruthy()
    expect(canonicalJson({ z: 1, a: { y: true, b: false } }))
      .toBe('{\n  "a": {\n    "b": false,\n    "y": true\n  },\n  "z": 1\n}\n')

    const prompt = structuredJsonSubmissionPrompt({
      type: 'object',
      required: ['decision'],
      properties: { decision: { type: 'string' } },
    })
    expect(prompt.startsWith('\n------------\n\n')).toBe(true)
    expect(prompt.endsWith('\n\n------------\n')).toBe(true)
    expect(prompt).toContain("just -f \"$SHELL_DECK_JUSTFILE\" submit-json <<'SHELL_DECK_JSON'")
    expect(prompt).toContain('"required": [\n    "decision"\n  ]')
    expect(prompt).toContain('structured_json_submitted')
    expect(prompt).toContain('structured_json_schema_mismatch')
  })

  test('json_match keeps missing and scalar comparisons typed', () => {
    const artifacts: MacroArtifactMap = new Map([[
      'capture',
      new Map([['captured_json', { kind: 'json', value: { decision: '1', score: 0.82 } }]]),
    ]])
    const source = { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_json' } as const
    expect(matchesMacroCondition(artifacts, {
      kind: 'json_match', source, pointer: '/decision', matcher: { kind: 'equals', value: '1' },
    })).toBe(true)
    expect(matchesMacroCondition(artifacts, {
      kind: 'json_match', source, pointer: '/decision', matcher: { kind: 'equals', value: 1 },
    })).toBe(false)
    expect(matchesMacroCondition(artifacts, {
      kind: 'json_match', source, pointer: '/score', matcher: { kind: 'greater_than', value: 0.8 },
    })).toBe(true)
    expect(matchesMacroCondition(artifacts, {
      kind: 'json_match', source, pointer: '/missing', matcher: { kind: 'not_equals', value: 'x' },
    })).toBe(false)
    expect(matchesMacroCondition(artifacts, {
      kind: 'json_match', source, pointer: '/missing', matcher: { kind: 'not_exists' },
    })).toBe(true)
  })
})

describe('20260724B submit-json CLI adapter', () => {
  test('requires terminal context and valid stdin', async () => {
    expect(await submitStructuredJson('{}', {})).toMatchObject({
      exitCode: 1,
      stderr: 'structured_json_room_context_required\n',
    })
    expect(await submitStructuredJson('not-json', submitEnvironment())).toMatchObject({
      exitCode: 1,
      stderr: 'structured_json_invalid_json\n',
    })
  })

  test('forwards exact runtime identity and surfaces server issues', async () => {
    let request: RequestInit | undefined
    const env = submitEnvironment()
    const succeeded = await submitStructuredJson('{"decision":"retry"}', env, async (_url, init) => {
      request = init
      return new Response(JSON.stringify({ ok: true }), { status: 201 })
    })
    expect(succeeded).toEqual({ exitCode: 0, stdout: 'structured_json_submitted\n', stderr: '' })
    expect(JSON.parse(String(request?.body))).toEqual({
      protocolVersion: 1,
      roomGeneration: 'roomGeneration_test',
      terminalId: 'term_test',
      launchId: 'launch_test',
      value: { decision: 'retry' },
    })

    const failed = await submitStructuredJson('{}', env, async () => new Response(JSON.stringify({
      ok: false,
      error: 'structured_json_schema_mismatch',
      issues: [{ path: '', keyword: 'required', message: 'required' }],
    }), { status: 422 }))
    expect(failed.exitCode).toBe(1)
    expect(failed.stderr).toContain('structured_json_schema_mismatch')
    expect(failed.stderr).toContain('"keyword": "required"')
  })
})

function structuredDefinition(): MacroDefinitionV5 {
  return {
    schemaVersion: 5,
    name: 'Structured decision',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [
      {
        id: 'capture_decision',
        type: 'capture-source',
        capture: {
          kind: 'structured-json',
          terminal: { kind: 'terminal_index', index: 1 },
          schema: {
            type: 'object',
            required: ['decision'],
            additionalProperties: false,
            properties: { decision: { enum: ['continue', 'retry'] } },
          },
          waitLimit: { kind: 'unbounded' },
        },
      },
      {
        id: 'branch',
        type: 'if',
        branches: [{
          kind: 'if',
          condition: {
            kind: 'json_match',
            source: { kind: 'step_artifact', stepId: 'capture_decision', artifact: 'captured_json' },
            pointer: '/decision',
            matcher: { kind: 'equals', value: 'retry' },
          },
          body: [{ id: 'wait', type: 'wait', mode: 'duration', durationMs: 1 }],
        }],
      },
    ],
  }
}

function issueCodes(input: unknown): string[] {
  const result = validateMacroDefinitionV5(input)
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

function submitEnvironment(): Record<string, string> {
  return {
    SHELL_DECK_SUBMIT_JSON_URL: 'http://127.0.0.1:5177/api/rooms/room_test/structured-results',
    SHELL_DECK_INGEST_TOKEN: 'token',
    SHELL_DECK_ROOM_GENERATION: 'roomGeneration_test',
    SHELL_DECK_TERMINAL_ID: 'term_test',
    SHELL_DECK_LAUNCH_ID: 'launch_test',
  }
}
