# Execution Plan

## Phase 1: Docs And Task Wiring

* Add `.022` task docs.
* Add `.022` to `doc/tasks/index/001_20260627A.md`.
* Set the current jj change description to the `.022` task.

Gate:

* Docs exist under `doc/tasks/snapshots/.../20260627A.022 explicit macro send enter semantics/`.
* No active spec is updated before implementation lands.

## Phase 2: Schema And Types

* Replace `SendLineNode` with `SendNode`.
* Replace `InputLineNode` with `InputNode`.
* Add required `enter: boolean` to both nodes.
* Update Flow V2 action lists, forbidden legacy names, parallel lane action types, editor command action checks, and validation tests.

Gate:

* Unit schema tests reject `send_line` / `input_line`.
* Unit schema tests require `enter` on `send` and `input`.
* Unit schema tests allow literal newlines in `message.parts[*].text`.

## Phase 3: Runner And Event Log

* Replace runner hardcoded `text + "\r"` with a shared LF submit helper.
* Write separate artifacts for content and exact write payload.
* Emit `terminal_text_sent` with `content.artifactRef`, `write.artifactRef`, `enter`, and `enterSequence`.
* Keep `user_input_requested` / `user_input_submitted` semantics; only the terminal-write event changes.

Gate:

* Integration tests prove `enter: true` sends LF.
* Integration tests prove `enter: false` does not append LF.
* Integration tests prove content artifact excludes the submit sequence and write artifact includes it.

## Phase 4: UI

* Rename visible action labels from `send_line` / `input_line` to `send` / `input`.
* Add `Submit with Enter` checkbox in root `send`, root `input`, and parallel lane `send`.
* Default new nodes to `enter: true`.
* Update insertion, movement, JSON preview, and parallel lane tests for new action names.

Gate:

* Playwright covers default checked checkbox for new `send`.
* Playwright covers toggling `enter` updates JSON preview.
* Playwright covers parallel lane `send` enter checkbox.

## Phase 5: Active Spec And Close Gate

* Update `doc/tasks/active_specs/macro_template_contract.md`.
* Add `test:022` and `just test-022`.
* Update `04_review/01_result.md` and `04_review/02_verification.md`.

Close Gate:

* `just test-022`
* `just check`
* `just test-unit`
* Targeted Playwright coverage for UI behavior touched by this task
