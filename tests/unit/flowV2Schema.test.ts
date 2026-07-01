import { expect, test } from 'bun:test'
import { validateFlowV2Template } from '../../src/lib/macro/flowV2Schema'
import type { FlowV2Template } from '../../src/lib/macro/flowV2Types'
import type { TerminalIndexMapItem } from '../../src/lib/protocol'

const indexMap: TerminalIndexMapItem[] = [
  { index: 1, terminalId: 'term_worker_a', terminalAlias: 'worker' },
  { index: 2, terminalId: 'term_reviewer_b', terminalAlias: 'reviewer' },
]

test('valid Flow V2 template supports for, if/elif/else, continue and return', () => {
  const result = validateFlowV2Template(validFlowV2Template(), { indexMap })
  expect(result).toEqual({ ok: true, issues: [] })
})

test('Flow V2 rejects legacy flat control nodes', () => {
  for (const type of ['pause', 'stop', 'goto', 'branch', 'complete', 'fail']) {
    const template = validFlowV2Template() as any
    template.body.push({ id: 'legacy_' + type, type })
    const result = validateFlowV2Template(template, { indexMap })
    expect(result.ok).toBe(false)
    expect(issueText(result)).toContain('legacy flow node ' + type)
  }
})

test('Flow V2 rejects string condition expressions and string booleans', () => {
  const template = validFlowV2Template() as any
  const ifNode = template.body[0].body[3]
  ifNode.expression = 'onlyP3OrClean == true'
  ifNode.branches[0].if = 'onlyP3OrClean == true'
  ifNode.branches[0].condition.value = 'true'

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('string expressions are not allowed')
  expect(issueText(result)).toContain('typed true or false')
})

test('Flow V2 validates if branch ordering and parser signal contract', () => {
  const template = validFlowV2Template() as any
  const ifNode = template.body[0].body[3]
  ifNode.branches[0].kind = 'elif'
  ifNode.branches[1].kind = 'if'
  ifNode.branches[0].condition.signal = 'missingSignal'

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('first branch kind must be if')
  expect(issueText(result)).toContain('later branch kind must be elif')
  expect(issueText(result)).toContain('signal is not declared by selected parse node')
})

test('Flow V2 requires break and continue to stay inside for body', () => {
  const template = validFlowV2Template() as any
  template.body.push({ id: 'continue_outside', type: 'continue' })
  template.body.push({ id: 'break_outside', type: 'break' })

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('continue can only be used inside for body')
  expect(issueText(result)).toContain('break can only be used inside for body')
})

test('Flow V2 validates sleep modes without overloading pause or stop', () => {
  const duration = validFlowV2Template() as any
  duration.body.push({ id: 'bad_sleep', type: 'sleep', mode: 'duration', durationMs: 0 })
  expect(issueText(validateFlowV2Template(duration, { indexMap }))).toContain('positive integer')

  const untilResume = validFlowV2Template() as any
  untilResume.body.push({ id: 'bad_until_resume', type: 'sleep', mode: 'until-resume', durationMs: 1000 })
  expect(issueText(validateFlowV2Template(untilResume, { indexMap }))).toContain('must not include durationMs')
})

test('Flow V2 rejects duplicate node ids globally', () => {
  const template = validFlowV2Template() as any
  template.body[0].body.push({ id: 'send_review', type: 'return', reason: 'duplicate id' })

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('duplicate Flow V2 node id')
})

test('Flow V2 parse must reference an earlier capture-source node', () => {
  const template = validFlowV2Template() as any
  template.body[0].body[2].captureStep = 'capture_later'
  template.body[0].body.push({
    id: 'capture_later',
    type: 'capture-source',
    capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 2000 },
  })

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('parse captureStep must reference an earlier capture-source')
})

test('Flow V2 action nodes reject v1 control fields', () => {
  const template = validFlowV2Template() as any
  template.body[0].body[0].next = 'hidden_jump'
  template.body[0].body[1].loopGuard = { maxIterations: 3, onLimit: 'pause' }

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('body[0].body[0].next:extra Flow V2 node field is not allowed')
  expect(issueText(result)).toContain('body[0].body[1].loopGuard:extra Flow V2 node field is not allowed')
})

