# Verification

## Commands

* `just check` - PASS. `svelte-check` found 0 errors and 0 warnings.
* `just test-022` - PASS. 39 unit/integration tests and 5 Playwright tests passed.
* `just test-unit` - PASS. 142 tests and 591 expect calls passed.
* `git diff --check` - PASS.

## Coverage

* Schema rejects `send_line` / `input_line` and requires `send.enter` / `input.enter`.
* Schema allows literal newlines inside `send.message.parts[*].text`.
* Runner tests cover `enter: true` LF payload and `enter: false` exact content payload.
* Runner tests cover content artifact versus write artifact evidence.
* Playwright covers the macro editor flows touched by `.022`, including template workbench, node insertion, workspace workbench, and parallel lane behavior.
