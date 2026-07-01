# Verification

状态：mcp-gui-smoke-expanded。

## Automated Gate

Latest verified commands:

```bash
git diff --check
just test-010-offline
just test-010-codex-gui
```

Results:

* `git diff --check`: pass。
* `just test-010-offline`: pass; includes check, 108 unit/integration tests, full e2e (14 passed, 1 online-only skipped), and `just test-010-shell-gui` (12 passed)。
* `just test-010-codex-gui`: default offline mode reports blocked and exits successfully with an explicit message. It is an online-only entry; set `SHELL_DECK_RUN_ONLINE=1` to run the real Codex GUI harness。

The shell GUI recipe now covers:

* `terminalDeck.ui.spec.ts`: multi-tab terminal sync and real shell cursor visibility after repeated empty prompts。
* `terminalDeck.ui.spec.ts`: multi-tab terminal sync and real shell cursor visibility after repeated empty prompts。
* `macroTemplateWorkbench.spec.ts`: CRUD/import/export/delete confirm and sleep ms/s/min/h unit conversion。
* `captureSourceFlow.spec.ts`: terminal-buffer capture artifacts。
* `runLogView.spec.ts`: folded node logs, artifact preview, AI trace。
* `macroRunnerState.spec.ts`: runner controls, input_line, config isolation, draft auto-save, delayed auto-refresh。
* `parallelAll.spec.ts`: lane events and run log preservation。
* `macroRealShellGui.spec.ts`: real shell send/wait/capture/regex/branch happy path plus actual macro run log node expansion and artifact preview。
* `macroRealShellMatrix.spec.ts`: real shell target index/id/alias after reorder, wait modes, timeout pause, control flow, regex, explicit mock ai-json, structured branch, real parallel_all。
* `parserFailureGui.spec.ts`: GUI-started parser failure pause with run log node evidence in disabled parser mode。

## MCP GUI Smoke Results

### Expanded Ordinary Shell Matrix

Environment:

* Data root: `/tmp/shell-deck-mcp-010`
* URL: `http://127.0.0.1:5290`
* Config: `mcp010_1782908678858`
* Server command:

```bash
SHELL_DECK_DATA_ROOT=/tmp/shell-deck-mcp-010 bun run server/httpServer.ts --ai-json-parser mock --port 5290 --seed-backend real
```

MCP result summary:

* 3 real shell terminals。
* 10 macro runs executed from GUI。
* Tab alias rename passed: terminal renamed to `reviewer_mcp`。
* Tab drag reorder passed: index 1 remapped to the moved terminal。
* Target matrix passed: index/id/alias each sent to the expected terminal。
* `input_line` passed: GUI input submitted shell command and run completed。
* wait passed: duration + user-continue completed; capture-ready AgentEvent timeout paused and then stopped。
* regex parse + structured branch passed: `== true`、`== false`、`is_null`。
* mock ai-json passed through explicit mock parser server mode。
* control flow passed: goto loop guard paused, then GUI Stop; fail and stop step statuses were correct。
* real shell `parallel_all` passed with two lanes and terminal output on both lane terminals。
* JSON tab was selected and preview visible after the run。

### Earlier Codex-in-shell MCP Smoke

Environment:

* Data root: `/tmp/shell-deck-010.qgf0JO`
* URL: `http://127.0.0.1:5287`
* Browser driver: Playwright MCP (`mcp__playwright_firefox`)。

Pass:

* In terminal_2, Playwright typed the shell-deck wrapped Codex command with a prompt asking for `SD_CODEX_OK_010`。
* Codex CLI started inside the browser terminal, displayed session id `019f1d55-bb86-73f3-af50-d665dcd7d67f`, returned `SD_CODEX_OK_010`, and hook printed `SessionStart Completed` / `Stop Completed`。
* Macro terminal-buffer capture of terminal_2 completed; regex parser produced `codexOk=true` and branch selected complete。
* Macro AgentEvent capture completed; run log recorded `codexSessionId=019f1d55-bb86-73f3-af50-d665dcd7d67f`, `launchId=launch_6QeNWn92nhCxLzQVuKrw57`, capture artifacts, parser artifacts, and `codexOk=true`。

## Fix Verification

Checks run after the P2 fixes:

```bash
just check
bun test tests/integration/macroRunnerFakeTerminal.test.ts
bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroRealShellGui.spec.ts
bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroRealShellMatrix.spec.ts
just test-010-shell-gui
git diff --check
just test-010-offline
just test-010-codex-gui
```

Observed results:

* `macroRealShellMatrix.spec.ts`: 4 passed。
* `terminalDeck.ui.spec.ts`: 2 passed, including repeated Enter cursor visibility regression。
* `terminalDeck.ui.spec.ts`: 2 passed, including repeated Enter cursor visibility regression。
* `just test-010-shell-gui`: 12 passed in mock parser mode plus 1 passed in disabled parser mode。
* `just test-010-offline`: pass。
* `just test-010-codex-gui`: blocked-aware default output confirmed。

## Online Entry Status

`just test-010-codex-gui` now has two modes:

* Default/offline: prints a blocked message and exits 0。
* Online: with `SHELL_DECK_RUN_ONLINE=1`, runs `tests/e2e/codexGuiOnline.spec.ts` through Playwright. The harness first uses macro `send_line` to send the wrapped Codex exec command and prompt into the real shell terminal, then validates terminal-buffer and AgentEvent capture. This path requires real Codex CLI, auth, network, and model quota。

Online automated Codex GUI was not run in the latest pass to avoid implicit quota/network use. The manual MCP Codex smoke above is the current verified Codex evidence for this task.

## Remaining Closeout Recommendation

The broader offline matrix has already passed in this round via `just test-010-offline`.

Run online Codex GUI only when explicitly accepting Codex/auth/network/model quota use:

```bash
SHELL_DECK_RUN_ONLINE=1 just test-010-codex-gui
```
