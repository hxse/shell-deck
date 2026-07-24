import { performance } from 'node:perf_hooks'
import type { CaptureWaitLimit } from '../src/lib/macro/macroDefinitionTypes'
import type { FrozenTerminalBinding } from '../src/lib/macro/runnerTypes'
import {
  compileStructuredJsonSchema,
  type JsonSchema,
  type JsonValue,
  type StructuredJsonValidationIssue,
} from '../src/lib/macro/structuredJson'
import type { LiveRun, PendingStructuredCapture } from './macroRunnerLiveState'

export type StructuredJsonSubmission = {
  roomGeneration: string
  terminalId: string
  launchId: string
  value: JsonValue
}

export type StructuredJsonSubmissionResult =
  | { ok: true }
  | { ok: false; kind: 'not_waiting' }
  | { ok: false; kind: 'schema_mismatch'; issues: StructuredJsonValidationIssue[] }

export async function waitForMacroStructuredJson(
  run: LiveRun,
  stepId: string,
  binding: FrozenTerminalBinding,
  schema: JsonSchema,
  waitLimit: CaptureWaitLimit,
  callbacks: {
    checkpoint: () => Promise<void>
    validateBinding: () => void
    totalPausedMs: (now: number) => number
  },
): Promise<JsonValue> {
  if (run.pendingStructuredCapture) throw new Error('structured_json_capture_already_waiting')
  const compiled = compileStructuredJsonSchema(schema)
  if (!compiled.ok) throw new Error('invalid_json_schema')
  const pending: PendingStructuredCapture = {
    stepId,
    binding,
    validator: compiled.validator,
    submittedValue: undefined,
  }
  run.pendingStructuredCapture = pending
  const startedAtMs = performance.now()
  const pausedAtStartMs = callbacks.totalPausedMs(startedAtMs)
  try {
    while (true) {
      await callbacks.checkpoint()
      callbacks.validateBinding()
      if (pending.submittedValue !== undefined) return pending.submittedValue
      const remaining = waitLimit.kind === 'timeout'
        ? waitLimit.timeoutMs - activeElapsedMs(callbacks.totalPausedMs, startedAtMs, pausedAtStartMs)
        : null
      if (remaining !== null && remaining <= 0) {
        throw new Error('structured_json_capture_timeout:' + binding.terminalId)
      }
      await abortableDelay(remaining === null ? 100 : Math.min(100, remaining), run.abortController.signal)
    }
  } finally {
    if (run.pendingStructuredCapture === pending) run.pendingStructuredCapture = null
  }
}

export function submitMacroStructuredJson(
  run: LiveRun | undefined,
  submission: StructuredJsonSubmission,
): StructuredJsonSubmissionResult {
  const pending = run?.pendingStructuredCapture
  if (
    !run
    || run.terminalized
    || run.roomGeneration !== submission.roomGeneration
    || !pending
    || pending.submittedValue !== undefined
    || pending.binding.terminalId !== submission.terminalId
    || pending.binding.launchId !== submission.launchId
  ) {
    return { ok: false, kind: 'not_waiting' }
  }
  const issues = pending.validator.validate(submission.value)
  if (issues.length > 0) return { ok: false, kind: 'schema_mismatch', issues }
  pending.submittedValue = structuredClone(submission.value)
  return { ok: true }
}

function activeElapsedMs(
  totalPausedMs: (now: number) => number,
  startedAtMs: number,
  pausedAtStartMs: number,
): number {
  const now = performance.now()
  return now - startedAtMs - (totalPausedMs(now) - pausedAtStartMs)
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('run_stopped'))
      return
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', aborted, { once: true })
    function done() {
      signal.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted() {
      clearTimeout(timer)
      reject(new Error('run_stopped'))
    }
  })
}
