# Quickstart

This guide exercises the V0 local path. It does not require network access unless you explicitly run online Codex probes or start the real `codex-exec` parser mode.

## Start And Stop

From the shell-deck repo:

```bash
cd <shell-deck-root>
just start
```

`just start` seeds the `local` config with two real shell terminals when it starts with an empty deck. Tests and explicit API calls can still create fake terminals.

Default URL:

```text
http://127.0.0.1:5177
```

Stop the default local server from another shell:

```bash
just stop
```

For a non-default port, pass the same port to both commands:

```bash
just start --port 5188
just stop --port 5188
```

The server refuses non-local binds unless `SHELL_DECK_ALLOW_LAN=1` is set. V0 has no access control, so local bind is the safe default.

## Parser Modes

V0 separates parser modes at the command entry point:

```bash
just start          # ai-json disabled; regex still works
just start-mock-ai  # explicit mock ai-json for offline demos/tests
just start-codex-ai # real codex exec parser; may use auth/network/model quota
```

If a macro uses `ai-json` while the server is in disabled mode, the run pauses with `ai_json_adapter_not_configured`. This avoids silently using mock AI or silently spending model quota.

## Terminal Deck

Open two browser tabs to the same URL and config. Terminal output, terminal order, aliases, and replay are synchronized by the server. A fresh `just start` opens two real shell terminals by default.

V0 terminal refs:

- `{ "kind": "index", "value": 1 }`: convenient dynamic position
- `{ "kind": "id", "value": "term_..." }`: stable terminal id
- `{ "kind": "alias", "value": "reviewer" }`: terminal tab rename alias

Double-click a terminal tab to rename it. That alias is the macro-visible alias. Use the tab close button to remove a terminal; shell-deck asks for confirmation before closing. Dragging terminal tabs is behind the drag toggle to avoid accidental reorder.

## Hook-Enabled Codex

Use the shell-deck justfile wrapper from any target project when you want Codex hooks to report AgentEvents back to shell-deck:

```bash
cd /path/to/target/project
just -f <shell-deck-root>/justfile -- codex --help
just -f <shell-deck-root>/justfile -- codex exec -
```

The wrapper injects temporary hook config only for that Codex invocation. It forwards arguments to Codex and preserves terminal/config/launch ids through environment variables. V0 records Codex session ids for traceability but does not bind macro templates or macro state to Codex sessions.

## Workspace Panels

The top bar has Macro and Prompt toggles. Macro is visible by default; Prompt is hidden by default. Both side panels can be resized horizontally and reset to their default widths. Panel visibility and width are stored per config and synchronized across browser tabs connected to the same config.

The Prompt panel provides a compact Prompt Library with a searchable selector:

- project prompts scoped to the current config
- global prompts visible to all configs on the same server
- create/edit/delete with confirmation
- search by title, body, or tag
- edit/read body in one textarea and copy body to clipboard

Prompts are plain text records; V0.1 does not auto-send prompts to terminals and does not bind prompts to macros.

## Macro Template Flow

The macro workbench supports:

- searchable template selection
- template create/save/duplicate/delete with delete confirmation in one toolbar
- import/export JSON backups
- visual editing for top-level macro steps and basic `parallel_all` lane id/terminal fields
- JSON preview/import/export for advanced fields, including lane internals
- structured branch conditions only; no expression strings and no JS eval

Common V0 step types:

- `send_line`: writes text to target terminal and presses Enter
- `sleep`: waits for a fixed duration
- `wait`: duration, terminal quiet, capture-ready-or-user, or user-continue
- `input_line`: pauses for user text, sends it to target terminal, then continues
- `capture-source`: terminal-buffer or AgentEvent capture
- `parse`: regex or ai-json parser over a capture artifact
- `branch`, `goto`, `pause`, `complete`, `fail`, `stop`
- `parallel_all`: bounded fan-out/fan-in across different terminals inside one macro run

## Observability

Each macro run writes one append-only event log plus artifacts. The visual node log and AI-readable trace derive from that same event log. Expand nodes to inspect inputs, waits, captures, parser results, branch decisions, parallel lane events, and artifact refs.

## Offline Test Gate

The full V0 offline gate is:

```bash
just test-009-offline
```

Useful smaller gates:

```bash
just check
just build
just test-unit
just test-e2e
just test-001-offline
just test-006-offline
just test-007-offline
just test-008-offline
```

Online probes are explicit and optional:

```bash
just test-001-online
just test-006-online
just test-007-online
just test-008-online
```

They may require Codex auth, network, and model quota. If unavailable, record the blocked reason instead of treating them as default failures.

## Known V0 Limits

- No authentication or access control; keep default local bind unless you understand the LAN risk.
- No Codex session binding or session restore; use `codex resume` manually in a terminal if needed.
- `ai-json` real parser depends on Codex structured output compatibility and external model availability.
- Full nested visual editing for `parallel_all` lane internals is deferred; use JSON for advanced lane steps/conditions.
- Crash recovery for the tiny window where terminal input was sent but the event was not written is deferred; normal pause/resume duplicate-send prevention is implemented.

Run Log / AI Trace lives under the Macro Trace tab, follows the selected macro template, and updates from server run events automatically.
