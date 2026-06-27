# shell-deck

`shell-deck` is a browser terminal deck with a visual macro panel. It keeps Codex and other terminal programs as ordinary processes inside PTYs, then lets users run flexible, pauseable, observable macros against terminal indexes or stable terminal ids. It is also an experiment in tooling the strict spec/review/Gate workflow used by `<pyo3-quant-root>/AGENTS.md`, so the first target audience is high-control AI collaboration rather than generic terminal automation.

Current status: V0 design bootstrap with `.001 v0 api probe` passed. The root blueprint lives at `doc/tasks/snapshots/20260627A shell deck bootstrap/20260627A/`, and V0 implementation is split into nine phase tasks under the same snapshot group.

Core V0 direction:

- one local server with config-scoped decks, multiple browser tabs synchronized
- multiple internal terminal slots per config
- no role system and no Codex pre-injected prompts
- generate stable terminal ids with `short-uuid`, stored as `term_<shortUuid>`
- use the shell-deck `justfile` `codex` recipe to inject temporary Codex hooks without changing global Codex config or installing global commands, returning stable terminal ids and Codex session ids
- launch hook-enabled Codex from a target project with `just -f <shell-deck-root>/justfile -- codex <codex args...>`
- normalize agent callbacks through a local `AgentEvent Ingest` protocol; Codex hook is the first adapter, not a macro-runner dependency
- macro templates persisted as JSON, with terminal refs by dynamic index or stable id, edited through a basic visual panel
- macro runs persisted as append-only event logs plus artifacts
- parser supports template-local `regex` rules and built-in `ai-json` profiles to produce soft structured signals from user-selected capture sources; terminal buffer capture is the default, AgentEvent/Codex hook capture is optional
- V0 restores macro state and logs, not Codex sessions

V0 phase tasks:

- `20260627A.001 v0 api probe`
- `20260627A.002 terminal deck foundation`
- `20260627A.003 macro template workbench`
- `20260627A.004 run log and artifacts`
- `20260627A.005 macro runner state machine`
- `20260627A.006 capture source and agent event adapters`
- `20260627A.007 parser profiles and adapters`
- `20260627A.008 bounded parallel lanes`
- `20260627A.009 v0 closeout`

Documentation entry points:

- `AGENTS.md`
- `doc/tasks/index/000_readme.md`
- `doc/tasks/index/001_20260627A.md`
- `doc/tasks/snapshots/20260627A shell deck bootstrap/20260627A/02_spec/01_contract.md`
