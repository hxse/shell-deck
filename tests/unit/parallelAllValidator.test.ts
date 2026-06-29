import { expect, test } from 'bun:test'
import { validateMacroTemplate } from '../../src/lib/macro/templateSchema'
import type { MacroTemplate, ParallelLane } from '../../src/lib/macro/templateTypes'
import type { TerminalIndexMapItem } from '../../src/lib/protocol'

const indexMap: TerminalIndexMapItem[] = [
  { index: 1, terminalId: 'term_main_a', terminalAlias: 'main' },
  { index: 2, terminalId: 'term_review_b', terminalAlias: 'reviewer' },
]

test('parallel_all validates lane schema and typed success conditions', () => {
  expect(validateMacroTemplate(template(), { indexMap })).toEqual({ ok: true, issues: [] })
})

test('parallel_all rejects duplicate lane terminal and mismatched lane step terminal', () => {
  const duplicate = template()
  const parallel = duplicate.steps[0]
  if (parallel.type !== 'parallel_all') throw new Error('missing parallel_all')
  parallel.lanes[1].terminal = { kind: 'alias', value: 'main' }
  expect(issueText(validateMacroTemplate(duplicate, { indexMap }))).toContain('duplicate lane primary terminal')

  const mismatched = template()
  const step = mismatched.steps[0]
  if (step.type !== 'parallel_all') throw new Error('missing parallel_all')
  const wait = step.lanes[0].steps.find((candidate) => candidate.type === 'wait' && candidate.mode === 'terminal-quiet')
  if (!wait || wait.type !== 'wait' || wait.mode !== 'terminal-quiet') throw new Error('missing wait')
  wait.terminal = { kind: 'alias', value: 'reviewer' }
  expect(issueText(validateMacroTemplate(mismatched, { indexMap }))).toContain('lane step terminal must resolve to lane primary terminal')
})

test('parallel_all rejects lane control flow, input_line and string expression conditions', () => {
  const candidate = template()
  const step = candidate.steps[0]
  if (step.type !== 'parallel_all') throw new Error('missing parallel_all')
  step.lanes[0].steps.push({ id: 'bad_branch', type: 'branch', fromParseStep: 'parse_main', conditions: [] } as never)
  step.lanes[0].steps[0] = { ...step.lanes[0].steps[0], next: 'parse_main' } as never
  step.lanes[0].success.conditions[0] = { expression: 'hasReadyText == true', signal: 'hasReadyText', op: '==', value: 'true' } as never

  const result = validateMacroTemplate(candidate, { indexMap })
  expect(result.ok).toBe(false)
  const issues = issueText(result)
  expect(issues).toContain('lane step type must be send_line, sleep, wait, capture-source or parse')
  expect(issues).toContain('lane steps are linear and must not declare next')
  expect(issues).toContain('string expressions are not allowed')
  expect(issues).toContain('typed true or false')
})

test('parallel_all parse captureStep must reference an earlier lane capture-source step', () => {
  const candidate = template()
  const step = candidate.steps[0]
  if (step.type !== 'parallel_all') throw new Error('missing parallel_all')
  const lane = step.lanes[0]
  const parseIndex = lane.steps.findIndex((item) => item.type === 'parse')
  const [parse] = lane.steps.splice(parseIndex, 1)
  lane.steps.splice(1, 0, parse)

  const issues = issueText(validateMacroTemplate(candidate, { indexMap }))
  expect(issues).toContain('parse captureStep must reference an earlier lane capture-source step')
})

test('parallel_all lane success can only reference its own parse output', () => {
  const candidate = template()
  const step = candidate.steps[0]
  if (step.type !== 'parallel_all') throw new Error('missing parallel_all')
  step.lanes[0].success.fromParseStep = 'parse_review'
  step.lanes[1].success.conditions[0].signal = 'missingSignal'

  const issues = issueText(validateMacroTemplate(candidate, { indexMap }))
  expect(issues).toContain('fromParseStep must reference a lane parse step')
  expect(issues).toContain('signal is not declared by selected lane parse step')
})

function template(): MacroTemplate {
  const now = new Date('2026-07-01T00:00:00.000Z').toISOString()
  return {
    schemaVersion: 1,
    id: 'parallel_template',
    name: 'Parallel Template',
    description: '',
    configId: 'local',
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: 'parallel_review',
        type: 'parallel_all',
        lanes: [lane('main_lane', { kind: 'alias', value: 'main' }, 'main'), lane('review_lane', { kind: 'alias', value: 'reviewer' }, 'review')],
        join: { mode: 'all_success', onLaneFail: 'pause', onTimeout: 'pause' },
        next: 'done',
      },
      { id: 'done', type: 'complete', reason: 'ok' },
    ],
  }
}

function lane(id: string, terminal: { kind: 'alias'; value: string }, prefix: string): ParallelLane {
  return {
    id,
    terminal,
    steps: [
      { id: 'send_' + prefix, type: 'send_line', text: 'echo ready ' + prefix },
      { id: 'wait_' + prefix, type: 'wait', mode: 'terminal-quiet', terminal, quietMs: 10, maxMs: 200, onTimeout: 'pause' },
      { id: 'capture_' + prefix, type: 'capture-source', capture: { kind: 'terminal-buffer', terminal, mode: 'scrollback-tail', maxChars: 12000 } },
      { id: 'parse_' + prefix, type: 'parse', captureStep: 'capture_' + prefix, parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready', flags: 'i', onMatch: true, onNoMatch: false }] } },
    ],
    success: { fromParseStep: 'parse_' + prefix, mode: 'all', conditions: [{ signal: 'hasReadyText', op: '==', value: true }] },
  }
}

function issueText(result: ReturnType<typeof validateMacroTemplate>): string {
  return result.issues.map((issue) => issue.path + ':' + issue.message).join(String.fromCharCode(10))
}
