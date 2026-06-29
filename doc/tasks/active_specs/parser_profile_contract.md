# Parser Profile Contract

## Parser Kinds

V0 supports two parser kinds:

- `regex`: template-local rules that emit typed boolean/null signals.
- `ai-json`: built-in parser profiles that call either explicit mock mode or real `codex exec` mode.

`ai-json` is disabled by default. Users must start `just start-mock-ai` or `just start-codex-ai` to enable it.

## Signals

Parser outputs are soft structured signals for macro branching and lane success checks. V0 signal values are typed `true`, `false`, or `null`; missing fields fail schema validation.

String boolean values may be normalized by parser output normalization only where explicitly allowed by parser schema. Branch and lane condition comparison itself is strict and typed.

## Profile Catalog

The macro workbench consumes a thin `ProfileCatalogSummary` with profile id, declared signals, and allowed branch operators. Full ParserProfile bundles add prompt/schema/check fixtures and are loaded by parser runtime.

The summary and full profile must stay compatible: declared signals cannot drift.

## Regex Parser

Regex rules declare signal id, signal type, pattern, safe flags, and match/no-match values. Regex parser writes raw and normalized parser artifacts.

## AI JSON Parser

Real ai-json uses one-shot `codex exec` with schema-constrained output. Mock ai-json is only available through explicit mock mode for offline tests and demos. Parser errors pause runs with raw artifact evidence when available.

Replica disagreement returns a disagreement state instead of guessing.

## Online Limit

The online Codex parser probe depends on external Codex CLI/auth/network/model behavior. If Codex structured output rejects the current schema or auth/network is unavailable, the online gate is recorded as blocked while offline gates remain valid.
