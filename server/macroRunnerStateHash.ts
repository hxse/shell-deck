import { createHash } from 'node:crypto'
import { canonicalRunnerState, type RunnerStateProjectionInput } from '../src/lib/macro/runnerStateProjection'

export function macroRunnerStateHash(input: RunnerStateProjectionInput): string {
  return 'sha256:' + createHash('sha256')
    .update(Buffer.from(canonicalRunnerState(input), 'utf8'))
    .digest('hex')
}
