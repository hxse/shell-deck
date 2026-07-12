# Terminal Deck Contract

## Identity

Each terminal has a stable id generated as `term_<shortUuid>`. Terminal indexes are dynamic and follow current visual order. Terminal aliases are tab names and follow the terminal id when tabs are reordered. Default aliases are backend-specific: shell/fake/real tabs use `shell_N`, and text tabs use `text_N`.

Each backend launch also has a required `launchId`. A terminal reset preserves `terminalId` and alias but creates a new `launchId`; snapshots expose both so browser parser state never crosses launch generations.

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
- `real`: shell PTY backend for local shell use. Real shell tabs default to the current user home directory, falling back to the server process cwd only when home cannot be determined. For bash launched without user profile files, shell-deck provides a generated rcfile that sets `PS1="\[\e[1;92m\][\u@\h:\w]\$\[\e[0m\] "` and defines color-friendly aliases (`ls`, `ll`, `la`, `l`, `grep`, `diff`). The prompt shows dynamic user, host, current path, shell marker, and a trailing separator space in bold bright green. The browser terminal font stack prefers locally installed Maple Mono variants before system monospace fallbacks, and the terminal renderer uses normal regular weight with bold weight for bold text; shell-deck does not bundle font files or load remote fonts.
- `text`: synchronized plain-text document backend. Its browser editor shows an aria-hidden, non-selectable, one-based logical-line gutter. Empty content still shows line 1. The gutter follows vertical scroll and never enters stored/captured text. Text editing uses `wrap=off`, so long logical lines scroll horizontally and line numbers remain exactly aligned.

The browser/xterm view displays backend PTY output. The frontend does not local-echo terminal input as truth.

## Browser Chrome Density

The entire workspace topbar is one 36px row with horizontal brand/status text. Macro/Prompt toggles, all three New terminal buttons, and Settings share the same 28px height and 12px text; only their widths and internal switch affordances differ. The terminal tab strip is 40px high, each tab is 34px, and its alias is 12px. The active terminal alias/id/status meta row is 36px high with 11px alias text and 10px id/status text. These chrome rules do not change xterm or Text editor content font sizes.

## Synchronization

The server owns terminal replay and broadcasts `pty_output`, terminal snapshots, and index maps to connected browser tabs. Late clients receive replay so existing output is visible after opening or refresh.

Real PTY stdout is UTF-8 stream-decoded and coalesced in exact order with a 4ms window and 256KiB flush threshold before it reaches replay/fan-out. This batching is program-agnostic; shell-deck does not inspect Codex or any other foreground process.

Each browser connection has an independent, connection-local WebSocket pending queue capped at 64MiB of serialized UTF-8 text frames. A Bun send result below zero means the current frame was accepted with backpressure and must not be resent; later frames wait in FIFO order. A zero result, send failure, or queue overflow closes that client loudly instead of dropping output silently. Drain continuation is scheduled with `setImmediate` after Bun's native drain callback returns, because synchronous or microtask continuation may fail to re-arm another drain after it reaches backpressure again. This queue is not durable and does not pause the shared PTY; reconnect, cross-connection replay beyond the normal 2MiB terminal tail, and global PTY flow control are not provided.

Shell/fake replay is a whole-chunk byte-bounded tail. `TerminalDeckManager.replayByteLimit` is the only retention option, defaults to 2MiB, and must be a positive integer; invalid values fail with `invalid_replay_byte_limit`. A single oversized chunk keeps a valid UTF-8 suffix. Logically discarded array entries are also compacted by bytes: discarded physical strings stay below the replay limit, so default post-append shell replay storage stays below 4MiB rather than retaining an entire large burst behind a moved start index. Text tabs retain their complete user-authored content and are not truncated by the shell replay limit.

Each terminal snapshot carries required `launchId` generation identity. Reset keeps `terminalId` but creates a new `launchId`; the browser must replace its parser generation even when old and new replay text happen to match.

The browser coalesces consecutive `pty_output` per terminal at the animation-frame boundary. Its terminal view carries explicit append/replace render revisions, keeps at most 2Mi UTF-16 code units for shell tab remount, and sends only the current delta to a mounted xterm. Each logical update is fed through a generation-aware callback pump as ordered chunks of at most 32Ki UTF-16 code units, without splitting surrogate pairs and with at most four xterm writes outstanding inside that update. The next logical update cannot start until every callback for the current one completes. A replace creates a new xterm parser generation, clears queued old work, and prevents stale callbacks from publishing state afterward. Parsed test/debug state is limited to the latest 8192 code units; current-generation enqueue/consumed counters advance at the pump and xterm callback boundaries, and reset on parser recreation. Complete terminal history is never mirrored into a DOM attribute. Terminal fitting is driven by mount/recreation and `ResizeObserver`, not by output arrival.

## Reorder And Alias

Deck tabs can be reordered when the drag toggle is enabled. Reorder updates index mapping but does not change terminal ids. Double-click rename updates the terminal alias. The dynamically mounted rename input receives focus on the next DOM tick with its caret at the end; Enter or blur commits through the same alias validator, while Escape cancels.

## Wrapped Codex Env

Real terminals receive shell-deck environment variables for wrapped Codex hook attribution:

- `SHELL_DECK_CONFIG_ID`
- `SHELL_DECK_TERMINAL_ID`
- `SHELL_DECK_LAUNCH_ID`
- `SHELL_DECK_DATA_ROOT`
- local `SHELL_DECK_INGEST_URL` and optional `SHELL_DECK_INGEST_TOKEN`
