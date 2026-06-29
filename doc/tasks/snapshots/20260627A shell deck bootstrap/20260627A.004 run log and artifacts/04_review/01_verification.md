# Verification

## Automated Gate

Passed on 2026-06-30:

* `just check`
* `just test-unit` - 49 pass
* `just test-e2e` - 3 pass
* `just test-004` - 14 unit pass + 1 e2e pass
* `git diff --check`

## Coverage Notes

* Unit coverage includes event envelope scope validation, operational event `stepId` requirements, append ordering, duplicate generated eventId rejection, replay gap/duplicate/corrupt/half-line handling, artifact containment, orphan diagnostics, missing artifact recovery, config isolation, and derived state rebuild.
* Missing artifact recovery now carries failed event metadata into node logs and marks the missing artifact ref on the affected node.
* E2E coverage creates a run, appends simulated events/artifacts, verifies folded node logs, opens artifact refs for send/input/sleep/capture/parser/branch/control-flow, checks AI trace, and reloads the page to confirm replay-derived state persists.

## Manual Smoke

Not required for Close Gate. Not performed in this pass.