test('Flow V2 parallel_all uses full lane validation instead of accepting unknown lanes', () => {
  const valid = validFlowV2Template() as any
  valid.body.push(validParallelAllNode())
  expect(validateFlowV2Template(valid, { indexMap })).toEqual({ ok: true, issues: [] })

  const broken = validFlowV2Template() as any
  broken.body.push({
    ...validParallelAllNode(),
    lanes: [
      {
        id: 'lane_bad',
        terminal: { kind: 'alias', value: 'reviewer' },
        steps: [{ id: 'lane_bad_send', type: 'send_line', text: 'echo ready' }],
        success: { fromParseStep: 'lane_bad_parse', mode: 'all', conditions: [{ signal: 'hasReadyText', op: '==', value: true }] },
      },
    ],
  })

  const result = validateFlowV2Template(broken, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('lane must include at least one wait step')
  expect(issueText(result)).toContain('fromParseStep must reference a lane parse step')
})

function validFlowV2Template(): FlowV2Template {
  return {
    schemaVersion: 2,
    id: 'review_loop_v2',
    name: 'Review Loop V2',
    description: 'structured flow fixture',
    configId: 'local',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    body: [
      {
        id: 'review_loop',
        type: 'for',
        range: { count: 3 },
        body: [
          { id: 'send_review', type: 'send_line', terminal: { kind: 'alias', value: 'reviewer' }, text: 'review current changes' },
          {
            id: 'capture_review',
            type: 'capture-source',
            capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 12000 },
          },
          {
            id: 'parse_review',
            type: 'parse',
            captureStep: 'capture_review',
            parser: {
              kind: 'regex',
              rules: [
                { signal: 'onlyP3OrClean', type: 'boolean-null', pattern: 'clean|p3', flags: 'i', onMatch: true, onNoMatch: false },
                { signal: 'needsUserDecision', type: 'boolean-null', pattern: 'user decision', flags: 'i', onMatch: true, onNoMatch: null },
              ],
            },
          },
          {
            id: 'route_review',
            type: 'if',
            branches: [
              {
                kind: 'if',
                condition: { fromParseStep: 'parse_review', signal: 'onlyP3OrClean', op: '==', value: true },
                body: [{ id: 'return_clean', type: 'return', reason: 'review clean enough' }],
              },
              {
                kind: 'elif',
                condition: { fromParseStep: 'parse_review', signal: 'needsUserDecision', op: 'is_null' },
                body: [{ id: 'continue_unknown', type: 'continue' }],
              },
            ],
            else: [
              { id: 'send_fix', type: 'send_line', terminal: { kind: 'alias', value: 'worker' }, text: 'fix these issues' },
              { id: 'continue_after_fix', type: 'continue' },
            ],
          },
        ],
      },
      { id: 'loop_limit_sleep', type: 'sleep', mode: 'until-resume', reason: 'loop limit reached' },
      { id: 'return_after_limit', type: 'return', reason: 'manual follow-up accepted' },
    ],
  }
}

function validParallelAllNode() {
  return {
    id: 'parallel_review',
    type: 'parallel_all',
    lanes: [
      {
        id: 'lane_reviewer',
        terminal: { kind: 'alias', value: 'reviewer' },
        steps: [
          { id: 'lane_reviewer_send', type: 'send_line', text: 'echo ready' },
          { id: 'lane_reviewer_wait', type: 'wait', mode: 'terminal-quiet', terminal: { kind: 'alias', value: 'reviewer' }, quietMs: 100, maxMs: 1000, onTimeout: 'pause' },
          { id: 'lane_reviewer_capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 4000 } },
          {
            id: 'lane_reviewer_parse',
            type: 'parse',
            captureStep: 'lane_reviewer_capture',
            parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready', flags: 'i', onMatch: true, onNoMatch: false }] },
          },
        ],
        success: { fromParseStep: 'lane_reviewer_parse', mode: 'all', conditions: [{ signal: 'hasReadyText', op: '==', value: true }] },
      },
    ],
    join: { mode: 'all_success', onLaneFail: 'pause', onTimeout: 'pause' },
  }
}

function issueText(result: { issues: Array<{ path: string; message: string }> }) {
  return result.issues.map((issue) => issue.path + ':' + issue.message).join('\n')
}
