# shell-deck

`shell-deck` is a local browser terminal deck with a visual macro panel. It keeps Codex and other terminal programs as ordinary processes inside PTYs, then lets users run flexible, pauseable, observable macros against terminal indexes, aliases, or stable terminal ids. It is also an experiment in tooling the strict spec/review/Gate workflow used by `<pyo3-quant-root>/AGENTS.md`, so the first target audience is high-control AI collaboration rather than generic terminal automation.

Current status: V0 local/offline implementation has landed through `20260627A.009 v0 closeout`. The stable behavior is summarized in `doc/tasks/active_specs/**`; detailed design and verification history remain in `doc/tasks/snapshots/20260627A shell deck bootstrap/**`.

Core V0 behavior:

- one local server with config-scoped decks and synchronized browser tabs
- multiple terminal tabs per config, backed by fake terminals for deterministic tests or real PTYs for shell use
- stable `terminalId=term_<shortUuid>`, dynamic terminal indexes, and tab aliases from terminal rename
- no role system and no Codex pre-injected prompts
- `just codex` wrapper injects temporary Codex hook config without changing global Codex config or installing global commands
- AgentEvent ingest normalizes Codex hook callbacks; Codex session ids are trace data, not macro template state
- macro templates are persisted as JSON and editable through a basic visual panel plus JSON preview/import/export
- macro runs are append-only event logs plus artifacts; UI node logs and AI trace use that same log truth
- capture source is user-selected: terminal-buffer by default, AgentEvent/Codex hook optional
- parser supports template-local `regex` and explicit `ai-json` modes; mock and real Codex parser entry points are separate
- V0 restores macro state and logs, not Codex sessions

Quickstart: `doc/guides/001_quickstart.md`.

Primary commands:

```bash
just start                 # local server, ai-json disabled
just start-mock-ai         # local server with explicit mock ai-json parser
just start-codex-ai        # local server with real codex-exec parser
just stop                  # stop the default local server pid
just test-009-offline      # full V0 offline gate aggregate
```

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
- `doc/guides/001_quickstart.md`
- `doc/tasks/active_specs/000_readme.md`
- `doc/tasks/index/001_20260627A.md`
