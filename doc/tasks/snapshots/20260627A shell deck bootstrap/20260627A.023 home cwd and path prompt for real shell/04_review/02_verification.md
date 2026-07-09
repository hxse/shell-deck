# Verification

## Commands

* `just test-023` - PASS. 3 tests, 20 expect calls.
* `just check` - PASS. `svelte-check` found 0 errors and 0 warnings.
* `just test-unit` - PASS. 144 tests, 605 expect calls.
* `git diff --check` - PASS.

## Coverage

* Unit coverage checks default real shell cwd/prompt constants and alias definitions.
* Real PTY integration verifies startup prompt is dynamic user@host home-shaped, contains ANSI bold bright green SGR output, preserves the trailing separator space, loads the `ls` color alias, and `$PWD` equals the default shell cwd.
* Unit coverage checks terminal font fallback prefers Maple Mono local families and normal regular weight and does not add repo/remote font loading markers.
* Existing real PTY integration still covers stdin pipe, long input, resize, ctrl-c, and exit behavior.
