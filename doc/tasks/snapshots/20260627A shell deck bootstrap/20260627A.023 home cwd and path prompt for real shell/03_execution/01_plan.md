# Execution Plan

1. Add `.023` task docs and index entry.
2. Update real PTY backend cwd/prompt defaults.
3. Add local Maple Mono-first terminal font fallback without bundling fonts.
4. Add focused unit/integration coverage for backend prompt/cwd and font fallback contract.
5. Add `test:023` / `just test-023` entry.
6. Run close gate and write review docs.

## Close Gate

* `just check`
* `just test-023`
* `just test-unit`
* `git diff --check`
