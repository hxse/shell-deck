# Verification

## Automated Gate

2026-06-30:

* `just check`: pass.
* `just test-007-offline`: pass.
  * Unit/integration: 14 pass.
  * E2E subset: `tests/e2e/captureSourceFlow.spec.ts` pass.
* `just test-unit`: pass, 88 pass.
* `just test-e2e`: pass, 5 pass.
* `git diff --check`: pass.

## Review Fix Verification

2026-06-30 follow-up:

* Fixed invalid ai-json raw output evidence retention before JSON parse/normalize.
* Fixed parser pause/stop race by aborting active parser invocation and ignoring late parser returns.
* Tightened ParserProfile schema validation for exact properties and boolean-null/string enum signal schema shape.
* `just check`: pass.
* `just test-007-offline`: pass, 18 parser tests + 1 e2e subset pass.
* `just test-unit`: pass, 92 pass.
* `just test-e2e`: pass, 5 pass.
* `git diff --check`: pass.

## Explicit AI Mode Follow-up

2026-06-30 follow-up 2:

* Product default `ai-json` mode is now disabled. `just start` and `just dev` run with `--ai-json-parser disabled`; an `ai-json` parse pauses with `ai_json_adapter_not_configured` instead of silently using mock.
* Added explicit mock entries: `just start-mock-ai` and `just dev-mock-ai`. These are for local development, offline demo, and tests.
* Added explicit real model entries: `just start-codex-ai` and `just dev-codex-ai`, using `--ai-json-parser codex-exec`.
* `just test-007-online` now calls the online probe with explicit `--run-online`; parser mode no longer depends on `SHELL_DECK_PARSER_AI_JSON_ADAPTER`.
* Codex exec non-zero exit preserves raw output artifact when the CLI wrote `raw-output.json`.
* `just check`: pass.
* `just test-007-offline`: pass, 20 parser tests + 1 e2e subset pass.
* `just test-unit`: pass, 94 pass.
* `just test-e2e`: pass, 5 pass.
* `git diff --check`: pass.

## Empty Raw Artifact Follow-up

2026-06-30 follow-up 3:

* Codex exec adapter now always writes parser-ai-json-raw, including empty raw output before parse/normalize failure.
* Added regression coverage for empty raw output preserving rawArtifactRef.
* bun test tests/integration/codexExecParserProbe.test.ts: pass, 4 pass.
* just check: pass.
* git diff --check: pass.

## Online Gate

* `just test-007-online`: not run in this pass.
* Reason: online probe invokes real `codex exec` and may require Codex auth, network access, and model quota. The offline fake `codex exec` adapter probe verifies argv shape, `--output-schema`, `--output-last-message`, ephemeral one-shot semantics, and artifact input/output without consuming model quota.

## Implemented Scope

* Added full `ai-json` ParserProfile bundles for `review-routing-v1`, `review-full-v1`, and `claims-safety-v1`.
* Added profile loader, summary compatibility validation, fixture eval, parser result normalization, regex parser adapter, mock ai-json adapter, codex exec one-shot adapter, and replica reducer.
* Runner parse step now consumes `.006` capture artifacts through parser runtime and writes raw/normalized parser artifacts into the same run log.
* `parser_disagreement` is a step-scoped event. Replica disagreement pauses the run before branch evaluation.
* Branch evaluation remains strict over normalized typed values; string `"true"` is normalized only during parser normalize and is not branch-compared as a string.

## Manual Smoke

Manual smoke was not executed for this pass. Current project policy treats manual smoke as useful but not mandatory before continuing; final V0 closeout can run UI smoke across regex parser, mock/online ai-json, explicit null, and parser failure pause.
