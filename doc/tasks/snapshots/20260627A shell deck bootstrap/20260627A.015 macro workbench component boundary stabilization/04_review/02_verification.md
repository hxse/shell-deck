# Verification

Status: passed.

Automated checks:

* git diff --check: passed.
* just check: passed, 0 errors / 0 warnings.
* just test-unit: passed, 129 tests.
* just test-e2e: passed, 22 passed / 1 skipped. The skipped case is the online Codex GUI smoke.

Implementation evidence:

* MacroPanel.svelte is reduced to orchestration and delegates workbench chrome, editor shell, JSON view, and trace view.
* App.svelte no longer owns terminal tab chrome, side panel frame, and notice stack markup directly.
* src/styles.css is an import-only style entrypoint.
* Template selector, run dock, editor shell, action palette, MacroStepList node editor, JSON view, and trace view live in separate files.
* .014 layout invariant is covered by the existing workspace/workbench e2e suite.
* Active spec functional semantics were not changed by this task.

Manual smoke: deferred; this task is a component boundary refactor and the required evidence is automated.
