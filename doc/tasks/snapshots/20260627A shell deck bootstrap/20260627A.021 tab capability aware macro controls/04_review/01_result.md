# Result

Status: implementation-landed.

Implemented .021 tab capability aware macro controls:

* Added `src/lib/macro/tabCapabilities.ts` as the single helper for live tab capabilities.
* Macro editor target choices now carry shell/text capability metadata.
* `send_line` and `input_line` still target any tab and show `Target tab`.
* `wait` terminal-quiet only offers shell-capable tabs; switching wait modes clears stale fields.
* `capture-source` is source-tab-first:
  * shell tabs offer `terminal-buffer` and `agent-event`.
  * text tabs fix capture kind to `text-box`.
  * changing source tab converts capture config to the first valid kind when needed.
* Parallel lane editor now filters lane actions by lane tab capability:
  * text lanes hide wait.
  * text lane capture defaults to `text-box`.
  * incompatible lane tab changes are blocked with a visible notice.
* Flow V2 validation accepts optional live `terminals` context and rejects capability-invalid templates at editor/start preflight time while keeping offline structural validation capability-agnostic.
* Active macro template spec now records the Tab Capability Model, root wait/capture capability rules, parallel lane capability rules, and runner preflight behavior.
* Runner start preflight now passes live terminal snapshots to validation.
* Added `test:021` and `just test-021`.

A pre-existing parallel fail-path integration fixture was updated because .021 preflight now correctly rejects `text-box` capture on shell tabs before runtime. The test now uses a valid shell `agent-event` capture with a short timeout to exercise `onLaneFail=fail` at runtime.
