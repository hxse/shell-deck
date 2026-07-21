# shell-deck

`shell-deck` is a local browser terminal workspace with live, URL-addressed Rooms and a visual macro system. Codex and other programs remain ordinary processes inside PTYs; a macro addresses terminals by their current index/type and resolves that logical layout to runtime terminal IDs at Start.

Current stack work is the destructive Room/user-storage redesign beginning at `20260627A.032`. Room routing/runtime isolation and user-level storage land in `.032`, single-controller/content edit leases in `.033`, the production Macro editor/runner cutover in `.034`, server-authoritative Room runtime sync in `.035`, the user-global Library in `.036`, exact persistable unassigned references in MacroDefinitionV4 in `.037`, explicit AgentEvent wait limits in MacroDefinitionV5 in `.038`, and retained terminal views across tab switches in `.039`.

Core V0 behavior:

- one server process with multiple memory-only Rooms selected by `/<roomId>` URLs
- the same user can open one Room from multiple tabs/devices and receive synchronized terminal state; one server-enforced controller writes while other connections observe
- multiple Shell/Text terminals per Room; each Shell owns its own cwd
- full UUID-v4 short IDs through one generated-ID module; index follows UI order while terminalId follows the terminal object
- no terminal alias or rename identity
- user-level Macro/evidence/Library storage is independent from Room URLs and terminal cwd
- saved Macro/Library records use per-record cross-Room/process edit leases plus optimistic revision; different records remain independent
- no role system and no Codex pre-injected prompts
- `just codex` only runs inside a shell-deck-created Shell with complete Room context; external terminals fail loudly
- AgentEvent ingest normalizes Codex hook callbacks; Codex session ids are trace data, not macro template state
- AgentEvent capture defaults to explicit unbounded waiting; users may opt into a persisted duration timeout
- MacroDefinitionV5 stores portable Flow plus continuous terminal index/type and exact assigned/unassigned logical references; MacroRecord metadata and runtime terminal IDs remain separate
- terminal layout changes only through the explicit `Prepare terminals` button; selection, Save, Start and terminal events never auto-prepare
- Start validates a saved record revision and terminal structure revision, then freezes index/type to terminalId/launchId routing for the run
- Macro selection/draft stays browser-local, while saved records and the Room's frozen Running Macro are synchronized through the server
- runner status/current node/runtime input are pushed to every same-Room connection; closing browsers does not stop the live run
- shared mutation denial uses one actionable toast instead of silent disabled controls
- run evidence is append-only events plus artifacts and never hydrates runtime state
- Room-scoped AgentEvent/Codex hook ingest persists attributable evidence; Macro capture consumption returns in `.034`
- parser profiles remain an independent catalog/developer surface and are not a current Macro action
- Room, terminal, runner cursor and run snapshot are never restored after server restart; read-only Trace/evidence remains persistent

Quickstart: `doc/guides/001_quickstart.md`.

Primary commands:

```bash
just start                 # production build + local Room server
just dev                   # Vite HMR frontend plus Bun API/WebSocket server
just stop                  # stop the default local server pid
just test-032              # Room/user-storage foundation gate
just test-033              # Room controller/content edit lease gate
just test-034              # Macro editor/Prepare/runner regression gate
just test-035              # server-authoritative Room runtime sync gate
just test-036              # user-global Macro JSON / Prompt / Note Library gate
just test-037              # Macro unassigned-reference regression gate
just test-038              # Macro V5 explicit AgentEvent wait-limit gate
just test-039              # retained terminal view lifecycle gate
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
- `doc/tasks/index/001_20260627A_20260627A.031.md`
- `doc/tasks/index/002_20260627A.032.md`
- `doc/tasks/index/003_20260627A.033.md`
- `doc/tasks/index/004_20260627A.034.md`
- `doc/tasks/index/005_20260627A.035.md`
- `doc/tasks/index/006_20260627A.036.md`
- `doc/tasks/index/007_20260627A.037.md`
- `doc/tasks/index/008_20260627A.038.md`
- `doc/tasks/index/020_20260627A.039.md`
