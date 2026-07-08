# Execution Plan

## Phase 1: Capability Helper

* Add a small capability helper near macro editor utilities, covered by unit tests.
* It should consume `TerminalSnapshot.backend` and return the `TabCapabilities` contract.
* Refactor `MacroEditorShell.terminalChoices()` to expose enough metadata for components to filter by capability without duplicating backend checks.

## Phase 2: Root Macro Editor Filtering

* `send_line` / `input_line`: keep all tab options.
* `wait.terminal-quiet`: filter to quiet-capable tabs; disable mode when none exist.
* `capture-source`: make Source tab drive capture kind choices; collapse kind selector for text tab.
* Preserve imported invalid nodes visibly; do not silently hide or rewrite them except when the user explicitly changes Source tab.

## Phase 3: Parallel Lane Filtering

* Filter lane insertion palette by selected lane capability.
* Block changing a lane to text when incompatible shell-only actions are already present.
* Make lane capture-source use the same Source tab capability logic, scoped to the lane tab.

## Phase 4: Preflight And Tests

* Add runner/editor preflight tests for text tab + shell-only action rejection.
* Add Playwright coverage for:
  * text tab does not show `terminal-quiet` in wait mode choices.
  * text source tab collapses capture kind to text-box behavior.
  * shell source tab allows terminal-buffer and agent-event.
  * text parallel lane does not offer wait and blocks incompatible lane-tab switch.

## Close Gate

Implementation task should add a `test:021` / `just test-021` entry. Suggested gate:

* targeted unit tests for capability helper and preflight
* targeted Playwright tests for Macro editor capability filtering
* `just check`
* `just test-unit`
* `just test-e2e` if selector behavior touches shared macro workbench paths

Implementation added `test:021` and `just test-021`; see `04_review/02_verification.md` for the executed gate.
