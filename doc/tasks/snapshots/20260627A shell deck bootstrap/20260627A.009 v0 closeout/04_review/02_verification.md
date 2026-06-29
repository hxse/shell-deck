# Verification

## Automated Gate

2026-07-01:

* `just check`: pass.
* `just build`: pass.
* `just test-unit`: pass, 107 pass.
* `just test-e2e`: pass, 7 Playwright tests.
* `just test`: pass, 106 unit/integration + 6 Playwright tests before latest smoke fixes; latest targeted regression is recorded below.
* `just test-009-offline`: pass.
  * Includes `just check`, `just build`, `just test-unit`, `just test-e2e`, `just test-001-offline`, `just test-002`, `just test-003`, `just test-004`, `just test-005`, `just test-006-offline`, `just test-007-offline`, and `just test-008-offline`.
* `git diff --check`: pass.

## Latest Smoke Feedback Regression

2026-07-01:

* `just start` default seed changed to two `real`/`running` shell terminals for an empty `local` config. Playwright webServer explicitly uses `--seed-backend fake` for deterministic tests.
* Macro Start now saves the current draft before runner start, so adding `send_line` and clicking Start without a separate Save runs the visible template.
* A `send_line` step with no `next` now completes the run instead of leaving it stuck in `running`.
* Regression evidence: `just check` pass; `just test-unit` pass, 107 pass; `bun run scripts/runPlaywright.ts --workers=1` pass, 7 Playwright tests.

## Start Stop Smoke

2026-07-01:

* Command: `SHELL_DECK_DATA_ROOT=/tmp/shell-deck-009-stop-smoke just start --port 5199`.
* Seed behavior: `GET http://127.0.0.1:5202/api/configs/local/snapshot` returned two `real`/`running` terminals.
* Health: `GET http://127.0.0.1:5199/health` returned `{ "ok": true, "bind": "127.0.0.1", "aiJsonParser": "disabled" }`.
* Command: `SHELL_DECK_DATA_ROOT=/tmp/shell-deck-009-stop-smoke just stop --port 5199`.
* Result: server stopped and pid session exited.

## V0 E2E Matrix

| ID | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| E01 | local server start/stop | pass | start/health/stop smoke on port 5199 |
| E02 | two browser tabs same config | pass | `terminalDeck.ui.spec.ts`, `terminalDeck.ws.test.ts` |
| E03 | two configs isolation | pass | `terminalDeckManager.test.ts`, `macroRunnerFakeTerminal.test.ts`, AgentEvent config tests |
| E04 | real PTY shell | pass | `realPtyBackend.test.ts`, terminal deck unit resize/ctrl-c/exit tests |
| E05 | terminal reorder | pass | `terminalDeck.ui.spec.ts`, `terminalIdentity.test.ts` |
| E06 | macro template CRUD | pass | `macroTemplateWorkbench.spec.ts`, macro template unit tests |
| E07 | structured branch condition | pass | `macroTemplate.test.ts`, `parserResultSchema.test.ts` |
| E08 | run log recovery | pass | `runEventReplay.test.ts`, `runEventStore.test.ts`, `runLogView.spec.ts` |
| E09 | macro runner mock flow | pass | `macroRunnerFakeTerminal.test.ts`, `macroRunnerState.spec.ts` |
| E10 | terminal-buffer capture | pass | `terminalBufferCapture.test.ts`, `captureSourceFlow.spec.ts` |
| E11 | AgentEvent/Codex hook capture | pass offline | `agentEventCapture.test.ts`, `codexHookAdapter.test.ts`, `agentEventIngest.test.ts` |
| E12 | parser offline | pass | parser profile/result/regex/replica/fixture tests and parser runtime integration |
| E13 | parser online optional | blocked external | Online probes not run in this pass; require Codex auth/network/model/schema support |
| E14 | bounded parallel lanes | pass | `parallelAllValidator.test.ts`, `parallelAllRunner.test.ts`, `parallelAll.spec.ts` |
| E15 | V0 known limitations visible | pass | README, quickstart, active specs, known limitations below |

## Online Gate

Not run in this pass. Online probes remain explicit:

* `just test-001-online`
* `just test-006-online`
* `just test-007-online`
* `just test-008-online`

Known blocker from previous online parser attempts: Codex structured output rejected the current ai-json profile schema because `oneOf` was not permitted in response format schema. Treat this as external/online compatibility until revalidated in the target Codex environment.

## Known Limitations

- id: KL-001
  status: deferred-v1
  area: security
  summary: No authentication or access control in V0.
  impact: LAN exposure is unsafe by default.
  workaround: Keep default `127.0.0.1` bind; non-local bind requires `SHELL_DECK_ALLOW_LAN=1`.
  followUpTask: V1 security/access-control task.

- id: KL-002
  status: deferred-v1
  area: macro
  summary: No Codex session binding or automatic resume.
  impact: Macro state can recover, but Codex sessions must be resumed manually by the user.
  workaround: Use terminal and `codex resume` manually.
  followUpTask: V1 session mapping/cache task.

- id: KL-003
  status: blocked-external
  area: parser
  summary: Real ai-json parser depends on Codex structured output compatibility and online availability.
  impact: Online parser probes may be blocked by auth/network/model/schema support.
  workaround: Use `regex` or explicit `start-mock-ai` offline mode.
  followUpTask: Parser online compatibility follow-up.

- id: KL-004
  status: deferred-v1
  area: macro
  summary: Full nested visual editor for `parallel_all` lane internals is not in V0.
  impact: Advanced lane steps and success conditions require JSON editing/import.
  workaround: Use JSON preview/import/export.
  followUpTask: V1 macro UI editor task.

- id: KL-005
  status: deferred-v1
  area: run-log
  summary: Send-before-event-write crash window is not fully disambiguated.
  impact: An OS/server crash at that exact point may require user inspection.
  workaround: Normal pause/resume duplicate-send prevention is implemented; inspect terminal/run log after hard crash.
  followUpTask: V1 recovery UX task.

## Manual Smoke

Pending human smoke using `doc/guides/001_quickstart.md`.
