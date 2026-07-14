# Parser Profile Contract

## Current Product Boundary

Flow V2 macro templates do not expose a `parse` or `ai-json` action. Parser profiles are not part of the runnable macro language after `20260627A.016`.

When users want AI parsing, they run an agent such as Codex in a normal terminal, use `send` to send text to that terminal, use `capture-source` to capture the response, and use `if.text_match` to route on the captured text.

## Retained Internal/Probe Surface

The parser profile and parser runtime code may remain for historical probes, offline experiments, and explicit developer tests. It must not be treated as a macro template contract unless a future task reintroduces a parser action explicitly.

If used in a probe, the old parser kinds are:

- `regex`: template-local rules that emit typed boolean/null signals.
- `ai-json`: built-in parser profiles that call either explicit mock mode or real `codex exec` mode.

`.032` 的 Room foundation 不提供 server-side parser execution mode。profile catalog、validator、fixture evaluation与adapter代码继续独立存在；`.034` runner接回时，mock或real model path必须由明确入口选择，任何产品路径都不得静默fallback到mock AI。

## Legacy Signal Rules

Legacy parser outputs use typed `true`, `false`, or `null`; missing fields fail schema validation. String boolean values may be normalized only where explicitly allowed by parser schema. Condition comparison itself is strict and typed.

## Online Limit

The online Codex parser probe depends on external Codex CLI/auth/network/model behavior. If Codex structured output rejects the current schema or auth/network is unavailable, the online gate is recorded as blocked while offline gates remain valid.
