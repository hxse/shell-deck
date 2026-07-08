# Terminal Deck Contract

## Identity

Each terminal has a stable id generated as `term_<shortUuid>`. Terminal indexes are dynamic and follow current visual order. Terminal aliases are tab names and follow the terminal id when tabs are reordered. Default aliases are backend-specific: shell/fake/real tabs use `shell_N`, and text tabs use `text_N`.

Terminal refs use structured JSON:

```json
{ "kind": "index", "value": 1 }
{ "kind": "id", "value": "term_example" }
{ "kind": "alias", "value": "reviewer" }
```

## Config Isolation

Terminal ids, indexes, aliases, and deck snapshots are scoped by `configId`. The same index in two configs refers to different terminal maps.

## Backends

- `fake`: deterministic backend used by tests and offline demos.

A fresh `just start` seeds the `local` config with `shell_1`, `shell_2`, and `text_1`: two `real` shell tabs and one `text` tab. Test servers and explicit tab creation can still request `fake`.
- `real`: shell PTY backend for local shell use.

The browser/xterm view displays backend PTY output. The frontend does not local-echo terminal input as truth.

## Synchronization

The server owns terminal replay and broadcasts `pty_output`, terminal snapshots, and index maps to connected browser tabs. Late clients receive replay so existing output is visible after opening or refresh.

## Reorder And Alias

Deck tabs can be reordered when the drag toggle is enabled. Reorder updates index mapping but does not change terminal ids. Double-click rename updates the terminal alias.

## Wrapped Codex Env

Real terminals receive shell-deck environment variables for wrapped Codex hook attribution:

- `SHELL_DECK_CONFIG_ID`
- `SHELL_DECK_TERMINAL_ID`
- `SHELL_DECK_LAUNCH_ID`
- `SHELL_DECK_DATA_ROOT`
- local `SHELL_DECK_INGEST_URL` and optional `SHELL_DECK_INGEST_TOKEN`
