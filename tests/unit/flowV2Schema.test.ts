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

test('Flow V2 parse must reference an earlier artifact-producing step', () => {
  const template = validFlowV2Template() as any
  template.body[0].body[2].source.stepId = 'capture_later'
  template.body[0].body.push({
    id: 'capture_later',
    type: 'capture-source',
    capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 2000 },
  })

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('artifact source must reference an earlier artifact-producing step')
})

test('Flow V2 rejects v1 control fields recursively', () => {
  const template = validFlowV2Template() as any
  template.body[0].range.goto = 'hidden_jump'
  template.body[0].body[1].capture.next = 'hidden_jump'
  template.body[0].body[2].parser.next = 'hidden_jump'
  template.body[0].body[2].parser.rules[0].goto = 'hidden_jump'
  const parallel = validParallelAllNode() as any
  parallel.join.next = 'hidden_jump'
  template.body.push(parallel)

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  const text = issueText(result)
  expect(text).toContain('body[0].range.goto:legacy control fields are not allowed in Flow V2')
  expect(text).toContain('body[0].body[1].capture.next:legacy control fields are not allowed in Flow V2')
  expect(text).toContain('body[0].body[2].parser.next:legacy control fields are not allowed in Flow V2')
  expect(text).toContain('body[0].body[2].parser.rules[0].goto:legacy control fields are not allowed in Flow V2')
  expect(text).toContain('body[3].join.next:legacy control fields are not allowed in Flow V2')
})

test('Flow V2 parallel_all lanes use restricted fan-out fan-in schema', () => {
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
        body: [{ id: 'lane_bad_return', type: 'return' }],
        success: { fromParseStep: 'lane_bad_parse', mode: 'all', conditions: [] },
      },
    ],
  })

  const result = validateFlowV2Template(broken, { indexMap })
  expect(result.ok).toBe(false)
  const text = issueText(result)
  expect(text).toContain('lanes[0].steps:legacy control fields are not allowed in Flow V2')
  expect(text).toContain('lanes[0].body:extra Flow V2 node field is not allowed')
  expect(text).toContain('lanes[0].send:lane send must be an object')
  expect(text).toContain('lanes[0].wait:lane wait must be an object')
  expect(text).toContain('lanes[0].capture:lane capture must be an object')
})

test('Flow V2 parallel_all lane rejects user-driven workflow fields', () => {
  const template = validFlowV2Template() as any
  const parallel = validParallelAllNode() as any
  parallel.lanes[0].send.terminal = { kind: 'alias', value: 'worker' }
  parallel.lanes[0].wait = { mode: 'user-continue', prompt: 'continue?' }
  parallel.lanes[0].capture.terminal = { kind: 'alias', value: 'worker' }
  template.body.push(parallel)

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  const text = issueText(result)
  expect(text).toContain('lanes[0].send.terminal:extra Flow V2 node field is not allowed')
  expect(text).toContain('lanes[0].wait.mode:lane wait mode must be duration or terminal-quiet')
  expect(text).toContain('lanes[0].capture.terminal:extra Flow V2 node field is not allowed')
})

test('Flow V2 merge and send_artifact require explicit visible predecessor artifact sources', () => {
  const valid = validFlowV2Template() as any
  valid.body.push(validParallelAllNode(), validMergeParallelResultsNode(), validParseMergedNode(), validSendArtifactNode())
  expect(validateFlowV2Template(valid, { indexMap })).toEqual({ ok: true, issues: [] })

  const mergeBeforeParallel = validFlowV2Template() as any
  mergeBeforeParallel.body.push(validMergeParallelResultsNode(), validParallelAllNode())
  expect(issueText(validateFlowV2Template(mergeBeforeParallel, { indexMap }))).toContain('merge source must reference an earlier parallel_all')

  const sendBeforeMerge = validFlowV2Template() as any
  sendBeforeMerge.body.push(validParallelAllNode(), validSendArtifactNode(), validMergeParallelResultsNode())
  expect(issueText(validateFlowV2Template(sendBeforeMerge, { indexMap }))).toContain('artifact source must reference an earlier artifact-producing step')
})

