import { canonicalJsonStringify } from '../canonicalJson'
import type { MacroRunEventWindow, MacroRunnerSnapshot, MacroRunnerStatus } from './runnerTypes'

export type RunnerStateProjectionInput = MacroRunEventWindow & {
  runId: string | null
  definitionHash: string | null
  status: MacroRunnerStatus
  currentNodeId: string | null
  error: string | null
  runtimeInput: MacroRunnerSnapshot['runtimeInput']
}

export function runnerStateProjection(input: RunnerStateProjectionInput) {
  return {
    runId: input.runId,
    definitionHash: input.definitionHash,
    status: input.status,
    currentNodeId: input.currentNodeId,
    error: input.error,
    runtimeInput: input.runtimeInput,
    events: input.events,
    firstAvailableEventSeq: input.firstAvailableEventSeq,
    lastEventSeq: input.lastEventSeq,
    totalEventCount: input.totalEventCount,
    discardedEventCount: input.discardedEventCount,
  }
}

export function canonicalRunnerState(input: RunnerStateProjectionInput): string {
  return canonicalJsonStringify(runnerStateProjection(input))
}
