# shell-deck

`shell-deck` is a local browser terminal workspace with live, URL-addressed Rooms and a visual macro system. Codex and other programs remain ordinary processes inside PTYs; a macro addresses terminals by their current index/type and resolves that logical layout to runtime terminal IDs at Start.

Current stack work is the destructive Room/user-storage redesign beginning at `20260627A.032`. `.032` is a foundation revision rather than a standalone release: Room routing, runtime isolation, user-level storage, notification relocation and browser settings land here; the production Macro V3 cutover lands atomically in `.034`.

Core V0 behavior:

- one server process with multiple memory-only Rooms selected by `/<roomId>` URLs
- the same user can open one Room from multiple tabs/devices and receive synchronized terminal state
- multiple Shell/Text terminals per Room; each Shell owns its own cwd
- full UUID-v4 short IDs through one generated-ID module; index follows UI order while terminalId follows the terminal object
- no terminal alias or rename identity
- user-level Macro/evidence/Library storage is independent from Room URLs and terminal cwd
- no role system and no Codex pre-injected prompts
- `just codex` only runs inside a shell-deck-created Shell with complete Room context; external terminals fail loudly
- AgentEvent ingest normalizes Codex hook callbacks; Codex session ids are trace data, not macro template state
- `.032` exposes only the generic user-global MacroRecord storage primitive; production Macro schema/API/editor/runner return in `.034`
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