test('Flow V2 branch body can reference outer visible predecessor artifacts', () => {
  const template = validFlowV2Template() as any
  const loopBody = template.body[0].body
  loopBody.splice(3, 0, validParallelAllNode(), validMergeParallelResultsNode(), {
    id: 'send_outer_artifact_branch',
    type: 'if',
    branches: [
      {
        kind: 'if',
        condition: { fromParseStep: 'parse_review', signal: 'onlyP3OrClean', op: '==', value: true },
        body: [validSendArtifactNode()],
      },
    ],
  })

  expect(validateFlowV2Template(template, { indexMap })).toEqual({ ok: true, issues: [] })
})

test('Flow V2 branch-local artifact outputs do not leak to later siblings', () => {
  const template = validFlowV2Template() as any
  const loopBody = template.body[0].body
  loopBody.splice(3, 0, {
    id: 'branch_parallel_merge',
    type: 'if',
    branches: [
      {
        kind: 'if',
        condition: { fromParseStep: 'parse_review', signal: 'onlyP3OrClean', op: '==', value: true },
        body: [validParallelAllNode(), validMergeParallelResultsNode()],
      },
    ],
  })
  loopBody.splice(4, 0, validSendArtifactNode())

  const result = validateFlowV2Template(template, { indexMap })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('artifact source must reference an earlier artifact-producing step')
})

test('Flow V2 parallel_all detects duplicate direct lane terminals without indexMap', () => {
  const template = validFlowV2Template() as any
  const parallel = validParallelAllNode() as any
  parallel.lanes[0].terminal = { kind: 'id', value: 'term_same' }
  parallel.lanes[1].terminal = { kind: 'id', value: 'term_same' }
  template.body.push(parallel)

  const result = validateFlowV2Template(template)
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('duplicate lane primary terminal: direct:id:term_same already used by lane_docs')
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
            source: { kind: 'step_artifact', stepId: 'capture_review', artifact: 'captured_text' },
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
        id: 'lane_docs',
        terminal: { kind: 'alias', value: 'reviewer' },
        send: { text: 'review docs only' },
        wait: { mode: 'terminal-quiet', quietMs: 100, maxMs: 1000, onTimeout: 'pause' },
        capture: { kind: 'terminal-buffer', mode: 'scrollback-tail', maxChars: 4000 },
      },
      {
        id: 'lane_tests',
        terminal: { kind: 'alias', value: 'worker' },
        send: { text: 'review tests only' },
        wait: { mode: 'duration', durationMs: 100 },
        capture: { kind: 'terminal-buffer', mode: 'scrollback-tail', maxChars: 4000 },
      },
    ],
    join: { mode: 'all_completed', onLaneFail: 'pause', onTimeout: 'pause' },
  }
}

function validMergeParallelResultsNode() {
  return {
    id: 'merge_review_outputs',
    type: 'merge_parallel_results',
    source: { kind: 'parallel_all', stepId: 'parallel_review', captures: 'all' },
    format: { kind: 'sectioned_text', includeLaneId: true, includeTerminal: true },
  }
}

function validParseMergedNode() {
  return {
    id: 'parse_merged_review',
    type: 'parse',
    source: { kind: 'step_artifact', stepId: 'merge_review_outputs', artifact: 'merged_text' },
    parser: { kind: 'regex', rules: [{ signal: 'hasAiFixable', type: 'boolean-null', pattern: 'ai can fix', flags: 'i', onMatch: true, onNoMatch: false }] },
  }
}

function validSendArtifactNode() {
  return {
    id: 'send_merged_to_worker',
    type: 'send_artifact',
    terminal: { kind: 'alias', value: 'worker' },
    source: { kind: 'step_artifact', stepId: 'merge_review_outputs', artifact: 'merged_text' },
  }
}

function issueText(result: { issues: Array<{ path: string; message: string }> }) {
  return result.issues.map((issue) => issue.path + ':' + issue.message).join('\n')
}
