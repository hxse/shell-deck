# Execution Plan

1. Add backend-aware default alias generation in `ConfigStore` / `TerminalDeckManager`.
2. Update macro editor selector labels and option formatting in `MacroEditorShell`, `MacroStepList`, and `ParallelLaneTabs`.
3. Update close-tab copy and e2e assertions that referenced `terminal_N` defaults.
4. Sync active specs with the current naming contract.
5. Add `test:020` / `just test-020` targeted gate.

## Close Gate

* `just test-020`
* `just check`
* `just test-unit`
* `git diff --check`
