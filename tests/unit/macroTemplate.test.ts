import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MacroTemplateStore } from '../../src/lib/macro/templateStore'
import { validateMacroTemplate } from '../../src/lib/macro/templateSchema'
import type { MacroTemplate } from '../../src/lib/macro/templateTypes'
import type { TerminalIndexMapItem } from '../../src/lib/protocol'

const indexMap: TerminalIndexMapItem[] = [
  { index: 1, terminalId: 'term_main_a', terminalAlias: 'terminal_1' },
  { index: 2, terminalId: 'term_review_b', terminalAlias: 'reviewer' },
]

test('valid template covers V0 step schema and structured branch', () => {
  const result = validateMacroTemplate(validTemplate(), { indexMap })
  expect(result).toEqual({ ok: true, issues: [] })
})

test('template rejects macro-local terminal aliases and top-level capture sources', () => {
  const template = validTemplate() as MacroTemplate & { terminalAliases?: unknown; captureSources?: unknown }
  template.terminalAliases = { review: { kind: 'index', value: 2 } }
  template.captureSources = { reviewTui: { kind: 'terminal-buffer' } }

  const result = validateMacroTemplate(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('macro-local terminalAliases are not allowed')
  expect(issueText(result)).toContain('capture source config must live in capture-source steps')
})

test('branch rejects string expressions and string boolean values', () => {
  const template = validTemplate()
  const branch = template.steps.find((step) => step.type === 'branch')
  if (!branch || branch.type !== 'branch') throw new Error('missing branch')
  branch.conditions[0] = { expression: 'hasReadyText == true', if: 'hasReadyText == true', signal: 'hasReadyText', op: '==', value: 'true', goto: 'complete_ok' } as never

  const result = validateMacroTemplate(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('string expressions are not allowed')
  expect(issueText(result)).toContain('typed true or false')
})

test('branch can only reference selected parse output signals and operators', () => {
  const template = validTemplate()
  const branch = template.steps.find((step) => step.type === 'branch')
  if (!branch || branch.type !== 'branch') throw new Error('missing branch')
  branch.conditions[0].signal = 'needsUserDecision'

  const result = validateMacroTemplate(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('signal is not declared by selected parse step')
})

test('regex parser rejects unsafe flags and invalid output type', () => {
  const template = validTemplate()
  const parse = template.steps.find((step) => step.type === 'parse')
  if (!parse || parse.type !== 'parse' || parse.parser.kind !== 'regex') throw new Error('missing regex parse')
  parse.parser.rules[0].flags = 'gi'
  parse.parser.rules[0].type = 'string' as never

  const result = validateMacroTemplate(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('regex flags may only include i, m, s, u')
  expect(issueText(result)).toContain('V0 regex rule type must be boolean-null')
})

test('template rejects Codex session fields and parser bundle fields', () => {
  const template = validTemplate() as MacroTemplate & { session_id?: string }
  template.session_id = 'codex-session'
  const parse = template.steps.find((step) => step.type === 'parse')
  if (!parse || parse.type !== 'parse') throw new Error('missing parse')
  parse.parser = { kind: 'ai-json', profileId: 'review-routing-v1', prompt: 'custom' } as never

  const result = validateMacroTemplate(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('must not persist Codex session fields')
  expect(issueText(result)).toContain('parser bundle fields are out of scope')
})

test('terminal refs are config scoped for index, id and terminal-tab alias validation', () => {
  const missingIndex = validTemplate()
  const send = missingIndex.steps.find((step) => step.type === 'send_line')
  if (!send || send.type !== 'send_line') throw new Error('missing send')
  send.terminal = { kind: 'index', value: 3 }
  expect(issueText(validateMacroTemplate(missingIndex, { indexMap }))).toContain('terminal index is not present')

  const missingId = validTemplate()
  const capture = missingId.steps.find((step) => step.type === 'capture-source')
  if (!capture || capture.type !== 'capture-source') throw new Error('missing capture')
  capture.capture.terminal = { kind: 'id', value: 'term_other_config' }
  expect(issueText(validateMacroTemplate(missingId, { indexMap }))).toContain('terminal id is not present')

  const missingAlias = validTemplate()
  const input = missingAlias.steps.find((step) => step.type === 'input_line')
  if (!input || input.type !== 'input_line') throw new Error('missing input')
  input.terminal = { kind: 'alias', value: 'missing_alias' }
  expect(issueText(validateMacroTemplate(missingAlias, { indexMap }))).toContain('terminal alias is not present')
})

test('parse and capture-ready wait must reference capture-source steps', () => {
  const template = validTemplate()
  const parse = template.steps.find((step) => step.type === 'parse')
  const wait = template.steps.find((step) => step.type === 'wait' && step.mode === 'capture-ready-or-user')
  if (!parse || parse.type !== 'parse' || !wait || wait.type !== 'wait' || wait.mode !== 'capture-ready-or-user') throw new Error('missing steps')
  parse.captureStep = 'send_prompt'
  wait.captureStep = 'missing_capture'

  const result = validateMacroTemplate(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('captureStep must reference a capture-source step')
})

test('loop back edges require loopGuard and validate loopGuard bounds', () => {
  const template = validTemplate()
  template.steps.push({ id: 'loop_back', type: 'goto', goto: 'send_prompt' })
  let result = validateMacroTemplate(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('back edge requires loopGuard')

  template.steps[template.steps.length - 1] = { id: 'loop_back', type: 'goto', goto: 'send_prompt', loopGuard: { maxIterations: 5, onLimit: 'pause' } }
  result = validateMacroTemplate(template, { indexMap })
  expect(result.ok).toBe(true)
})


test('store migrates legacy terminalAliases and captureSources on read and import', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-003-legacy-'))
  try {
    const store = new MacroTemplateStore(root)
    const legacy = legacyTemplate()
    const templateDir = join(root, '.shell-deck', 'configs', 'local', 'templates')
    mkdirSync(templateDir, { recursive: true })
    writeFileSync(join(templateDir, 'legacy_template.json'), JSON.stringify(legacy, null, 2) + '\n')

    const read = store.read('local', 'legacy_template')
    expect('terminalAliases' in read).toBe(false)
    expect('captureSources' in read).toBe(false)
    expect(validateMacroTemplate(read, { indexMap })).toEqual({ ok: true, issues: [] })

    const capture = read.steps.find((step) => step.id === 'capture_review')
    expect(capture).toEqual({
      id: 'capture_review',
      type: 'capture-source',
      capture: { kind: 'terminal-buffer', terminal: { kind: 'index', value: 2 }, mode: 'scrollback-tail', maxChars: 12000 },
      next: 'parse_review',
    })
    const wait = read.steps.find((step) => step.id === 'wait_review')
    expect(wait).toMatchObject({ type: 'wait', captureStep: 'capture_review' })
    const parse = read.steps.find((step) => step.id === 'parse_review')
    expect(parse).toMatchObject({ type: 'parse', captureStep: 'capture_review' })

    const imported = store.import('local', { ...legacy, id: 'legacy_imported' }, indexMap)
    expect('terminalAliases' in imported).toBe(false)
    expect('captureSources' in imported).toBe(false)
    expect(validateMacroTemplate(imported, { indexMap })).toEqual({ ok: true, issues: [] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('store saves, duplicates and imports template JSON without losing macro fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-003-'))
  try {
    const store = new MacroTemplateStore(root)
    const template = store.save('local', validTemplate(), indexMap)
    const read = store.read('local', template.id)
    expect('terminalAliases' in read).toBe(false)
    expect('captureSources' in read).toBe(false)
    expect(read.steps.map((step) => step.type)).toContain('capture-source')
    expect(read.steps.map((step) => step.type)).toContain('input_line')
    expect(read.steps.map((step) => step.type)).toContain('branch')

    const duplicated = store.duplicate('local', template.id, indexMap)
    expect(duplicated.id).not.toBe(template.id)
    expect(duplicated.steps).toEqual(template.steps)

    const imported = store.import('local', { ...template, id: 'imported_template' }, indexMap)
    expect(imported.id).toBe('imported_template')
    expect(store.list('local').map((item) => item.id).sort()).toEqual([duplicated.id, imported.id, template.id].sort())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


function legacyTemplate(): MacroTemplate & { terminalAliases: unknown; captureSources: unknown } {
  const now = new Date('2026-06-29T00:00:00.000Z').toISOString()
  return {
    schemaVersion: 1,
    id: 'legacy_template',
    name: 'Legacy Template',
    description: 'old schema fixture',
    configId: 'local',
    terminalAliases: {
      review: { kind: 'index', value: 2 },
      main: { kind: 'index', value: 1 },
    },
    captureSources: {
      reviewTui: { kind: 'terminal-buffer', terminal: 'review', mode: 'scrollback-tail', maxChars: 12000 },
    },
    steps: [
      { id: 'send_prompt', type: 'send_line', terminal: 'review', text: 'review docs only', next: 'wait_review' },
      { id: 'wait_review', type: 'wait', mode: 'capture-ready-or-user', source: 'reviewTui', timeoutMs: 600000, onTimeout: 'pause', next: 'capture_review' },
      { id: 'capture_review', type: 'capture-source', source: 'reviewTui', next: 'parse_review' },
      {
        id: 'parse_review',
        type: 'parse',
        source: 'reviewTui',
        parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready', flags: 'i', onMatch: true, onNoMatch: false }] },
        next: 'branch_review',
      },
      { id: 'branch_review', type: 'branch', fromParseStep: 'parse_review', conditions: [{ signal: 'hasReadyText', op: '==', value: true, goto: 'complete_ok' }], else: 'pause_unknown' },
      { id: 'complete_ok', type: 'complete' },
      { id: 'pause_unknown', type: 'pause', reason: 'unknown' },
    ],
    createdAt: now,
    updatedAt: now,
  } as never
}

function validTemplate(): MacroTemplate {
  const now = new Date('2026-06-29T00:00:00.000Z').toISOString()
  return {
    schemaVersion: 1,
    id: 'review_fix_loop',
    name: 'Review Fix Loop',
    description: 'A V0 macro template fixture',
    configId: 'local',
    steps: [
      { id: 'send_prompt', type: 'send_line', terminal: { kind: 'alias', value: 'reviewer' }, text: 'review docs only', next: 'sleep_short' },
      { id: 'sleep_short', type: 'sleep', durationMs: 1500, next: 'input_direction' },
      { id: 'input_direction', type: 'input_line', terminal: { kind: 'index', value: 1 }, prompt: 'direction', allowEmpty: false, next: 'capture_review' },
      {
        id: 'capture_review',
        type: 'capture-source',
        capture: { kind: 'terminal-buffer', terminal: { kind: 'id', value: 'term_review_b' }, mode: 'scrollback-tail', maxChars: 20000 },
        next: 'wait_capture',
      },
      { id: 'wait_capture', type: 'wait', mode: 'capture-ready-or-user', captureStep: 'capture_review', timeoutMs: 600000, onTimeout: 'pause', next: 'wait_quiet' },
      { id: 'wait_quiet', type: 'wait', mode: 'terminal-quiet', terminal: { kind: 'index', value: 1 }, quietMs: 1000, maxMs: 600000, onTimeout: 'pause', next: 'wait_duration' },
      { id: 'wait_duration', type: 'wait', mode: 'duration', durationMs: 250, next: 'wait_user' },
      { id: 'wait_user', type: 'wait', mode: 'user-continue', prompt: 'continue', next: 'parse_review' },
      {
        id: 'parse_review',
        type: 'parse',
        captureStep: 'capture_review',
        parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready|done|complete', flags: 'i', onMatch: true, onNoMatch: false }] },
        next: 'branch_review',
      },
      { id: 'branch_review', type: 'branch', fromParseStep: 'parse_review', conditions: [{ signal: 'hasReadyText', op: '==', value: true, goto: 'complete_ok' }], else: 'pause_unknown' },
      { id: 'complete_ok', type: 'complete' },
      { id: 'pause_unknown', type: 'pause', reason: 'unknown' },
      { id: 'fail_explicit', type: 'fail', reason: 'explicit' },
      { id: 'stop_explicit', type: 'stop', reason: 'explicit' },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

function issueText(result: ReturnType<typeof validateMacroTemplate>): string {
  return result.issues.map((issue) => issue.path + ':' + issue.message).join('\n')
}
