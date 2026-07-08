# Review Result

Status: implementation-landed; automated gate passed.

## Summary

`.019` landed a hook-only Codex capture contract. `just codex` now registers `UserPromptSubmit` in addition to `SessionStart` and `Stop`, while preserving target cwd and passing shell-deck data root into hook env. AgentEvent capture now supports required `captureMode` values: `result_only`, `prompt_only`, and `prompt_and_result`.

The macro schema no longer accepts legacy `eventKind` / `field` agent-event capture fields. `prompt_and_result` pairs only prompt/output events with the same Codex session id and turn id.

## Landed Scope

* Wrapper: target cwd and data-root propagation for `just -f ... codex`.
* Hook adapter: `UserPromptSubmit.prompt` -> `agent.prompt_submitted`.
* Schema/types: required `captureMode`, removed legacy `eventKind` / `field`.
* Runner: post-baseline prompt/result/both capture with artifact trace.
* UI: AgentEvent capture mode selector.
* Docs: active specs and `.019` snapshot.
* Gate: added `just test-019` / `test:019`.

## Known Notes

Codex online GUI smoke remains environment-dependent and is not part of the offline `.019` gate. This task intentionally does not read Codex transcripts or intermediate event streams.
