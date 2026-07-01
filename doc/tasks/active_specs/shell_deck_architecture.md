# Shell Deck Architecture

## Scope

shell-deck V0 is a local-first browser terminal deck plus macro runner. The design keeps terminal processes ordinary: Codex, shells, and tools run inside PTYs; macro automation is an external, pauseable, observable layer.

## Core Rules

- One server can serve multiple config scopes.
- Browser tabs connected to the same config see the same terminal order, terminal output, macro templates, runner state, run logs, workspace panel layout, and project prompt updates.
- Different configs are isolated for terminal index maps, templates, runs, AgentEvents, and artifacts.
- V0 allows one live macro run per config. Different configs can run independently.
- No role system, sealed prompt, or Codex pre-injected instruction is part of V0.
- Codex integration is through a wrapped command and AgentEvent ingest, not through macro state binding.

## Storage

Default local storage is under `SHELL_DECK_DATA_ROOT` if set, otherwise `.shell-deck/` relative to the process working directory. Stored data includes macro templates, run logs, artifacts, AgentEvent JSONL, workspace panel layout, project prompts, and global prompts.

## Entrypoints

- `just start`: local server with ai-json disabled; an empty `local` deck is seeded with two real shell terminals.
- `just start-mock-ai`: explicit mock ai-json mode for offline demos/tests.
- `just start-codex-ai`: real codex-exec parser mode.
- `just stop`: stops the server recorded in the local pid file.
- `just codex`: forwards to Codex while injecting temporary hook config.

## Security Boundary

The default bind is `127.0.0.1`. Non-local bind requires `SHELL_DECK_ALLOW_LAN=1`. V0 has no authentication or authorization, so LAN exposure is not a safe default.

## Deferred

- Access control.
- Codex session binding and automatic session restore.
- Global `sdcodex` installation.
- Multi-run scheduler or terminal lock scheduler inside one config.
- Prompt auto-send, prompt variables, and prompt/macro binding.
