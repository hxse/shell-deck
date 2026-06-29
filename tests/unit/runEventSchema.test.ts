import { expect, test } from 'bun:test'
import { validateRunEvent } from '../../src/lib/runLog/runEventSchema'
import type { RunEvent, RunEventKind } from '../../src/lib/runLog/runEventTypes'

const base = {
  schemaVersion: 1,
  eventId: 'evt_schema_1',
  eventSeq: 1,
  runId: 'run_schema_1',
  configId: 'local',
  createdAt: '2026-06-30T00:00:00.000Z',
  summary: 'schema fixture',
  data: {},
} satisfies Omit<RunEvent, 'kind'>

test('run-scoped events omit stepId and step-scoped events require stepId', () => {
  expect(validateRunEvent({ ...base, kind: 'run_started' }, { configId: 'local', runId: 'run_schema_1', eventSeq: 1 })).toEqual({ ok: true, issues: [] })

  const runWithStep = validateRunEvent({ ...base, kind: 'run_completed', stepId: 'done_step' })
  expect(runWithStep.ok).toBe(false)
  expect(issueText(runWithStep)).toContain('run-scoped event must omit stepId')

  const missingStep = validateRunEvent({ ...base, kind: 'step_started' })
  expect(missingStep.ok).toBe(false)
  expect(issueText(missingStep)).toContain('step-scoped event requires stepId')

  expect(validateRunEvent({ ...base, kind: 'step_started', stepId: 'send_review' }).ok).toBe(true)
})

test('operational events are step-scoped in V0', () => {
  const operational: RunEventKind[] = [
    'terminal_ref_resolved',
    'wait_started',
    'wait_completed',
    'wait_timeout',
    'wait_manual_continue',
    'terminal_line_sent',
    'user_input_requested',
    'user_input_submitted',
    'sleep_started',
    'sleep_completed',
    'parser_normalized',
    'branch_decision',
    'control_transition',
  ]
  for (const kind of operational) {
    const missing = validateRunEvent({ ...base, kind })
    expect(missing.ok).toBe(false)
    expect(issueText(missing)).toContain('step-scoped event requires stepId')
    expect(validateRunEvent({ ...base, kind, stepId: 'step_' + kind }).ok).toBe(true)
  }
})

test('context-scoped events may be run-level or step-bound', () => {
  for (const kind of ['run_paused', 'run_resumed', 'artifact_created', 'user_override'] as const) {
    expect(validateRunEvent({ ...base, kind }).ok).toBe(true)
    expect(validateRunEvent({ ...base, kind, stepId: 'send_review' }).ok).toBe(true)
  }
})

test('validator returns issues for malformed input instead of throwing', () => {
  const result = validateRunEvent({ schemaVersion: 1 })
  expect(result.ok).toBe(false)
  expect(issueText(result)).toContain('eventId must be a string')
  expect(issueText(result)).toContain('kind is not supported')
})

function issueText(result: { issues: Array<{ path: string; message: string }> }) {
  return result.issues.map((issue) => issue.path + ' ' + issue.message).join('\n')
}
