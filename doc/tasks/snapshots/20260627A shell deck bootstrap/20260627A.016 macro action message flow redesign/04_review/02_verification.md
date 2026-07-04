# Verification

Automated checks run for `.016` implementation:

* `just check`：pass; `svelte-check found 0 errors and 0 warnings`.
* `just test-unit`：pass; 107 tests passed.
* `just test-e2e`：pass; 23 Playwright tests passed, 1 online Codex GUI test skipped by design because `SHELL_DECK_RUN_ONLINE` was not enabled.
* `just test-016`：pass; 34 unit/integration tests passed plus 7 focused Playwright tests passed.
* `just build`：pass; Vite production build completed.
* `git diff --check`：pass.

Focused coverage added or updated:

* Flow V2 schema and template store fail loudly on invalid current-schema template imports/files; no old-format skip or compatibility path remains.
* `send_line` ordered parts validation and runner execution, including source concatenation without implicit separators and writing to text box deck slots; `input_line` prompt/defaultSource runtime prefill and submission.
* `capture-source` terminal-buffer, text-box, and codex AgentEvent source execution, including visible-screen normalization for bash prompt redraw, `raw-stream-tail` raw artifact selection, and plain text deck-slot capture.
* `extract_text` schema/runtime path for split/filter/select/regex group extraction into `extracted_text`, plus downstream send from that artifact.
* `if.text_match` simple/regex matching and artifact reference scope validation.
* `parallel_send_capture` schema, runner merge artifact, and GUI e2e path.
* GUI workbench tests updated away from legacy `sleep`/`parse`/`branch`/`parallel_all` controls, and cover JSON copy plus `raw-stream-tail` debug-only labeling.
* Real-shell smoke updated to Flow V2 send/capture/text_match and parallel fan-out/fan-in.
* Terminal deck e2e covers `backend = text` creation, manual editing, multi-tab sync, and Copy.

Manual smoke remains deferred to the final closeout pass. No mandatory manual smoke was run for this implementation slice.
