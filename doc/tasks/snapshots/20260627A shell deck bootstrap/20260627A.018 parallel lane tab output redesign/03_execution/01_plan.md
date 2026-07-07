# Execution Plan

## Phase 1: Contract And Types

* Replace `parallel_send_capture` with `parallel` in Flow V2 types.
* Add `ParallelLane`, `ParallelLaneOutputNode`, and `ParallelOutputSource`.
* Keep `merged_text` as the parent parallel artifact output.
* Mark `parallel_send_capture` as removed legacy type.

Gate:

* `just check`
* targeted unit tests for valid/invalid schema.

## Phase 2: Validator

* Validate lane ids, terminals, and body.
* Enforce mandatory final `output`.
* Enforce output immovable-by-schema: no action after output and no output before the end.
* Validate lane-local artifact scope.
* Reject lane-local `input_line`, flow nodes, nested `parallel`, and `wait.user-continue`.

Gate:

* `just test-unit`

## Phase 3: Runner

* Replace `executeParallelSendCapture` with `executeParallel`.
* Execute each lane concurrently.
* Execute lane body sequentially up to the final `output`.
* Store lane-local artifacts separately enough to prevent cross-lane leakage.
* Read each lane output, merge into parent `merged_text`, and append new parallel events.
* Preserve pause/fail behavior on lane failure.

Gate:

* `just test-016`
* new integration test for lane output merge.

## Phase 4: UI

* Replace item cards with lane tabs.
* Add lane creates Output-only lane.
* Show Output as fixed final card.
* Hide delete/move/add-after controls for Output.
* Lane insertion palette only shows `send_line`, `wait`, `capture-source`, `extract_text`.
* Output source selector lists `none` and preceding lane capture/extract artifacts.

Gate:

* Playwright test for adding lane action before Output and verifying Output stays last.

## Phase 5: Docs And Active Spec

* Update `doc/tasks/active_specs/macro_template_contract.md`.
* Update `doc/tasks/index/001_20260627A.md`.
* Write review and verification notes.

Close Gate:

* `git diff --check`
* `just check`
* `just test-unit`
* `just test-e2e`
* task-specific gate if added.
